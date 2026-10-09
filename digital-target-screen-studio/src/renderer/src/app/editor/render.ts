/** Vector annotations drawn on top of a raster screenshot. */
type LineAnn<T extends string> = { t: T; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
type ShapeAnn<T extends string> = { t: T; x: number; y: number; w: number; h: number; color: string; width: number; fill: boolean }
type RedactAnn<T extends string> = { t: T; x: number; y: number; w: number; h: number; strength: number }

export type Annotation =
  | LineAnn<'arrow'>
  | LineAnn<'line'>
  | ShapeAnn<'rect'>
  | ShapeAnn<'ellipse'>
  | { t: 'highlight'; x: number; y: number; w: number; h: number; color: string }
  | RedactAnn<'pixelate'>
  | RedactAnn<'blur'>
  | { t: 'text'; x: number; y: number; text: string; color: string; size: number }

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function normBox(b: Box): Box {
  return { x: b.w < 0 ? b.x + b.w : b.x, y: b.h < 0 ? b.y + b.h : b.y, w: Math.abs(b.w), h: Math.abs(b.h) }
}

export function textLines(a: Extract<Annotation, { t: 'text' }>): string[] {
  return a.text.split('\n')
}

export function bounds(a: Annotation, measure?: (a: Extract<Annotation, { t: 'text' }>) => number): Box {
  switch (a.t) {
    case 'arrow':
    case 'line':
      return normBox({ x: a.x1, y: a.y1, w: a.x2 - a.x1, h: a.y2 - a.y1 })
    case 'text': {
      const w = measure ? measure(a) : a.text.length * a.size * 0.6
      return { x: a.x, y: a.y, w, h: textLines(a).length * a.size * 1.25 }
    }
    default:
      return normBox(a)
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function hitTest(a: Annotation, x: number, y: number, tol: number, measure?: (a: Extract<Annotation, { t: 'text' }>) => number): boolean {
  if (a.t === 'arrow' || a.t === 'line') return distToSegment(x, y, a.x1, a.y1, a.x2, a.y2) <= tol + a.width
  const b = bounds(a, measure)
  if ((a.t === 'rect' || a.t === 'ellipse') && !a.fill) {
    const inside = x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol
    const deep = x > b.x + tol + a.width && x < b.x + b.w - tol - a.width && y > b.y + tol + a.width && y < b.y + b.h - tol - a.width
    return inside && !deep
  }
  return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol
}

export function moveBy(a: Annotation, dx: number, dy: number): Annotation {
  if (a.t === 'arrow' || a.t === 'line') return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
  return { ...a, x: a.x + dx, y: a.y + dy }
}

export const FONT = (size: number) => `600 ${size}px Inter, "Segoe UI", sans-serif`

function drawArrow(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, a: Extract<Annotation, { t: 'arrow' }>) {
  const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1)
  const head = Math.max(14, a.width * 4.2)
  const bx = a.x2 - Math.cos(angle) * head * 0.8
  const by = a.y2 - Math.sin(angle) * head * 0.8
  ctx.beginPath()
  ctx.moveTo(a.x1, a.y1)
  ctx.lineTo(bx, by)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(a.x2, a.y2)
  ctx.lineTo(a.x2 - head * Math.cos(angle - Math.PI / 7), a.y2 - head * Math.sin(angle - Math.PI / 7))
  ctx.lineTo(a.x2 - head * Math.cos(angle + Math.PI / 7), a.y2 - head * Math.sin(angle + Math.PI / 7))
  ctx.closePath()
  ctx.fill()
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * Renders the base image plus annotations. Redactions (pixelate / blur) are
 * computed from the original pixels only, so hidden content cannot leak
 * through other annotations.
 */
export function renderDocument(ctx: Ctx, base: CanvasImageSource & { width: number; height: number }, anns: Annotation[]): void {
  const W = base.width
  const H = base.height
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(base, 0, 0)
  for (const a of anns) {
    if (a.t !== 'pixelate' && a.t !== 'blur') continue
    const b = clampBox(normBox(a), W, H)
    if (b.w < 1 || b.h < 1) continue
    if (a.t === 'pixelate') {
      const block = Math.max(4, a.strength)
      const sw = Math.max(1, Math.round(b.w / block))
      const sh = Math.max(1, Math.round(b.h / block))
      const tmp = new OffscreenCanvas(sw, sh)
      const tctx = tmp.getContext('2d')!
      tctx.imageSmoothingEnabled = true
      tctx.drawImage(base, b.x, b.y, b.w, b.h, 0, 0, sw, sh)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(tmp, 0, 0, sw, sh, b.x, b.y, b.w, b.h)
      ctx.imageSmoothingEnabled = true
    } else {
      // Pixelate first, then blur: a plain blur of small text can be partly reversible.
      const pad = a.strength * 2
      const tmp = new OffscreenCanvas(Math.ceil(b.w + pad * 2), Math.ceil(b.h + pad * 2))
      const tctx = tmp.getContext('2d')!
      const small = new OffscreenCanvas(Math.max(1, Math.round((b.w + pad * 2) / 4)), Math.max(1, Math.round((b.h + pad * 2) / 4)))
      small.getContext('2d')!.drawImage(base, b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 0, 0, small.width, small.height)
      tctx.filter = `blur(${a.strength}px)`
      tctx.drawImage(small, 0, 0, tmp.width, tmp.height)
      ctx.save()
      ctx.beginPath()
      ctx.rect(b.x, b.y, b.w, b.h)
      ctx.clip()
      ctx.drawImage(tmp, b.x - pad, b.y - pad)
      ctx.restore()
    }
  }
  for (const a of anns) {
    ctx.save()
    switch (a.t) {
      case 'highlight': {
        const b = normBox(a)
        ctx.globalCompositeOperation = 'multiply'
        ctx.fillStyle = a.color
        ctx.globalAlpha = 0.45
        ctx.fillRect(b.x, b.y, b.w, b.h)
        break
      }
      case 'rect':
      case 'ellipse': {
        const b = normBox(a)
        ctx.strokeStyle = a.color
        ctx.fillStyle = a.color
        ctx.lineWidth = a.width
        ctx.lineJoin = 'round'
        ctx.beginPath()
        if (a.t === 'rect') ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(6, a.width))
        else ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
        if (a.fill) {
          ctx.globalAlpha = 0.28
          ctx.fill()
          ctx.globalAlpha = 1
        }
        ctx.stroke()
        break
      }
      case 'line':
      case 'arrow': {
        ctx.strokeStyle = a.color
        ctx.fillStyle = a.color
        ctx.lineWidth = a.width
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        if (a.t === 'arrow') drawArrow(ctx, a)
        else {
          ctx.beginPath()
          ctx.moveTo(a.x1, a.y1)
          ctx.lineTo(a.x2, a.y2)
          ctx.stroke()
        }
        break
      }
      case 'text': {
        ctx.font = FONT(a.size)
        ctx.textBaseline = 'top'
        ctx.fillStyle = a.color
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = Math.max(2, a.size / 8)
        ctx.shadowOffsetY = Math.max(1, a.size / 24)
        textLines(a).forEach((line, i) => ctx.fillText(line, a.x, a.y + i * a.size * 1.25))
        break
      }
    }
    ctx.restore()
  }
  ctx.restore()
}

export function clampBox(b: Box, W: number, H: number): Box {
  const x = Math.max(0, Math.min(W, b.x))
  const y = Math.max(0, Math.min(H, b.y))
  return { x, y, w: Math.max(0, Math.min(W, b.x + b.w) - x), h: Math.max(0, Math.min(H, b.y + b.h) - y) }
}
