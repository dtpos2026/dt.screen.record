import { denormalizeToFrame, fitContain, fitWithin } from '@shared/recording-math'
import type { Rect, Size } from '@shared/types'

/** Opens a desktop (screen or window) capture stream through Chromium's native capturer. */
export async function openDesktopVideo(sourceId: string, max: Size, fps: number): Promise<MediaStream> {
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: Math.round(max.width),
        maxHeight: Math.round(max.height),
        maxFrameRate: fps
      }
    }
  } as unknown as MediaStreamConstraints
  return navigator.mediaDevices.getUserMedia(constraints)
}

export interface VideoPipeline {
  track: MediaStreamTrack
  size: () => Size
  stop: () => void
}

/** Native capture bounds: large enough that Chromium never downscales (it never upscales). */
export const NATIVE_MAX: Size = { width: 8192, height: 8192 }

/**
 * Crops a region out of a display capture (and scales it if the preset asks
 * for a smaller size). Runs on Chromium's insertable streams, so it does not
 * depend on the window being visible.
 */
export function cropPipeline(source: MediaStreamTrack, crop: Rect, max: Size, onError: (e: unknown) => void): VideoPipeline {
  let canvas: OffscreenCanvas | null = null
  let ctx: OffscreenCanvasRenderingContext2D | null = null
  let src: Rect | null = null
  let out: Size = { width: 2, height: 2 }
  let frameKey = ''
  return transformPipeline(
    source,
    (frame) => {
      const key = `${frame.displayWidth}x${frame.displayHeight}`
      if (key !== frameKey || !canvas || !ctx || !src) {
        frameKey = key
        src = denormalizeToFrame(crop, { width: frame.displayWidth, height: frame.displayHeight })
        if (!canvas) {
          out = fitWithin({ width: src.width, height: src.height }, max)
          canvas = new OffscreenCanvas(out.width, out.height)
          ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
          ctx.imageSmoothingQuality = 'high'
        }
      }
      ctx!.drawImage(frame, src.x, src.y, src.width, src.height, 0, 0, out.width, out.height)
      return canvas
    },
    () => out,
    onError
  )
}

/**
 * Window capture: the output size is fixed by the first frame so encoders get
 * a constant frame size; if the window is resized later it is letterboxed.
 */
export function windowPipeline(source: MediaStreamTrack, max: Size, onError: (e: unknown) => void): VideoPipeline {
  let canvas: OffscreenCanvas | null = null
  let ctx: OffscreenCanvasRenderingContext2D | null = null
  let out: Size = { width: 2, height: 2 }
  return transformPipeline(
    source,
    (frame) => {
      const fw = frame.displayWidth
      const fh = frame.displayHeight
      if (!canvas) {
        out = fitWithin({ width: fw, height: fh }, max)
        canvas = new OffscreenCanvas(out.width, out.height)
        ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
        ctx.imageSmoothingQuality = 'high'
      }
      const dest = fitContain({ width: fw, height: fh }, out)
      if (dest.width !== out.width || dest.height !== out.height) {
        ctx!.fillStyle = '#000'
        ctx!.fillRect(0, 0, out.width, out.height)
      }
      ctx!.drawImage(frame, 0, 0, fw, fh, dest.x, dest.y, dest.width, dest.height)
      return canvas
    },
    () => out,
    onError
  )
}

function transformPipeline(
  source: MediaStreamTrack,
  draw: (frame: VideoFrame) => OffscreenCanvas,
  size: () => Size,
  onError: (e: unknown) => void
): VideoPipeline {
  const processor = new MediaStreamTrackProcessor({ track: source })
  const generator = new MediaStreamTrackGenerator({ kind: 'video' })
  const abort = new AbortController()
  const transformer = new TransformStream<VideoFrame, VideoFrame>({
    transform(frame, controller) {
      try {
        const canvas = draw(frame)
        controller.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp }))
      } finally {
        frame.close()
      }
    }
  })
  processor.readable
    .pipeThrough(transformer, { signal: abort.signal })
    .pipeTo(generator.writable, { signal: abort.signal })
    .catch((e) => {
      if (!abort.signal.aborted) onError(e)
    })
  return {
    track: generator,
    size,
    stop: () => {
      abort.abort()
      generator.stop()
      source.stop()
    }
  }
}

