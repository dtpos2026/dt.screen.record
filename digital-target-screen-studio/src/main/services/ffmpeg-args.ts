/**
 * Pure FFmpeg argument builders (no Electron imports) so they can be unit
 * tested. All commands are spawned with an argument array — never through a
 * shell — so file names cannot inject commands.
 */

export interface EncoderSpec {
  id: string
  label: string
  hardware: boolean
}

/** Preference order: hardware encoders first, then software fallbacks. */
export const H264_ENCODERS: EncoderSpec[] = [
  { id: 'h264_nvenc', label: 'NVIDIA NVENC (hardware)', hardware: true },
  { id: 'h264_qsv', label: 'Intel Quick Sync (hardware)', hardware: true },
  { id: 'h264_amf', label: 'AMD AMF (hardware)', hardware: true },
  { id: 'h264_mf', label: 'Windows Media Foundation', hardware: true },
  { id: 'h264_videotoolbox', label: 'Apple VideoToolbox (hardware)', hardware: true },
  { id: 'libx264', label: 'x264 (software)', hardware: false },
  { id: 'libopenh264', label: 'OpenH264 (software)', hardware: false }
]

export function encoderLabel(id: string): string {
  return H264_ENCODERS.find((e) => e.id === id)?.label ?? id
}

/** Parses `ffmpeg -encoders` output into a set of encoder names. */
export function parseEncoderList(output: string): Set<string> {
  const names = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*[VAS][.A-Z]{5}\s+(\S+)/.exec(line)
    if (m) names.add(m[1])
  }
  return names
}

export function parseVersion(output: string): string | null {
  const m = /ffmpeg version (\S+)/.exec(output)
  return m ? m[1] : null
}

/** Arguments for a quick encode test of one encoder. */
export function encoderTestArgs(id: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=0.3',
    ...videoEncoderArgs(id, 1_000_000, 30),
    '-frames:v', '6', '-f', 'null', '-'
  ]
}

export function videoEncoderArgs(id: string, bitrate: number, fps: number): string[] {
  const b = String(Math.round(bitrate))
  const max = String(Math.round(bitrate * 1.5))
  const buf = String(Math.round(bitrate * 2))
  const gop = String(Math.max(12, Math.round(fps * 2)))
  switch (id) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', gop]
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'medium', '-b:v', b, '-maxrate', max, '-profile:v', 'high', '-pix_fmt', 'nv12', '-g', gop]
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', max, '-profile:v', 'high', '-pix_fmt', 'nv12', '-g', gop]
    case 'h264_mf':
      return ['-c:v', 'h264_mf', '-b:v', b, '-pix_fmt', 'nv12', '-g', gop]
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', '-b:v', b, '-maxrate', max, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', gop]
    case 'libx264':
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', gop]
    case 'libopenh264':
      return ['-c:v', 'libopenh264', '-b:v', b, '-maxrate', max, '-pix_fmt', 'yuv420p', '-g', gop]
    default:
      throw new Error(`Unsupported encoder ${id}`)
  }
}

export function audioEncoderArgs(bitrateKbps: number, sampleRate: number): string[] {
  return ['-c:a', 'aac', '-b:a', `${bitrateKbps}k`, '-ar', String(sampleRate), '-ac', '2']
}

export interface FinalizeArgsInput {
  input: string
  output: string
  /** Codec of the recorded video stream (from MediaRecorder). */
  sourceVideoCodec: 'h264' | 'vp8' | 'vp9' | 'other'
  hasAudio: boolean
  constantFrameRate: boolean
  fps: number
  bitrate: number
  encoder: string | null
  audioBitrateKbps: number
  sampleRate: number
}

/**
 * Builds the command that turns the raw WebM written during recording into a
 * standard MP4. H.264 video is copied without re-encoding (fast, lossless);
 * other codecs are encoded with the best available H.264 encoder. Audio is
 * encoded to AAC at the user's bitrate / sample rate.
 */
export function finalizeArgs(o: FinalizeArgsInput): string[] {
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-fflags', '+genpts', '-i', o.input, '-map', '0:v:0']
  if (o.hasAudio) args.push('-map', '0:a:0?')
  const copy = o.sourceVideoCodec === 'h264' && !o.constantFrameRate
  if (copy) {
    args.push('-c:v', 'copy')
  } else {
    if (!o.encoder) throw new Error('No H.264 encoder available')
    if (o.constantFrameRate) args.push('-vf', `fps=${o.fps}`)
    args.push(...videoEncoderArgs(o.encoder, o.bitrate, o.fps))
  }
  if (o.hasAudio) args.push(...audioEncoderArgs(o.audioBitrateKbps, o.sampleRate))
  args.push('-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', '-nostats', o.output)
  return args
}

