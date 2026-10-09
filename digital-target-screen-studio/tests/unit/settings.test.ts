import { describe, expect, it } from 'vitest'
import { applySettingsPatch, defaultSettings, normalizeSettings, resolveTheme, THEME_CHROME } from '@shared/settings'

describe('settings', () => {
  it('provides complete defaults', () => {
    const s = defaultSettings()
    expect(s.recording.fps).toBe(30)
    expect(s.recording.resolution).toBe('1080')
    expect(s.audio.sampleRate).toBe(48000)
    expect(s.screenshot.format).toBe('png')
    expect(s.shortcuts.recordToggle).toBe('Alt+Shift+R')
  })

  it('repairs corrupted values instead of failing', () => {
    const s = normalizeSettings({ recording: { fps: 999, resolution: 'bogus', countdownSeconds: -5 }, audio: 'nope', general: null })
    expect(s.recording.fps).toBe(30)
    expect(s.recording.resolution).toBe('1080')
    expect(s.recording.countdownSeconds).toBe(3)
    expect(s.audio.microphone).toBe(false)
    expect(s.general.notifications).toBe(true)
  })

  it('handles garbage input', () => {
    expect(normalizeSettings(null).schemaVersion).toBe(1)
    expect(normalizeSettings('x').recording.fps).toBe(30)
  })

  it('applies valid patch values and keeps previous values for invalid ones', () => {
    const base = applySettingsPatch(defaultSettings(), { recording: { fps: 60 } })
    expect(base.recording.fps).toBe(60)
    const next = applySettingsPatch(base, { recording: { fps: 17, quality: 'ultra' }, audio: { micVolume: 150 } })
    expect(next.recording.fps).toBe(60)
    expect(next.recording.quality).toBe('ultra')
    expect(next.audio.micVolume).toBe(150)
  })

  it('ignores unknown sections and keys', () => {
    const s = applySettingsPatch(defaultSettings(), { hacker: { x: 1 }, recording: { evil: true }, schemaVersion: 9 })
    expect(s).toEqual(defaultSettings())
  })

  it('accepts a region and null', () => {
    const s = applySettingsPatch(defaultSettings(), { recording: { region: { displayId: '1', x: 10, y: 20, width: 300, height: 200 } } })
    expect(s.recording.region?.width).toBe(300)
    const cleared = applySettingsPatch(s, { recording: { region: null } })
    expect(cleared.recording.region).toBeNull()
  })

  it('supports light, dark, midnight and system themes', () => {
    for (const theme of ['light', 'dark', 'midnight', 'system'] as const) {
      expect(applySettingsPatch(defaultSettings(), { general: { theme } }).general.theme).toBe(theme)
    }
    // Unknown or damaged values fall back to the dark theme.
    expect(normalizeSettings({ general: { theme: 'neon' } }).general.theme).toBe('dark')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('midnight', false)).toBe('midnight')
    expect(THEME_CHROME.light.background).toMatch(/^#f/i)
  })
})
