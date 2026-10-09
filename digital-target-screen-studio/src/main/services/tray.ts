import { Menu, Tray, nativeImage, shell } from 'electron'
import { formatAccelerator } from '../../shared/accelerator'
import { formatDuration } from '../../shared/format'
import type { ScreenshotMode } from '../../shared/settings'
import type { RecordingState } from '../../shared/types'
import { brandAsset } from '../paths'
import { settingsStore } from '../settings-store'
import { getMainWindow, getToolbarWindow, showMainWindow } from '../windows'
import { sendTo } from './events'

export interface TrayActions {
  toggleRecording: () => void
  togglePause: () => void
  discard: () => void
  screenshot: (mode: ScreenshotMode) => void
  toggleToolbar: () => void
  quit: () => void
}

let tray: Tray | null = null
let actions: TrayActions | null = null
let state: RecordingState | null = null
let tooltipTimer: NodeJS.Timeout | null = null

function icon(recording: boolean) {
  const img = nativeImage.createFromPath(brandAsset(recording ? 'tray-recording.png' : 'tray.png'))
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16, quality: 'best' })
}

export function createTray(a: TrayActions): Tray {
  actions = a
  tray = new Tray(icon(false))
  tray.setToolTip('Digital Target Screen Studio')
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
  rebuild()
  return tray
}

function navigate(page: 'settings' | 'library'): void {
  showMainWindow()
  sendTo(getMainWindow(), 'navigate', { page })
}

export function rebuild(): void {
  if (!tray || !actions) return
  const a = actions
  const s = settingsStore.get()
  const status = state?.status ?? 'idle'
  const active = status === 'recording' || status === 'paused'
  const busy = status !== 'idle'
  const sc = s.shortcuts
  const acc = (x: string) => (x ? formatAccelerator(x) : undefined)
  const menu = Menu.buildFromTemplate([
    { label: 'Open Digital Target Screen Studio', click: () => showMainWindow() },
    { type: 'separator' },
    active
      ? { label: 'Stop and save recording', sublabel: acc(sc.recordToggle), click: a.toggleRecording }
      : { label: status === 'countdown' ? 'Cancel countdown' : 'Start recording', sublabel: acc(sc.recordToggle), enabled: status === 'idle' || status === 'countdown', click: a.toggleRecording },
    { label: status === 'paused' ? 'Resume recording' : 'Pause recording', sublabel: acc(sc.pauseToggle), enabled: active, click: a.togglePause },
    { label: 'Discard recording…', enabled: active, click: a.discard },
    { type: 'separator' },
    {
      label: 'Take screenshot',
      enabled: !busy || active,
      submenu: [
        { label: 'Region…', sublabel: acc(sc.screenshotRegion), click: () => a.screenshot('region') },
        { label: 'Full screen', sublabel: acc(sc.screenshotFullscreen), click: () => a.screenshot('fullscreen') },
        { label: 'Active window', sublabel: acc(sc.screenshotWindow), click: () => a.screenshot('window') },
        { label: 'All displays', click: () => a.screenshot('all-displays') }
      ]
    },
    { label: 'Floating toolbar', type: 'checkbox', checked: !!getToolbarWindow()?.isVisible(), click: a.toggleToolbar },
    { type: 'separator' },
    { label: 'Open recordings folder', click: () => void shell.openPath(s.general.recordingsDir) },
    { label: 'Open screenshots folder', click: () => void shell.openPath(s.general.screenshotsDir) },
    { label: 'Media library', click: () => navigate('library') },
    { label: 'Settings', click: () => navigate('settings') },
    { type: 'separator' },
    { label: 'Quit', click: a.quit }
  ])
  tray.setContextMenu(menu)
}

export function updateTray(next: RecordingState): void {
  const prevStatus = state?.status
  state = next
  if (!tray) return
  const active = next.status === 'recording' || next.status === 'paused'
  if (prevStatus !== next.status) {
    tray.setImage(icon(active))
    rebuild()
  }
  if (tooltipTimer) clearInterval(tooltipTimer)
  tooltipTimer = null
  const setTip = () => {
    if (!tray || !state) return
    const s = state
    const elapsed = s.elapsedMs + (s.status === 'recording' ? Date.now() - s.updatedAt : 0)
    tray.setToolTip(
      s.status === 'recording'
        ? `Recording ${formatDuration(elapsed)} — Digital Target Screen Studio`
        : s.status === 'paused'
          ? `Paused at ${formatDuration(elapsed)} — Digital Target Screen Studio`
          : s.status === 'finalizing'
            ? 'Saving recording… — Digital Target Screen Studio'
            : 'Digital Target Screen Studio'
    )
  }
  setTip()
  if (next.status === 'recording') tooltipTimer = setInterval(setTip, 1000)
}

export function destroyTray(): void {
  if (tooltipTimer) clearInterval(tooltipTimer)
  tray?.destroy()
  tray = null
}
