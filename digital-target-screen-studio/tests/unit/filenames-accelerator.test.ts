import { describe, expect, it } from 'vitest'
import { recordingBaseName, screenshotBaseName, splitExt, timestampForFilename, uniqueName, validateFileName } from '@shared/filenames'
import { acceleratorFromEvent, findConflicts, formatAccelerator, isValidAccelerator } from '@shared/accelerator'
import { formatBytes, formatDuration } from '@shared/format'

describe('filenames', () => {
  it('builds sortable timestamp names', () => {
    const d = new Date(2026, 9, 9, 14, 3, 5)
    expect(timestampForFilename(d)).toBe('2026-10-09_14-03-05')
    expect(recordingBaseName(d)).toBe('DT-Recording_2026-10-09_14-03-05')
    expect(screenshotBaseName(d)).toBe('DT-Screenshot_2026-10-09_14-03-05')
  })
  it('rejects unsafe names', () => {
    for (const bad of ['', '..', 'a/b', 'a\\b', 'con', 'LPT1.txt', 'name.', 'what?', 'x'.repeat(201)]) {
      expect(validateFileName(bad).ok, bad).toBe(false)
    }
    expect(validateFileName('  My demo  ')).toEqual({ ok: true, name: 'My demo' })
  })
  it('avoids collisions', () => {
    const taken = new Set(['a.png', 'a (2).png'])
    expect(uniqueName('a', '.png', (n) => taken.has(n))).toBe('a (3).png')
    expect(splitExt('clip.MP4')).toEqual(['clip', '.mp4'])
  })
})

describe('accelerators', () => {
  it('validates', () => {
    expect(isValidAccelerator('Alt+Shift+R')).toBe(true)
    expect(isValidAccelerator('PrintScreen')).toBe(true)
    expect(isValidAccelerator('')).toBe(true)
    expect(isValidAccelerator('R')).toBe(false)
    expect(isValidAccelerator('Alt+Alt+R')).toBe(false)
    expect(isValidAccelerator('Foo+R')).toBe(false)
  })
  it('converts keyboard events', () => {
    const e = { key: 'r', code: 'KeyR', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }
    expect(acceleratorFromEvent(e)).toBe('CommandOrControl+Shift+R')
    expect(acceleratorFromEvent({ ...e, key: 'Shift', code: 'ShiftLeft' })).toBeNull()
    expect(formatAccelerator('CommandOrControl+Shift+R')).toBe('Ctrl + Shift + R')
  })
  it('finds conflicts', () => {
    expect(findConflicts({ a: 'Alt+R', b: 'alt+r', c: 'Alt+S', d: '' })).toEqual([['a', 'b']])
  })
})

describe('format', () => {
  it('formats sizes and durations', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB')
    expect(formatDuration(75_000)).toBe('01:15')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})
