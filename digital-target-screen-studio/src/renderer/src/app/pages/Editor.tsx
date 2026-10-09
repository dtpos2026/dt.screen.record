import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight, Check, Circle, Copy, Crop, Download, Grid3x3, Highlighter, ImageDown, Maximize2, Minus, MousePointer2, Redo2, Save, Square, Trash2, Type, Undo2, Droplets, X, ZoomIn, ZoomOut, ArrowLeft
} from 'lucide-react'
import { Button, EmptyState, Field, IconButton, Modal, Notice, Segmented, Spinner, Toggle } from '../../components/ui'
import { useConfirm } from '../../components/confirm'
import { dt } from '../../lib/hooks'
import { useApp } from '../context'
import { FONT, bounds, clampBox, hitTest, moveBy, normBox, renderDocument, textLines, type Annotation, type Box } from '../editor/render'

type Tool = 'select' | 'crop' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'text' | 'highlight' | 'pixelate' | 'blur'
interface Doc {
  base: ImageBitmap
  anns: Annotation[]
}

const COLORS = ['#FF3B5C', '#FFC861', '#4ADE9B', '#4FA8FF', '#E0AAFF', '#FFFFFF', '#111111']
const HIGHLIGHTS = ['#FFE14D', '#7CFFB2', '#FF9DE2', '#8CD3FF']

const TOOLS: Array<{ id: Tool; label: string; icon: typeof Crop; key: string }> = [
  { id: 'select', label: 'Select & move (V)', icon: MousePointer2, key: 'v' },
  { id: 'crop', label: 'Crop (C)', icon: Crop, key: 'c' },
  { id: 'arrow', label: 'Arrow (A)', icon: ArrowUpRight, key: 'a' },
  { id: 'line', label: 'Line (L)', icon: Minus, key: 'l' },
  { id: 'rect', label: 'Rectangle (R)', icon: Square, key: 'r' },
  { id: 'ellipse', label: 'Circle / ellipse (E)', icon: Circle, key: 'e' },
  { id: 'text', label: 'Text (T)', icon: Type, key: 't' },
  { id: 'highlight', label: 'Highlight (H)', icon: Highlighter, key: 'h' },
  { id: 'pixelate', label: 'Pixelate — hide sensitive info (P)', icon: Grid3x3, key: 'p' },
  { id: 'blur', label: 'Blur (B)', icon: Droplets, key: 'b' }
]

async function bitmapFromCanvas(c: OffscreenCanvas): Promise<ImageBitmap> {
  return createImageBitmap(c)
}

