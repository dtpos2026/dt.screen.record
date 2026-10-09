import { MAX_ENCODE_HEIGHT, MAX_ENCODE_PIXELS, MAX_ENCODE_WIDTH } from './constants'
import type { QualityPreset, ResolutionPreset } from './settings'
import type { DisplayInfo, Rect, Size } from './types'

export const PRESET_LABELS: Record<ResolutionPreset, string> = {
  native: 'Original (native)',
  '2160': '2160p 4K UHD',
  '1440': '1440p QHD',
  '1080': '1080p Full HD',
  '720': '720p HD'
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)

export interface OutputSizeResult extends Size {
  /** True when the preset asked for more pixels than the source has. */
  limitedBySource: boolean
  /** True when encoder limits forced a smaller size. */
  limitedByEncoder: boolean
  scale: number
}

/**
 * Computes the recording size for a source. Presets bound the *shorter* side
 * (so "1080p" means 1080 lines on landscape and portrait screens alike).
 * Sources are never upscaled: a 1080p display recorded with the 4K preset is
 * recorded at its real 1920×1080 and the UI says so.
 */
export function computeOutputSize(source: Size, preset: ResolutionPreset): OutputSizeResult {
  const sw = Math.max(2, Math.round(source.width))
  const sh = Math.max(2, Math.round(source.height))
  const shorter = Math.min(sw, sh)
  let scale = 1
  let limitedBySource = false
  if (preset !== 'native') {
    const target = Number(preset)
    if (target < shorter) scale = target / shorter
    else if (target > shorter) limitedBySource = true
  }
  let limitedByEncoder = false
  const enc = encoderScale(sw * scale, sh * scale)
  if (enc < 1) {
    scale *= enc
    limitedByEncoder = true
  }
  return {
    width: even(sw * scale),
    height: even(sh * scale),
    limitedBySource,
    limitedByEncoder,
    scale
  }
}

/** Scale factor (≤ 1) needed to fit a frame inside the H.264 encoder limits. */
export function encoderScale(width: number, height: number): number {
  let s = 1
  if (width * s > MAX_ENCODE_WIDTH) s = MAX_ENCODE_WIDTH / width
  if (height * s > MAX_ENCODE_HEIGHT) s = Math.min(s, MAX_ENCODE_HEIGHT / height)
  const px = width * s * height * s
  if (px > MAX_ENCODE_PIXELS) s *= Math.sqrt(MAX_ENCODE_PIXELS / px)
  return s
}

/** Bits per pixel per frame used for the quality presets. */
const BPP: Record<Exclude<QualityPreset, 'custom'>, number> = {
  standard: 0.06,
  high: 0.1,
  ultra: 0.16
}

export function computeVideoBitrate(size: Size, fps: number, quality: QualityPreset, customMbps = 12): number {
  if (quality === 'custom') return Math.round(customMbps * 1_000_000)
  // Higher frame rates need proportionally fewer bits per frame.
  const fpsFactor = fps > 30 ? 0.75 : 1
  const bps = size.width * size.height * fps * BPP[quality] * fpsFactor
  return Math.round(Math.min(120_000_000, Math.max(1_500_000, bps)))
}

/** Rough storage estimate in bytes per minute for a bitrate (video + audio). */
export function estimateBytesPerMinute(videoBps: number, audioKbps: number, hasAudio: boolean): number {
  const total = videoBps + (hasAudio ? audioKbps * 1000 : 0)
  return Math.round((total / 8) * 60)
}

/** Converts a DIP rectangle relative to a display into a 0..1 normalised rectangle. */
export function normalizeRegion(region: Rect, display: Pick<DisplayInfo, 'bounds'>): Rect {
  const w = display.bounds.width
  const h = display.bounds.height
  const x = clamp(region.x, 0, w)
  const y = clamp(region.y, 0, h)
  const right = clamp(region.x + region.width, 0, w)
  const bottom = clamp(region.y + region.height, 0, h)
  return { x: x / w, y: y / h, width: (right - x) / w, height: (bottom - y) / h }
}

/** Converts a normalised rectangle to whole, even pixel values inside a frame. */
export function denormalizeToFrame(rect: Rect, frame: Size): Rect {
  const evenFloor = (n: number) => Math.max(0, Math.floor(n / 2) * 2)
  const x = Math.min(evenFloor(Math.round(rect.x * frame.width)), Math.max(0, frame.width - 2))
  const y = Math.min(evenFloor(Math.round(rect.y * frame.height)), Math.max(0, frame.height - 2))
  const width = Math.max(2, Math.min(evenFloor(Math.round(rect.width * frame.width)), evenFloor(frame.width - x)))
  const height = Math.max(2, Math.min(evenFloor(Math.round(rect.height * frame.height)), evenFloor(frame.height - y)))
  return { x, y, width, height }
}

/** Physical-pixel size of a DIP region on a display. */
export function regionPhysicalSize(region: Rect, display: Pick<DisplayInfo, 'scaleFactor'>): Size {
  return {
    width: Math.round(region.width * display.scaleFactor),
    height: Math.round(region.height * display.scaleFactor)
  }
}

export interface DesktopLayout {
  canvas: Size
  placements: Array<{ id: string; rect: Rect }>
}

/**
 * Lays out displays in physical pixels for multi-monitor screenshots and
 * "all displays" recordings. Uses each display's physical origin so mixed
 * DPI setups line up the way Windows arranges them.
 */
export function layoutDisplays(displays: Array<Pick<DisplayInfo, 'id' | 'physicalOrigin' | 'physicalSize'>>): DesktopLayout {
  if (displays.length === 0) return { canvas: { width: 0, height: 0 }, placements: [] }
  const minX = Math.min(...displays.map((d) => d.physicalOrigin.x))
  const minY = Math.min(...displays.map((d) => d.physicalOrigin.y))
  const maxX = Math.max(...displays.map((d) => d.physicalOrigin.x + d.physicalSize.width))
  const maxY = Math.max(...displays.map((d) => d.physicalOrigin.y + d.physicalSize.height))
  return {
    canvas: { width: maxX - minX, height: maxY - minY },
    placements: displays.map((d) => ({
      id: d.id,
      rect: {
        x: d.physicalOrigin.x - minX,
        y: d.physicalOrigin.y - minY,
        width: d.physicalSize.width,
        height: d.physicalSize.height
      }
    }))
  }
}

/** Fits `inner` inside `outer` keeping the aspect ratio (letterbox) and centres it. */
export function fitContain(inner: Size, outer: Size): Rect {
  const s = Math.min(outer.width / inner.width, outer.height / inner.height)
  const width = Math.round(inner.width * s)
  const height = Math.round(inner.height * s)
  return { x: Math.round((outer.width - width) / 2), y: Math.round((outer.height - height) / 2), width, height }
}

/** Scales a size down to fit inside max bounds (never up) and makes it even. */
export function fitWithin(size: Size, max: Size): Size {
  const s = Math.min(1, max.width / size.width, max.height / size.height)
  const e = encoderScale(size.width * s, size.height * s)
  return { width: even(size.width * s * e), height: even(size.height * s * e) }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Bounding box used for capture constraints for a preset on a given source. */
export function presetBounds(source: Size, preset: ResolutionPreset): Size {
  const r = computeOutputSize(source, preset)
  return { width: r.width, height: r.height }
}