export interface ExportArgsInput {
  input: string
  output: string
  sourceWidth: number
  sourceHeight: number
  sourceFps: number | null
  hasAudio: boolean
  resolution: 'original' | '2160' | '1440' | '1080' | '720' | '480'
  fps: 'original' | 24 | 30 | 60
  quality: 'high' | 'balanced' | 'small'
  encoder: string
  audioBitrateKbps: number
  removeAudio: boolean
}

const EXPORT_BPP = { high: 0.1, balanced: 0.06, small: 0.035 } as const

export function exportPlan(o: ExportArgsInput): { width: number; height: number; fps: number; bitrate: number } {
  const shorter = Math.min(o.sourceWidth, o.sourceHeight)
  let scale = 1
  if (o.resolution !== 'original') {
    const target = Number(o.resolution)
    if (target < shorter) scale = target / shorter
  }
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
  const width = even(o.sourceWidth * scale)
  const height = even(o.sourceHeight * scale)
  const srcFps = o.sourceFps && o.sourceFps > 0 && o.sourceFps <= 240 ? o.sourceFps : 30
  const fps = o.fps === 'original' ? Math.round(srcFps) : Math.min(o.fps, Math.max(1, Math.round(srcFps)) || o.fps)
  const bitrate = Math.round(Math.min(80_000_000, Math.max(800_000, width * height * fps * EXPORT_BPP[o.quality] * (fps > 30 ? 0.75 : 1))))
  return { width, height, fps, bitrate }
}

export function exportArgs(o: ExportArgsInput): string[] {
  const plan = exportPlan(o)
  const filters: string[] = []
  if (plan.width !== o.sourceWidth || plan.height !== o.sourceHeight) filters.push(`scale=${plan.width}:${plan.height}:flags=lanczos`)
  if (o.fps !== 'original') filters.push(`fps=${plan.fps}`)
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', o.input, '-map', '0:v:0']
  const keepAudio = o.hasAudio && !o.removeAudio
  if (keepAudio) args.push('-map', '0:a:0?')
  if (filters.length) args.push('-vf', filters.join(','))
  args.push(...videoEncoderArgs(o.encoder, plan.bitrate, plan.fps))
  if (keepAudio) args.push(...audioEncoderArgs(o.audioBitrateKbps, 48000))
  else args.push('-an')
  args.push('-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', '-nostats', o.output)
  return args
}

export function thumbnailArgs(input: string, output: string, atSec: number): string[] {
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-ss', atSec.toFixed(2), '-i', input,
    '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', output
  ]
}

/** Parses `-progress pipe:1` key=value blocks; returns processed seconds or null. */
export function parseProgressSeconds(chunk: string): number | null {
  let last: number | null = null
  for (const line of chunk.split(/\r?\n/)) {
    const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
    if (m) last = Number(m[1]) / 1_000_000
  }
  return last
}

export interface ProbeResult {
  durationSec: number | null
  width: number | null
  height: number | null
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  hasVideo: boolean
  hasAudio: boolean
}

function parseRate(rate: unknown): number | null {
  if (typeof rate !== 'string') return null
  const [n, d] = rate.split('/').map(Number)
  if (!n || !d) return null
  const v = n / d
  return v > 0 && v < 1000 ? Math.round(v * 100) / 100 : null
}

/** Parses `ffprobe -print_format json -show_format -show_streams` output. */
export function parseProbeJson(json: string): ProbeResult {
  const data = JSON.parse(json) as {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string }>
  }
  const streams = data.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video')
  const a = streams.find((s) => s.codec_type === 'audio')
  const dur = Number(data.format?.duration ?? v?.duration ?? NaN)
  return {
    durationSec: Number.isFinite(dur) ? dur : null,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps: parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate),
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    hasVideo: !!v,
    hasAudio: !!a
  }
}

/** Codec inside a MediaRecorder mime type, e.g. `video/webm;codecs=h264,opus` → `h264`. */
export function codecFromMime(mime: string): 'h264' | 'vp8' | 'vp9' | 'other' {
  const m = mime.toLowerCase()
  if (m.includes('h264') || m.includes('avc1')) return 'h264'
  if (m.includes('vp9') || m.includes('vp09')) return 'vp9'
  if (m.includes('vp8')) return 'vp8'
  return 'other'
}
