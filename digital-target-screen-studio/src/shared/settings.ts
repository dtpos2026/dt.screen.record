import { z } from 'zod'

/**
 * Persistent user preferences. Every field has a `.catch()` fallback so a
 * corrupted or hand-edited settings file can never prevent the app from
 * starting: invalid values silently fall back to their defaults.
 */

export const THEMES = ['system', 'light', 'dark', 'midnight'] as const
export type ThemeSetting = (typeof THEMES)[number]
export type EffectiveTheme = Exclude<ThemeSetting, 'system'>

/** Resolves 'system' to light/dark using the OS preference. */
export function resolveTheme(theme: ThemeSetting, systemPrefersDark: boolean): EffectiveTheme {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light'
  return theme
}

/** Window colours per theme (title-bar overlay, first-paint background). */
export const THEME_CHROME: Record<EffectiveTheme, { background: string; symbol: string }> = {
  dark: { background: '#0d0717', symbol: '#E0AAFF' },
  midnight: { background: '#06030c', symbol: '#E0AAFF' },
  light: { background: '#f6f3fb', symbol: '#3C096C' }
}

export const RESOLUTION_PRESETS = ['native', '2160', '1440', '1080', '720'] as const
export type ResolutionPreset = (typeof RESOLUTION_PRESETS)[number]

export const FPS_OPTIONS = [24, 30, 60] as const
export type Fps = (typeof FPS_OPTIONS)[number]

export const QUALITY_PRESETS = ['standard', 'high', 'ultra', 'custom'] as const
export type QualityPreset = (typeof QUALITY_PRESETS)[number]

export const SOURCE_MODES = ['display', 'window', 'region', 'all-displays'] as const
export type SourceMode = (typeof SOURCE_MODES)[number]

export const SCREENSHOT_MODES = ['region', 'fullscreen', 'display', 'window', 'all-displays'] as const
export type ScreenshotMode = (typeof SCREENSHOT_MODES)[number]

export const IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const
export type ImageFormat = (typeof IMAGE_FORMATS)[number]

export const AUDIO_BITRATES = [128, 160, 192, 256, 320] as const
export const SAMPLE_RATES = [44100, 48000] as const

export const SHORTCUT_ACTIONS = [
  'recordToggle',
  'pauseToggle',
  'screenshotRegion',
  'screenshotFullscreen',
  'screenshotWindow',
  'toggleToolbar'
] as const
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]

const regionSchema = z.object({
  displayId: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive()
})
export type SavedRegion = z.infer<typeof regionSchema>

const int = (min: number, max: number) => z.number().int().min(min).max(max)

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  recordToggle: 'Alt+Shift+R',
  pauseToggle: 'Alt+Shift+P',
  screenshotRegion: 'Alt+Shift+S',
  screenshotFullscreen: 'Alt+Shift+F',
  screenshotWindow: 'Alt+Shift+W',
  toggleToolbar: 'Alt+Shift+T'
}

const generalSchema = z.object({
  recordingsDir: z.string().max(1024).catch(''),
  screenshotsDir: z.string().max(1024).catch(''),
  launchAtStartup: z.boolean().catch(false),
  startMinimized: z.boolean().catch(false),
  minimizeToTray: z.boolean().catch(true),
  closeToTray: z.boolean().catch(true),
  notifications: z.boolean().catch(true),
  showSplash: z.boolean().catch(true),
  hideWindowWhileCapturing: z.boolean().catch(true),
  theme: z.enum(THEMES).catch('dark'),
  reduceMotion: z.boolean().catch(false),
  onboardingDone: z.boolean().catch(false)
})

const recordingSchema = z.object({
  sourceMode: z.enum(SOURCE_MODES).catch('display'),
  displayId: z.string().max(64).catch(''),
  region: regionSchema.nullable().catch(null),
  resolution: z.enum(RESOLUTION_PRESETS).catch('1080'),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).catch(30),
  quality: z.enum(QUALITY_PRESETS).catch('high'),
  customBitrateMbps: z.number().min(1).max(150).catch(12),
  outputFormat: z.enum(['mp4', 'webm']).catch('mp4'),
  videoCodec: z.enum(['auto', 'h264', 'vp9', 'vp8']).catch('auto'),
  constantFrameRate: z.boolean().catch(false),
  countdownSeconds: int(0, 60).catch(3),
  durationLimitSeconds: int(0, 24 * 3600).catch(0),
  minimizeOnStart: z.boolean().catch(true),
  showRegionBorder: z.boolean().catch(true)
})

