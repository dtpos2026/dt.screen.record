const pad = (n: number, len = 2) => String(n).padStart(len, '0')

/** `2026-10-09_14-30-05` in local time — sortable and safe on every filesystem. */
export function timestampForFilename(date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  )
}

export function recordingBaseName(date = new Date()): string {
  return `DT-Recording_${timestampForFilename(date)}`
}

export function screenshotBaseName(date = new Date()): string {
  return `DT-Screenshot_${timestampForFilename(date)}`
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/

export type FileNameCheck = { ok: true; name: string } | { ok: false; reason: string }

/**
 * Validates a user-supplied file name (without folder). Rejects anything that
 * could escape the target folder or is invalid on Windows.
 */
export function validateFileName(input: string): FileNameCheck {
  const name = input.trim()
  if (!name) return { ok: false, reason: 'Enter a file name.' }
  if (name.length > 200) return { ok: false, reason: 'The name is too long (200 characters max).' }
  if (name === '.' || name === '..') return { ok: false, reason: 'That name is not allowed.' }
  if (INVALID_CHARS.test(name)) return { ok: false, reason: 'Names cannot contain < > : " / \\ | ? * or control characters.' }
  if (/[. ]$/.test(name)) return { ok: false, reason: 'Names cannot end with a dot or a space.' }
  if (WINDOWS_RESERVED.test(name)) return { ok: false, reason: 'That name is reserved by Windows.' }
  return { ok: true, name }
}

/** Splits `name.ext` → [`name`, `.ext`] (extension lower-cased). */
export function splitExt(fileName: string): [string, string] {
  const i = fileName.lastIndexOf('.')
  if (i <= 0) return [fileName, '']
  return [fileName.slice(0, i), fileName.slice(i).toLowerCase()]
}

/** Returns a name that does not collide: `name.ext`, `name (2).ext`, `name (3).ext`… */
export function uniqueName(base: string, ext: string, exists: (candidate: string) => boolean): string {
  let candidate = `${base}${ext}`
  for (let i = 2; exists(candidate); i++) {
    candidate = `${base} (${i})${ext}`
    if (i > 9999) throw new Error('Could not find a free file name')
  }
  return candidate
}
