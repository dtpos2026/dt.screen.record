import type { ImageFormat, ScreenshotMode, Settings, SourceMode } from './settings'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface DisplayInfo {
  id: string
  label: string
  /** Bounds in device-independent pixels (DIP), virtual-desktop coordinates. */
  bounds: Rect
  workArea: Rect
  scaleFactor: number
  /** Native pixel size of the display (what a screenshot of it will be). */
  physicalSize: Size
  /** Physical-pixel position in the virtual desktop (used for multi-monitor images). */
  physicalOrigin: { x: number; y: number }
  rotation: number
  isPrimary: boolean
  refreshRate: number
  /** desktopCapturer source id (`screen:…`) if the display is capturable. */
  sourceId: string | null
  thumbnail?: string
}

export interface WindowSourceInfo {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
}

export type CaptureErrorCode =
  | 'NO_SOURCE'
  | 'PERMISSION_DENIED'
  | 'AUDIO_DEVICE_UNAVAILABLE'
  | 'SYSTEM_AUDIO_UNSUPPORTED'
  | 'ENCODER_UNAVAILABLE'
  | 'INVALID_SAVE_LOCATION'
  | 'INSUFFICIENT_DISK_SPACE'
  | 'INIT_FAILED'
  | 'FINALIZE_FAILED'
  | 'FILE_ACCESS'
  | 'BUSY'
  | 'CANCELLED'
  | 'UNKNOWN'

export interface AppErrorInfo {
  code: CaptureErrorCode
  message: string
  /** Optional practical advice shown under the message. */
  hint?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppErrorInfo }

export type RecordingStatus =
  | 'idle'
  | 'selecting'
  | 'countdown'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'finalizing'

export interface RecordingState {
  status: RecordingStatus
  sessionId: string | null
  /** Milliseconds of recorded time (pauses excluded) at `updatedAt`. */
  elapsedMs: number
  /** Wall clock (ms since epoch) when the value above was computed. */
  updatedAt: number
  /** 0 = unlimited. */
  limitMs: number
  countdownRemaining: number
  sourceLabel: string
  sourceMode: SourceMode | null
  output: { width: number; height: number; fps: number; container: string; codec: string } | null
  audio: { system: boolean; microphone: boolean }
  warnings: string[]
  lastError: AppErrorInfo | null
  lastSavedPath: string | null
  finalizeProgress: number
}

export interface AudioLevel {
  /** 0..1 RMS */
  rms: number
  /** 0..1 peak */
  peak: number
  clipping: boolean
}

export interface AudioLevels {
  mic: AudioLevel | null
  system: AudioLevel | null
}

/** What the main process asks the hidden engine window to record. */
export interface RecordingPlan {
  sessionId: string
  video:
    | {
        kind: 'display'
        sourceId: string
        maxWidth: number
        maxHeight: number
      }
    | {
        kind: 'window'
        sourceId: string
        maxWidth: number
        maxHeight: number
      }
    | {
        kind: 'region'
        sourceId: string
        /** Crop rectangle normalised to 0..1 of the source frame. */
        crop: Rect
        maxWidth: number
        maxHeight: number
      }
    | {
        kind: 'composite'
        /** Output canvas size before encoder limits are applied. */
        canvas: Size
        maxWidth: number
        maxHeight: number
        sources: Array<{ sourceId: string; dest: Rect /* normalised 0..1 of the canvas */ }>
      }
  fps: number
  videoBitsPerSecond: number
  codecPreference: Settings['recording']['videoCodec']
  audio: {
    system: boolean
    systemVolume: number
    mic: null | {
      deviceId: string
      channels: 1 | 2
      volume: number
      noiseSuppression: boolean
      echoCancellation: boolean
      autoGainControl: boolean
      voiceEnhancement: boolean
    }
  }
}

export interface EngineStartResult {
  mimeType: string
  width: number
  height: number
  hasAudio: boolean
  warnings: string[]
}

export interface MediaItem {
  path: string
  name: string
  kind: 'video' | 'image'
  ext: string
  size: number
  createdMs: number
  modifiedMs: number
  width: number | null
  height: number | null
  durationSec: number | null
  fps: number | null
  url: string
  thumbnailUrl: string | null
  folder: 'recordings' | 'screenshots'
}

export interface CaptureResult {
  id: string
  width: number
  height: number
  url: string
  mode: ScreenshotMode
  sourceLabel: string
  createdMs: number
  savedPath: string | null
  copied: boolean
}

export interface SaveImageRequest {
  /** Capture id (from a capture) or absolute path of a library image. */
  captureId?: string
  /** Encoded bytes of an edited image (PNG); when present it replaces the capture pixels. */
  bytes?: Uint8Array
  format?: ImageFormat
  quality?: number
  /** 'auto' saves to the screenshots folder, 'dialog' asks where to save. */
  target: 'auto' | 'dialog' | 'overwrite'
  /** Required for target 'overwrite' or for naming edited copies. */
  sourcePath?: string
  suggestedName?: string
}

export interface FfmpegInfo {
  available: boolean
  path: string | null
  version: string | null
  bundled: boolean
  h264Encoders: Array<{ id: string; label: string; hardware: boolean }>
  aac: boolean
  error?: string
}

export interface ExportOptions {
  resolution: 'original' | '2160' | '1440' | '1080' | '720' | '480'
  fps: 'original' | 24 | 30 | 60
  quality: 'high' | 'balanced' | 'small'
  encoder: string // 'auto' or an ffmpeg encoder id
  audioBitrateKbps: number
  removeAudio: boolean
}

export interface ExportProgress {
  jobId: string
  sourcePath: string
  percent: number
  etaSec: number | null
  status: 'running' | 'done' | 'error' | 'cancelled'
  outputPath?: string
  error?: string
}

export interface RecoverableRecording {
  id: string
  sizeBytes: number
  startedMs: number
  file: string
}

export interface AppInfo {
  name: string
  company: string
  version: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: NodeJS.Platform
  arch: string
  osRelease: string
  windowsBuild: number | null
  isPackaged: boolean
  capabilities: {
    systemAudio: boolean
    systemAudioNote: string
    /** Windows 10 2004+ can hide our own windows from captures. */
    excludeFromCapture: boolean
    hardwareAcceleration: boolean
  }
  paths: { recordings: string; screenshots: string; logs: string }
  licenses: Array<{ name: string; version: string; license: string; url?: string }>
}

export type Page = 'dashboard' | 'recorder' | 'screenshot' | 'library' | 'editor' | 'settings' | 'about'

export interface NavigateRequest {
  page: Page
  /** Optional extra info, e.g. `{ captureId }` for the editor or a settings section. */
  params?: Record<string, string>
}

export interface Toast {
  kind: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  /** Optional path to reveal when the toast action is used. */
  revealPath?: string
}

export interface OverlayInit {
  mode: 'screenshot' | 'record'
  display: DisplayInfo
  /** For screenshots: frozen image of the display (dtmedia URL). */
  imageUrl: string | null
  /** Pre-selected rectangle in DIP relative to the display. */
  initial: Rect | null
}

export interface DiskInfo {
  path: string
  freeBytes: number | null
  totalBytes: number | null
}
