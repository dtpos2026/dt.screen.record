import { globalShortcut } from 'electron'
import { isValidAccelerator } from '../../shared/accelerator'
import { SHORTCUT_ACTIONS, type Settings, type ShortcutAction } from '../../shared/settings'
import { createLogger } from '../logger'

const log = createLogger('shortcuts')
let registered: string[] = []

/**
 * (Re)registers the global shortcuts. Returns the accelerators that could
 * not be registered (usually because another application already uses them).
 */
export function registerShortcuts(map: Settings['shortcuts'], handlers: Record<ShortcutAction, () => void>): string[] {
  for (const acc of registered) {
    try {
      globalShortcut.unregister(acc)
    } catch {
      // ignore
    }
  }
  registered = []
  const failed: string[] = []
  const used = new Set<string>()
  for (const action of SHORTCUT_ACTIONS) {
    const acc = map[action]
    if (!acc || !isValidAccelerator(acc) || used.has(acc.toLowerCase())) {
      if (acc) failed.push(acc)
      continue
    }
    try {
      if (globalShortcut.register(acc, handlers[action])) {
        registered.push(acc)
        used.add(acc.toLowerCase())
      } else failed.push(acc)
    } catch {
      failed.push(acc)
    }
  }
  if (failed.length) log.warn(`Shortcuts unavailable: ${failed.join(', ')}`)
  return failed
}

export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll()
  registered = []
}
