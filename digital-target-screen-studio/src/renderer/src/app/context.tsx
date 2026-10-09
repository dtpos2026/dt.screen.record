import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Settings, SettingsPatch } from '@shared/settings'
import type { AppInfo, FfmpegInfo, Page, RecordingState, Toast } from '@shared/types'
import { dt, useRecordingState, useSettings, useThemeSync } from '../lib/hooks'

interface AppContextValue {
  page: Page
  params: Record<string, string>
  navigate: (page: Page, params?: Record<string, string>) => void
  settings: Settings
  update: (patch: SettingsPatch) => Promise<void>
  recording: RecordingState | null
  info: AppInfo | null
  ffmpeg: FfmpegInfo | null
  refreshFfmpeg: () => Promise<void>
  toast: (t: Toast) => void
  toasts: Array<Toast & { id: number }>
  dismissToast: (id: number) => void
}

const Ctx = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

let toastSeq = 1

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, update] = useSettings()
  const recording = useRecordingState()
  const [route, setRoute] = useState<{ page: Page; params: Record<string, string> }>({ page: 'dashboard', params: {} })
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [ffmpeg, setFfmpeg] = useState<FfmpegInfo | null>(null)
  const [toasts, setToasts] = useState<Array<Toast & { id: number }>>([])
  useThemeSync(settings)

  const navigate = useCallback((page: Page, params: Record<string, string> = {}) => setRoute({ page, params }), [])
  const toast = useCallback((t: Toast) => {
    const id = toastSeq++
    setToasts((list) => [...list.slice(-3), { ...t, id }])
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.kind === 'error' ? 9000 : 5500)
  }, [])
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), [])
  const refreshFfmpeg = useCallback(async () => {
    setFfmpeg(await dt.invoke('export:info', { refresh: true }))
  }, [])

  useEffect(() => {
    void dt.invoke('app:info').then(setInfo)
    void dt.invoke('export:info', {}).then(setFfmpeg)
    const offs = [dt.on('navigate', (r) => navigate(r.page, r.params ?? {})), dt.on('toast', toast), dt.on('settings:changed', () => void dt.invoke('app:info').then(setInfo))]
    return () => offs.forEach((o) => o())
  }, [navigate, toast])

  const value = useMemo(
    () =>
      settings
        ? { page: route.page, params: route.params, navigate, settings, update, recording, info, ffmpeg, refreshFfmpeg, toast, toasts, dismissToast }
        : null,
    [route, navigate, settings, update, recording, info, ffmpeg, refreshFfmpeg, toast, toasts, dismissToast]
  )
  if (!value) return null
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
