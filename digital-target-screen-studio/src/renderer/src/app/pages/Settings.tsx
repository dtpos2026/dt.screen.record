import { useEffect, useState } from 'react'
import { AppWindow, Camera, Circle, Cpu, FolderOpen, Keyboard, Mic, Monitor, Moon, MoonStar, PanelTop, RefreshCw, RotateCcw, Settings2, Sun, Webcam } from 'lucide-react'
import { acceleratorFromEvent, findConflicts, formatAccelerator, isValidAccelerator } from '@shared/accelerator'
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, type Settings, type ShortcutAction } from '@shared/settings'
import { Badge, Button, Card, Field, Notice, Segmented, Select, Slider, Spinner, Toggle } from '../../components/ui'
import { useConfirm } from '../../components/confirm'
import { dt } from '../../lib/hooks'
import { useApp } from '../context'
import { AudioCard, QualityCard, WebcamCard } from './Recorder'

type Section = 'general' | 'recording' | 'audio' | 'screenshots' | 'shortcuts' | 'webcam' | 'toolbar' | 'advanced'

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Circle }> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'recording', label: 'Recording', icon: Circle },
  { id: 'audio', label: 'Audio', icon: Mic },
  { id: 'screenshots', label: 'Screenshots', icon: Camera },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'webcam', label: 'Webcam', icon: Webcam },
  { id: 'toolbar', label: 'Floating toolbar', icon: PanelTop },
  { id: 'advanced', label: 'Advanced', icon: Cpu }
]

const ACTION_LABELS: Record<ShortcutAction, string> = {
  recordToggle: 'Start / stop recording',
  pauseToggle: 'Pause / resume recording',
  screenshotRegion: 'Region screenshot',
  screenshotFullscreen: 'Full-screen screenshot',
  screenshotWindow: 'Active-window screenshot',
  toggleToolbar: 'Show / hide floating toolbar'
}

export function SettingsPage() {
  const { params } = useApp()
  const [section, setSection] = useState<Section>((params.section as Section) ?? 'general')
  useEffect(() => {
    if (params.section) setSection(params.section as Section)
  }, [params.section])
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {SECTIONS.map((s) => {
          const Icon = s.icon
          return (
            <button key={s.id} className={section === s.id ? 'active' : ''} aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
              <Icon size={16} /> {s.label}
            </button>
          )
        })}
      </nav>
      <div className="settings-section">
        {section === 'general' && <General />}
        {section === 'recording' && <RecordingSettings />}
        {section === 'audio' && <AudioCard />}
        {section === 'screenshots' && <ScreenshotSettings />}
        {section === 'shortcuts' && <Shortcuts />}
        {section === 'webcam' && <WebcamCard />}
        {section === 'toolbar' && <ToolbarSettings />}
        {section === 'advanced' && <Advanced />}
      </div>
    </div>
  )
}

function FolderField({ label, value, purpose }: { label: string; value: string; purpose: 'recordings' | 'screenshots' }) {
  return (
    <Field label={label}>
      <div className="path-row">
        <input className="input" readOnly value={value} aria-label={label} title={value} />
        <Button variant="secondary" onClick={() => void dt.invoke('dialog:chooseFolder', { purpose })}>Change…</Button>
        <Button variant="ghost" icon={<FolderOpen size={15} />} onClick={() => void dt.invoke('shell:openFolder', { kind: purpose })} aria-label={`Open ${purpose} folder`} />
      </div>
    </Field>
  )
}

