import type { ImageFormat, ScreenshotMode, Settings, SettingsPatch } from './settings'
import type {
  AppErrorInfo,
  AppInfo,
  AudioLevels,
  CaptureResult,
  DiskInfo,
  DisplayInfo,
  EngineStartResult,
  ExportOptions,
  ExportProgress,
  FfmpegInfo,
  MediaItem,
  NavigateRequest,
  OverlayInit,
  RecordingPlan,
  RecordingState,
  RecoverableRecording,
  Rect,
  Result,
  SaveImageRequest,
  Toast,
  WindowSourceInfo
} from './types'

/**
 * The complete renderer → main request contract. Every channel is validated
 * in the main process (see src/main/ipc/schemas.ts) and restricted to the
 * window roles that need it.
 */
export interface InvokeContract {
  'app:info': { req: void; res: AppInfo }
  'app:quit': { req: void; res: void }
  'settings:get': { req: void; res: Settings }
  'settings:update': { req: SettingsPatch; res: Settings }
  'settings:reset': { req: void; res: Settings }
  'dialog:chooseFolder': { req: { purpose: 'recordings' | 'screenshots' }; res: string | null }
  'shell:openFolder': { req: { kind: 'recordings' | 'screenshots' | 'logs' }; res: void }
  'shell:openSystemSettings': { req: { target: 'microphone' | 'camera' | 'sound' | 'display' }; res: void }
  'system:disk': { req: { kind: 'recordings' | 'screenshots' }; res: DiskInfo }
  'system:mediaAccess': { req: void; res: { microphone: string; camera: string; screen: string } }

  'capture:displays': { req: { thumbnails?: boolean }; res: DisplayInfo[] }
  'capture:windows': { req: void; res: WindowSourceInfo[] }

  'recording:start': { req: void; res: Result<null> }
  'recording:stop': { req: void; res: void }
  'recording:pause': { req: void; res: void }
  'recording:resume': { req: void; res: void }
  'recording:toggle': { req: void; res: void }
  'recording:discard': { req: void; res: boolean }
  'recording:cancelCountdown': { req: void; res: void }
  'recording:state': { req: void; res: RecordingState }
  'recording:selectRegion': { req: { displayId?: string }; res: Result<{ displayId: string; rect: Rect } | null> }
  'recording:selectWindow': { req: { sourceId: string; name: string }; res: void }
  'recording:recoverable': { req: void; res: RecoverableRecording[] }
  'recording:recover': { req: { id: string }; res: Result<string> }
  'recording:discardRecoverable': { req: { id: string }; res: boolean }

  'screenshot:capture': {
    req: { mode: ScreenshotMode; displayId?: string; windowId?: string; delaySeconds?: number }
    res: Result<CaptureResult | null>
  }
  'screenshot:readBytes': { req: { captureId?: string; path?: string }; res: Uint8Array }
  'screenshot:save': { req: SaveImageRequest; res: Result<string | null> }
  'screenshot:copy': { req: { captureId?: string; bytes?: Uint8Array; path?: string }; res: Result<null> }
  'screenshot:discard': { req: { captureId: string }; res: void }
  'screenshot:get': { req: { captureId: string }; res: CaptureResult | null }

  'library:list': { req: void; res: MediaItem[] }
  'library:thumbnail': { req: { path: string }; res: string | null }
  'library:rename': { req: { path: string; newName: string }; res: Result<MediaItem> }
  'library:delete': { req: { paths: string[] }; res: Result<string[]> }
  'library:reveal': { req: { path: string }; res: void }
  'library:open': { req: { path: string }; res: Result<null> }

  'export:info': { req: { refresh?: boolean }; res: FfmpegInfo }
  'export:start': { req: { path: string; options: ExportOptions }; res: Result<string> }
  'export:cancel': { req: { jobId: string }; res: void }

  'window:navigate': { req: NavigateRequest; res: void }
  'window:minimize': { req: void; res: void }
  'toolbar:toggle': { req: { visible?: boolean }; res: void }
  'toolbar:screenshotMenu': { req: void; res: void }
  'toolbar:resize': { req: { width: number; height: number }; res: void }

