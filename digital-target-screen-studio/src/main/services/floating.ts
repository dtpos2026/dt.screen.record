import { Menu } from 'electron'
import type { RecordingState } from '../../shared/types'
import { settingsStore } from '../settings-store'
import { createToolbarWindow, createWebcamWindow, getToolbarWindow, getWebcamWindow, showMainWindow, TOOLBAR_SIZE, visiblePosition } from '../windows'
import { sendTo } from './events'
import { getMainWindow } from '../windows'
import type { ScreenshotMode } from '../../shared/settings'

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
      createToolbarWindow({ x: t.x, y: t.y }, (x, y) => {
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

export function popupScreenshotMenu(take: (mode: ScreenshotMode) => void): void {
  const win = getToolbarWindow()
  const menu = Menu.buildFromTemplate([
    { label: 'Region…', click: () => take('region') },
    { label: 'Full screen', click: () => take('fullscreen') },
    { label: 'Active window', click: () => take('window') },
    { label: 'All displays', click: () => take('all-displays') },
    { type: 'separator' },
    {
      label: 'Open Screenshot Tool',
      click: () => {
        showMainWindow()
        sendTo(getMainWindow(), 'navigate', { page: 'screenshot' })
      }
    }
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
