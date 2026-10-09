import { useCallback, useEffect, useRef, useState } from 'react'
import type { DisplayInfo, MediaItem } from '@shared/types'
import { buildVoiceChain, openMicrophone, RAW_AUDIO, readLevel, type MicOptions } from './audio-chain'
import type { AudioLevel } from '@shared/types'
import { dt } from './hooks'

/** Media library contents, refreshed whenever the main process reports changes. */
export function useLibrary(): { items: MediaItem[] | null; refresh: () => Promise<void>; thumb: (item: MediaItem) => string | null } {
  const [items, setItems] = useState<MediaItem[] | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})
  const requested = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    setItems(await dt.invoke('library:list'))
  }, [])

  useEffect(() => {
    void refresh()
    return dt.on('library:changed', () => void refresh())
  }, [refresh])

  const thumb = useCallback(
    (item: MediaItem) => {
      if (item.thumbnailUrl) return item.thumbnailUrl
      const key = `${item.path}|${item.modifiedMs}`
      if (key in thumbs) return thumbs[key]
      if (!requested.current.has(key)) {
        requested.current.add(key)
        void dt.invoke('library:thumbnail', { path: item.path }).then((url) => setThumbs((t) => ({ ...t, [key]: url })))
      }
      return null
    },
    [thumbs]
  )
  return { items, refresh, thumb }
}

export function useDisplays(withThumbnails = false): { displays: DisplayInfo[]; refresh: () => Promise<void>; loading: boolean } {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setDisplays(await dt.invoke('capture:displays', { thumbnails: withThumbnails }))
    } finally {
      setLoading(false)
    }
  }, [withThumbnails])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { displays, refresh, loading }
}

export function useMediaDevices(): { mics: MediaDeviceInfo[]; cameras: MediaDeviceInfo[]; refresh: () => Promise<void> } {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const refresh = useCallback(async () => {
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices())
    } catch {
      setDevices([])
    }
  }, [])
  useEffect(() => {
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refresh])
  return {
    mics: devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'),
    cameras: devices.filter((d) => d.kind === 'videoinput'),
    refresh
  }
}

export type MicPreviewState = { level: AudioLevel | null; error: string | null; permission: 'unknown' | 'granted' | 'denied' }

/**
 * Live microphone preview with the same processing chain used for recording,
 * plus a "record a short test and play it back" helper.
 */
export function useMicPreview(active: boolean, opts: MicOptions & { volume: number; enhance: boolean }) {
  const [state, setState] = useState<MicPreviewState>({ level: null, error: null, permission: 'unknown' })
  const [testing, setTesting] = useState<'idle' | 'recording' | 'playing'>('idle')
  const [testUrl, setTestUrl] = useState<string | null>(null)
  const graph = useRef<{ ctx: AudioContext; out: MediaStreamAudioDestinationNode; stream: MediaStream; gain: GainNode } | null>(null)
  const key = JSON.stringify(opts)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: number | null = null
    let cleanup: (() => void) | null = null
    void (async () => {
      try {
        const { stream } = await openMicrophone(opts)
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const ctx = new AudioContext({ sampleRate: 48000 })
        const src = ctx.createMediaStreamSource(stream)
        const chain = buildVoiceChain(ctx, opts.volume, opts.enhance)
        src.connect(chain.input)
        const out = ctx.createMediaStreamDestination()
        chain.output.connect(out)
        graph.current = { ctx, out, stream, gain: chain.gain }
        setState({ level: null, error: null, permission: 'granted' })
        timer = window.setInterval(() => setState((s) => ({ ...s, level: readLevel(chain.meter) })), 70)
        cleanup = () => {
          chain.disconnect()
          stream.getTracks().forEach((t) => t.stop())
          void ctx.close()
        }
      } catch (err) {
        const name = (err as DOMException).name
        setState({
          level: null,
          permission: name === 'NotAllowedError' ? 'denied' : 'unknown',
          error:
            name === 'NotAllowedError'
              ? 'Microphone access is blocked. Allow desktop apps to use the microphone in Windows privacy settings.'
              : name === 'NotFoundError'
                ? 'No microphone was found. Connect one and try again.'
                : name === 'NotReadableError'
                  ? 'The microphone is in use by another application or unavailable.'
                  : 'The microphone could not be opened.'
        })
      }
    })()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      cleanup?.()
      graph.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key])

  const recordTest = useCallback(async (seconds = 5) => {
    const g = graph.current
    if (!g) return
    setTestUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return null
    })
    setTesting('recording')
    const rec = new MediaRecorder(g.out.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const done = new Promise<void>((r) => (rec.onstop = () => r()))
    rec.start()
    await new Promise((r) => setTimeout(r, seconds * 1000))
    rec.stop()
    await done
    const url = URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' }))
    setTestUrl(url)
    setTesting('playing')
    const audio = new Audio(url)
    audio.onended = () => setTesting('idle')
    audio.onerror = () => setTesting('idle')
    await audio.play().catch(() => setTesting('idle'))
  }, [])

  return { ...state, testing, testUrl, recordTest }
}

/** Monitors system audio (loopback) for the level meter. */
export function useSystemAudioPreview(active: boolean): { level: AudioLevel | null; error: string | null } {
  const [level, setLevel] = useState<AudioLevel | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!active) {
      setLevel(null)
      return
    }
    let cancelled = false
    let timer: number | null = null
    let cleanup: (() => void) | null = null
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: RAW_AUDIO })
        s.getVideoTracks().forEach((t) => t.stop())
        if (!s.getAudioTracks().length) throw new Error('none')
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        const ctx = new AudioContext({ sampleRate: 48000 })
        const an = ctx.createAnalyser()
        an.fftSize = 2048
        ctx.createMediaStreamSource(s).connect(an)
        setError(null)
        timer = window.setInterval(() => setLevel(readLevel(an)), 70)
        cleanup = () => {
          s.getTracks().forEach((t) => t.stop())
          void ctx.close()
        }
      } catch {
        setError('System audio could not be captured on this computer.')
      }
    })()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      cleanup?.()
    }
  }, [active])
  return { level, error }
}

/** Plays a short, gentle chime so the system-audio meter can be tested. */
export function playTestTone(): void {
  const ctx = new AudioContext()
  const now = ctx.currentTime
  ;[523.25, 659.25, 783.99].forEach((f, i) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = f
    g.gain.setValueAtTime(0, now + i * 0.18)
    g.gain.linearRampToValueAtTime(0.25, now + i * 0.18 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.6)
    o.connect(g).connect(ctx.destination)
    o.start(now + i * 0.18)
    o.stop(now + i * 0.18 + 0.65)
  })
  setTimeout(() => void ctx.close(), 1500)
}