  'overlay:init': { req: void; res: OverlayInit | null }
  'overlay:submit': { req: { rect: Rect | null }; res: void }

  'webcam:config': { req: void; res: Settings['webcam'] }
  'webcam:close': { req: void; res: void }

  'engine:ready': { req: void; res: void }
  'engine:reply': { req: { reqId: number; ok: boolean; value?: unknown; error?: AppErrorInfo }; res: void }
  'engine:chunk': { req: { sessionId: string; data: Uint8Array }; res: boolean }
}

export type InvokeChannel = keyof InvokeContract
export type InvokeReq<C extends InvokeChannel> = InvokeContract[C]['req']
export type InvokeRes<C extends InvokeChannel> = InvokeContract[C]['res']

/** Fire-and-forget messages renderer → main. */
export interface SendContract {
  'engine:levels': AudioLevels
  'engine:warning': { sessionId: string; message: string }
  'engine:fatal': { sessionId: string; error: AppErrorInfo }
}
export type SendChannel = keyof SendContract

/** Push events main → renderer. */
export interface EventContract {
  'settings:changed': Settings
  'recording:state': RecordingState
  'audio:levels': AudioLevels
  'library:changed': void
  'export:progress': ExportProgress
  'navigate': NavigateRequest
  'screenshot:captured': CaptureResult
  'toast': Toast
  'recovery:available': RecoverableRecording[]
  'overlay:init': OverlayInit
  'engine:command': EngineCommand
}
export type EventChannel = keyof EventContract

export type EngineCommand =
  | { reqId: number; cmd: 'start'; plan: RecordingPlan }
  | { reqId: number; cmd: 'pause' }
  | { reqId: number; cmd: 'resume' }
  | { reqId: number; cmd: 'stop' }
  | { reqId: number; cmd: 'abort' }
  | { reqId: number; cmd: 'grabFrame'; sourceId: string }
  | { reqId: number; cmd: 'encodeImage'; png: Uint8Array; format: ImageFormat; quality: number }

export type EngineStartReply = EngineStartResult

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  'app:info', 'app:quit', 'settings:get', 'settings:update', 'settings:reset', 'dialog:chooseFolder',
  'shell:openFolder', 'shell:openSystemSettings', 'system:disk', 'system:mediaAccess', 'capture:displays',
  'capture:windows', 'recording:start', 'recording:stop', 'recording:pause', 'recording:resume',
  'recording:toggle', 'recording:discard', 'recording:cancelCountdown', 'recording:state',
  'recording:selectRegion', 'recording:selectWindow', 'recording:recoverable', 'recording:recover',
  'recording:discardRecoverable', 'screenshot:capture', 'screenshot:readBytes', 'screenshot:save',
  'screenshot:copy', 'screenshot:discard', 'screenshot:get', 'library:list', 'library:thumbnail',
  'library:rename', 'library:delete', 'library:reveal', 'library:open', 'export:info', 'export:start',
  'export:cancel', 'window:navigate', 'window:minimize', 'toolbar:toggle', 'toolbar:screenshotMenu',
  'toolbar:resize', 'overlay:init', 'overlay:submit', 'webcam:config', 'webcam:close', 'engine:ready',
  'engine:reply', 'engine:chunk'
] as const

export const SEND_CHANNELS: readonly SendChannel[] = ['engine:levels', 'engine:warning', 'engine:fatal'] as const

export const EVENT_CHANNELS: readonly EventChannel[] = [
  'settings:changed', 'recording:state', 'audio:levels', 'library:changed', 'export:progress', 'navigate',
  'screenshot:captured', 'toast', 'recovery:available', 'overlay:init', 'engine:command'
] as const

/** The API exposed to renderers as `window.dt` by the preload script. */
export interface DtBridge {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeReq<C> extends void ? [] : [InvokeReq<C>]): Promise<InvokeRes<C>>
  send<C extends SendChannel>(channel: C, payload: SendContract[C]): void
  on<C extends EventChannel>(channel: C, listener: (payload: EventContract[C]) => void): () => void
  platform: NodeJS.Platform
}
