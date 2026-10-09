/**
 * Helpers for Electron accelerators (global keyboard shortcuts). Kept free of
 * DOM / Electron imports so they can run in every process and in unit tests.
 */

const MODIFIERS = ['CommandOrControl', 'Control', 'Ctrl', 'Alt', 'Shift', 'Super', 'Meta', 'Command', 'Cmd', 'Option', 'AltGr']
const NAMED_KEYS = new Set([
  'Plus', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter', 'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc', 'PrintScreen', 'numadd', 'numsub', 'nummult', 'numdiv',
  'numdec', 'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9'
])

function isKey(part: string): boolean {
  if (/^[A-Z0-9]$/i.test(part)) return true
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(part)) return true
  if (/^[`\-=[\];',./\\]$/.test(part)) return true
  return NAMED_KEYS.has(part)
}

/** True for accelerators like `Alt+Shift+R`, `PrintScreen`, `Ctrl+F9`. Empty string = disabled. */
export function isValidAccelerator(acc: string): boolean {
  if (acc === '') return true
  const parts = acc.split('+')
  if (parts.some((p) => p === '')) return false
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  if (!isKey(key)) return false
  if (new Set(mods).size !== mods.length) return false
  if (!mods.every((m) => MODIFIERS.includes(m))) return false
  // Plain letters/digits without a modifier would hijack normal typing.
  if (mods.length === 0 && !/^(F([1-9]|1[0-9]|2[0-4])|PrintScreen)$/.test(key)) return false
  return true
}

export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** Converts a keydown event into an accelerator, or null while only modifiers are held. */
export function acceleratorFromEvent(e: KeyLike, isMac = false): string | null {
  const key = keyFromCode(e.code, e.key)
  if (!key) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push(isMac ? 'Control' : 'CommandOrControl')
  if (e.metaKey) parts.push(isMac ? 'CommandOrControl' : 'Super')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

function keyFromCode(code: string, key: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  const map: Record<string, string> = {
    Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Enter: 'Return',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', PrintScreen: 'PrintScreen', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    Backslash: '\\', Backquote: '`', NumpadAdd: 'numadd', NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec'
  }
  if (map[code]) return map[code]
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'].includes(key)) return null
  return null
}

/** Human-friendly label, e.g. `CommandOrControl+Shift+R` → `Ctrl + Shift + R`. */
export function formatAccelerator(acc: string, isMac = false): string {
  if (!acc) return 'Not set'
  return acc
    .split('+')
    .map((p) => {
      if (p === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
      if (p === 'Super') return isMac ? '⌘' : 'Win'
      if (p === 'Return') return 'Enter'
      if (p === 'PrintScreen') return 'PrtSc'
      return p
    })
    .join(' + ')
}

/** Finds actions that share the same accelerator. */
export function findConflicts(map: Record<string, string>): string[][] {
  const groups = new Map<string, string[]>()
  for (const [action, acc] of Object.entries(map)) {
    if (!acc) continue
    const norm = acc.toLowerCase().replace(/\bctrl\b|\bcontrol\b|\bcommandorcontrol\b/g, 'ctrl')
    groups.set(norm, [...(groups.get(norm) ?? []), action])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}
