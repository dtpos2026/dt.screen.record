import type { AppErrorInfo, CaptureErrorCode } from './types'

const DEFAULTS: Record<CaptureErrorCode, { message: string; hint?: string }> = {
  NO_SOURCE: {
    message: 'No screen or window is available to capture.',
    hint: 'Make sure a display is connected and awake, then try again. Minimised windows cannot be captured.'
  },
  PERMISSION_DENIED: {
    message: 'Windows blocked access to the capture device.',
    hint: 'Open Windows Settings → Privacy & security and allow desktop apps to use the microphone/camera.'
  },
  AUDIO_DEVICE_UNAVAILABLE: {
    message: 'The selected audio device is not available.',
    hint: 'Reconnect the device, choose another microphone, or turn the microphone off for this recording.'
  },
  SYSTEM_AUDIO_UNSUPPORTED: {
    message: 'System audio capture is not available on this computer.',
    hint: 'System audio requires Windows 10 or 11 with an active playback device. Turn system audio off to record without it.'
  },
  ENCODER_UNAVAILABLE: {
    message: 'No compatible video encoder is available.',
    hint: 'Update your graphics driver. The app falls back to software encoding when hardware encoding is unavailable.'
  },
  INVALID_SAVE_LOCATION: {
    message: 'The save folder cannot be used.',
    hint: 'Choose a different folder in Settings → General. The folder must exist and be writable.'
  },
  INSUFFICIENT_DISK_SPACE: {
    message: 'There is not enough free disk space.',
    hint: 'Free up space or choose a save folder on another drive.'
  },
  INIT_FAILED: {
    message: 'The recording could not be started.',
    hint: 'Try a lower resolution or frame rate, close other capture apps, and try again.'
  },
  FINALIZE_FAILED: {
    message: 'The recording could not be finalised.',
    hint: 'The raw recording has been kept so nothing is lost. You can recover it from the Dashboard.'
  },
  FILE_ACCESS: {
    message: 'The file could not be accessed.',
    hint: 'Check that the file is not open in another program and that you have permission to change it.'
  },
  BUSY: { message: 'Another capture is already in progress.' },
  CANCELLED: { message: 'Cancelled.' },
  UNKNOWN: { message: 'Something went wrong.', hint: 'Details were written to the log file (Settings → Advanced).' }
}

export const CAPTURE_ERROR_CODES = Object.keys(DEFAULTS) as CaptureErrorCode[]

export function appError(code: CaptureErrorCode, message?: string, hint?: string): AppErrorInfo {
  const d = DEFAULTS[code]
  return { code, message: message ?? d.message, hint: hint ?? d.hint }
}

export class AppError extends Error {
  readonly info: AppErrorInfo
  constructor(code: CaptureErrorCode, message?: string, hint?: string) {
    const info = appError(code, message, hint)
    super(info.message)
    this.info = info
  }
}

export function toAppError(err: unknown, fallback: CaptureErrorCode = 'UNKNOWN'): AppErrorInfo {
  if (err instanceof AppError) return err.info
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const e = err as { code: unknown; message: unknown; hint?: unknown }
    if (typeof e.code === 'string' && e.code in DEFAULTS && typeof e.message === 'string') {
      return { code: e.code as CaptureErrorCode, message: e.message, hint: typeof e.hint === 'string' ? e.hint : undefined }
    }
    if (e.code === 'ENOSPC') return appError('INSUFFICIENT_DISK_SPACE')
    if (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EBUSY') return appError('FILE_ACCESS')
  }
  return appError(fallback)
}

/** Maps getUserMedia DOMException names to our error codes. */
export function mediaErrorCode(name: string | undefined): CaptureErrorCode {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'PERMISSION_DENIED'
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'NotReadableError':
    case 'AbortError':
      return 'AUDIO_DEVICE_UNAVAILABLE'
    default:
      return 'INIT_FAILED'
  }
}
