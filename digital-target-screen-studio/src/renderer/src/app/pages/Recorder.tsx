import { useEffect, useState } from 'react'
import { AppWindow, Circle, Crop, FolderOpen, Layers, Monitor, Mic, Pause, Play, PlayCircle, RefreshCw, Square, Trash2, Volume2, Webcam as WebcamIcon, ExternalLink, Info } from 'lucide-react'
import { formatBytes, formatDuration, splitHms } from '@shared/format'
import type { Settings, SourceMode } from '@shared/settings'
import type { WindowSourceInfo } from '@shared/types'
import { Badge, Button, Card, EmptyState, Field, Meter, Notice, ProgressBar, Segmented, Select, Slider, Spinner, Toggle } from '../../components/ui'
import { meterPosition } from '../../lib/audio-chain'
import { dt, useAudioLevels, useElapsed } from '../../lib/hooks'
import { playTestTone, useDisplays, useMediaDevices, useMicPreview, useSystemAudioPreview } from '../../lib/media'
import { useApp } from '../context'
import { qualityInfo, sourceSummary } from '../summary'

/** Remembered for the session so the choice survives page switches. */
let selectedWindow: { id: string; name: string } | null = null

const MODES: Array<{ mode: SourceMode; label: string; desc: string; icon: typeof Monitor }> = [
  { mode: 'display', label: 'Full screen', desc: 'A whole monitor', icon: Monitor },
  { mode: 'window', label: 'Window', desc: 'One application', icon: AppWindow },
  { mode: 'region', label: 'Region', desc: 'A custom area', icon: Crop },
  { mode: 'all-displays', label: 'All displays', desc: 'Every monitor', icon: Layers }
]

const DURATIONS = [0, 60, 300, 600, 900, 1800, 3600, 7200]

function durationLabel(s: number): string {
  if (s === 0) return 'Unlimited'
  if (s < 3600) return `${s / 60} min`
  return `${s / 3600} h`
}

