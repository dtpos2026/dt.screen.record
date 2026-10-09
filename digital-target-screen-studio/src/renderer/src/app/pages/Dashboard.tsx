import { useEffect, useState } from 'react'
import { Camera, Circle, Cpu, Film, FolderOpen, HardDrive, Image as ImageIcon, Keyboard, Mic, Monitor, PanelTop, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { formatAccelerator } from '@shared/accelerator'
import { formatBytes, formatDate, formatDuration } from '@shared/format'
import type { DiskInfo, RecoverableRecording } from '@shared/types'
import { Badge, Button, Card, EmptyState, Notice } from '../../components/ui'
import { dt } from '../../lib/hooks'
import { useDisplays, useLibrary } from '../../lib/media'
import { useApp } from '../context'
import { audioSummary, qualityInfo, sourceSummary } from '../summary'
import markUrl from '../../assets/brand/mark-white.svg'

export function Dashboard() {
  const { settings, navigate, recording, ffmpeg, info, toast } = useApp()
  const { displays } = useDisplays(false)
  const { items, thumb } = useLibrary()
  const [disk, setDisk] = useState<DiskInfo | null>(null)
  const [recoverable, setRecoverable] = useState<RecoverableRecording[]>([])
  const [recovering, setRecovering] = useState<string | null>(null)
  const busy = !!recording && recording.status !== 'idle'

  useEffect(() => {
    void dt.invoke('system:disk', { kind: 'recordings' }).then(setDisk)
    void dt.invoke('recording:recoverable').then(setRecoverable)
    return dt.on('recovery:available', setRecoverable)
  }, [settings.general.recordingsDir])

  const q = qualityInfo(settings, displays)
  const hw = ffmpeg?.h264Encoders.find((e) => e.hardware)
  const recent = (items ?? []).slice(0, 6)
  const sc = settings.shortcuts

  const start = async () => {
    const r = await dt.invoke('recording:start')
    if (!r.ok) toast({ kind: 'error', title: r.error.message, message: r.error.hint })
  }
  const shot = async () => {
    const r = await dt.invoke('screenshot:capture', { mode: settings.screenshot.defaultMode })
    if (!r.ok && r.error.code !== 'BUSY') toast({ kind: 'error', title: r.error.message, message: r.error.hint })
  }
  const recover = async (id: string) => {
    setRecovering(id)
    const r = await dt.invoke('recording:recover', { id })
    setRecovering(null)
    if (r.ok) {
      toast({ kind: 'success', title: 'Recording recovered', message: r.value.split(/[\\/]/).pop(), revealPath: r.value })
      setRecoverable((l) => l.filter((x) => x.id !== id))
    } else toast({ kind: 'error', title: r.error.message, message: r.error.hint })
  }
  const discardRecovery = async (id: string) => {
    if (await dt.invoke('recording:discardRecoverable', { id })) setRecoverable((l) => l.filter((x) => x.id !== id))
  }

  return (
    <div className="stack">
      <section className="hero">
        <div>
          <Badge tone="accent">
            <Sparkles size={12} /> Digital Target Screen Studio
          </Badge>
          <h2 style={{ marginTop: 12 }}>{busy ? 'Recording in progress' : 'Ready when you are'}</h2>
          <p>Record your screen with crystal-clear audio or capture pixel-perfect screenshots at native resolution. Everything stays on this computer.</p>
          <div className="hero-actions">
            {busy ? (
              <Button variant="record" size="lg" icon={<Circle size={16} />} onClick={() => navigate('recorder')}>
                View recording
              </Button>
            ) : (
              <Button variant="record" size="lg" icon={<Circle size={16} fill="currentColor" />} onClick={start} tip={formatAccelerator(sc.recordToggle)}>
                Start Recording
              </Button>
            )}
            <Button variant="secondary" size="lg" icon={<Camera size={17} />} onClick={shot} tip={formatAccelerator(sc.screenshotRegion)}>
              Quick Screenshot
            </Button>
            <Button variant="ghost" size="lg" icon={<PanelTop size={17} />} onClick={() => void dt.invoke('toolbar:toggle', { visible: true })}>
              Floating toolbar
            </Button>
          </div>
        </div>
        <img className="hero-mark" src={markUrl} alt="" />
      </section>

      {recoverable.length > 0 && (
        <Notice
          tone="warning"
          title={`${recoverable.length === 1 ? 'An interrupted recording was found' : `${recoverable.length} interrupted recordings were found`}`}
          action={
            <div className="row">
              <Button variant="primary" size="sm" icon={<RotateCcw size={14} />} loading={recovering === recoverable[0].id} onClick={() => recover(recoverable[0].id)}>
                Recover
              </Button>
              <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => discardRecovery(recoverable[0].id)}>
                Delete
              </Button>
            </div>
          }
        >
          {formatBytes(recoverable[0].sizeBytes)} recorded {formatDate(recoverable[0].startedMs)} was not saved because the app closed unexpectedly. It can be recovered.
        </Notice>
      )}
      {recording?.lastError && recording.status === 'idle' && (
        <Notice tone="danger" title={recording.lastError.message}>
          {recording.lastError.hint}
        </Notice>
      )}
      {ffmpeg && !ffmpeg.available && (
        <Notice tone="warning" title="FFmpeg is not available">
          Recordings are saved as WebM. MP4 conversion, compression and export need FFmpeg, which is included with the installer.
        </Notice>
      )}
      {disk?.freeBytes != null && disk.freeBytes < 2 * 1024 ** 3 && (
        <Notice tone="warning" title="Low disk space">
          Only {formatBytes(disk.freeBytes)} is free where recordings are saved. Choose another folder in Settings if needed.
        </Notice>
      )}

      <div className="summary">
        <div className="stat">
          <div className="stat-icon"><Monitor size={17} /></div>
          <div className="truncate">
            <div className="stat-label">Source</div>
            <div className="stat-value truncate">{sourceSummary(settings, displays)}</div>
            <button className="link-btn" onClick={() => navigate('recorder')}>Change</button>
          </div>
        </div>
        <div className="stat">
          <div className="stat-icon"><Mic size={17} /></div>
          <div className="truncate">
            <div className="stat-label">Audio</div>
            <div className="stat-value truncate">{audioSummary(settings)}</div>
            <div className="stat-sub">{settings.audio.sampleRate / 1000} kHz · AAC {settings.audio.bitrateKbps} kbps</div>
          </div>
        </div>
        <div className="stat">
          <div className="stat-icon"><Film size={17} /></div>
          <div className="truncate">
            <div className="stat-label">Quality</div>
            <div className="stat-value truncate">{q.label}</div>
            <div className="stat-sub">{q.output ? `${q.output.width} × ${q.output.height} · ${settings.recording.outputFormat.toUpperCase()}` : settings.recording.outputFormat.toUpperCase()}</div>
          </div>
        </div>
        <div className="stat">
          <div className="stat-icon"><HardDrive size={17} /></div>
          <div className="truncate">
            <div className="stat-label">Storage</div>
            <div className="stat-value truncate" title={settings.general.recordingsDir}>{settings.general.recordingsDir.split(/[\\/]/).filter(Boolean).pop()}</div>
            <div className="stat-sub">{disk?.freeBytes != null ? `${formatBytes(disk.freeBytes)} free` : 'Checking…'}</div>
          </div>
        </div>
      </div>

      <div className="layout-main-side">
        <Card
          title="Recent recordings & screenshots"
          subtitle={items ? `${items.length} item${items.length === 1 ? '' : 's'} in your library` : 'Loading…'}
          actions={<Button variant="ghost" size="sm" onClick={() => navigate('library')}>Open library</Button>}
        >
          {items && recent.length === 0 ? (
            <EmptyState icon={<Film size={24} />} title="Nothing here yet">
              Your recordings and screenshots will appear here. Press Start Recording or take a quick screenshot to begin.
            </EmptyState>
          ) : (
            <div className="media-grid">
              {recent.map((it) => {
                const t = thumb(it)
                return (
                  <button key={it.path} className="media-card" onClick={() => navigate('library', { select: it.path })}>
                    <div className="media-thumb">
                      {t ? <img src={t} alt="" loading="lazy" /> : it.kind === 'video' ? <Film size={22} /> : <ImageIcon size={22} />}
                      <span className="media-kind"><Badge tone={it.kind === 'video' ? 'rec' : 'accent'}>{it.kind === 'video' ? 'Video' : 'Image'}</Badge></span>
                      {it.durationSec != null && <span className="media-dur tabular">{formatDuration(it.durationSec * 1000)}</span>}
                    </div>
                    <div className="media-info">
                      <span className="media-name truncate">{it.name}</span>
                      <span className="media-sub">{formatDate(it.createdMs)} · {formatBytes(it.size)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        <div className="stack">
          <Card title="Status">
            <dl className="spec-list">
              <dt>Export encoder</dt>
              <dd>{ffmpeg ? (hw ? hw.label.replace(' (hardware)', '') : ffmpeg.h264Encoders[0]?.label ?? 'Built-in') : 'Checking…'}</dd>
              <dt>System audio</dt>
              <dd>{info?.capabilities.systemAudio ? 'Supported' : 'Not supported'}</dd>
              <dt>Hide toolbar in captures</dt>
              <dd>{info?.capabilities.excludeFromCapture ? 'Supported' : 'Not available'}</dd>
              <dt>Displays</dt>
              <dd>{displays.length || '—'}</dd>
            </dl>
            <div className="divider" style={{ margin: '14px 0' }} />
            <div className="row">
              <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={() => void dt.invoke('shell:openFolder', { kind: 'recordings' })}>
                Recordings
              </Button>
              <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={() => void dt.invoke('shell:openFolder', { kind: 'screenshots' })}>
                Screenshots
              </Button>
            </div>
          </Card>
          <Card title="Keyboard shortcuts" actions={<Button variant="ghost" size="sm" icon={<Keyboard size={14} />} onClick={() => navigate('settings', { section: 'shortcuts' })}>Edit</Button>}>
            <dl className="spec-list">
              <dt>Start / stop recording</dt>
              <dd><kbd className="kbd">{formatAccelerator(sc.recordToggle)}</kbd></dd>
              <dt>Pause / resume</dt>
              <dd><kbd className="kbd">{formatAccelerator(sc.pauseToggle)}</kbd></dd>
              <dt>Region screenshot</dt>
              <dd><kbd className="kbd">{formatAccelerator(sc.screenshotRegion)}</kbd></dd>
              <dt>Full-screen screenshot</dt>
              <dd><kbd className="kbd">{formatAccelerator(sc.screenshotFullscreen)}</kbd></dd>
              <dt>Show / hide toolbar</dt>
              <dd><kbd className="kbd">{formatAccelerator(sc.toggleToolbar)}</kbd></dd>
            </dl>
          </Card>
          {hw == null && ffmpeg?.available && (
            <Notice tone="info" title="Software encoding">
              <span className="row"><Cpu size={14} /> No hardware video encoder was detected. Recording still works; exports may be slower.</span>
            </Notice>
          )}
        </div>
      </div>
    </div>
  )
}