export function Editor() {
  const { params, navigate, toast, settings } = useApp()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [past, setPast] = useState<Doc[]>([])
  const [future, setFuture] = useState<Doc[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(COLORS[0])
  const [hl, setHl] = useState(HIGHLIGHTS[0])
  const [width, setWidth] = useState(4)
  const [fontSize, setFontSize] = useState(28)
  const [fill, setFill] = useState(false)
  const [strength, setStrength] = useState(14)
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [crop, setCrop] = useState<Box | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [text, setText] = useState<{ x: number; y: number; value: string; index: number | null } | null>(null)
  const [resizeOpen, setResizeOpen] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [stageSize, setStageSize] = useState({ w: 800, h: 600 })
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; orig?: Annotation; moved: boolean } | null>(null)
  const [confirmNode, ask] = useConfirm()
  const sourcePath = params.path ?? null
  const captureId = params.captureId ?? null

  // ------------------------------------------------------------------ load
  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)
    if (!captureId && !sourcePath) return
    void (async () => {
      try {
        const bytes = await dt.invoke('screenshot:readBytes', captureId ? { captureId } : { path: sourcePath! })
        const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
        if (cancelled) return
        setDoc({ base: bmp, anns: [] })
        setPast([])
        setFuture([])
        setDirty(false)
      } catch {
        if (!cancelled) setError('This image could not be opened. It may have been moved or deleted.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [captureId, sourcePath])

  const hasDoc = doc != null
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth - 40, h: el.clientHeight - 40 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasDoc])

  const W = doc?.base.width ?? 1
  const H = doc?.base.height ?? 1
  const scale = zoom === 'fit' ? Math.min(1, stageSize.w / W, stageSize.h / H) : zoom
  const measure = useMemo(() => {
    const c = new OffscreenCanvas(1, 1).getContext('2d')!
    return (a: Extract<Annotation, { t: 'text' }>) => {
      c.font = FONT(a.size)
      return Math.max(...textLines(a).map((l) => c.measureText(l).width), a.size)
    }
  }, [])

  // ------------------------------------------------------------------ render
  useEffect(() => {
    const c = canvas.current
    if (!c || !doc) return
    const ctx = c.getContext('2d')!
    const anns = draft ? [...doc.anns, draft] : doc.anns
    renderDocument(ctx, doc.base, text?.index != null ? anns.filter((_, i) => i !== text.index) : anns)
    const lw = 1.5 / scale
    if (selected != null && doc.anns[selected]) {
      const b = bounds(doc.anns[selected], measure)
      ctx.save()
      ctx.setLineDash([6 / scale, 4 / scale])
      ctx.strokeStyle = '#E0AAFF'
      ctx.lineWidth = lw
      ctx.strokeRect(b.x - 6 / scale, b.y - 6 / scale, b.w + 12 / scale, b.h + 12 / scale)
      ctx.restore()
    }
    if (crop) {
      const b = clampBox(normBox(crop), W, H)
      ctx.save()
      ctx.fillStyle = 'rgba(8,4,16,0.6)'
      ctx.beginPath()
      ctx.rect(0, 0, W, H)
      ctx.rect(b.x, b.y, b.w, b.h)
      ctx.fill('evenodd')
      ctx.strokeStyle = '#E0AAFF'
      ctx.lineWidth = lw * 1.5
      ctx.strokeRect(b.x, b.y, b.w, b.h)
      ctx.restore()
    }
  }, [doc, draft, crop, selected, text, scale, W, H, measure])

  // ------------------------------------------------------------------ history
  const commit = useCallback(
    (next: Doc) => {
      if (!doc) return
      setPast((p) => [...p.slice(-40), doc])
      setFuture([])
      setDoc(next)
      setDirty(true)
    },
    [doc]
  )
  const undo = useCallback(() => {
    if (!past.length || !doc) return
    setFuture((f) => [doc, ...f])
    setDoc(past[past.length - 1])
    setPast((p) => p.slice(0, -1))
    setSelected(null)
  }, [past, doc])
  const redo = useCallback(() => {
    if (!future.length || !doc) return
    setPast((p) => [...p, doc])
    setDoc(future[0])
    setFuture((f) => f.slice(1))
    setSelected(null)
  }, [future, doc])

  const flatten = useCallback(async (box: Box | null, size?: { w: number; h: number }): Promise<ImageBitmap | null> => {
    if (!doc) return null
    const full = new OffscreenCanvas(W, H)
    renderDocument(full.getContext('2d')!, doc.base, doc.anns)
    const b = box ? clampBox(normBox(box), W, H) : { x: 0, y: 0, w: W, h: H }
    const out = new OffscreenCanvas(Math.max(1, Math.round(size?.w ?? b.w)), Math.max(1, Math.round(size?.h ?? b.h)))
    const octx = out.getContext('2d')!
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(full, b.x, b.y, b.w, b.h, 0, 0, out.width, out.height)
    return bitmapFromCanvas(out)
  }, [doc, W, H])

  const applyCrop = useCallback(async () => {
    if (!crop) return
    const b = clampBox(normBox(crop), W, H)
    if (b.w < 2 || b.h < 2) return
    const bmp = await flatten({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })
    if (bmp) commit({ base: bmp, anns: [] })
    setCrop(null)
    setTool('select')
  }, [crop, flatten, commit, W, H])

  // Enter and the following blur both try to commit; only the first one counts.
  const committedText = useRef<object | null>(null)
  const commitText = useCallback(() => {
    if (!text || !doc || committedText.current === text) return
    committedText.current = text
    const value = text.value.replace(/\s+$/, '')
    const anns = [...doc.anns]
    if (text.index != null) {
      if (value) anns[text.index] = { ...(anns[text.index] as Extract<Annotation, { t: 'text' }>), text: value }
      else anns.splice(text.index, 1)
      commit({ ...doc, anns })
    } else if (value) commit({ ...doc, anns: [...anns, { t: 'text', x: text.x, y: text.y, text: value, color, size: fontSize }] })
    setText(null)
  }, [text, doc, commit, color, fontSize])

  // ------------------------------------------------------------------ pointer
  const toImage = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  const onDown = (e: React.PointerEvent) => {
    if (!doc || e.button !== 0) return
    if (text) {
      commitText()
      return
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const p = toImage(e)
    const tol = 6 / scale
    if (tool === 'select') {
      const idx = [...doc.anns.keys()].reverse().find((i) => hitTest(doc.anns[i], p.x, p.y, tol, measure))
      setSelected(idx ?? null)
      drag.current = idx != null ? { ...p, orig: doc.anns[idx], moved: false } : null
      return
    }
    if (tool === 'text') {
      const idx = [...doc.anns.keys()].reverse().find((i) => doc.anns[i].t === 'text' && hitTest(doc.anns[i], p.x, p.y, tol, measure))
      if (idx != null) {
        const a = doc.anns[idx] as Extract<Annotation, { t: 'text' }>
        setText({ x: a.x, y: a.y, value: a.text, index: idx })
      } else setText({ x: p.x, y: p.y, value: '', index: null })
      return
    }
    drag.current = { ...p, moved: false }
    if (tool === 'crop') setCrop({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !doc) return
    const p = toImage(e)
    d.moved = true
    if (tool === 'select' && d.orig != null && selected != null) {
      const anns = [...doc.anns]
      anns[selected] = moveBy(d.orig, p.x - d.x, p.y - d.y)
      setDoc({ ...doc, anns })
      return
    }
    const box = { x: d.x, y: d.y, w: p.x - d.x, h: p.y - d.y }
    if (tool === 'crop') setCrop(box)
    else if (tool === 'arrow' || tool === 'line') {
      let x2 = p.x
      let y2 = p.y
      if (e.shiftKey) {
        const ang = Math.round(Math.atan2(p.y - d.y, p.x - d.x) / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.hypot(p.x - d.x, p.y - d.y)
        x2 = d.x + Math.cos(ang) * len
        y2 = d.y + Math.sin(ang) * len
      }
      setDraft({ t: tool, x1: d.x, y1: d.y, x2, y2, color, width })
    } else if (tool === 'rect' || tool === 'ellipse') {
      if (e.shiftKey) {
        const s = Math.max(Math.abs(box.w), Math.abs(box.h))
        box.w = Math.sign(box.w || 1) * s
        box.h = Math.sign(box.h || 1) * s
      }
      setDraft({ t: tool, ...box, color, width, fill })
    } else if (tool === 'highlight') setDraft({ t: 'highlight', ...box, color: hl })
    else if (tool === 'pixelate' || tool === 'blur') setDraft({ t: tool, ...box, strength })
  }

  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!doc) return
    if (tool === 'select' && d?.orig && selected != null && d.moved) {
      // Record the move as one undo step.
      const moved = doc.anns[selected]
      const before = [...doc.anns]
      before[selected] = d.orig
      setPast((p) => [...p.slice(-40), { ...doc, anns: before }])
      setFuture([])
      setDoc({ ...doc, anns: doc.anns.map((a, i) => (i === selected ? moved : a)) })
      setDirty(true)
      return
    }
    if (draft) {
      const b = bounds(draft)
      if (b.w > 2 || b.h > 2) commit({ ...doc, anns: [...doc.anns, draft] })
      setDraft(null)
    }
  }

  // ------------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (text || resizeOpen || (e.target as HTMLElement).closest('input, textarea, select')) return
      const k = e.key.toLowerCase()
      if (e.ctrlKey && k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if (e.ctrlKey && k === 's') {
        e.preventDefault()
        void save(e.shiftKey ? 'dialog' : 'auto')
      } else if (e.ctrlKey && k === 'c') {
        e.preventDefault()
        void copy()
      } else if ((k === 'delete' || k === 'backspace') && selected != null && doc) {
        commit({ ...doc, anns: doc.anns.filter((_, i) => i !== selected) })
        setSelected(null)
      } else if (k === 'enter' && crop) void applyCrop()
      else if (k === 'escape') {
        setCrop(null)
        setSelected(null)
        setDraft(null)
      } else if (!e.ctrlKey && !e.altKey) {
        const t = TOOLS.find((x) => x.key === k)
        if (t) {
          setTool(t.id)
          setCrop(null)
          setSelected(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ------------------------------------------------------------------ export
  const exportPng = async (): Promise<Uint8Array | null> => {
    if (!doc) return null
    const c = new OffscreenCanvas(W, H)
    renderDocument(c.getContext('2d')!, doc.base, doc.anns)
    const blob = await c.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  }
  const save = async (target: 'auto' | 'dialog' | 'overwrite') => {
    if (!doc) return
    setSaving(target)
    try {
      const bytes = await exportPng()
      if (!bytes) return
      const r = await dt.invoke('screenshot:save', {
        bytes,
        target,
        captureId: captureId ?? undefined,
        sourcePath: sourcePath ?? undefined,
        ...(target === 'overwrite' && sourcePath ? { format: formatOf(sourcePath) } : {})
      })
      if (!r.ok) toast({ kind: 'error', title: 'Could not save', message: r.error.message })
      else if (r.value) {
        setDirty(false)
        toast({ kind: 'success', title: target === 'overwrite' ? 'Original replaced' : 'Edited copy saved', message: r.value.split(/[\\/]/).pop(), revealPath: r.value })
      }
    } finally {
      setSaving(null)
    }
  }
  const copy = async () => {
    const bytes = await exportPng()
    if (!bytes) return
    const r = await dt.invoke('screenshot:copy', { bytes })
    toast(r.ok ? { kind: 'success', title: 'Copied to clipboard' } : { kind: 'error', title: r.error.message })
  }
  const leave = async () => {
    if (dirty && !(await ask({ title: 'Leave the editor?', message: 'Your edits have not been saved and will be lost.', confirmLabel: 'Discard edits', danger: true }))) return
    navigate(sourcePath ? 'library' : 'screenshot', captureId ? { captureId } : {})
  }

  if (!captureId && !sourcePath) {
    return <EmptyState icon={<ImageDown size={24} />} title="Nothing to edit" action={<Button variant="primary" onClick={() => navigate('screenshot')}>Take a screenshot</Button>}>Open a screenshot from the Screenshot Tool or the Media Library.</EmptyState>
  }
  if (error) return <Notice tone="danger" title="Could not open image">{error}</Notice>
  if (!doc) return <div className="row muted"><Spinner /> Opening image…</div>

  const isShape = tool === 'arrow' || tool === 'line' || tool === 'rect' || tool === 'ellipse'
  const sel = selected != null ? doc.anns[selected] : null

  return (
    <div className="editor">
      <div className="editor-bar" role="toolbar" aria-label="Editor tools">
        <IconButton label="Back" onClick={() => void leave()}><ArrowLeft size={17} /></IconButton>
        <span className="sep" />
        {TOOLS.map((t) => {
          const Icon = t.icon
          return (
            <IconButton key={t.id} label={t.label} className={tool === t.id ? 'active' : ''} onClick={() => { setTool(t.id); setCrop(null); setSelected(null) }} aria-pressed={tool === t.id}>
              <Icon size={17} />
            </IconButton>
          )
        })}
        <span className="sep" />
        {(isShape || tool === 'text' || (sel && sel.t !== 'pixelate' && sel.t !== 'blur' && sel.t !== 'highlight')) &&
          COLORS.map((c) => <button key={c} className={`color-dot ${color === c ? 'active' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setColor(c)} />)}
        {tool === 'highlight' && HIGHLIGHTS.map((c) => <button key={c} className={`color-dot ${hl === c ? 'active' : ''}`} style={{ background: c }} aria-label={`Highlight ${c}`} onClick={() => setHl(c)} />)}
        {isShape && (
          <Segmented size="sm" value={width} onChange={setWidth} ariaLabel="Stroke width" options={[{ value: 2, label: 'S' }, { value: 4, label: 'M' }, { value: 8, label: 'L' }]} />
        )}
        {(tool === 'rect' || tool === 'ellipse') && (
          <Button size="sm" variant={fill ? 'primary' : 'ghost'} onClick={() => setFill(!fill)}>Fill</Button>
        )}
        {tool === 'text' && <Segmented size="sm" value={fontSize} onChange={setFontSize} ariaLabel="Text size" options={[{ value: 18, label: 'S' }, { value: 28, label: 'M' }, { value: 44, label: 'L' }, { value: 72, label: 'XL' }]} />}
        {(tool === 'pixelate' || tool === 'blur') && <Segmented size="sm" value={strength} onChange={setStrength} ariaLabel="Strength" options={[{ value: 8, label: 'Light' }, { value: 14, label: 'Medium' }, { value: 24, label: 'Strong' }]} />}
        {crop && (
          <>
            <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => void applyCrop()}>Apply crop</Button>
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setCrop(null)}>Cancel</Button>
          </>
        )}
        {sel && <IconButton label="Delete annotation (Del)" onClick={() => { commit({ ...doc, anns: doc.anns.filter((_, i) => i !== selected) }); setSelected(null) }}><Trash2 size={16} /></IconButton>}
        <span style={{ flex: 1 }} />
        <IconButton label="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}><Undo2 size={17} /></IconButton>
        <IconButton label="Redo (Ctrl+Y)" disabled={!future.length} onClick={redo}><Redo2 size={17} /></IconButton>
        <span className="sep" />
        <IconButton label="Zoom out" onClick={() => setZoom(Math.max(0.1, (zoom === 'fit' ? scale : zoom) / 1.25))}><ZoomOut size={16} /></IconButton>
        <button className="btn btn-ghost btn-sm tabular" onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')} data-tip="Toggle fit / 100%">{Math.round(scale * 100)}%</button>
        <IconButton label="Zoom in" onClick={() => setZoom(Math.min(4, (zoom === 'fit' ? scale : zoom) * 1.25))}><ZoomIn size={16} /></IconButton>
        <IconButton label="Resize image" onClick={() => setResizeOpen(true)}><Maximize2 size={16} /></IconButton>
        <span className="sep" />
        <IconButton label="Copy to clipboard (Ctrl+C)" onClick={() => void copy()}><Copy size={16} /></IconButton>
        <Button size="sm" variant="secondary" icon={<Download size={14} />} loading={saving === 'dialog'} onClick={() => void save('dialog')} tip="Ctrl+Shift+S">Save As…</Button>
        {sourcePath && <Button size="sm" variant="ghost" loading={saving === 'overwrite'} onClick={() => void save('overwrite')}>Overwrite</Button>}
        <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saving === 'auto'} onClick={() => void save('auto')} tip={`Saves a new ${settings.screenshot.format.toUpperCase()} — Ctrl+S`}>Save copy</Button>
      </div>
      <div className="editor-stage" ref={stage}>
        <div style={{ position: 'relative', width: W * scale, height: H * scale }}>
          <canvas
            ref={canvas}
            width={W}
            height={H}
            style={{ width: W * scale, height: H * scale, cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair' }}
            onPointerDown={onDown}
            // Keep focus in the text box that a text-tool click creates.
            onMouseDown={(e) => e.preventDefault()}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
          {text && (
            <textarea
              className="text-editor"
              autoFocus
              value={text.value}
              placeholder="Type…"
              style={{ left: text.x * scale, top: text.y * scale, fontSize: fontSize * scale, color, minHeight: fontSize * scale * 1.4, width: Math.max(160, (measure({ t: 'text', x: 0, y: 0, text: text.value || 'Type…', color, size: fontSize }) + 30) * scale) }}
              onChange={(e) => setText({ ...text, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitText()
                }
                if (e.key === 'Escape') setText(null)
              }}
              onBlur={commitText}
              rows={Math.max(1, text.value.split('\n').length)}
            />
          )}
        </div>
      </div>
      {resizeOpen && (
        <ResizeDialog
          width={W}
          height={H}
          onClose={() => setResizeOpen(false)}
          onApply={async (w, h) => {
            setResizeOpen(false)
            const bmp = await flatten(null, { w, h })
            if (bmp) commit({ base: bmp, anns: [] })
          }}
        />
      )}
      {confirmNode}
    </div>
  )
}

function formatOf(path: string): 'png' | 'jpeg' | 'webp' {
  const ext = path.toLowerCase().split('.').pop()
  return ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'webp' ? 'webp' : 'png'
}

function ResizeDialog({ width, height, onClose, onApply }: { width: number; height: number; onClose: () => void; onApply: (w: number, h: number) => void }) {
  const [w, setW] = useState(width)
  const [h, setH] = useState(height)
  const [lock, setLock] = useState(true)
  const ratio = width / height
  const valid = w >= 1 && h >= 1 && w <= 16384 && h <= 16384
  return (
    <Modal title="Resize image" onClose={onClose} width={420} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={() => onApply(w, h)}>Resize</Button></>}>
      <div className="stack">
        <div className="grid-2">
          <Field label="Width (px)">
            <input className="input" type="number" min={1} max={16384} value={w} onChange={(e) => { const v = Number(e.target.value) || 1; setW(v); if (lock) setH(Math.max(1, Math.round(v / ratio))) }} />
          </Field>
          <Field label="Height (px)">
            <input className="input" type="number" min={1} max={16384} value={h} onChange={(e) => { const v = Number(e.target.value) || 1; setH(v); if (lock) setW(Math.max(1, Math.round(v * ratio))) }} />
          </Field>
        </div>
        <Toggle checked={lock} onChange={setLock} label="Keep aspect ratio" />
        <div className="row">
          {[25, 50, 75, 100, 200].map((p) => (
            <Button key={p} size="sm" variant="ghost" onClick={() => { setW(Math.round((width * p) / 100)); setH(Math.round((height * p) / 100)) }}>{p}%</Button>
          ))}
        </div>
        {w > width && <p className="small muted" style={{ margin: 0 }}>Enlarging cannot add detail; the image will look softer.</p>}
      </div>
    </Modal>
  )
}
