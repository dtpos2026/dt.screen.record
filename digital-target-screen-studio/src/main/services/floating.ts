import { Menu, nativeTheme } from 'electron'
import type { RecordingState } from '../../shared/types'
import { settingsStore } from '../settings-store'
import { createToolbarWindow, createWebcamWindow, getToolbarWindow, getWebcamWindow, showMainWindow, TOOLBAR_SIZE, visiblePosition } from '../windows'
import { sendTo } from './events'
import { getMainWindow } from '../windows'
import { resolveTheme, type ScreenshotMode } from '../../shared/settings'

let manualHidden = false
let lastStatus: RecordingState['status'] = 'idle'

/** Shows or hides the floating toolbar according to settings and recording state. */
export function syncToolbar(status: RecordingState['status'] = lastStatus): void {
  lastStatus = status
  const t = settingsStore.get().toolbar
  const recording = status !== 'idle'
  const wanted = !manualHidden && (t.alwaysVisible || (recording && t.showWhileRecording))
  const win = getToolbarWindow()
  if (win && t.x === null && t.y === null) {
    // "Reset position" in Settings: move back to the default spot.
    const p = visiblePosition(null, null, TOOLBAR_SIZE)
    win.setPosition(p.x, p.y)
  }
  if (wanted) {
    const w =
      win ??
      createToolbarWindow({ x: t.x, y: t.y }, resolveTheme(settingsStore.get().general.theme, nativeTheme.shouldUseDarkColors), (x, y) => {
        settingsStore.updateQuiet({ toolbar: { x, y } })
      })
    if (!w.isVisible()) {
      if (w.webContents.isLoading()) w.once('ready-to-show', () => w.showInactive())
      else w.showInactive()
    }
  } else if (win && win.isVisible()) {
    win.hide()
  }
}

export function setToolbarVisible(visible?: boolean): void {
  const win = getToolbarWindow()
  const currently = !!win && win.isVisible()
  const next = visible ?? !currently
  manualHidden = !next
  if (next) {
    // Showing it explicitly makes it stay on screen.
    if (!settingsStore.get().toolbar.alwaysVisible && lastStatus === 'idle') settingsStore.update({ toolbar: { alwaysVisible: true } })
    manualHidden = false
  } else if (lastStatus === 'idle' && settingsStore.get().toolbar.alwaysVisible) {
    settingsStore.update({ toolbar: { alwaysVisible: false } })
  }
  syncToolbar()
}

export function resizeToolbar(width: number, height: number): void {
  const win = getToolbarWindow()
  if (!win) return
  const w = Math.max(TOOLBAR_SIZE.height, Math.min(720, Math.round(width)))
  const h = Math.max(40, Math.min(160, Math.round(height)))
  const [x, y] = win.getPosition()
  win.setBounds({ x, y, width: w, height: h })
}

const DELAY_CHOICES = [0, 3, 5, 10]

/** The toolbar's screenshot menu: every capture mode, the countdown, and shortcuts to the tool and folder. */
export function popupScreenshotMenu(actions: { take: (mode: ScreenshotMode) => void; openFolder: () => void }): void {
  const win = getToolbarWindow()
  const delay = settingsStore.get().screenshot.delaySeconds
  const delays = DELAY_CHOICES.includes(delay) ? DELAY_CHOICES : [...DELAY_CHOICES, delay].sort((a, b) => a - b)
  const menu = Menu.buildFromTemplate([
    { label: 'Region…', click: () => actions.take('region') },
    { label: 'Full screen', click: () => actions.take('fullscreen') },
    { label: 'Active window', click: () => actions.take('window') },
    { label: 'All displays', click: () => actions.take('all-displays') },
    { type: 'separator' },
    {
      label: delay > 0 ? `Countdown (${delay} s)` : 'Countdown',
      submenu: delays.map((s) => ({
        label: s === 0 ? 'No countdown' : `${s} seconds`,
        type: 'radio' as const,
        checked: s === delay,
        click: () => settingsStore.update({ screenshot: { delaySeconds: s } })
      }))
    },
    {
      label: 'Copy to clipboard',
      type: 'checkbox',
      checked: settingsStore.get().screenshot.copyToClipboard,
      click: (item) => settingsStore.update({ screenshot: { copyToClipboard: item.checked } })
    },
    { type: 'separator' },
    {
      label: 'Open Screenshot Tool',
      click: () => {
        showMainWindow()
        sendTo(getMainWindow(), 'navigate', { page: 'screenshot' })
      }
    },
    { label: 'Open screenshots folder', click: actions.openFolder }
  ])
  menu.popup(win ? { window: win } : {})
}

/** Opens or closes the webcam bubble to match settings. */
export function syncWebcam(): void {
  const cfg = settingsStore.get().webcam
  const win = getWebcamWindow()
  if (cfg.enabled && !win) {
    createWebcamWindow({ size: cfg.size, x: cfg.x, y: cfg.y }, (b) => {
      settingsStore.updateQuiet({ webcam: { x: b.x, y: b.y, size: Math.round(b.width) } })
    })
  } else if (!cfg.enabled && win) {
    win.destroy()
  } else if (cfg.enabled && win) {
    const b = win.getBounds()
    if (Math.abs(b.width - cfg.size) > 2) win.setBounds({ ...b, width: cfg.size, height: cfg.size })
    sendTo(win, 'settings:changed', settingsStore.get())
  }
}
