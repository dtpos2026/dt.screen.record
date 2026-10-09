import { describe, expect, it } from 'vitest'
import { codecFromMime, exportArgs, exportPlan, finalizeArgs, parseEncoderList, parseProbeJson, parseProgressSeconds, videoEncoderArgs } from '../../src/main/services/ffmpeg-args'
import { imageSizeFromBuffer } from '../../src/main/services/image-meta'

const base = {
  input: 'in.webm',
  output: 'out.mp4.part',
  hasAudio: true,
  constantFrameRate: false,
  fps: 30,
  bitrate: 8_000_000,
  encoder: 'h264_nvenc',
  audioBitrateKbps: 192,
  sampleRate: 48000
}

describe('finalizeArgs', () => {
  it('stream-copies H.264 and encodes AAC', () => {
    const a = finalizeArgs({ ...base, sourceVideoCodec: 'h264' })
    expect(a.join(' ')).toContain('-c:v copy')
    expect(a.join(' ')).toContain('-c:a aac -b:a 192k -ar 48000 -ac 2')
    expect(a).toContain('+faststart')
    expect(a[a.length - 1]).toBe('out.mp4.part')
  })
  it('re-encodes VP9 with the chosen encoder', () => {
    const a = finalizeArgs({ ...base, sourceVideoCodec: 'vp9' }).join(' ')
    expect(a).toContain('-c:v h264_nvenc')
    expect(a).not.toContain('-c:v copy')
  })
  it('enforces constant frame rate when asked', () => {
    expect(finalizeArgs({ ...base, sourceVideoCodec: 'h264', constantFrameRate: true }).join(' ')).toContain('-vf fps=30')
  })
  it('omits audio when there is none', () => {
    const a = finalizeArgs({ ...base, sourceVideoCodec: 'h264', hasAudio: false }).join(' ')
    expect(a).not.toContain('aac')
  })
  it('fails without an encoder when one is needed', () => {
    expect(() => finalizeArgs({ ...base, sourceVideoCodec: 'vp8', encoder: null })).toThrow()
  })
})

describe('encoders', () => {
  it('uses nv12 for Media Foundation / QSV / AMF', () => {
    for (const id of ['h264_mf', 'h264_qsv', 'h264_amf']) expect(videoEncoderArgs(id, 5e6, 30)).toContain('nv12')
    expect(() => videoEncoderArgs('evil; rm -rf', 1, 1)).toThrow()
  })
  it('parses -encoders output', () => {
    const out = ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder\n A....D aac                  AAC (Advanced Audio Coding)\n'
    const set = parseEncoderList(out)
    expect(set.has('h264_nvenc')).toBe(true)
    expect(set.has('aac')).toBe(true)
  })
})

describe('export', () => {
  const ex = { input: 'a.mp4', output: 'b.mp4', sourceWidth: 3840, sourceHeight: 2160, sourceFps: 60, hasAudio: true, resolution: '1080' as const, fps: 30 as const, quality: 'balanced' as const, encoder: 'libx264', audioBitrateKbps: 160, removeAudio: false }
  it('plans downscale and frame rate', () => {
    expect(exportPlan(ex)).toMatchObject({ width: 1920, height: 1080, fps: 30 })
    expect(exportArgs(ex).join(' ')).toContain('scale=1920:1080:flags=lanczos,fps=30')
  })
  it('never upscales or raises fps', () => {
    expect(exportPlan({ ...ex, sourceWidth: 1280, sourceHeight: 720, sourceFps: 24, fps: 60 })).toMatchObject({ width: 1280, height: 720, fps: 24 })
  })
  it('can drop audio', () => {
    expect(exportArgs({ ...ex, removeAudio: true })).toContain('-an')
  })
})

describe('parsers', () => {
  it('reads progress', () => {
    expect(parseProgressSeconds('frame=10\nout_time_us=2500000\nprogress=continue\n')).toBe(2.5)
    expect(parseProgressSeconds('nothing')).toBeNull()
  })
  it('reads ffprobe JSON', () => {
    const p = parseProbeJson(JSON.stringify({ format: { duration: '5.07' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' }, { codec_type: 'audio', codec_name: 'aac' }] }))
    expect(p).toMatchObject({ durationSec: 5.07, width: 1920, height: 1080, fps: 29.97, hasAudio: true, videoCodec: 'h264' })
  })
  it('detects codecs from MediaRecorder mime types', () => {
    expect(codecFromMime('video/webm;codecs=h264,opus')).toBe('h264')
    expect(codecFromMime('video/webm;codecs=vp9,opus')).toBe('vp9')
    expect(codecFromMime('video/webm;codecs=vp8')).toBe('vp8')
  })
})

describe('image headers', () => {
  it('reads PNG and JPEG dimensions', () => {
    const png = Buffer.alloc(32)
    png.writeUInt32BE(0x89504e47, 0)
    png.write('IHDR', 12, 'ascii')
    png.writeUInt32BE(3840, 16)
    png.writeUInt32BE(2160, 20)
    expect(imageSizeFromBuffer(png)).toEqual({ width: 3840, height: 2160 })
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03])
    expect(imageSizeFromBuffer(jpg)).toEqual({ width: 1920, height: 1080 })
  })
})
