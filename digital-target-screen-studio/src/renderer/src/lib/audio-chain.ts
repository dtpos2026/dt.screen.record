import type { AudioLevel } from '@shared/types'

export interface MicOptions {
  deviceId: string
  channels: 1 | 2
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
}

/**
 * Opens a microphone with the chosen WebRTC processing (noise suppression,
 * echo cancellation, auto gain). Falls back to the default microphone when
 * the selected device has disappeared.
 */
export async function openMicrophone(o: MicOptions): Promise<{ stream: MediaStream; usedFallback: boolean }> {
  const base: MediaTrackConstraints = {
    channelCount: { ideal: o.channels },
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 24 },
    echoCancellation: o.echoCancellation,
    noiseSuppression: o.noiseSuppression,
    autoGainControl: o.autoGainControl
  }
  if (o.deviceId && o.deviceId !== 'default') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: o.deviceId } } })
      return { stream, usedFallback: false }
    } catch (err) {
      const name = (err as DOMException).name
      if (name !== 'NotFoundError' && name !== 'OverconstrainedError') throw err
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: base })
    return { stream, usedFallback: true }
  }
  return { stream: await navigator.mediaDevices.getUserMedia({ audio: base }), usedFallback: false }
}

export interface VoiceChain {
  input: AudioNode
  output: AudioNode
  meter: AnalyserNode
  gain: GainNode
  disconnect: () => void
}

/**
 * Microphone processing graph:
 *   source → [high-pass 75 Hz → gentle compressor] → gain → meter → [limiter] → output
 * "Voice enhancement" stays subtle (2.5:1 above −24 dB) so the voice keeps
 * its natural character; the limiter only prevents digital clipping.
 */
export function buildVoiceChain(ctx: AudioContext, volume: number, enhance: boolean): VoiceChain {
  const nodes: AudioNode[] = []
  const input = ctx.createGain()
  nodes.push(input)
  let last: AudioNode = input
  if (enhance) {
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 75
    hp.Q.value = 0.707
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -24
    comp.knee.value = 18
    comp.ratio.value = 2.5
    comp.attack.value = 0.008
    comp.release.value = 0.25
    last.connect(hp)
    hp.connect(comp)
    last = comp
    nodes.push(hp, comp)
  }
  const gain = ctx.createGain()
  gain.gain.value = volume
  last.connect(gain)
  const meter = ctx.createAnalyser()
  meter.fftSize = 2048
  meter.smoothingTimeConstant = 0
  gain.connect(meter)
  nodes.push(gain, meter)
  let output: AudioNode = gain
  if (enhance) {
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -1.5
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.08
    gain.connect(limiter)
    output = limiter
    nodes.push(limiter)
  }
  return {
    input,
    output,
    meter,
    gain,
    disconnect: () => nodes.forEach((n) => n.disconnect())
  }
}

const buffers = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>()

/** RMS / peak of the analyser's current window (0..1) with clip detection. */
export function readLevel(an: AnalyserNode): AudioLevel {
  let buf = buffers.get(an)
  if (!buf) {
    buf = new Float32Array(an.fftSize)
    buffers.set(an, buf)
  }
  an.getFloatTimeDomainData(buf)
  let sum = 0
  let peak = 0
  let clipped = 0
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i])
    sum += v * v
    if (v > peak) peak = v
    if (v >= 0.985) clipped++
  }
  return { rms: Math.sqrt(sum / buf.length), peak: Math.min(1, peak), clipping: clipped >= 3 }
}

/** Converts a 0..1 amplitude to a 0..1 meter position on a −60..0 dB scale. */
export function meterPosition(amplitude: number): number {
  if (amplitude <= 0.001) return 0
  const db = 20 * Math.log10(amplitude)
  return Math.max(0, Math.min(1, (db + 60) / 60))
}
