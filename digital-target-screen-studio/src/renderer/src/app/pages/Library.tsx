import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Film, FolderOpen, Grid2x2, Image as ImageIcon, List, Maximize, Pause, Pencil, Play, RefreshCw, Scissors, Search, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { formatBytes, formatDate, formatDuration } from '@shared/format'
import type { ExportOptions, ExportProgress, MediaItem } from '@shared/types'
import { Badge, Button, Card, EmptyState, Field, IconButton, Modal, Notice, ProgressBar, Segmented, Select, Spinner, Toggle } from '../../components/ui'
import { dt } from '../../lib/hooks'
import { useLibrary } from '../../lib/media'
import { useApp } from '../context'

type TypeFilter = 'all' | 'video' | 'image'
type DateFilter = 'any' | 'today' | '7d' | '30d'

export function Library() {
  const { settings, update, params, navigate, toast } = useApp()
  const { items, refresh, thumb } = useLibrary()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const [date, setDate] = useState<DateFilter>('any')
  const [selected, setSelected] = useState<string[]>(params.select ? [params.select] : [])
  const [renaming, setRenaming] = useState<MediaItem | null>(null)
  const [exporting, setExporting] = useState<MediaItem | null>(null)
  const view = settings.library.view
  const sort = settings.library.sort

  const filtered = useMemo(() => {
    if (!items) return null
    const q = query.trim().toLowerCase()
    const now = Date.now()
    const day = 86_400_000
    const startOfToday = new Date().setHours(0, 0, 0, 0)
    const list = items.filter((i) => {
      if (type !== 'all' && i.kind !== type) return false
      if (q && !i.name.toLowerCase().includes(q)) return false
      if (date === 'today' && i.createdMs < startOfToday) return false
      if (date === '7d' && i.createdMs < now - 7 * day) return false
      if (date === '30d' && i.createdMs < now - 30 * day) return false
      return true
    })
    const sorted = [...list]
    if (sort === 'oldest') sorted.sort((a, b) => a.createdMs - b.createdMs)
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'size') sorted.sort((a, b) => b.size - a.size)
    else sorted.sort((a, b) => b.createdMs - a.createdMs)
    return sorted
  }, [items, query, type, date, sort])

  const current = selected.length === 1 ? items?.find((i) => i.path === selected[0]) ?? null : null

  useEffect(() => {
    if (items) setSelected((sel) => sel.filter((p) => items.some((i) => i.path === p)))
  }, [items])

  const click = (item: MediaItem, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) setSelected((s) => (s.includes(item.path) ? s.filter((p) => p !== item.path) : [...s, item.path]))
    else if (e.shiftKey && selected.length && filtered) {
      const a = filtered.findIndex((i) => i.path === selected[selected.length - 1])
      const b = filtered.findIndex((i) => i.path === item.path)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setSelected(filtered.slice(lo, hi + 1).map((i) => i.path))
    } else setSelected([item.path])
  }

  const remove = async (paths: string[]) => {
    const r = await dt.invoke('library:delete', { paths })
    if (!r.ok) toast({ kind: 'error', title: r.error.message })
    else if (r.value.length) {
      toast({ kind: 'success', title: `${r.value.length} file${r.value.length === 1 ? '' : 's'} moved to the Recycle Bin` })
      setSelected([])
      void refresh()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'Delete' && selected.length) void remove(selected)
      if (e.key === 'F2' && current) setRenaming(current)
      if (e.key === 'a' && e.ctrlKey && filtered) {
        e.preventDefault()
        setSelected(filtered.map((i) => i.path))
      }
      if (e.key === 'Escape') setSelected([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="layout-main-side" style={{ gridTemplateColumns: current ? 'minmax(0,1fr) 400px' : '1fr' }}>
      <div>
        <div className="media-toolbar">
          <div className="search">
            <Search size={15} />
            <input className="input" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search media" />
          </div>
          <Segmented size="sm" value={type} onChange={setType} ariaLabel="Type" options={[{ value: 'all', label: 'All' }, { value: 'video', label: 'Videos' }, { value: 'image', label: 'Screenshots' }]} />
          <div style={{ width: 140 }}>
            <Select value={date} onChange={setDate} ariaLabel="Date" options={[{ value: 'any', label: 'Any time' }, { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]} />
          </div>
          <div style={{ width: 130 }}>
            <Select value={sort} onChange={(v) => void update({ library: { sort: v } })} ariaLabel="Sort" options={[{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }, { value: 'name', label: 'Name' }, { value: 'size', label: 'Largest' }]} />
          </div>
          <div className="row" style={{ gap: 2, marginLeft: 'auto' }}>
            <IconButton label="Grid view" className={view === 'grid' ? 'active' : ''} onClick={() => void update({ library: { view: 'grid' } })}><Grid2x2 size={16} /></IconButton>
            <IconButton label="List view" className={view === 'list' ? 'active' : ''} onClick={() => void update({ library: { view: 'list' } })}><List size={16} /></IconButton>
            <IconButton label="Refresh" onClick={() => void refresh()}><RefreshCw size={16} /></IconButton>
            <IconButton label="Open recordings folder" onClick={() => void dt.invoke('shell:openFolder', { kind: 'recordings' })}><FolderOpen size={16} /></IconButton>
          </div>
        </div>

        {selected.length > 1 && (
          <Notice tone="info" title={`${selected.length} items selected`} action={<div className="row"><Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => void remove(selected)}>Delete</Button><Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button></div>} />
        )}

        {filtered == null ? (
          <div className="row muted" style={{ padding: 40, justifyContent: 'center' }}><Spinner /> Loading your library…</div>
        ) : filtered.length === 0 ? (
          <Card>
            {items && items.length > 0 ? (
              <EmptyState icon={<Search size={24} />} title="No matches">Try a different search or filter.</EmptyState>
            ) : (
              <EmptyState icon={<Film size={24} />} title="Your library is empty" action={<Button variant="primary" onClick={() => navigate('recorder')}>Make a recording</Button>}>
                Recordings are saved to {settings.general.recordingsDir} and screenshots to {settings.general.screenshotsDir}.
              </EmptyState>
            )}
          </Card>
        ) : view === 'grid' ? (
          <div className="media-grid" style={{ marginTop: selected.length > 1 ? 12 : 0 }}>
            {filtered.map((it) => {
              const t = thumb(it)
              const sel = selected.includes(it.path)
              return (
                <button key={it.path} className={`media-card ${sel ? 'selected' : ''}`} onClick={(e) => click(it, e)} onDoubleClick={() => void dt.invoke('library:open', { path: it.path })} aria-pressed={sel}>
                  <div className="media-thumb">
                    {t ? <img src={t} alt="" loading="lazy" /> : it.kind === 'video' ? <Film size={24} /> : <ImageIcon size={24} />}
                    <span className="media-kind"><Badge tone={it.kind === 'video' ? 'rec' : 'accent'}>{it.ext.slice(1).toUpperCase()}</Badge></span>
                    {it.durationSec != null && <span className="media-dur tabular">{formatDuration(it.durationSec * 1000)}</span>}
                    <span className="media-check" aria-hidden>{sel && <Check size={14} strokeWidth={3} />}</span>
                  </div>
                  <div className="media-info">
                    <span className="media-name truncate" title={it.name}>{it.name}</span>
                    <span className="media-sub">{formatDate(it.createdMs)}</span>
                    <span className="media-sub">{it.width ? `${it.width} × ${it.height} · ` : ''}{formatBytes(it.size)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <Card padded={false}>
            <table className="media-table">
              <thead>
                <tr><th style={{ width: 80 }} /><th>Name</th><th>Date</th><th>Duration</th><th>Resolution</th><th>Size</th></tr>
              </thead>
              <tbody>
                {filtered.map((it) => {
                  const t = thumb(it)
                  return (
                    <tr key={it.path} className={selected.includes(it.path) ? 'selected' : ''} onClick={(e) => click(it, e)} onDoubleClick={() => void dt.invoke('library:open', { path: it.path })}>
                      <td>{t ? <img className="thumb-sm" src={t} alt="" loading="lazy" /> : <div className="thumb-sm" />}</td>
                      <td className="truncate" style={{ maxWidth: 280 }}>{it.name}</td>
                      <td className="muted">{formatDate(it.createdMs)}</td>
                      <td className="tabular">{it.durationSec != null ? formatDuration(it.durationSec * 1000) : '—'}</td>
                      <td className="tabular">{it.width ? `${it.width} × ${it.height}` : '—'}</td>
                      <td className="tabular">{formatBytes(it.size)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {current && (
        <div style={{ position: 'sticky', top: 0 }}>
          <Card
            title={<span className="truncate" style={{ display: 'block', maxWidth: 300 }} title={current.name}>{current.name}</span>}
            actions={<IconButton label="Close preview" onClick={() => setSelected([])}><X size={16} /></IconButton>}
          >
            <div className="preview-pane">
              {current.kind === 'video' ? <VideoPlayer key={current.url} src={current.url} /> : <div className="player"><img src={current.url} alt={current.name} /></div>}
              <dl className="spec-list">
                <dt>Created</dt><dd>{formatDate(current.createdMs)}</dd>
                {current.durationSec != null && (<><dt>Duration</dt><dd>{formatDuration(current.durationSec * 1000)}</dd></>)}
                <dt>Resolution</dt><dd>{current.width ? `${current.width} × ${current.height}` : '—'}</dd>
                {current.fps != null && (<><dt>Frame rate</dt><dd>{Math.round(current.fps * 100) / 100} fps</dd></>)}
                <dt>Size</dt><dd>{formatBytes(current.size)}</dd>
                <dt>Format</dt><dd>{current.ext.slice(1).toUpperCase()}</dd>
              </dl>
              <div className="row">
                <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} onClick={async () => { const r = await dt.invoke('library:open', { path: current.path }); if (!r.ok) toast({ kind: 'error', title: r.error.message }) }}>Open</Button>
                <Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void dt.invoke('library:reveal', { path: current.path })}>Show in folder</Button>
                <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => setRenaming(current)}>Rename</Button>
              </div>
              <div className="row">
                {current.kind === 'video' ? (
                  <Button size="sm" variant="secondary" icon={<Scissors size={14} />} onClick={() => setExporting(current)}>Export / compress</Button>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => navigate('editor', { path: current.path })}>Edit</Button>
                    <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={async () => { const r = await dt.invoke('screenshot:copy', { path: current.path }); toast(r.ok ? { kind: 'success', title: 'Copied to clipboard' } : { kind: 'error', title: r.error.message }) }}>Copy</Button>
                  </>
                )}
                <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => void remove([current.path])}>Delete</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
      {renaming && <RenameDialog item={renaming} onClose={() => setRenaming(null)} onDone={(p) => { setRenaming(null); setSelected([p]) }} />}
      {exporting && <ExportDialog item={exporting} onClose={() => setExporting(null)} />}
    </div>
  )
}

function VideoPlayer({ src }: { src: string }) {
  const v = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState(false)
  const toggle = () => {
    const el = v.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }
  return (
    <div className="player">
      {error ? (
        <div className="player-error"><Notice tone="warning">This video cannot be previewed here. Use Open to play it in your default player.</Notice></div>
      ) : (
        <video
          ref={v}
          src={src}
          preload="metadata"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
          onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onError={() => setError(true)}
        />
      )}
      <div className="player-controls">
        <IconButton label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? <Pause size={16} /> : <Play size={16} />}</IconButton>
        <input
          className="seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={time}
          aria-label="Seek"
          onChange={(e) => {
            const t = Number(e.target.value)
            setTime(t)
            if (v.current) v.current.currentTime = t
          }}
        />
        <span className="player-time tabular">{formatDuration(time * 1000)} / {formatDuration(duration * 1000)}</span>
        <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={() => { setMuted(!muted); if (v.current) v.current.muted = !muted }}>{muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</IconButton>
        <input className="vol" type="range" min={0} max={1} step={0.05} value={volume} aria-label="Volume" onChange={(e) => { const x = Number(e.target.value); setVolume(x); if (v.current) v.current.volume = x }} />
        <IconButton label="Full screen" onClick={() => void v.current?.requestFullscreen()}><Maximize size={15} /></IconButton>
      </div>
    </div>
  )
}

function RenameDialog({ item, onClose, onDone }: { item: MediaItem; onClose: () => void; onDone: (path: string) => void }) {
  const base = item.name.slice(0, item.name.length - item.ext.length)
  const [name, setName] = useState(base)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const r = await dt.invoke('library:rename', { path: item.path, newName: name })
    setBusy(false)
    if (r.ok) onDone(r.value.path)
    else setError(r.error.message)
  }
  return (
    <Modal title="Rename" onClose={onClose} width={460} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!name.trim()}>Rename</Button></>}>
      <Field label="File name" hint={`The ${item.ext} extension is kept.`}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="input" value={name} autoFocus onChange={(e) => { setName(e.target.value); setError(null) }} onKeyDown={(e) => e.key === 'Enter' && void submit()} aria-label="New file name" />
          <span className="muted">{item.ext}</span>
        </div>
      </Field>
      {error && <p className="small" style={{ color: 'var(--danger)', marginBottom: 0 }}>{error}</p>}
    </Modal>
  )
}

function ExportDialog({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const { ffmpeg, toast } = useApp()
  const [opts, setOpts] = useState<ExportOptions>({ resolution: '1080', fps: 'original', quality: 'balanced', encoder: 'auto', audioBitrateKbps: 160, removeAudio: false })
  const [job, setJob] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  useEffect(
    () =>
      dt.on('export:progress', (p) => {
        if (p.jobId !== job) return
        setProgress(p)
        if (p.status === 'done') toast({ kind: 'success', title: 'Export finished', message: p.outputPath?.split(/[\\/]/).pop(), revealPath: p.outputPath })
        if (p.status === 'error') toast({ kind: 'error', title: 'Export failed', message: p.error })
      }),
    [job, toast]
  )
  const start = async () => {
    setProgress(null)
    const r = await dt.invoke('export:start', { path: item.path, options: opts })
    if (r.ok) setJob(r.value)
    else toast({ kind: 'error', title: r.error.message, message: r.error.hint })
  }
  const running = progress?.status === 'running' || (job && !progress)
  const set = (p: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...p }))
  const shorter = item.width && item.height ? Math.min(item.width, item.height) : 0
  return (
    <Modal
      title="Export / compress video"
      onClose={() => { if (running && job) void dt.invoke('export:cancel', { jobId: job }); onClose() }}
      width={560}
      footer={
        running ? (
          <Button variant="danger" onClick={() => job && void dt.invoke('export:cancel', { jobId: job })}>Cancel export</Button>
        ) : progress?.status === 'done' ? (
          <>
            <Button variant="secondary" icon={<FolderOpen size={14} />} onClick={() => progress.outputPath && void dt.invoke('library:reveal', { path: progress.outputPath })}>Show in folder</Button>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={start} disabled={!ffmpeg?.available}>Export MP4</Button>
          </>
        )
      }
    >
      {!ffmpeg?.available ? (
        <Notice tone="warning" title="FFmpeg is not available">Exporting requires FFmpeg, which is bundled with the installer.</Notice>
      ) : (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>Creates a new H.264/AAC MP4 next to the original. The original file is never changed.</p>
          <Field label="Resolution">
            <Segmented
              size="sm"
              value={opts.resolution}
              onChange={(v) => set({ resolution: v })}
              options={(['original', '2160', '1440', '1080', '720', '480'] as const).map((r) => ({ value: r, label: r === 'original' ? 'Original' : `${r}p`, disabled: r !== 'original' && Number(r) > shorter && shorter > 0 }))}
            />
          </Field>
          <div className="grid-2">
            <Field label="Frame rate">
              <Select value={String(opts.fps)} onChange={(v) => set({ fps: v === 'original' ? 'original' : (Number(v) as 24) })} ariaLabel="Frame rate" options={[{ value: 'original', label: 'Same as source' }, { value: '60', label: '60 fps' }, { value: '30', label: '30 fps' }, { value: '24', label: '24 fps' }]} />
            </Field>
            <Field label="Size / quality">
              <Select value={opts.quality} onChange={(v) => set({ quality: v })} ariaLabel="Quality" options={[{ value: 'high', label: 'High quality' }, { value: 'balanced', label: 'Balanced' }, { value: 'small', label: 'Smallest file' }]} />
            </Field>
            <Field label="Encoder">
              <Select value={opts.encoder} onChange={(v) => set({ encoder: v })} ariaLabel="Encoder" options={[{ value: 'auto', label: 'Automatic (best available)' }, ...(ffmpeg?.h264Encoders ?? []).map((e) => ({ value: e.id, label: e.label }))]} />
            </Field>
            <Field label="Audio bitrate">
              <Select value={opts.audioBitrateKbps} onChange={(v) => set({ audioBitrateKbps: v })} ariaLabel="Audio bitrate" options={[96, 128, 160, 192, 256].map((b) => ({ value: b, label: `${b} kbps` }))} />
            </Field>
          </div>
          <Toggle checked={opts.removeAudio} onChange={(v) => set({ removeAudio: v })} label="Remove audio" />
          {(running || progress) && (
            <div className="stack" style={{ gap: 6 }}>
              <ProgressBar value={progress?.percent ?? 0} indeterminate={!progress || (progress.status === 'running' && progress.percent === 0)} />
              <span className="small muted">
                {progress?.status === 'done' ? 'Finished.' : progress?.status === 'cancelled' ? 'Cancelled — no file was kept.' : progress?.status === 'error' ? progress.error : `Exporting… ${Math.round(progress?.percent ?? 0)}%${progress?.etaSec != null ? ` · about ${formatDuration(progress.etaSec * 1000)} left` : ''}`}
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
