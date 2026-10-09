import { computeOutputSize, computeVideoBitrate, estimateBytesPerMinute, PRESET_LABELS, regionPhysicalSize, layoutDisplays } from '@shared/recording-math'
import type { Settings } from '@shared/settings'
import type { DisplayInfo, Size } from '@shared/types'

export function sourceSummary(s: Settings, displays: DisplayInfo[], windowName?: string | null): string {
  const r = s.recording
  if (r.sourceMode === 'window') return windowName ? `Window: ${windowName}` : 'Application window (choose one)'
  if (r.sourceMode === 'all-displays') return `All displays (${displays.length || 1})`
  if (r.sourceMode === 'region') {
    if (!r.region) return 'Custom region (select an area)'
    const d = displays.find((x) => x.id === r.region!.displayId)
    const p = d ? regionPhysicalSize(r.region, d) : { width: Math.round(r.region.width), height: Math.round(r.region.height) }
    return `Region ${p.width} × ${p.height}`
  }
  const d = displays.find((x) => x.id === r.displayId) ?? displays.find((x) => x.isPrimary) ?? displays[0]
  return d ? `Full screen · ${d.label.replace(/^\d+\.\s*/, '')}` : 'Full screen'
}

export function audioSummary(s: Settings): string {
  const a = s.audio
  if (a.systemAudio && a.microphone) return 'System audio + microphone'
  if (a.systemAudio) return 'System audio only'
  if (a.microphone) return 'Microphone only'
  return 'No audio (muted)'
}

/** Native pixel size of the current source, if it can be known up front. */
export function sourceSize(s: Settings, displays: DisplayInfo[]): Size | null {
  const r = s.recording
  if (r.sourceMode === 'window') return null
  if (r.sourceMode === 'all-displays') return displays.length ? layoutDisplays(displays).canvas : null
  if (r.sourceMode === 'region') {
    if (!r.region) return null
    const d = displays.find((x) => x.id === r.region!.displayId)
    return d ? regionPhysicalSize(r.region, d) : null
  }
  const d = displays.find((x) => x.id === r.displayId) ?? displays.find((x) => x.isPrimary) ?? displays[0]
  return d?.physicalSize ?? null
}

export interface QualityInfo {
  label: string
  output: Size | null
  limitedBySource: boolean
  limitedByEncoder: boolean
  bitrate: number | null
  bytesPerMinute: number | null
}

export function qualityInfo(s: Settings, displays: DisplayInfo[]): QualityInfo {
  const r = s.recording
  const src = sourceSize(s, displays)
  const out = src ? computeOutputSize(src, r.resolution) : null
  const bitrate = out ? computeVideoBitrate(out, r.fps, r.quality, r.customBitrateMbps) : null
  const hasAudio = s.audio.systemAudio || s.audio.microphone
  const q = r.quality === 'custom' ? `${r.customBitrateMbps} Mbps` : r.quality[0].toUpperCase() + r.quality.slice(1)
  return {
    label: `${r.resolution === 'native' ? 'Native' : `${r.resolution}p`} · ${r.fps} fps · ${q}`,
    output: out ? { width: out.width, height: out.height } : null,
    limitedBySource: !!out?.limitedBySource,
    limitedByEncoder: !!out?.limitedByEncoder,
    bitrate,
    bytesPerMinute: bitrate ? estimateBytesPerMinute(bitrate, s.audio.bitrateKbps, hasAudio) : null
  }
}

export function presetLabel(p: Settings['recording']['resolution']): string {
  return PRESET_LABELS[p]
}
