import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveTheme, type EffectiveTheme, type Settings, type SettingsPatch } from '@shared/settings'
import type { AudioLevels, RecordingState } from '@shared/types'

export const dt = window.dt

/** Live settings with an `update` helper (validated in the main process). */
export function useSettings(): [Settings | null, (patch: SettingsPatch) => Promise<void>] {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let alive = true
    void dt.invoke('settings:get').then((s) => alive && setSettings(s))
    const off = dt.on('settings:changed', (s) => setSettings(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  const update = useCallback(async (patch: SettingsPatch) => {
    setSettings(await dt.invoke('settings:update', patch))
  }, [])
  return [settings, update]
}

export function useRecordingState(): RecordingState | null {
  const [state, setState] = useState<RecordingState | null>(null)
  useEffect(() => {
    void dt.invoke('recording:state').then(setState)
    return dt.on('recording:state', setState)
  }, [])
  return state
}

/** Elapsed recording time that ticks smoothly between state updates. */
export function useElapsed(state: RecordingState | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (state?.status !== 'recording') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [state?.status])
  if (!state) return 0
  return state.elapsedMs + (state.status === 'recording' ? Math.max(0, now - state.updatedAt) : 0)
}

export function useAudioLevels(): AudioLevels {
  const [levels, setLevels] = useState<AudioLevels>({ mic: null, system: null })
  useEffect(() => dt.on('audio:levels', setLevels), [])
  return levels
}

export function useInterval(fn: () => void, ms: number | null): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (ms == null) return
    const id = setInterval(() => ref.current(), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** Applies the theme (resolving "System" live from Windows) and motion preferences. */
export function useThemeSync(settings: Settings | null): EffectiveTheme | null {
  const theme = settings?.general.theme
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const effective = theme ? resolveTheme(theme, systemDark) : null
  useEffect(() => {
    if (!effective) return
    document.documentElement.dataset.theme = effective
  }, [effective])
  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.motion = settings.general.reduceMotion ? 'reduced' : 'full'
  }, [settings])
  return effective
}
