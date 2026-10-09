import { desktopCapturer, screen, type DesktopCapturerSource, type Display } from 'electron'
import type { DisplayInfo, WindowSourceInfo } from '../../shared/types'
import { createLogger } from '../logger'
import { ownMediaSourceIds } from '../windows'

const log = createLogger('displays')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * desktopCapturer occasionally returns no screens on the first call after a
 * display change (the capturer is still initialising), so retry briefly.
 */
export async function getScreenSources(thumbnailSize = { width: 0, height: 0 }): Promise<DesktopCapturerSource[]> {
  let sources: DesktopCapturerSource[] = []
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
    } catch (err) {
      log.warn('getSources(screen) failed', err)
      sources = []
    }
    if (sources.length > 0) return sources
    await sleep(150 + attempt * 150)
  }
  return sources
}

export function physicalRect(d: Display): { x: number; y: number; width: number; height: number } {
  if (process.platform === 'win32') {
    try {
      return screen.dipToScreenRect(null, d.bounds)
    } catch {
      // fall through
    }
  }
  return {
    x: Math.round(d.bounds.x * d.scaleFactor),
    y: Math.round(d.bounds.y * d.scaleFactor),
    width: Math.round(d.bounds.width * d.scaleFactor),
    height: Math.round(d.bounds.height * d.scaleFactor)
  }
}

export function matchSource(display: Display, index: number, sources: DesktopCapturerSource[]): DesktopCapturerSource | null {
  const byId = sources.find((s) => s.display_id && s.display_id === String(display.id))
  if (byId) return byId
  // Some platforms do not report display_id; fall back to enumeration order.
  if (sources.length === screen.getAllDisplays().length) return sources[index] ?? null
  if (sources.length === 1 && screen.getAllDisplays().length === 1) return sources[0]
  return null
}

export function sortedDisplays(): Display[] {
  const primary = screen.getPrimaryDisplay()
  return [...screen.getAllDisplays()].sort((a, b) => {
    if (a.id === primary.id) return -1
    if (b.id === primary.id) return 1
    return a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y
  })
}

export async function listDisplays(withThumbnails = false): Promise<DisplayInfo[]> {
  const displays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id
  const sources = await getScreenSources(withThumbnails ? { width: 480, height: 270 } : { width: 0, height: 0 })
  const ordered = sortedDisplays()
  return ordered.map((d) => {
    const index = displays.findIndex((x) => x.id === d.id)
    const src = matchSource(d, index, sources)
    const phys = physicalRect(d)
    const n = ordered.indexOf(d) + 1
    const name = d.label && d.label.trim() ? d.label.trim() : `Display ${n}`
    return {
      id: String(d.id),
      label: `${n}. ${name}${d.id === primaryId ? ' (Primary)' : ''}`,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      physicalSize: { width: phys.width, height: phys.height },
      physicalOrigin: { x: phys.x, y: phys.y },
      rotation: d.rotation,
      isPrimary: d.id === primaryId,
      refreshRate: d.displayFrequency || 60,
      sourceId: src?.id ?? null,
      thumbnail: withThumbnails && src && !src.thumbnail.isEmpty() ? src.thumbnail.toDataURL() : undefined
    }
  })
}

export async function findDisplay(id: string | undefined | null): Promise<DisplayInfo | null> {
  const all = await listDisplays(false)
  if (!all.length) return null
  return all.find((d) => d.id === id) ?? all.find((d) => d.isPrimary) ?? all[0]
}

export function electronDisplay(id: string): Display | undefined {
  return screen.getAllDisplays().find((d) => String(d.id) === id)
}

export async function listWindows(): Promise<WindowSourceInfo[]> {
  const own = ownMediaSourceIds()
  let sources: DesktopCapturerSource[] = []
  try {
    sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 400, height: 250 }, fetchWindowIcons: true })
  } catch (err) {
    log.warn('getSources(window) failed', err)
  }
  return sources
    .filter((s) => !own.has(s.id) && s.name.trim() !== '')
    .map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
    }))
}

/** Returns the first (top-most) capturable window that is not ours: the "active" window. */
export async function foregroundWindow(): Promise<WindowSourceInfo | null> {
  const own = ownMediaSourceIds()
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
    const s = sources.find((x) => !own.has(x.id) && x.name.trim() !== '')
    return s ? { id: s.id, name: s.name, thumbnail: '', appIcon: null } : null
  } catch {
    return null
  }
}
