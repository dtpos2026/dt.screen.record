import { BrowserWindow, Notification, shell } from 'electron'
import type { EventChannel, EventContract } from '../../shared/ipc'
import type { Toast } from '../../shared/types'
import { settingsStore } from '../settings-store'
import { brandAsset } from '../paths'
import { getMainWindow, roleOf, type WindowRole } from '../windows'

/** Sends an event to every window (optionally limited to some roles). */
export function broadcast<C extends EventChannel>(channel: C, payload: EventContract[C], only?: WindowRole[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    const role = roleOf(win.webContents)
    if (!role || (only && !only.includes(role))) continue
    if (role === 'engine' && channel !== 'engine:command') continue
    win.webContents.send(channel, payload)
  }
}

export function sendTo<C extends EventChannel>(win: BrowserWindow | null | undefined, channel: C, payload: EventContract[C]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/**
 * Shows an in-app toast when the main window is visible, otherwise a native
 * Windows notification (if the user enabled notifications).
 */
export function notify(toast: Toast): void {
  const main = getMainWindow()
  const visible = !!main && main.isVisible() && !main.isMinimized()
  if (visible) {
    sendTo(main, 'toast', toast)
    return
  }
  if (!settingsStore.get().general.notifications || !Notification.isSupported()) {
    sendTo(main, 'toast', toast)
    return
  }
  const n = new Notification({
    title: toast.title,
    body: toast.message ?? '',
    icon: brandAsset('icon-256.png'),
    silent: toast.kind !== 'error'
  })
  if (toast.revealPath) {
    const p = toast.revealPath
    n.on('click', () => shell.showItemInFolder(p))
  }
  n.show()
  sendTo(main, 'toast', toast)
}
