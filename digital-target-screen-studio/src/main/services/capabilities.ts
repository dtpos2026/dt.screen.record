import { app } from 'electron'
import { release } from 'node:os'

export interface Capabilities {
  windowsBuild: number | null
  /** WDA_EXCLUDEFROMCAPTURE needs Windows 10 version 2004 (build 19041) or later. */
  excludeFromCapture: boolean
  systemAudio: boolean
  systemAudioNote: string
  hardwareAcceleration: boolean
}

let cached: Capabilities | null = null

export function windowsBuild(): number | null {
  if (process.platform !== 'win32') return null
  const parts = release().split('.')
  const build = Number(parts[2])
  return Number.isFinite(build) ? build : null
}

export function capabilities(): Capabilities {
  if (cached) return cached
  const build = windowsBuild()
  const win = process.platform === 'win32'
  cached = {
    windowsBuild: build,
    excludeFromCapture: win && (build ?? 0) >= 19041,
    systemAudio: win || process.platform === 'linux',
    systemAudioNote: win
      ? 'System audio is captured from the default playback device using Windows audio loopback (WASAPI).'
      : process.platform === 'linux'
        ? 'System audio on Linux depends on PulseAudio/PipeWire loopback support and may be unavailable.'
        : 'System audio capture is not supported on this platform.',
    hardwareAcceleration: app.isHardwareAccelerationEnabled()
  }
  return cached
}