/**
 * "All displays": draws every display stream into one canvas at the target
 * frame rate. Each source keeps its latest frame; a timer composes them.
 */
export function compositePipeline(
  sources: Array<{ track: MediaStreamTrack; dest: Rect }>,
  canvasSize: Size,
  max: Size,
  fps: number,
  onError: (e: unknown) => void
): VideoPipeline {
  const out = fitWithin(canvasSize, max)
  const canvas = new OffscreenCanvas(out.width, out.height)
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, out.width, out.height)
  const generator = new MediaStreamTrackGenerator({ kind: 'video' })
  const writer = generator.writable.getWriter()
  const latest: Array<VideoFrame | null> = sources.map(() => null)
  let running = true
  let writing = false

  sources.forEach((s, i) => {
    const reader = new MediaStreamTrackProcessor({ track: s.track }).readable.getReader()
    const pump = async () => {
      while (running) {
        const { value, done } = await reader.read()
        if (done || !value) break
        latest[i]?.close()
        latest[i] = value
      }
    }
    pump().catch((e) => running && onError(e))
  })

  const timer = setInterval(() => {
    if (!running || writing) return
    for (let i = 0; i < sources.length; i++) {
      const f = latest[i]
      if (!f) continue
      const d = sources[i].dest
      ctx.drawImage(f, 0, 0, f.displayWidth, f.displayHeight, d.x * out.width, d.y * out.height, d.width * out.width, d.height * out.height)
    }
    writing = true
    const frame = new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) })
    writer
      .write(frame)
      .catch((e) => running && onError(e))
      .finally(() => {
        writing = false
      })
  }, 1000 / fps)

  return {
    track: generator,
    size: () => out,
    stop: () => {
      running = false
      clearInterval(timer)
      latest.forEach((f) => f?.close())
      writer.close().catch(() => undefined)
      generator.stop()
      sources.forEach((s) => s.track.stop())
    }
  }
}

/** Reads the first frame of a track (waiting for real content) and returns its size. */
export async function firstFrameSize(track: MediaStreamTrack, timeoutMs = 4000): Promise<Size | null> {
  // getSettings() reports the constraint bounds for desktop capture, not the
  // real frame size, so read an actual frame from a clone of the track.
  const clone = track.clone()
  try {
    const reader = new MediaStreamTrackProcessor({ track: clone }).readable.getReader()
    const result = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))])
    if (!result || !result.value) return null
    const size = { width: result.value.displayWidth, height: result.value.displayHeight }
    result.value.close()
    reader.cancel().catch(() => undefined)
    return size
  } finally {
    clone.stop()
  }
}

/** Grabs one frame at native resolution and returns it as PNG bytes. */
export async function grabFramePng(sourceId: string): Promise<Uint8Array> {
  const stream = await openDesktopVideo(sourceId, NATIVE_MAX, 30)
  const track = stream.getVideoTracks()[0]
  try {
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
    // Skip the very first frame: some capturers deliver an empty frame first.
    let frame: VideoFrame | undefined
    for (let i = 0; i < 2; i++) {
      const r = await Promise.race([reader.read(), new Promise<null>((res) => setTimeout(() => res(null), 3000))])
      if (!r?.value) break
      frame?.close()
      frame = r.value
    }
    if (!frame) throw new Error('No frame received')
    const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
    canvas.getContext('2d')!.drawImage(frame, 0, 0)
    frame.close()
    reader.cancel().catch(() => undefined)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    track.stop()
  }
}

export async function encodeImage(png: Uint8Array, format: 'png' | 'jpeg' | 'webp', quality: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { alpha: format !== 'jpeg' })!
  if (format === 'jpeg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, bitmap.width, bitmap.height)
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: `image/${format}`, quality: Math.max(0.01, Math.min(1, quality / 100)) })
  if (format === 'webp' && blob.type !== 'image/webp') throw new Error('WebP encoding is not supported')
  return new Uint8Array(await blob.arrayBuffer())
}