function General() {
  const { settings, update, info, theme } = useApp()
  const g = settings.general
  const set = (p: Partial<Settings['general']>) => void update({ general: p })
  return (
    <>
      <Card title="Save locations" subtitle="Your choices are remembered. Files are always stored locally.">
        <div className="stack">
          <FolderField label="Recordings" value={g.recordingsDir} purpose="recordings" />
          <FolderField label="Screenshots" value={g.screenshotsDir} purpose="screenshots" />
        </div>
      </Card>
      <Card title="Window & tray">
        <Toggle checked={g.minimizeToTray} onChange={(v) => set({ minimizeToTray: v })} label="Minimise to the system tray while recording" description="Keeps the taskbar clear; open the app again from the tray icon." />
        <Toggle checked={g.closeToTray} onChange={(v) => set({ closeToTray: v })} label="Keep running in the tray when the window is closed" description="Shortcuts keep working. Quit from the tray menu." />
        <Toggle checked={g.hideWindowWhileCapturing} onChange={(v) => set({ hideWindowWhileCapturing: v })} label="Hide this window while taking screenshots" />
        <Toggle checked={g.notifications} onChange={(v) => set({ notifications: v })} label="Notifications" description="Windows notifications when recordings and screenshots are saved." />
      </Card>
      <Card title="Startup">
        <Toggle checked={g.launchAtStartup} onChange={(v) => set({ launchAtStartup: v })} label="Start with Windows" description={info?.isPackaged ? 'Starts quietly in the tray when you sign in.' : 'Available in the installed app.'} disabled={!info?.isPackaged} />
        <Toggle checked={g.startMinimized} onChange={(v) => set({ startMinimized: v })} label="Start minimised to the tray" />
        <Toggle checked={g.showSplash} onChange={(v) => set({ showSplash: v })} label="Show the Digital Target splash screen" />
      </Card>
      <Card title="Appearance">
        <div className="stack">
          <Field label="Theme">
            <Segmented
              value={g.theme}
              ariaLabel="Theme"
              onChange={(v) => set({ theme: v })}
              options={[
                { value: 'system', label: <span className="seg-icon"><Monitor size={14} />System</span>, tip: 'Follows the Windows light/dark app mode' },
                { value: 'light', label: <span className="seg-icon"><Sun size={14} />Light</span> },
                { value: 'dark', label: <span className="seg-icon"><Moon size={14} />Dark</span> },
                { value: 'midnight', label: <span className="seg-icon"><MoonStar size={14} />Midnight</span>, tip: 'Darker, higher-contrast dark theme' }
              ]}
            />
          </Field>
          <p className="muted small">
            {g.theme === 'system' ? `Following Windows — currently ${theme === 'light' ? 'light' : 'dark'}. ` : ''}
            The theme applies to every window, including the floating toolbar.
          </p>
          <Toggle checked={g.reduceMotion} onChange={(v) => set({ reduceMotion: v })} label="Reduce motion" description="Turns off interface animations." />
        </div>
      </Card>
    </>
  )
}

function RecordingSettings() {
  const { settings, update } = useApp()
  const r = settings.recording
  const set = (p: Partial<Settings['recording']>) => void update({ recording: p })
  return (
    <>
      <QualityCard />
      <Card title="Encoding">
        <div className="stack">
          <Field label="Recording codec" hint="H.264 is converted to MP4 instantly without re-encoding. VP9/VP8 need conversion and use more CPU.">
            <Select
              value={r.videoCodec}
              onChange={(v) => set({ videoCodec: v })}
              ariaLabel="Recording codec"
              options={[
                { value: 'auto', label: 'Automatic (H.264, hardware accelerated when available)' },
                { value: 'h264', label: 'H.264' },
                { value: 'vp9', label: 'VP9' },
                { value: 'vp8', label: 'VP8 (fastest on very old PCs)' }
              ]}
            />
          </Field>
          <Toggle checked={r.constantFrameRate} onChange={(v) => set({ constantFrameRate: v })} label="Constant frame rate (for video editors)" description="Re-encodes after recording so editors like Premiere stay in sync. Takes longer to save." />
        </div>
      </Card>
      <Card title="Behaviour">
        <div className="grid-2">
          <Field label="Default countdown">
            <Select value={r.countdownSeconds} onChange={(v) => set({ countdownSeconds: v })} ariaLabel="Countdown" options={[0, 3, 5, 10, 15, 30].map((s) => ({ value: s, label: s ? `${s} seconds` : 'Off' }))} />
          </Field>
          <Field label="Default duration limit">
            <Select value={r.durationLimitSeconds} onChange={(v) => set({ durationLimitSeconds: v })} ariaLabel="Duration limit" options={[0, 60, 300, 600, 1800, 3600, 7200].map((s) => ({ value: s, label: s === 0 ? 'Unlimited' : s < 3600 ? `${s / 60} minutes` : `${s / 3600} hour${s > 3600 ? 's' : ''}` }))} />
          </Field>
        </div>
        <div style={{ marginTop: 8 }}>
          <Toggle checked={r.minimizeOnStart} onChange={(v) => set({ minimizeOnStart: v })} label="Hide the main window when recording starts" />
          <Toggle checked={r.showRegionBorder} onChange={(v) => set({ showRegionBorder: v })} label="Show a frame around region recordings" />
        </div>
      </Card>
    </>
  )
}

