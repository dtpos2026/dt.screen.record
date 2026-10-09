import { INTERMEDIATE_AUDIO_BITRATE, RECORDING_TIMESLICE_MS } from '@shared/constants'
import { appError, mediaErrorCode } from '@shared/errors'
import type { AppErrorInfo, AudioLevels, EngineStartResult, RecordingPlan } from '@shared/types'
import { buildVoiceChain, openMicrophone, readLevel, type VoiceChain } from '../lib/audio-chain'
import { compositePipeline, cropPipeline, firstFrameSize, NATIVE_MAX, openDesktopVideo, windowPipeline, type VideoPipeline } from './video'

class EngineError extends Error {
  constructor(public info: AppErrorInfo) {
    super(info.message)
  }
}

const H264 = ['video/webm;codecs=h264', 'video/webm;codecs=avc1']
const VP9 = ['video/webm;codecs=vp9']
const VP8 = ['video/webm;codecs=vp8']

/** Picks the first MediaRecorder format this Chromium build supports. */
export function pickMimeType(pref: RecordingPlan['codecPreference'], withAudio: boolean): string {
  const order =
    pref === 'vp9' ? [...VP9, ...VP8, ...H264] : pref === 'vp8' ? [...VP8, ...VP9, ...H264] : [...H264, ...VP9, ...VP8]
  for (const base of order) {
    const mime = withAudio ? `${base},opus` : base
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  if (MediaRecorder.isTypeSupported('video/webm')) return 'video/webm'
  throw new EngineError(appError('ENCODER_UNAVAILABLE', 'This system cannot encode video with the built-in recorder.'))
}

/** Captures Windows system audio (WASAPI loopback) via getDisplayMedia, with a legacy fallback. */
async function openSystemAudio(): Promise<MediaStream> {
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    s.getVideoTracks().forEach((t) => {
      t.stop()
      s.removeTrack(t)
    })
    if (s.getAudioTracks().length) return s
  } catch {
    // fall through to the legacy path
  }
  const legacy = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 64, maxHeight: 64, maxFrameRate: 1 } }
  } as unknown as MediaStreamConstraints)
  legacy.getVideoTracks().forEach((t) => {
    t.stop()
    legacy.removeTrack(t)
  })
  if (!legacy.getAudioTracks().length) throw new Error('No loopback track')
  return legacy
}

export interface SessionCallbacks {
  chunk: (data: Uint8Array) => Promise<void>
  levels: (l: AudioLevels) => void
  warning: (message: string) => void
  fatal: (error: AppErrorInfo) => void
}

/** One recording: owns streams, the audio graph and the MediaRecorder. */
export class RecordingSession {
  private streams: MediaStream[] = []
  private pipeline: VideoPipeline | null = null
  private ctx: AudioContext | null = null
  private mic: VoiceChain | null = null
  private systemMeter: AnalyserNode | null = null
  private recorder: MediaRecorder | null = null
  private uploads: Promise<void> = Promise.resolve()
  private levelTimer: number | null = null
  private stopped = false

  constructor(private plan: RecordingPlan, private cb: SessionCallbacks) {}

