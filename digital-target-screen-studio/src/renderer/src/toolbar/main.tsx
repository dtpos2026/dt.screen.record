import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ScreenshotMode } from '@shared/settings'
import { AppWindow, ChevronDown, EyeOff, Images, Monitor, Pause, Play, Settings as Cog, Square, SquareDashed, Trash2 } from 'lucide-react'
import { formatDuration } from '@shared/format'
import { meterPosition } from '../lib/audio-chain'
import { dt, useAudioLevels, useElapsed, useRecordingState, useSettings, useThemeSync } from '../lib/hooks'
import mark from '../assets/brand/mark-white.svg'
import '../styles/base.css'
import './toolbar.css'

const SHOTS: { mode: ScreenshotMode; label: string; Icon: typeof Monitor }[] = [
  { mode: 'region', label: 'Region screenshot', Icon: SquareDashed },
  { mode: 'fullscreen', label: 'Full-screen screenshot', Icon: Monitor },
  { mode: 'window', label: 'Window screenshot', Icon: AppWindow }
]

/** Slim, draggable, always-on-top recording and screenshot toolbar (hidden from captures). */
function Toolbar() {
  const state = useRecordingState()
  const [settings] = useSettings()
  const elapsed = useElapsed(state)
  const levels = useAudioLevels()
  const [busy, setBusy] = useState(false)
  // Separate from `busy` so a delayed screenshot never blocks Stop/Pause.
  const [shooting, setShooting] = useState(false)
  const status = state?.status ?? 'idle'
  const active = status === 'recording' || status === 'paused'

  useThemeSync(settings)

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const shoot = (mode: ScreenshotMode) => {
    if (shooting) return
    setShooting(true)
    void dt.invoke('screenshot:capture', { mode }).finally(() => setShooting(false))
  }

  const limit = state?.limitMs ?? 0
  const progress = limit > 0 ? Math.min(1, elapsed / limit) : 0
  const label =
    status === 'recording'
      ? 'REC'
      : status === 'paused'
        ? 'PAUSED'
        : status === 'countdown'
          ? 'STARTING'
          : status === 'starting' || status === 'selecting'
            ? 'PREPARING'
            : status === 'stopping' || status === 'finalizing'
              ? `SAVING ${Math.round(state?.finalizeProgress ?? 0)}%`
              : 'READY'
  const mic = levels.mic ? meterPosition(levels.mic.peak) : 0
  const delay = settings?.screenshot.delaySeconds ?? 0

  return (
    <div className={`tb tb-${status}`}>
      <div className="tb-grip" title="Drag to move">
        <img src={mark} alt="Digital Target" />
      </div>
      <div className="tb-status" aria-live="polite">
        <span className="tb-dot" />
        <span className="tb-label">{label}</span>
        <span className="tb-time tabular">{active || status === 'stopping' || status === 'finalizing' ? formatDuration(elapsed) : '00:00'}</span>
        {limit > 0 && active && <span className="tb-limit tabular">/ {formatDuration(limit)}</span>}
        {active && state?.audio.microphone && (
          <span className={`tb-mic ${levels.mic?.clipping ? 'clip' : ''}`} title="Microphone level">
            <span style={{ transform: `scaleY(${Math.max(0.08, mic)})` }} />
          </span>
        )}
      </div>
      <div className="tb-actions">
        {active ? (
          <button className="tb-btn tb-stop" onClick={() => run(() => dt.invoke('recording:stop'))} title="Stop and save" aria-label="Stop and save">
            <Square size={14} fill="currentColor" />
          </button>
        ) : status === 'countdown' ? (
          <button className="tb-btn" onClick={() => run(() => dt.invoke('recording:cancelCountdown'))} title="Cancel countdown">
            Cancel
          </button>
        ) : (
          <button className="tb-btn tb-rec" disabled={status !== 'idle'} onClick={() => run(() => dt.invoke('recording:start'))} title="Start recording" aria-label="Start recording">
            <span className="tb-rec-dot" />
          </button>
        )}
        <button
          className="tb-btn"
          disabled={!active}
          onClick={() => run(() => dt.invoke(status === 'paused' ? 'recording:resume' : 'recording:pause'))}
          title={status === 'paused' ? 'Resume' : 'Pause'}
          aria-label={status === 'paused' ? 'Resume recording' : 'Pause recording'}
        >
          {status === 'paused' ? <Play size={15} /> : <Pause size={15} />}
        </button>
        {active && (
          <button className="tb-btn" onClick={() => run(() => dt.invoke('recording:discard'))} title="Discard recording…" aria-label="Discard recording">
            <Trash2 size={15} />
          </button>
        )}
        <span className="tb-sep" />
        <div className="tb-group" role="group" aria-label="Screenshot">
          {SHOTS.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              className="tb-btn"
              disabled={shooting}
              onClick={() => shoot(mode)}
              title={delay > 0 ? `${label} (after ${delay} s)` : label}
              aria-label={label}
            >
              <Icon size={15} />
            </button>
          ))}
          {delay > 0 && (
            <span className="tb-delay tabular" title={`Screenshots start after a ${delay}-second countdown`}>
              {delay}s
            </span>
          )}
          <button className="tb-btn tb-caret" onClick={() => void dt.invoke('toolbar:screenshotMenu')} title="More screenshot options" aria-label="Screenshot options">
            <ChevronDown size={13} />
          </button>
        </div>
        <span className="tb-sep" />
        <button className="tb-btn" onClick={() => void dt.invoke('window:navigate', { page: 'library' })} title="Library" aria-label="Open library">
          <Images size={15} />
        </button>
        <button className="tb-btn" onClick={() => void dt.invoke('window:navigate', { page: 'settings' })} title="Settings" aria-label="Open settings">
          <Cog size={15} />
        </button>
        <button className="tb-btn" onClick={() => void dt.invoke('toolbar:toggle', { visible: false })} title="Hide toolbar (Alt+Shift+T)" aria-label="Hide toolbar">
          <EyeOff size={15} />
        </button>
      </div>
      <div className="tb-progress" style={{ transform: `scaleX(${progress})`, opacity: limit > 0 && active ? 1 : 0 }} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Toolbar />)