function ScreenshotSettings() {
  const { settings, update } = useApp()
  const s = settings.screenshot
  const set = (p: Partial<Settings['screenshot']>) => void update({ screenshot: p })
  return (
    <>
      <Card title="Format & quality">
        <div className="stack">
          <Field label="Default format">
            <Segmented value={s.format} onChange={(v) => set({ format: v })} options={[{ value: 'png', label: 'PNG (lossless)' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }]} />
          </Field>
          <Field label="JPEG quality"><Slider value={s.jpegQuality} min={40} max={100} onChange={(v) => set({ jpegQuality: v })} ariaLabel="JPEG quality" format={(v) => `${v}%`} /></Field>
          <Field label="WebP quality"><Slider value={s.webpQuality} min={40} max={100} onChange={(v) => set({ webpQuality: v })} ariaLabel="WebP quality" format={(v) => `${v}%`} /></Field>
        </div>
      </Card>
      <Card title="Capture">
        <div className="grid-2">
          <Field label="Default mode (toolbar & tray)">
            <Select value={s.defaultMode} onChange={(v) => set({ defaultMode: v })} ariaLabel="Default mode" options={[{ value: 'region', label: 'Region' }, { value: 'fullscreen', label: 'Full screen' }, { value: 'window', label: 'Active window' }, { value: 'all-displays', label: 'All monitors' }]} />
          </Field>
          <Field label="Default delay">
            <Select value={s.delaySeconds} onChange={(v) => set({ delaySeconds: v })} ariaLabel="Delay" options={[0, 3, 5, 10, 15, 30].map((x) => ({ value: x, label: x ? `${x} seconds` : 'None' }))} />
          </Field>
        </div>
        <div style={{ marginTop: 8 }}>
          <Toggle checked={s.showPreview} onChange={(v) => set({ showPreview: v })} label="Preview before saving" />
          <Toggle checked={s.copyToClipboard} onChange={(v) => set({ copyToClipboard: v })} label="Copy every screenshot to the clipboard" />
        </div>
      </Card>
      <Card title="Save location">
        <FolderField label="Screenshots" value={settings.general.screenshotsDir} purpose="screenshots" />
      </Card>
    </>
  )
}

function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false)
  const [invalid, setInvalid] = useState(false)
  return (
    <button
      className={`shortcut-input ${recording ? 'recording' : ''} ${invalid ? 'invalid' : ''}`}
      onClick={() => {
        setRecording(true)
        setInvalid(false)
      }}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') {
          setRecording(false)
          return
        }
        const acc = acceleratorFromEvent(e.nativeEvent, window.dt.platform === 'darwin')
        if (!acc) return
        if (!isValidAccelerator(acc)) {
          setInvalid(true)
          return
        }
        setRecording(false)
        setInvalid(false)
        onChange(acc)
      }}
      aria-label="Shortcut — click and press new keys"
    >
      {recording ? (invalid ? 'Add Ctrl, Alt or Shift…' : 'Press keys…') : formatAccelerator(value)}
    </button>
  )
}

function Shortcuts() {
  const { settings, update } = useApp()
  const sc = settings.shortcuts
  const conflicts = findConflicts(sc)
  return (
    <Card
      title="Keyboard shortcuts"
      subtitle="Global shortcuts work everywhere, even when the app is hidden. Click a shortcut and press the new keys."
      actions={<Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => void update({ shortcuts: DEFAULT_SHORTCUTS })}>Reset defaults</Button>}
    >
      {SHORTCUT_ACTIONS.map((a) => (
        <div className="shortcut-row" key={a}>
          <span>{ACTION_LABELS[a]}</span>
          <ShortcutInput value={sc[a]} onChange={(v) => void update({ shortcuts: { [a]: v } })} />
          <Button variant="ghost" size="sm" onClick={() => void update({ shortcuts: { [a]: '' } })} disabled={!sc[a]}>Clear</Button>
        </div>
      ))}
      {conflicts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="warning" title="Duplicate shortcuts">
            {conflicts.map((c) => c.map((a) => ACTION_LABELS[a as ShortcutAction]).join(' and ')).join('; ')} use the same keys. Only the first one will work.
          </Notice>
        </div>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>If a shortcut is already used by another app, Windows will not let us register it — you will see a notice and can choose another.</p>
    </Card>
  )
}