  async start(): Promise<EngineStartResult> {
    const warnings: string[] = []
    try {
      const videoTrack = await this.openVideo()
      const size = this.pipeline ? this.pipeline.size() : await firstFrameSize(videoTrack)
      if (!size) throw new EngineError(appError('NO_SOURCE', 'The capture source did not produce any frames.', 'Make sure the screen is on and the window is not minimised.'))

      const audioTrack = await this.openAudio(warnings)
      const tracks = [videoTrack, ...(audioTrack ? [audioTrack] : [])]
      const mimeType = pickMimeType(this.plan.codecPreference, !!audioTrack)
      const stream = new MediaStream(tracks)
      const options: MediaRecorderOptions = {
        mimeType,
        videoBitsPerSecond: this.plan.videoBitsPerSecond,
        audioBitsPerSecond: INTERMEDIATE_AUDIO_BITRATE,
        videoKeyFrameIntervalDuration: 2000
      }
      const rec = new MediaRecorder(stream, options)
      rec.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return
        const blob = e.data
        this.uploads = this.uploads
          .then(async () => {
            const buf = new Uint8Array(await blob.arrayBuffer())
            await this.cb.chunk(buf)
          })
          .catch((err) => {
            if (!this.stopped) this.cb.fatal(appError('FILE_ACCESS', `Recording data could not be saved: ${(err as Error)?.message ?? err}`))
          })
      }
      rec.onerror = (e) => {
        const err = (e as unknown as { error?: DOMException }).error
        this.cb.fatal(appError('INIT_FAILED', `The video encoder stopped: ${err?.message ?? 'unknown error'}.`))
      }
      videoTrack.addEventListener('ended', () => {
        if (!this.stopped) this.cb.fatal(appError('NO_SOURCE', 'The captured screen or window is no longer available.'))
      })
      rec.start(RECORDING_TIMESLICE_MS)
      this.recorder = rec
      this.startLevels()
      return { mimeType, width: size.width, height: size.height, hasAudio: !!audioTrack, warnings }
    } catch (err) {
      this.release()
      if (err instanceof EngineError) throw err
      const e = err as DOMException
      const code = mediaErrorCode(e?.name)
      throw new EngineError(appError(code === 'AUDIO_DEVICE_UNAVAILABLE' ? 'INIT_FAILED' : code, `The recording could not be started: ${e?.message ?? String(err)}`))
    }
  }

  private async openVideo(): Promise<MediaStreamTrack> {
    const v = this.plan.video
    const fps = this.plan.fps
    const onError = (e: unknown) => {
      if (!this.stopped) this.cb.fatal(appError('INIT_FAILED', `Video processing failed: ${(e as Error)?.message ?? e}`))
    }
    const open = async (sourceId: string, max = NATIVE_MAX) => {
      try {
        const s = await openDesktopVideo(sourceId, max, fps)
        this.streams.push(s)
        return s.getVideoTracks()[0]
      } catch (err) {
        const name = (err as DOMException)?.name
        throw new EngineError(
          name === 'NotAllowedError'
            ? appError('PERMISSION_DENIED', 'Screen capture permission was denied.')
            : appError('NO_SOURCE', 'The screen or window could not be captured.', 'It may have been closed, minimised, or protected from capture.')
        )
      }
    }
    switch (v.kind) {
      case 'display':
        // Chromium scales inside the capturer, keeping the aspect ratio and never upscaling.
        return open(v.sourceId, { width: v.maxWidth, height: v.maxHeight })
      case 'region': {
        const t = await open(v.sourceId)
        this.pipeline = cropPipeline(t, v.crop, { width: v.maxWidth, height: v.maxHeight }, onError)
        await this.waitForPipeline()
        return this.pipeline.track
      }
      case 'window': {
        const t = await open(v.sourceId)
        this.pipeline = windowPipeline(t, { width: v.maxWidth, height: v.maxHeight }, onError)
        await this.waitForPipeline()
        return this.pipeline.track
      }
      case 'composite': {
        const tracks = []
        for (const s of v.sources) tracks.push({ track: await open(s.sourceId), dest: s.dest })
        this.pipeline = compositePipeline(tracks, v.canvas, { width: v.maxWidth, height: v.maxHeight }, fps, onError)
        return this.pipeline.track
      }
    }
  }

  /** Waits until the pipeline has produced its first frame (so its size is known). */
  private async waitForPipeline(timeoutMs = 5000): Promise<void> {
    const t0 = performance.now()
    while (this.pipeline && this.pipeline.size().width <= 2 && performance.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 30))
    }
    if (this.pipeline && this.pipeline.size().width <= 2) {
      throw new EngineError(appError('NO_SOURCE', 'The capture source did not produce any frames.'))
    }
  }

  private async openAudio(warnings: string[]): Promise<MediaStreamTrack | null> {
    const a = this.plan.audio
    if (!a.system && !a.mic) return null
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' })
    this.ctx = ctx
    await ctx.resume().catch(() => undefined)
    const dest = ctx.createMediaStreamDestination()
    dest.channelCount = 2

    if (a.system) {
      let sys: MediaStream
      try {
        sys = await openSystemAudio()
      } catch {
        throw new EngineError(appError('SYSTEM_AUDIO_UNSUPPORTED'))
      }
      this.streams.push(sys)
      const src = ctx.createMediaStreamSource(sys)
      const gain = ctx.createGain()
      gain.gain.value = a.systemVolume
      const meter = ctx.createAnalyser()
      meter.fftSize = 2048
      src.connect(gain)
      gain.connect(meter)
      gain.connect(dest)
      this.systemMeter = meter
      sys.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (!this.stopped) this.cb.warning('System audio stopped (the playback device changed or was disconnected). Video recording continues.')
      })
    }

    if (a.mic) {
      let micStream: MediaStream
      try {
        const opened = await openMicrophone(a.mic)
        micStream = opened.stream
        if (opened.usedFallback) warnings.push('The selected microphone was not found, so the default microphone is being used.')
      } catch (err) {
        const name = (err as DOMException)?.name
        throw new EngineError(
          name === 'NotAllowedError'
            ? appError('PERMISSION_DENIED', 'Microphone access is blocked.', 'Open Windows Settings → Privacy & security → Microphone and allow desktop apps to use the microphone.')
            : appError('AUDIO_DEVICE_UNAVAILABLE', 'The microphone could not be opened.', 'Check that it is connected and not used exclusively by another app, or turn the microphone off.')
        )
      }
      this.streams.push(micStream)
      const src = ctx.createMediaStreamSource(micStream)
      const chain = buildVoiceChain(ctx, a.mic.volume, a.mic.voiceEnhancement)
      src.connect(chain.input)
      chain.output.connect(dest)
      this.mic = chain
      micStream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (!this.stopped) this.cb.warning('The microphone was disconnected. Video recording continues without it.')
      })
    }
    return dest.stream.getAudioTracks()[0] ?? null
  }

  private startLevels(): void {
    if (!this.mic && !this.systemMeter) return
    let clipNotified = false
    this.levelTimer = window.setInterval(() => {
      const levels: AudioLevels = {
        mic: this.mic ? readLevel(this.mic.meter) : null,
        system: this.systemMeter ? readLevel(this.systemMeter) : null
      }
      if (levels.mic?.clipping && !clipNotified) {
        clipNotified = true
        this.cb.warning('The microphone is clipping (too loud). Lower the microphone volume or move it further away.')
      }
      this.cb.levels(levels)
    }, 100)
  }

  pause(): void {
    if (this.recorder?.state === 'recording') this.recorder.pause()
  }

  resume(): void {
    if (this.recorder?.state === 'paused') this.recorder.resume()
  }

  /** Stops recording and waits until every chunk has been handed to the main process. */
  async stop(): Promise<void> {
    this.stopped = true
    const rec = this.recorder
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true })
        try {
          rec.stop()
        } catch {
          resolve()
        }
      })
    }
    await this.uploads.catch(() => undefined)
    this.release()
  }

  abort(): void {
    this.stopped = true
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      // ignore
    }
    this.release()
  }

  private release(): void {
    if (this.levelTimer) clearInterval(this.levelTimer)
    this.levelTimer = null
    this.pipeline?.stop()
    this.pipeline = null
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop())
    this.streams = []
    this.mic?.disconnect()
    this.mic = null
    this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.cb.levels({ mic: null, system: null })
  }
}

export function toErrorInfo(err: unknown): AppErrorInfo {
  if (err instanceof EngineError) return err.info
  return appError('INIT_FAILED', err instanceof Error ? err.message : String(err))
}
