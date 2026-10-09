import { screen, type BrowserWindow, type WebContents } from 'electron'
import type { DisplayInfo, OverlayInit, Rect } from '../../shared/types'
import { createLogger } from '../logger'
import { createOverlayWindow } from '../windows'

const log = createLogger('region')

export interface RegionSelection {
  displayId: string
  rect: Rect
}

interface Session {
  resolve: (v: RegionSelection | null) => void
  overlays: Map<number, { win: BrowserWindow; init: OverlayInit }>
  done: boolean
}

/**
 * Shows one full-screen overlay per display and lets the user drag a
 * rectangle. In screenshot mode the overlay shows the frozen capture so the
 * selection matches exactly what will be saved; in record mode it is
 * transparent over the live desktop.
 */
class RegionSelector {
  private session: Session | null = null

  get active(): boolean {
    return !!this.session
  }

  select(
    mode: 'screenshot' | 'record',
    displays: DisplayInfo[],
    images: Map<string, string> | null,
    initial?: RegionSelection | null
  ): Promise<RegionSelection | null> {
    this.cancel()
    return new Promise((resolve) => {
      const session: Session = { resolve, overlays: new Map(), done: false }
      this.session = session
      const cursor = screen.getCursorScreenPoint()
      for (const d of displays) {
        const init: OverlayInit = {
          mode,
          display: d,
          imageUrl: images?.get(d.id) ?? null,
          initial: initial && initial.displayId === d.id ? initial.rect : null
        }
        const win = createOverlayWindow(d.bounds, mode)
        session.overlays.set(win.webContents.id, { win, init })
        win.once('ready-to-show', () => {
          if (win.isDestroyed()) return
          win.show()
          const b = d.bounds
          const under = cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height
          if (under || displays.length === 1) win.focus()
        })
        win.on('closed', () => {
          if (!session.done) this.finish(session, null)
        })
      }
      if (displays.length === 0) this.finish(session, null)
    })
  }

  initFor(contents: WebContents): OverlayInit | null {
    return this.session?.overlays.get(contents.id)?.init ?? null
  }

  submit(contents: WebContents, rect: Rect | null): void {
    const s = this.session
    if (!s) return
    const entry = s.overlays.get(contents.id)
    if (!entry) return
    if (!rect || rect.width < 4 || rect.height < 4) {
      this.finish(s, null)
      return
    }
    const b = entry.init.display.bounds
    const clamped: Rect = {
      x: Math.max(0, Math.min(rect.x, b.width)),
      y: Math.max(0, Math.min(rect.y, b.height)),
      width: Math.min(rect.width, b.width - Math.max(0, rect.x)),
      height: Math.min(rect.height, b.height - Math.max(0, rect.y))
    }
    this.finish(s, { displayId: entry.init.display.id, rect: clamped })
  }

  cancel(): void {
    if (this.session) this.finish(this.session, null)
  }

  private finish(s: Session, value: RegionSelection | null): void {
    if (s.done) return
    s.done = true
    if (this.session === s) this.session = null
    for (const { win } of s.overlays.values()) {
      if (!win.isDestroyed()) win.destroy()
    }
    log.debug(value ? 'Region selected' : 'Region selection cancelled')
    s.resolve(value)
  }
}

export const regionSelector = new RegionSelector()