function ToolbarSettings() {
  const { settings, update } = useApp()
  const t = settings.toolbar
  return (
    <Card title="Floating toolbar" subtitle="A slim, draggable control bar that stays on top of other windows. It is hidden from recordings on Windows 10 (2004) and later.">
      <Toggle checked={t.showWhileRecording} onChange={(v) => void update({ toolbar: { showWhileRecording: v } })} label="Show while recording" />
      <Toggle checked={t.alwaysVisible} onChange={(v) => void update({ toolbar: { alwaysVisible: v } })} label="Always show the toolbar" description="Keep it on screen for quick recordings and screenshots." />
      <div className="row" style={{ marginTop: 8 }}>
        <Button variant="secondary" size="sm" onClick={() => void dt.invoke('toolbar:toggle', { visible: true })}>Show now</Button>
        <Button variant="ghost" size="sm" onClick={() => void update({ toolbar: { x: null, y: null } })}>Reset position</Button>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>Shortcut: {formatAccelerator(settings.shortcuts.toggleToolbar)}. The toolbar remembers where you leave it.</p>
    </Card>
  )
}

function Advanced() {
  const { ffmpeg, refreshFfmpeg, info, update } = useApp()
  const [detecting, setDetecting] = useState(false)
  const [confirmNode, ask] = useConfirm()
  return (
    <>
      <Card
        title="Video encoding (FFmpeg)"
        subtitle="Used to finalise MP4 files and for export/compression. Recording itself uses the built-in Chromium encoder."
        actions={<Button variant="ghost" size="sm" icon={detecting ? <Spinner size={13} /> : <RefreshCw size={14} />} onClick={async () => { setDetecting(true); await refreshFfmpeg(); setDetecting(false) }}>Detect again</Button>}
      >
        {!ffmpeg ? (
          <div className="row muted"><Spinner /> Detecting encoders…</div>
        ) : !ffmpeg.available ? (
          <Notice tone="warning" title="FFmpeg not found">{ffmpeg.error} Recordings are saved as WebM until FFmpeg is available.</Notice>
        ) : (
          <div className="stack">
            <dl className="spec-list">
              <dt>Version</dt><dd>{ffmpeg.version}</dd>
              <dt>Source</dt><dd>{ffmpeg.bundled ? 'Bundled (LGPL build)' : 'System installation'}</dd>
              <dt>AAC audio</dt><dd>{ffmpeg.aac ? 'Available' : 'Unavailable'}</dd>
            </dl>
            <div className="row">
              {ffmpeg.h264Encoders.length === 0 && <Badge tone="warning">No H.264 encoder</Badge>}
              {ffmpeg.h264Encoders.map((e) => (
                <Badge key={e.id} tone={e.hardware ? 'success' : 'neutral'}>{e.label}</Badge>
              ))}
            </div>
          </div>
        )}
      </Card>
      <Card title="System">
        <dl className="spec-list">
          <dt>Operating system</dt><dd>{info ? `${info.platform === 'win32' ? 'Windows' : info.platform} ${info.osRelease}` : '—'}</dd>
          <dt>Hardware acceleration</dt><dd>{info?.capabilities.hardwareAcceleration ? 'On' : 'Off'}</dd>
          <dt>System audio capture</dt><dd>{info?.capabilities.systemAudio ? 'Supported' : 'Not supported'}</dd>
          <dt>Hide own windows from capture</dt><dd>{info?.capabilities.excludeFromCapture ? 'Supported' : 'Not available'}</dd>
        </dl>
        <p className="small muted">{info?.capabilities.systemAudioNote}</p>
      </Card>
      <Card title="Troubleshooting">
        <p className="small muted" style={{ marginTop: 0 }}>Logs contain technical events only — never screen content, audio or file contents. They stay on this PC unless you share them.</p>
        <div className="row">
          <Button variant="secondary" icon={<FolderOpen size={15} />} onClick={() => void dt.invoke('shell:openFolder', { kind: 'logs' })}>Open logs folder</Button>
          <Button
            variant="danger"
            icon={<RotateCcw size={15} />}
            onClick={async () => {
              if (await ask({ title: 'Reset all settings?', message: 'All preferences return to their defaults. Your recordings and screenshots are not affected.', confirmLabel: 'Reset settings', danger: true })) {
                await dt.invoke('settings:reset')
                void update({})
              }
            }}
          >
            Reset all settings
          </Button>
        </div>
      </Card>
      <Card title={<span className="row"><AppWindow size={15} /> Privacy</span>}>
        <p className="small muted" style={{ margin: 0 }}>Digital Target Screen Studio has no telemetry, analytics or cloud features. Nothing you record is uploaded.</p>
      </Card>
      {confirmNode}
    </>
  )
}
