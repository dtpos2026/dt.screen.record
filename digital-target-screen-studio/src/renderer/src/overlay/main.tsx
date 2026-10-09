import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { OverlayInit, Rect } from '@shared/types'
import '../styles/base.css'
import './overlay.css'

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN = 8

function normalize(r: Rect): Rect {
  const x = r.width < 0 ? r.x + r.width : r.x
  const y = r.height < 0 ? r.y + r.height : r.y
  return { x, y, width: Math.abs(r.width), height: Math.abs(r.height) }
}

function clampRect(r: Rect, W: number, H: number): Rect {
  const width = Math.min(Math.max(MIN, r.width), W)
  const height = Math.min(Math.max(MIN, r.height), H)
  return { x: Math.min(Math.max(0, r.x), W - width), y: Math.min(Math.max(0, r.y), H - height), width, height }
}

function Overlay() {
  const [init, setInit] = useState<OverlayInit | null>(null)
  const [sel, setSel] = useState<Rect | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ handle: Handle | 'new'; start: { x: number; y: number }; orig: Rect | null } | null>(null)
  const loupe = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const moved = useRef(false)

  useEffect(() => {
    void window.dt.invoke('overlay:init').then((i) => {
      setInit(i)
      if (i?.initial) setSel(i.initial)
      if (i?.imageUrl) {
        const im = new Image()
        im.src = i.imageUrl
        img.current = im
      }
    })
  }, [])

  const W = init?.display.bounds.width ?? window.innerWidth
  const H = init?.display.bounds.height ?? window.innerHeight
  const scale = init?.display.scaleFactor ?? window.devicePixelRatio ?? 1
  const mode = init?.mode ?? 'screenshot'

  const submit = useCallback(
    (r: Rect | null) => {
      void window.dt.invoke('overlay:submit', { rect: r ? clampRect(r, W, H) : null })
    },
    [W, H]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') submit(null)
      else if (e.key === 'Enter' && sel) submit(sel)
      else if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0]
        setSel((s) =>
          s
            ? e.altKey
              ? clampRect({ ...s, width: s.width + d[0], height: s.height + d[1] }, W, H)
              : clampRect({ ...s, x: s.x + d[0], y: s.y + d[1] }, W, H)
            : s
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, submit, W, H])

  // Magnifier for pixel-precise selection (screenshot mode).
  useEffect(() => {
    const c = loupe.current
    const im = img.current
    if (!c || !im || !cursor || !im.complete) return
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const zoom = 8
    const size = c.width / zoom
    const sx = cursor.x * (im.naturalWidth / W) - size / 2
    const sy = cursor.y * (im.naturalHeight / H) - size / 2
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(im, sx, sy, size, size, 0, 0, c.width, c.height)
    ctx.strokeStyle = 'rgba(224,170,255,0.9)'
    ctx.lineWidth = 1
    ctx.strokeRect(c.width / 2 - zoom / 2, c.height / 2 - zoom / 2, zoom, zoom)
  }, [cursor, W, H])

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.ov-bar')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const p = { x: e.clientX, y: e.clientY }
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined
    moved.current = false
    if (handle && sel) drag.current = { handle, start: p, orig: sel }
    else drag.current = { handle: 'new', start: p, orig: null }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = { x: e.clientX, y: e.clientY }
    setCursor(p)
    const d = drag.current
    if (!d) return
    const dx = p.x - d.start.x
    const dy = p.y - d.start.y
    if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true
    if (d.handle === 'new') {
      if (moved.current) setSel(clampRect(normalize({ x: d.start.x, y: d.start.y, width: dx, height: dy }), W, H))
      return
    }
    const o = d.orig!
    let r = { ...o }
    if (d.handle === 'move') r = { ...o, x: o.x + dx, y: o.y + dy }
    else {
      if (d.handle.includes('e')) r.width = o.width + dx
      if (d.handle.includes('s')) r.height = o.height + dy
      if (d.handle.includes('w')) {
        r.x = o.x + dx
        r.width = o.width - dx
      }
      if (d.handle.includes('n')) {
        r.y = o.y + dy
        r.height = o.height - dy
      }
      r = normalize(r)
    }
    setSel(clampRect(r, W, H))
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    // A plain click (no drag) selects the whole display.
    if (d?.handle === 'new' && !moved.current) setSel({ x: 0, y: 0, width: W, height: H })
  }

  const phys = (v: number) => Math.round(v * scale)
  const setPhysSize = (w: number, h: number) => {
    if (!sel) return
    setSel(clampRect({ ...sel, width: w / scale, height: h / scale }, W, H))
  }
  const preset = (w: number, h: number) => {
    const width = Math.min(W, w / scale)
    const height = Math.min(H, h / scale)
    const base = sel ?? { x: (W - width) / 2, y: (H - height) / 2, width, height }
    setSel(clampRect({ x: base.x, y: base.y, width, height }, W, H))
  }

  const barStyle: React.CSSProperties = sel
    ? sel.y + sel.height + 64 < H
      ? { left: Math.min(Math.max(8, sel.x), W - 520), top: sel.y + sel.height + 10 }
      : sel.y > 64
        ? { left: Math.min(Math.max(8, sel.x), W - 520), top: sel.y - 54 }
        : { left: Math.min(Math.max(8, sel.x + 8), W - 520), top: sel.y + 8 }
    : {}

  return (
    <div
      className={`ov ov-${mode}`}
      style={init?.imageUrl ? { backgroundImage: `url("${init.imageUrl}")` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => sel && submit(sel)}
    >
      {sel ? (
        <>
          <div className="ov-shade" style={{ left: 0, top: 0, width: W, height: sel.y }} />
          <div className="ov-shade" style={{ left: 0, top: sel.y + sel.height, width: W, height: Math.max(0, H - sel.y - sel.height) }} />
          <div className="ov-shade" style={{ left: 0, top: sel.y, width: sel.x, height: sel.height }} />
          <div className="ov-shade" style={{ left: sel.x + sel.width, top: sel.y, width: Math.max(0, W - sel.x - sel.width), height: sel.height }} />
          <div className="ov-sel" style={{ left: sel.x, top: sel.y, width: sel.width, height: sel.height }} data-handle="move">
            {HANDLES.map((h) => (
              <span key={h} className={`ov-h ov-h-${h}`} data-handle={h} />
            ))}
            <div className="ov-size tabular">
              {phys(sel.width)} × {phys(sel.height)}
            </div>
          </div>
          <div className="ov-bar" style={barStyle} onPointerDown={(e) => e.stopPropagation()}>
            {mode === 'record' && (
              <>
                <label className="ov-num">
                  W
                  <input type="number" min={MIN} max={phys(W)} value={phys(sel.width)} onChange={(e) => setPhysSize(Number(e.target.value), phys(sel.height))} />
                </label>
                <label className="ov-num">
                  H
                  <input type="number" min={MIN} max={phys(H)} value={phys(sel.height)} onChange={(e) => setPhysSize(phys(sel.width), Number(e.target.value))} />
                </label>
                <button className="ov-chip" onClick={() => preset(1280, 720)} title="1280 × 720 (16:9)">720p</button>
                <button className="ov-chip" onClick={() => preset(1920, 1080)} title="1920 × 1080 (16:9)">1080p</button>
                <button className="ov-chip" onClick={() => setSel({ x: 0, y: 0, width: W, height: H })} title="Whole display">Full</button>
              </>
            )}
            <button className="ov-btn ov-ok" onClick={() => submit(sel)}>
              {mode === 'record' ? 'Use this area' : 'Capture'} <kbd>Enter</kbd>
            </button>
            <button className="ov-btn" onClick={() => submit(null)} aria-label="Cancel">
              Cancel <kbd>Esc</kbd>
            </button>
          </div>
        </>
      ) : (
        <div className="ov-shade" style={{ inset: 0 }} />
      )}
      {!sel && (
        <div className="ov-hint">
          <strong>{mode === 'record' ? 'Select the area to record' : 'Select an area to capture'}</strong>
          <span>Drag to select · Click to use the whole screen · Esc to cancel</span>
        </div>
      )}
      {mode === 'screenshot' && cursor && !drag.current?.orig && (
        <div className="ov-loupe" style={{ left: Math.min(cursor.x + 20, W - 150), top: Math.min(cursor.y + 20, H - 170) }}>
          <canvas ref={loupe} width={128} height={128} />
          <div className="tabular">
            {phys(cursor.x)}, {phys(cursor.y)}
          </div>
        </div>
      )}
      {cursor && !sel && (
        <>
          <div className="ov-cross-h" style={{ top: cursor.y }} />
          <div className="ov-cross-v" style={{ left: cursor.x }} />
        </>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