export function Recorder() {
  const { settings, update, recording, ffmpeg, info, toast, navigate } = useApp()
  const r = settings.recording
  const { displays, refresh: refreshDisplays, loading } = useDisplays(true)
  const [windows, setWindows] = useState<WindowSourceInfo[] | null>(null)
  const [win, setWin] = useState(selectedWindow)
  const status = recording?.status ?? 'idle'
  const busy = status !== 'idle'
  const active = status === 'recording' || status === 'paused'

  const loadWindows = async () => {
    setWindows(null)
    setWindows(await dt.invoke('capture:windows'))
  }
  useEffect(() => {
    if (r.sourceMode === 'window' && windows == null) void loadWindows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.sourceMode])

  const setRec = (p: Partial<Settings['recording']>) => void update({ recording: p })
  const chooseWindow = (w: WindowSourceInfo) => {
    selectedWindow = { id: w.id, name: w.name }
    setWin(selectedWindow)
    void dt.invoke('recording:selectWindow', { sourceId: w.id, name: w.name })
  }
  const selectRegion = async (displayId?: string) => {
    const res = await dt.invoke('recording:selectRegion', displayId ? { displayId } : {})
    if (!res.ok) toast({ kind: 'error', title: res.error.message })
  }
  const start = async () => {
    if (r.sourceMode === 'window' && win) await dt.invoke('recording:selectWindow', { sourceId: win.id, name: win.name })
    const res = await dt.invoke('recording:start')
    if (!res.ok) toast({ kind: 'error', title: res.error.message, message: res.error.hint })
  }

  const q = qualityInfo(settings, displays)
  const selectedDisplay = displays.find((d) => d.id === r.displayId) ?? displays.find((d) => d.isPrimary)
  const canStart = !busy && (r.sourceMode !== 'window' || !!win)

  return (
    <div className="layout-main-side">
      <div className="stack">
        <Card title="What to record" subtitle={sourceSummary(settings, displays, win?.name)}>
          <div className="mode-tabs" role="radiogroup" aria-label="Capture source">
            {MODES.map((m) => {
              const Icon = m.icon
              return (
                <button key={m.mode} role="radio" aria-checked={r.sourceMode === m.mode} className={`mode-tab ${r.sourceMode === m.mode ? 'active' : ''}`} onClick={() => setRec({ sourceMode: m.mode })} disabled={busy}>
                  <Icon size={18} />
                  <strong>{m.label}</strong>
                  <span>{m.desc}</span>
                </button>
              )
            })}
          </div>

          {(r.sourceMode === 'display' || r.sourceMode === 'all-displays') && (
            <>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <span className="muted small">{r.sourceMode === 'display' ? 'Choose the monitor to record' : 'All monitors are combined into one video'}</span>
                <Button variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={() => void refreshDisplays()}>Refresh</Button>
              </div>
              {loading && !displays.length ? (
                <div className="row muted"><Spinner /> Detecting displays…</div>
              ) : (
                <div className="source-grid">
                  {displays.map((d) => {
                    const sel = r.sourceMode === 'all-displays' || (selectedDisplay?.id === d.id)
                    return (
                      <button key={d.id} className={`source-tile ${sel ? 'selected' : ''}`} disabled={busy || r.sourceMode === 'all-displays'} onClick={() => setRec({ displayId: d.id })}>
                        <div className="source-thumb" style={d.thumbnail ? { backgroundImage: `url(${d.thumbnail})` } : undefined}>{!d.thumbnail && <Monitor size={22} />}</div>
                        <div className="source-meta truncate">{d.label}</div>
                        <div className="source-sub">
                          {d.physicalSize.width} × {d.physicalSize.height} · {Math.round(d.scaleFactor * 100)}% scale · {Math.round(d.refreshRate)} Hz
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {r.sourceMode === 'window' && (
            <>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <span className="muted small">Minimised windows cannot be captured. Some protected apps appear black.</span>
                <Button variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={() => void loadWindows()}>Refresh</Button>
              </div>
              {windows == null ? (
                <div className="row muted"><Spinner /> Finding windows…</div>
              ) : windows.length === 0 ? (
                <EmptyState icon={<AppWindow size={22} />} title="No windows found">Open the application you want to record and press Refresh.</EmptyState>
              ) : (
                <div className="source-grid">
                  {windows.map((w) => (
                    <button key={w.id} className={`source-tile ${win?.id === w.id ? 'selected' : ''}`} disabled={busy} onClick={() => chooseWindow(w)}>
                      <div className="source-thumb" style={w.thumbnail ? { backgroundImage: `url(${w.thumbnail})` } : undefined}>{!w.thumbnail && <AppWindow size={22} />}</div>
                      <div className="source-meta">
                        {w.appIcon && <img src={w.appIcon} alt="" />}
                        <span className="truncate">{w.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {r.sourceMode === 'region' && (
            <div className="stack">
              {r.region ? (
                <Notice
                  tone="info"
                  title={sourceSummary(settings, displays)}
                  action={<Button variant="secondary" size="sm" icon={<Crop size={14} />} onClick={() => selectRegion()} disabled={busy}>Change area</Button>}
                >
                  On {displays.find((d) => d.id === r.region!.displayId)?.label ?? 'a display that is not connected'}. A thin frame marks the area while recording.
                </Notice>
              ) : (
                <EmptyState icon={<Crop size={22} />} title="Select the area to record" action={<Button variant="primary" icon={<Crop size={15} />} onClick={() => selectRegion()} disabled={busy}>Select area</Button>}>
                  Drag over any part of a screen. You can fine-tune the size in pixels before confirming.
                </EmptyState>
              )}
              <Toggle checked={r.showRegionBorder} onChange={(v) => setRec({ showRegionBorder: v })} label="Show recording frame" description="Draws a frame just outside the recorded area (never inside the video)." />
            </div>
          )}
        </Card>

        <QualityCard />
        <AudioCard />
        <WebcamCard />

        <Card title="Countdown & duration">
          <div className="grid-2">
            <Field label="Countdown before recording">
              <div className="row">
                <Segmented
                  size="sm"
                  value={[0, 3, 5, 10].includes(r.countdownSeconds) ? r.countdownSeconds : -1}
                  onChange={(v) => setRec({ countdownSeconds: v === -1 ? 15 : v })}
                  options={[
                    { value: 0, label: 'Off' },
                    { value: 3, label: '3 s' },
                    { value: 5, label: '5 s' },
                    { value: 10, label: '10 s' },
                    { value: -1, label: 'Custom' }
                  ]}
                />
                {![0, 3, 5, 10].includes(r.countdownSeconds) && (
                  <input className="input input-sm" style={{ width: 70 }} type="number" min={1} max={60} value={r.countdownSeconds} onChange={(e) => setRec({ countdownSeconds: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} aria-label="Countdown seconds" />
                )}
              </div>
            </Field>
            <Field label="Stop automatically after" hint={r.durationLimitSeconds ? 'The recording is saved automatically when the time is up.' : 'Record until you press Stop.'}>
              <div className="row">
                <Select
                  value={DURATIONS.includes(r.durationLimitSeconds) ? r.durationLimitSeconds : -1}
                  onChange={(v) => setRec({ durationLimitSeconds: v === -1 ? 1200 : v })}
                  options={[...DURATIONS.map((d) => ({ value: d, label: durationLabel(d) })), { value: -1, label: 'Custom…' }]}
                  ariaLabel="Duration limit"
                />
              </div>
              {!DURATIONS.includes(r.durationLimitSeconds) && <DurationInput seconds={r.durationLimitSeconds} onChange={(s) => setRec({ durationLimitSeconds: s })} />}
            </Field>
          </div>
          <div style={{ marginTop: 8 }}>
            <Toggle checked={r.minimizeOnStart} onChange={(v) => setRec({ minimizeOnStart: v })} label="Hide this window while recording" description="Recording continues in the background. Use the floating toolbar, tray icon or shortcuts to control it." />
          </div>
        </Card>
      </div>

      <div className="stack" style={{ position: 'sticky', top: 0 }}>
        <StatusCard canStart={canStart} onStart={start} />
        <Card title="Output">
          <dl className="spec-list">
            <dt>Resolution</dt>
            <dd>{active && recording?.output ? `${recording.output.width} × ${recording.output.height}` : q.output ? `${q.output.width} × ${q.output.height}` : 'Set by window'}</dd>
            <dt>Frame rate</dt>
            <dd>{r.fps} fps</dd>
            <dt>Format</dt>
            <dd>{r.outputFormat === 'mp4' ? 'MP4 · H.264 · AAC' : 'WebM · VP9 · Opus'}</dd>
            <dt>Audio</dt>
            <dd>{settings.audio.systemAudio || settings.audio.microphone ? `${settings.audio.sampleRate / 1000} kHz · ${settings.audio.bitrateKbps} kbps` : 'Muted'}</dd>
            <dt>Estimated size</dt>
            <dd>{q.bytesPerMinute ? `≈ ${formatBytes(q.bytesPerMinute)} / min` : '—'}</dd>
          </dl>
          {q.limitedBySource && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              <Info size={13} style={{ verticalAlign: -2 }} /> The source is smaller than {r.resolution}p, so it is recorded at its real resolution. Footage is never upscaled.
            </p>
          )}
          {q.limitedByEncoder && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              <Info size={13} style={{ verticalAlign: -2 }} /> Scaled to fit H.264 encoder limits (max 4096 px wide, ~8.9 MP).
            </p>
          )}
          <div className="divider" style={{ margin: '12px 0' }} />
          <div className="small muted truncate" title={settings.general.recordingsDir}>Saving to {settings.general.recordingsDir}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void dt.invoke('shell:openFolder', { kind: 'recordings' })}>Open folder</Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('settings', { section: 'general' })}>Change</Button>
          </div>
        </Card>
        {ffmpeg && !ffmpeg.available && r.outputFormat === 'mp4' && <Notice tone="warning" title="MP4 unavailable">FFmpeg was not found, so recordings will be saved as WebM.</Notice>}
        {info?.platform === 'win32' && !info.capabilities.excludeFromCapture && (
          <Notice tone="info">The floating toolbar may appear in recordings on this Windows version (hiding requires Windows 10 version 2004 or later).</Notice>
        )}
      </div>
    </div>
  )
}

function DurationInput({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const { h, m, s } = splitHms(seconds)
  const set = (nh: number, nm: number, ns: number) => onChange(Math.max(1, Math.min(24 * 3600, nh * 3600 + nm * 60 + ns)))
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <input className="input input-sm" style={{ width: 64 }} type="number" min={0} max={24} value={h} onChange={(e) => set(Number(e.target.value) || 0, m, s)} aria-label="Hours" /> h
      <input className="input input-sm" style={{ width: 64 }} type="number" min={0} max={59} value={m} onChange={(e) => set(h, Number(e.target.value) || 0, s)} aria-label="Minutes" /> m
      <input className="input input-sm" style={{ width: 64 }} type="number" min={0} max={59} value={s} onChange={(e) => set(h, m, Number(e.target.value) || 0)} aria-label="Seconds" /> s
    </div>
  )
}

export function QualityCard() {
  const { settings, update, recording } = useApp()
  const r = settings.recording
  const busy = (recording?.status ?? 'idle') !== 'idle'
  const setRec = (p: Partial<Settings['recording']>) => void update({ recording: p })
  return (
    <Card title="Quality" subtitle="Presets never upscale: if the source is smaller, its native resolution is used.">
      <div className="stack">
        <Field label="Resolution">
          <Segmented
            value={r.resolution}
            onChange={(v) => setRec({ resolution: v })}
            options={[
              { value: 'native', label: 'Native', tip: 'Exact resolution of the source' },
              { value: '2160', label: '4K', tip: '2160p UHD' },
              { value: '1440', label: '1440p', tip: 'QHD' },
              { value: '1080', label: '1080p', tip: 'Full HD' },
              { value: '720', label: '720p', tip: 'HD' }
            ]}
          />
        </Field>
        <div className="grid-2">
          <Field label="Frame rate">
            <Segmented value={r.fps} onChange={(v) => setRec({ fps: v })} options={[{ value: 24, label: '24' }, { value: 30, label: '30' }, { value: 60, label: '60' }]} />
          </Field>
          <Field label="Quality">
            <Segmented
              value={r.quality}
              onChange={(v) => setRec({ quality: v })}
              options={[
                { value: 'standard', label: 'Standard', tip: 'Smaller files' },
                { value: 'high', label: 'High', tip: 'Recommended' },
                { value: 'ultra', label: 'Ultra', tip: 'Sharpest text, larger files' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          </Field>
        </div>
        {r.quality === 'custom' && (
          <Field label="Video bitrate">
            <Slider value={r.customBitrateMbps} min={1} max={80} onChange={(v) => setRec({ customBitrateMbps: v })} ariaLabel="Video bitrate in Mbps" format={(v) => `${v} Mbps`} />
          </Field>
        )}
        <Field label="File format" hint={r.outputFormat === 'mp4' ? 'MP4 with H.264 video and AAC audio plays everywhere.' : 'WebM (VP9/Opus) is saved directly without conversion.'}>
          <Segmented value={r.outputFormat} onChange={(v) => setRec({ outputFormat: v })} options={[{ value: 'mp4', label: 'MP4 (recommended)' }, { value: 'webm', label: 'WebM' }]} />
        </Field>
        {busy && <p className="small muted" style={{ margin: 0 }}>Changes apply to the next recording.</p>}
      </div>
    </Card>
  )
}

export function AudioCard() {
  const { settings, update, info, recording } = useApp()
  const a = settings.audio
  const { mics, refresh } = useMediaDevices()
  const live = useAudioLevels()
  const active = recording?.status === 'recording' || recording?.status === 'paused'
  const [monitor, setMonitor] = useState(false)
  const [sysMonitor, setSysMonitor] = useState(false)
  const setA = (p: Partial<Settings['audio']>) => void update({ audio: p })
  const mic = useMicPreview(monitor && a.microphone && !active, {
    deviceId: a.micDeviceId,
    channels: a.micChannels,
    noiseSuppression: a.noiseSuppression,
    echoCancellation: a.echoCancellation,
    autoGainControl: a.autoGainControl,
    volume: a.micVolume / 100,
    enhance: a.voiceEnhancement
  })
  const sys = useSystemAudioPreview(sysMonitor && a.systemAudio && !active)
  useEffect(() => {
    if (mic.permission === 'granted') void refresh()
  }, [mic.permission, refresh])

  const micLevel = active ? live.mic : mic.level
  const sysLevel = active ? live.system : sys.level
  const sysSupported = info?.capabilities.systemAudio ?? true

  return (
    <Card title="Audio" subtitle="Choose any combination. Levels update live so you can check before recording.">
      <div className="stack">
        <div>
          <Toggle
            checked={a.systemAudio}
            disabled={!sysSupported}
            onChange={(v) => setA({ systemAudio: v })}
            label={<span className="row"><Volume2 size={15} /> System audio</span>}
            description={sysSupported ? 'Sound playing on this PC (videos, calls, apps).' : info?.capabilities.systemAudioNote}
          />
          {a.systemAudio && (
            <div className="stack" style={{ paddingLeft: 2, marginTop: 6 }}>
              <div className="level-row">
                <span className="muted">Level</span>
                <Meter level={meterPosition(sysLevel?.rms ?? 0)} peak={meterPosition(sysLevel?.peak ?? 0)} clipping={sysLevel?.clipping} label="System audio level" />
                <div className="row" style={{ gap: 4 }}>
                  <Button size="sm" variant={sysMonitor ? 'primary' : 'secondary'} disabled={active} onClick={() => setSysMonitor((v) => !v)}>{sysMonitor ? 'Stop test' : 'Test'}</Button>
                  <Button size="sm" variant="ghost" icon={<PlayCircle size={14} />} onClick={playTestTone} disabled={active} tip="Play a short test sound" />
                </div>
              </div>
              {sys.error && <span className="small" style={{ color: 'var(--warning)' }}>{sys.error}</span>}
              <div className="level-row">
                <span className="muted">Volume</span>
                <Slider value={a.systemVolume} min={0} max={200} step={5} onChange={(v) => setA({ systemVolume: v })} ariaLabel="System audio volume" format={(v) => `${v}%`} />
                <span />
              </div>
            </div>
          )}
        </div>
        <div className="divider" />
        <div>
          <Toggle checked={a.microphone} onChange={(v) => setA({ microphone: v })} label={<span className="row"><Mic size={15} /> Microphone</span>} description="Your voice, recorded at 48 kHz and kept in sync with the video." />
          {a.microphone && (
            <div className="stack" style={{ marginTop: 6 }}>
              <Field label="Input device">
                <Select
                  value={mics.some((m) => m.deviceId === a.micDeviceId) ? a.micDeviceId : 'default'}
                  onChange={(v) => setA({ micDeviceId: v })}
                  ariaLabel="Microphone"
                  options={
                    mics.length
                      ? mics.map((m, i) => ({ value: m.deviceId || 'default', label: m.label || `Microphone ${i + 1}` }))
                      : [{ value: 'default', label: 'Default microphone' }]
                  }
                />
              </Field>
              <div className="level-row">
                <span className="muted">Level</span>
                <Meter level={meterPosition(micLevel?.rms ?? 0)} peak={meterPosition(micLevel?.peak ?? 0)} clipping={micLevel?.clipping} label="Microphone level" />
                <Button size="sm" variant={monitor ? 'primary' : 'secondary'} disabled={active} onClick={() => setMonitor((v) => !v)}>{monitor ? 'Stop' : 'Check level'}</Button>
              </div>
              {micLevel?.clipping && <span className="small" style={{ color: 'var(--danger)' }}>Clipping detected — lower the volume or move the microphone further away.</span>}
              <div className="level-row">
                <span className="muted">Volume</span>
                <Slider value={a.micVolume} min={0} max={200} step={5} onChange={(v) => setA({ micVolume: v })} ariaLabel="Microphone volume" format={(v) => `${v}%`} />
                <span />
              </div>
              <div className="row">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={mic.testing === 'recording' ? <Spinner size={13} /> : <Mic size={14} />}
                  disabled={!monitor || mic.testing !== 'idle' || active || !!mic.error}
                  onClick={() => void mic.recordTest(5)}
                  tip={monitor ? 'Records 5 seconds and plays them back' : 'Press "Check level" first'}
                >
                  {mic.testing === 'recording' ? 'Recording 5 s…' : mic.testing === 'playing' ? 'Playing back…' : 'Test microphone (5 s)'}
                </Button>
                <span className="small muted">Speak normally; you will hear exactly how you sound in recordings.</span>
              </div>
              {mic.error && (
                <Notice
                  tone="danger"
                  title="Microphone unavailable"
                  action={info?.platform === 'win32' ? <Button size="sm" variant="secondary" icon={<ExternalLink size={13} />} onClick={() => void dt.invoke('shell:openSystemSettings', { target: 'microphone' })}>Privacy settings</Button> : undefined}
                >
                  {mic.error}
                </Notice>
              )}
              <div className="grid-2">
                <Field label="Sample rate">
                  <Segmented size="sm" value={a.sampleRate} onChange={(v) => setA({ sampleRate: v })} options={[{ value: 48000, label: '48 kHz' }, { value: 44100, label: '44.1 kHz' }]} />
                </Field>
                <Field label="AAC bitrate">
                  <Select value={a.bitrateKbps} onChange={(v) => setA({ bitrateKbps: v })} ariaLabel="Audio bitrate" options={[128, 160, 192, 256, 320].map((b) => ({ value: b as 128, label: `${b} kbps${b === 192 ? ' (recommended)' : ''}` }))} />
                </Field>
              </div>
              <div>
                <Toggle checked={a.noiseSuppression} onChange={(v) => setA({ noiseSuppression: v })} label="Noise suppression" description="Reduces steady background noise such as fans and hum." />
                <Toggle checked={a.echoCancellation} onChange={(v) => setA({ echoCancellation: v })} label="Echo cancellation" description="Use when recording speakers and a microphone together (headphones are best)." />
                <Toggle checked={a.autoGainControl} onChange={(v) => setA({ autoGainControl: v })} label="Automatic gain control" description="Keeps your level steady; turn off for the most natural sound." />
                <Toggle checked={a.voiceEnhancement} onChange={(v) => setA({ voiceEnhancement: v })} label="Voice enhancement" description="Gentle rumble filter, light compression and a safety limiter that prevents clipping." />
                <Toggle checked={a.micChannels === 2} onChange={(v) => setA({ micChannels: v ? 2 : 1 })} label="Stereo microphone" description="Only for stereo microphones. Mono is best for voice." />
              </div>
            </div>
          )}
        </div>
        {!a.systemAudio && !a.microphone && <Notice tone="info">Recording without sound. Turn on system audio or the microphone to include audio.</Notice>}
      </div>
    </Card>
  )
}

export function WebcamCard() {
  const { settings, update } = useApp()
  const w = settings.webcam
  const { cameras } = useMediaDevices()
  const setW = (p: Partial<Settings['webcam']>) => void update({ webcam: p })
  return (
    <Card title={<span className="row"><WebcamIcon size={16} /> Webcam overlay</span>} subtitle="A movable camera bubble that is recorded as part of your screen.">
      <Toggle checked={w.enabled} onChange={(v) => setW({ enabled: v })} label="Show webcam" description="Drag the bubble anywhere. Hover it to resize or change its shape." />
      {w.enabled && (
        <div className="grid-2" style={{ marginTop: 8 }}>
          <Field label="Camera">
            <Select
              value={cameras.some((c) => c.deviceId === w.deviceId) ? w.deviceId : 'default'}
              onChange={(v) => setW({ deviceId: v })}
              ariaLabel="Camera"
              options={cameras.length ? cameras.map((c, i) => ({ value: c.deviceId || 'default', label: c.label || `Camera ${i + 1}` })) : [{ value: 'default', label: 'Default camera' }]}
            />
          </Field>
          <Field label="Shape">
            <Segmented value={w.shape} onChange={(v) => setW({ shape: v })} options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rectangle' }]} />
          </Field>
          <Field label="Size">
            <Slider value={w.size} min={120} max={600} step={20} onChange={(v) => setW({ size: v })} ariaLabel="Webcam size" format={(v) => `${v}px`} />
          </Field>
          <Field label="Mirror">
            <Segmented value={w.mirror ? 'on' : 'off'} onChange={(v) => setW({ mirror: v === 'on' })} options={[{ value: 'on', label: 'Mirrored' }, { value: 'off', label: 'Normal' }]} />
          </Field>
        </div>
      )}
    </Card>
  )
}

function StatusCard({ canStart, onStart }: { canStart: boolean; onStart: () => void }) {
  const { recording, settings, navigate } = useApp()
  const elapsed = useElapsed(recording)
  const status = recording?.status ?? 'idle'
  const active = status === 'recording' || status === 'paused'
  const limit = recording?.limitMs ?? 0
  const [acting, setActing] = useState(false)
  const act = async (fn: () => Promise<unknown>) => {
    setActing(true)
    try {
      await fn()
    } finally {
      setActing(false)
    }
  }
  const stateLabel = {
    idle: 'Ready',
    selecting: 'Selecting',
    countdown: 'Starting',
    starting: 'Preparing',
    recording: 'Recording',
    paused: 'Paused',
    stopping: 'Stopping',
    finalizing: 'Saving'
  }[status]
  return (
    <Card>
      <div className="rec-status">
        <span className={`rec-state ${status}`}>{stateLabel}</span>
        <span className="rec-time tabular">{formatDuration(active || status === 'finalizing' || status === 'stopping' ? elapsed : 0)}</span>
        {limit > 0 && active && (
          <div style={{ width: '100%' }}>
            <ProgressBar value={(elapsed / limit) * 100} />
            <div className="small muted" style={{ marginTop: 4 }}>Stops automatically at {formatDuration(limit)}</div>
          </div>
        )}
        {status === 'finalizing' && (
          <div style={{ width: '100%' }}>
            <ProgressBar value={recording?.finalizeProgress} indeterminate={!recording?.finalizeProgress} />
            <div className="small muted" style={{ marginTop: 4 }}>Finalising and verifying the file…</div>
          </div>
        )}
        {active && recording?.output && (
          <div className="row" style={{ justifyContent: 'center' }}>
            <Badge>{recording.output.width} × {recording.output.height}</Badge>
            <Badge>{recording.output.fps} fps</Badge>
            {recording.audio.system && <Badge>System audio</Badge>}
            {recording.audio.microphone && <Badge>Mic</Badge>}
          </div>
        )}
        <div className="rec-controls">
          {status === 'idle' && (
            <Button variant="record" size="lg" icon={<Circle size={15} fill="currentColor" />} disabled={!canStart} onClick={onStart}>
              Start Recording
            </Button>
          )}
          {status === 'countdown' && (
            <Button variant="secondary" size="lg" onClick={() => act(() => dt.invoke('recording:cancelCountdown'))}>Cancel countdown</Button>
          )}
          {active && (
            <>
              <Button variant="record" size="lg" icon={<Square size={14} fill="currentColor" />} loading={acting} onClick={() => act(() => dt.invoke('recording:stop'))}>
                Stop & save
              </Button>
              <Button variant="secondary" size="lg" icon={status === 'paused' ? <Play size={16} /> : <Pause size={16} />} onClick={() => act(() => dt.invoke(status === 'paused' ? 'recording:resume' : 'recording:pause'))}>
                {status === 'paused' ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="ghost" size="lg" icon={<Trash2 size={16} />} onClick={() => act(() => dt.invoke('recording:discard'))} tip="Discard recording" aria-label="Discard recording" />
            </>
          )}
          {(status === 'starting' || status === 'stopping') && (
            <Button variant="secondary" size="lg" loading>
              {status === 'starting' ? 'Starting…' : 'Stopping…'}
            </Button>
          )}
        </div>
        {status === 'idle' && settings.recording.sourceMode === 'window' && !canStart && <span className="small muted">Choose a window to record.</span>}
      </div>
      {recording?.warnings.length && active ? (
        <Notice tone="warning">{recording.warnings[recording.warnings.length - 1]}</Notice>
      ) : null}
      {status === 'idle' && recording?.lastSavedPath && (
        <Notice
          tone="success"
          title="Last recording saved"
          action={
            <div className="row" style={{ gap: 4 }}>
              <Button size="sm" variant="secondary" onClick={() => void dt.invoke('library:open', { path: recording.lastSavedPath! })}>Play</Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('library', { select: recording.lastSavedPath! })}>Library</Button>
            </div>
          }
        >
          <span className="truncate" style={{ display: 'block', maxWidth: 180 }}>{recording.lastSavedPath.split(/[\\/]/).pop()}</span>
        </Notice>
      )}
      {status === 'idle' && recording?.lastError && (
        <Notice tone="danger" title={recording.lastError.message}>{recording.lastError.hint}</Notice>
      )}
    </Card>
  )
}
