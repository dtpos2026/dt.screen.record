import { globalShortcut, type BrowserWindow, type Display } from 'electron'
import { createCountdownWindow } from '../windows'

let active: { win: BrowserWindow; finish: (ok: boolean) => void } | null = null

/**
 * Shows a countdown on the given display. Resolves true when it completes,
 * false when the user cancels (Esc, the Cancel button, or the toolbar).
 */
export function runCountdown(seconds: number, display: Display, purpose: 'record' | 'screenshot' = 'screenshot'): Promise<boolean> {
  cancelCountdown()
  return new Promise((resolve) => {
    const win = createCountdownWindow(display, seconds, purpose)
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape')
      if (!win.isDestroyed()) win.destroy()
      if (active?.win === win) active = null
      resolve(ok)
    }
    const timer = setTimeout(() => finish(true), seconds * 1000)
    try {
      globalShortcut.register('Escape', () => finish(false))
    } catch {
      // Another app owns Escape; the Cancel button still works.
    }
    win.on('closed', () => finish(false))
    active = { win, finish }
  })
}

export function cancelCountdown(): boolean {
  if (!active) return false
  active.finish(false)
  return true
}

export function countdownActive(): boolean {
  return !!active
}
