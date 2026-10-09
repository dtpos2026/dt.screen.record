import { useEffect } from 'react'
import { Camera, Circle, Film, Info, LayoutDashboard, Settings as Cog, X, CheckCircle2, AlertTriangle, AlertOctagon, FolderOpen } from 'lucide-react'
import type { Page } from '@shared/types'
import { formatDuration } from '@shared/format'
import { useElapsed } from '../lib/hooks'
import { useApp } from './context'
import markUrl from '../assets/brand/mark-white.svg'
import { Dashboard } from './pages/Dashboard'
import { Recorder } from './pages/Recorder'
import { Screenshot } from './pages/Screenshot'
import { Library } from './pages/Library'
import { Editor } from './pages/Editor'
import { SettingsPage } from './pages/Settings'
import { About } from './pages/About'

const NAV: Array<{ page: Page; label: string; icon: typeof Circle }> = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'recorder', label: 'Screen Recorder', icon: Circle },
  { page: 'screenshot', label: 'Screenshot Tool', icon: Camera },
  { page: 'library', label: 'Media Library', icon: Film },
  { page: 'settings', label: 'Settings', icon: Cog },
  { page: 'about', label: 'About Digital Target', icon: Info }
]

const TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  recorder: 'Screen Recorder',
  screenshot: 'Screenshot Tool',
  library: 'Media Library',
  editor: 'Screenshot Editor',
  settings: 'Settings',
  about: 'About Digital Target'
}

function RecordingPill() {
  const { recording, navigate } = useApp()
  const elapsed = useElapsed(recording)
  if (!recording || recording.status === 'idle') return null
  const label =
    recording.status === 'recording'
      ? 'Recording'
      : recording.status === 'paused'
        ? 'Paused'
        : recording.status === 'countdown'
          ? 'Starting…'
          : recording.status === 'finalizing'
            ? `Saving ${Math.round(recording.finalizeProgress)}%`
            : 'Preparing…'
  return (
    <button className={`rec-pill rec-pill-${recording.status}`} onClick={() => navigate('recorder')} aria-label={`${label} ${formatDuration(elapsed)}`}>
      <span className="rec-pill-dot" />
      <span>{label}</span>
      <span className="tabular">{formatDuration(elapsed)}</span>
    </button>
  )
}

function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertOctagon : t.kind === 'warning' ? AlertTriangle : Info
        return (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon size={18} className="toast-icon" />
            <div className="toast-text">
              <strong>{t.title}</strong>
              {t.message && <span>{t.message}</span>}
              {t.revealPath && (
                <button className="link-btn" onClick={() => void window.dt.invoke('library:reveal', { path: t.revealPath! })}>
                  <FolderOpen size={13} /> Show in folder
                </button>
              )}
            </div>
            <button className="icon-btn toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function App() {
  const { page, navigate, info } = useApp()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return
      const idx = Number(e.key) - 1
      if (idx >= 0 && idx < NAV.length) {
        e.preventDefault()
        navigate(NAV[idx].page)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={markUrl} alt="" />
          </div>
          <div className="brand-text">
            <span className="brand-company">Digital Target</span>
            <span className="brand-product">Screen Studio</span>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((n, i) => {
            const Icon = n.icon
            const active = page === n.page || (n.page === 'screenshot' && page === 'editor')
            return (
              <button key={n.page} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => navigate(n.page)} data-tip={`Ctrl+${i + 1}`} data-tip-side="right">
                <Icon size={18} strokeWidth={n.page === 'recorder' ? 2.4 : 2} />
                <span>{n.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <RecordingPill />
          <div className="sidebar-version">
            {info ? `Version ${info.version}` : ''}
            <span>Local &amp; private · No uploads</span>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="titlebar">
          <h1>{TITLES[page]}</h1>
        </header>
        <main className="content" key={page}>
          {page === 'dashboard' && <Dashboard />}
          {page === 'recorder' && <Recorder />}
          {page === 'screenshot' && <Screenshot />}
          {page === 'library' && <Library />}
          {page === 'editor' && <Editor />}
          {page === 'settings' && <SettingsPage />}
          {page === 'about' && <About />}
        </main>
      </div>
      <Toasts />
    </div>
  )
}
