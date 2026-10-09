import { useEffect, useState } from 'react'
import { AppWindow, Copy, Crop, Download, FolderOpen, Layers, Monitor, MousePointer2, Pencil, RefreshCw, Save, Trash2, Camera } from 'lucide-react'
import { formatAccelerator } from '@shared/accelerator'
import type { ImageFormat, ScreenshotMode, Settings } from '@shared/settings'
import type { CaptureResult, WindowSourceInfo } from '@shared/types'
import { Badge, Button, Card, EmptyState, Field, Modal, Notice, Segmented, Select, Slider, Spinner, Toggle } from '../../components/ui'
import { dt } from '../../lib/hooks'
import { useDisplays } from '../../lib/media'
import { useApp } from '../context'
import { useConfirm } from '../../components/confirm'

let lastCapture: CaptureResult | null = null

export function Screenshot() {
  const { settings, update, params, navigate, toast } = useApp()
  const s = settings.screenshot
  const { displays } = useDisplays(false)
  const [capture, setCapture] = useState<CaptureResult | null>(lastCapture)
  const [busy, setBusy] = useState(false)
  const [displayId, setDisplayId] = useState<string>('')
  const [windowPicker, setWindowPicker] = useState(false)
  const [saving, setSaving] = useState<'auto' | 'dialog' | null>(null)
  const [confirmNode, ask] = useConfirm()
  const setS = (p: Partial<Settings['screenshot']>) => void update({ screenshot: p })

  useEffect(() => {
    const show = (c: CaptureResult) => {
      lastCapture = c
      setCapture(c)
    }
    const off = dt.on('screenshot:captured', show)
    if (params.captureId && params.captureId !== lastCapture?.id) {
      void dt.invoke('screenshot:get', { captureId: params.captureId }).then((c) => c && show(c))
    }
    return off
  }, [params.captureId])

  useEffect(() => {
    if (!displayId && displays.length) setDisplayId(displays.find((d) => d.isPrimary)?.id ?? displays[0].id)
  }, [displays, displayId])

  const take = async (mode: ScreenshotMode, extra: { displayId?: string; windowId?: string } = {}) => {
    setBusy(true)
    try {
      const r = await dt.invoke('screenshot:capture', { mode, ...extra })
      if (!r.ok) toast({ kind: 'error', title: r.error.message, message: r.error.hint })
      else if (r.value) {
        lastCapture = r.value
        setCapture(r.value)
        if (!settings.screenshot.showPreview) toast({ kind: 'success', title: 'Screenshot saved', message: `${r.value.width} × ${r.value.height}` })
      }
    } finally {
      setBusy(false)
    }
  }

  const save = async (target: 'auto' | 'dialog') => {
    if (!capture) return
    setSaving(target)
    const r = await dt.invoke('screenshot:save', { captureId: capture.id, target })
    setSaving(null)
    if (!r.ok) toast({ kind: 'error', title: 'Could not save the screenshot', message: r.error.message })
    else if (r.value) {
      const updated = { ...capture, savedPath: r.value }
      lastCapture = updated
      setCapture(updated)
      toast({ kind: 'success', title: 'Screenshot saved', message: r.value.split(/[\\/]/).pop(), revealPath: r.value })
    }
  }
  const copy = async () => {
    if (!capture) return
    const r = await dt.invoke('screenshot:copy', { captureId: capture.id })
    toast(r.ok ? { kind: 'success', title: 'Copied to clipboard' } : { kind: 'error', title: 'Copy failed', message: r.error.message })
  }
  const discard = async () => {
    if (!capture) return
    if (!capture.savedPath && !(await ask({ title: 'Discard screenshot?', message: 'This screenshot has not been saved. Discard it?', confirmLabel: 'Discard', danger: true }))) return
    await dt.invoke('screenshot:discard', { captureId: capture.id })
    lastCapture = null
    setCapture(null)
  }

  const modes: Array<{ mode: ScreenshotMode; label: string; desc: string; icon: typeof Crop; key?: string }> = [
    { mode: 'region', label: 'Region', desc: 'Drag to select', icon: Crop, key: settings.shortcuts.screenshotRegion },
    { mode: 'fullscreen', label: 'Full screen', desc: 'Screen under the mouse', icon: MousePointer2, key: settings.shortcuts.screenshotFullscreen },
    { mode: 'display', label: 'Monitor', desc: 'Choose below', icon: Monitor },
    { mode: 'window', label: 'Window', desc: 'Pick an app window', icon: AppWindow, key: settings.shortcuts.screenshotWindow },
    { mode: 'all-displays', label: 'All monitors', desc: 'One wide image', icon: Layers }
  ]

  return (
    <div className="layout-main-side">
      <div className="stack">
        <Card title="Capture" subtitle="Screenshots are taken at the display's native resolution — 1080p, 1440p, 4K or higher.">
          <div className="shot-modes">
            {modes.map((m) => {
              const Icon = m.icon
              return (
                <button
                  key={m.mode}
                  className="shot-mode"
                  disabled={busy}
                  onClick={() => (m.mode === 'window' ? setWindowPicker(true) : void take(m.mode, m.mode === 'display' ? { displayId } : {}))}
                  data-tip={m.key ? formatAccelerator(m.key) : ''}
                >
                  <Icon size={22} />
                  <strong>{m.label}</strong>
                  <span>{m.desc}</span>
                </button>
              )
            })}
          </div>
          <div className="grid-2" style={{ marginTop: 16 }}>
            <Field label="Monitor">
              <Select value={displayId} onChange={setDisplayId} ariaLabel="Monitor" options={displays.map((d) => ({ value: d.id, label: `${d.label} — ${d.physicalSize.width}×${d.physicalSize.height}` }))} />
            </Field>
            <Field label="Delay">
              <div className="row">
                <Segmented
                  size="sm"
                  value={[0, 3, 5, 10].includes(s.delaySeconds) ? s.delaySeconds : -1}
                  onChange={(v) => setS({ delaySeconds: v === -1 ? 15 : v })}
                  options={[{ value: 0, label: 'None' }, { value: 3, label: '3 s' }, { value: 5, label: '5 s' }, { value: 10, label: '10 s' }, { value: -1, label: 'Custom' }]}
                />
                {![0, 3, 5, 10].includes(s.delaySeconds) && (
                  <input className="input input-sm" style={{ width: 70 }} type="number" min={1} max={60} value={s.delaySeconds} aria-label="Delay seconds" onChange={(e) => setS({ delaySeconds: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
                )}
              </div>
            </Field>
          </div>
          {busy && (
            <div className="row muted" style={{ marginTop: 12 }}>
              <Spinner size={16} /> Capturing…
            </div>
          )}
        </Card>

        <Card
          title="Preview"
          subtitle={capture ? `${capture.width} × ${capture.height} px · ${capture.sourceLabel}` : 'Your latest capture appears here'}
          actions={capture && <Badge tone={capture.savedPath ? 'success' : 'warning'}>{capture.savedPath ? 'Saved' : 'Not saved yet'}</Badge>}
        >
          {capture ? (
            <div className="stack">
              <div className="shot-preview">
                <img src={capture.url} alt={`Screenshot ${capture.width} by ${capture.height}`} />
              </div>
              <div className="row">
                <Button variant="primary" icon={<Save size={15} />} loading={saving === 'auto'} onClick={() => save('auto')}>
                  Save {s.format.toUpperCase()}
                </Button>
                <Button variant="secondary" icon={<Download size={15} />} loading={saving === 'dialog'} onClick={() => save('dialog')}>
                  Save As…
                </Button>
                <Button variant="secondary" icon={<Copy size={15} />} onClick={copy}>
                  Copy
                </Button>
                <Button variant="secondary" icon={<Pencil size={15} />} onClick={() => navigate('editor', { captureId: capture.id })}>
                  Edit
                </Button>
                <Button variant="ghost" icon={<Trash2 size={15} />} onClick={discard}>
                  Discard
                </Button>
              </div>
              {capture.savedPath && (
                <div className="row small muted">
                  <span className="truncate" style={{ maxWidth: 520 }}>{capture.savedPath}</span>
                  <button className="link-btn" onClick={() => void dt.invoke('library:reveal', { path: capture.savedPath! })}>
                    <FolderOpen size={13} /> Show in folder
                  </button>
                </div>
              )}
              {capture.copied && !capture.savedPath && <span className="small muted">Already copied to the clipboard.</span>}
            </div>
          ) : (
            <EmptyState icon={<Camera size={24} />} title="No screenshot yet">
              Choose a capture mode above, or press {formatAccelerator(settings.shortcuts.screenshotRegion)} from anywhere.
            </EmptyState>
          )}
        </Card>
      </div>

      <div className="stack">
        <Card title="Format">
          <div className="stack">
            <Segmented
              value={s.format}
              onChange={(v: ImageFormat) => setS({ format: v })}
              options={[
                { value: 'png', label: 'PNG', tip: 'Lossless, best for text and UI' },
                { value: 'jpeg', label: 'JPEG', tip: 'Smaller files for photos' },
                { value: 'webp', label: 'WebP', tip: 'Modern, small files' }
              ]}
            />
            {s.format === 'png' && <p className="small muted" style={{ margin: 0 }}>Lossless: every pixel is preserved exactly.</p>}
            {s.format === 'jpeg' && (
              <Field label="JPEG quality">
                <Slider value={s.jpegQuality} min={40} max={100} onChange={(v) => setS({ jpegQuality: v })} ariaLabel="JPEG quality" format={(v) => `${v}%`} />
              </Field>
            )}
            {s.format === 'webp' && (
              <Field label="WebP quality">
                <Slider value={s.webpQuality} min={40} max={100} onChange={(v) => setS({ webpQuality: v })} ariaLabel="WebP quality" format={(v) => `${v}%`} />
              </Field>
            )}
          </div>
        </Card>
        <Card title="After capture">
          <Toggle checked={s.showPreview} onChange={(v) => setS({ showPreview: v })} label="Preview before saving" description="Otherwise screenshots are saved automatically." />
          <Toggle checked={s.copyToClipboard} onChange={(v) => setS({ copyToClipboard: v })} label="Copy to clipboard" description="Paste straight into chats, documents and email." />
          <Field label="Toolbar & tray default">
            <Select
              value={s.defaultMode}
              onChange={(v) => setS({ defaultMode: v })}
              ariaLabel="Default screenshot mode"
              options={[
                { value: 'region', label: 'Region' },
                { value: 'fullscreen', label: 'Full screen' },
                { value: 'window', label: 'Active window' },
                { value: 'all-displays', label: 'All monitors' }
              ]}
            />
          </Field>
        </Card>
        <Card title="Save location">
          <div className="small muted truncate" title={settings.general.screenshotsDir}>{settings.general.screenshotsDir}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void dt.invoke('shell:openFolder', { kind: 'screenshots' })}>Open folder</Button>
            <Button size="sm" variant="ghost" onClick={() => void dt.invoke('dialog:chooseFolder', { purpose: 'screenshots' })}>Change…</Button>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Files are named automatically, e.g. DT-Screenshot_2026-10-09_14-30-05.png</p>
        </Card>
      </div>
      {confirmNode}
      {windowPicker && <WindowPicker onClose={() => setWindowPicker(false)} onPick={(id) => { setWindowPicker(false); void take('window', { windowId: id }) }} onActive={() => { setWindowPicker(false); void take('window') }} />}
    </div>
  )
}

function WindowPicker({ onClose, onPick, onActive }: { onClose: () => void; onPick: (id: string) => void; onActive: () => void }) {
  const [windows, setWindows] = useState<WindowSourceInfo[] | null>(null)
  const load = async () => {
    setWindows(null)
    setWindows(await dt.invoke('capture:windows'))
  }
  useEffect(() => {
    void load()
  }, [])
  return (
    <Modal
      title="Choose a window"
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()}>Refresh</Button>
          <Button variant="secondary" onClick={onActive}>Top-most window</Button>
        </>
      }
    >
      {windows == null ? (
        <div className="row muted"><Spinner /> Finding windows…</div>
      ) : windows.length === 0 ? (
        <Notice tone="info">No capturable windows were found. Minimised windows cannot be captured.</Notice>
      ) : (
        <div className="source-grid">
          {windows.map((w) => (
            <button key={w.id} className="source-tile" onClick={() => onPick(w.id)}>
              <div className="source-thumb" style={w.thumbnail ? { backgroundImage: `url(${w.thumbnail})` } : undefined} />
              <div className="source-meta">
                {w.appIcon && <img src={w.appIcon} alt="" />}
                <span className="truncate">{w.name}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