const audioSchema = z.object({
  systemAudio: z.boolean().catch(true),
  microphone: z.boolean().catch(false),
  micDeviceId: z.string().max(512).catch('default'),
  micVolume: int(0, 200).catch(100),
  systemVolume: int(0, 200).catch(100),
  sampleRate: z.union([z.literal(44100), z.literal(48000)]).catch(48000),
  bitrateKbps: z.union([z.literal(128), z.literal(160), z.literal(192), z.literal(256), z.literal(320)]).catch(192),
  micChannels: z.union([z.literal(1), z.literal(2)]).catch(1),
  noiseSuppression: z.boolean().catch(true),
  echoCancellation: z.boolean().catch(false),
  autoGainControl: z.boolean().catch(false),
  voiceEnhancement: z.boolean().catch(true)
})

const screenshotSchema = z.object({
  format: z.enum(IMAGE_FORMATS).catch('png'),
  jpegQuality: int(1, 100).catch(92),
  webpQuality: int(1, 100).catch(90),
  defaultMode: z.enum(SCREENSHOT_MODES).catch('region'),
  delaySeconds: int(0, 60).catch(0),
  copyToClipboard: z.boolean().catch(true),
  showPreview: z.boolean().catch(true)
})

const webcamSchema = z.object({
  enabled: z.boolean().catch(false),
  deviceId: z.string().max(512).catch('default'),
  shape: z.enum(['circle', 'rounded']).catch('circle'),
  size: int(120, 600).catch(220),
  mirror: z.boolean().catch(true),
  x: z.number().int().nullable().catch(null),
  y: z.number().int().nullable().catch(null)
})

const shortcutsSchema = z.object({
  recordToggle: z.string().max(64).catch(DEFAULT_SHORTCUTS.recordToggle),
  pauseToggle: z.string().max(64).catch(DEFAULT_SHORTCUTS.pauseToggle),
  screenshotRegion: z.string().max(64).catch(DEFAULT_SHORTCUTS.screenshotRegion),
  screenshotFullscreen: z.string().max(64).catch(DEFAULT_SHORTCUTS.screenshotFullscreen),
  screenshotWindow: z.string().max(64).catch(DEFAULT_SHORTCUTS.screenshotWindow),
  toggleToolbar: z.string().max(64).catch(DEFAULT_SHORTCUTS.toggleToolbar)
})

const toolbarSchema = z.object({
  /** Keep the floating toolbar on screen even when not recording. */
  alwaysVisible: z.boolean().catch(false),
  /** Show the floating toolbar automatically while recording. */
  showWhileRecording: z.boolean().catch(true),
  x: z.number().int().nullable().catch(null),
  y: z.number().int().nullable().catch(null)
})

const librarySchema = z.object({
  view: z.enum(['grid', 'list']).catch('grid'),
  sort: z.enum(['newest', 'oldest', 'name', 'size']).catch('newest')
})

export const settingsSchema = z.object({
  schemaVersion: z.literal(1).catch(1),
  general: generalSchema.catch(() => generalSchema.parse({})),
  recording: recordingSchema.catch(() => recordingSchema.parse({})),
  audio: audioSchema.catch(() => audioSchema.parse({})),
  screenshot: screenshotSchema.catch(() => screenshotSchema.parse({})),
  webcam: webcamSchema.catch(() => webcamSchema.parse({})),
  shortcuts: shortcutsSchema.catch(() => shortcutsSchema.parse({})),
  toolbar: toolbarSchema.catch(() => toolbarSchema.parse({})),
  library: librarySchema.catch(() => librarySchema.parse({}))
})

export type Settings = z.infer<typeof settingsSchema>
export type SettingsSection = Exclude<keyof Settings, 'schemaVersion'>

export type SettingsPatch = {
  [K in SettingsSection]?: Partial<Settings[K]>
}

export function defaultSettings(): Settings {
  return settingsSchema.parse({})
}

/** Parse anything (e.g. JSON from disk) into valid settings, repairing invalid fields. */
export function normalizeSettings(input: unknown): Settings {
  const obj = input && typeof input === 'object' ? input : {}
  return settingsSchema.parse(obj)
}

const SECTION_SCHEMAS = {
  general: generalSchema,
  recording: recordingSchema,
  audio: audioSchema,
  screenshot: screenshotSchema,
  webcam: webcamSchema,
  shortcuts: shortcutsSchema,
  toolbar: toolbarSchema,
  library: librarySchema
} satisfies Record<SettingsSection, z.ZodObject>

/**
 * Applies a patch section-by-section. Unknown sections or keys are ignored and
 * invalid values keep their previous value (instead of being reset).
 */
export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return current
  const next = structuredClone(current) as Record<SettingsSection, Record<string, unknown>> & Settings
  for (const [section, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!(section in SECTION_SCHEMAS)) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const shape = SECTION_SCHEMAS[section as SettingsSection].shape as Record<string, z.ZodType>
    const target = next[section as SettingsSection] as Record<string, unknown>
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const field = shape[key]
      if (!field) continue
      const strict = field instanceof z.ZodCatch ? (field.unwrap() as z.ZodType) : field
      const parsed = strict.safeParse(v)
      if (parsed.success) target[key] = parsed.data
    }
  }
  return normalizeSettings(next)
}
