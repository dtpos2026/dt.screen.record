import { app, clipboard, ClipboardItem, nativeImage, screen, type NativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { AppError, toAppError } from '../../shared/errors'
import { screenshotBaseName, splitExt, uniqueName } from '../../shared/filenames'
import { layoutDisplays } from '../../shared/recording-math'
import type { ImageFormat, ScreenshotMode } from '../../shared/settings'
import type { CaptureResult, DisplayInfo, Rect, Result, SaveImageRequest } from '../../shared/types'
import { confirm, saveDialog } from '../dialogs'
import { createLogger } from '../logger'
import { isAllowedMediaPath, mediaUrl } from '../protocols'
import { settingsStore } from '../settings-store'
import { getMainWindow, getToolbarWindow, showMainWindow } from '../windows'
import { ensureWritableDir } from './disk'
import { getScreenSources, listDisplays, foregroundWindow } from './displays'
import { engine } from './engine-client'
import { broadcast, notify, sendTo } from './events'
import { regionSelector } from './region-selector'
import { runCountdown } from './countdown'
import { capabilities } from './capabilities'

const log = createLogger('screenshot')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface StoredCapture extends CaptureResult {
  file: string
}

const EXT: Record<ImageFormat, string> = { png: '.png', jpeg: '.jpg', webp: '.webp' }

export function captureTempDir(): string {
  return join(app.getPath('userData'), 'captures')
}

/** Native-resolution images of the given displays, keyed by display id. */
export async function captureDisplays(displays: DisplayInfo[]): Promise<Map<string, NativeImage>> {
  const out = new Map<string, NativeImage>()
  // desktopCapturer uses one thumbnail size per call and scales every screen
  // to fit it, so request each distinct native size separately (no scaling).
  const groups = new Map<string, DisplayInfo[]>()
  for (const d of displays) {
    const key = `${d.physicalSize.width}x${d.physicalSize.height}`
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  for (const group of groups.values()) {
    const size = group[0].physicalSize
    const sources = await getScreenSources({ width: size.width, height: size.height })
    for (const d of group) {
      const src = sources.find((s) => s.id === d.sourceId) ?? sources.find((s) => s.display_id === d.id)
      if (src && !src.thumbnail.isEmpty()) out.set(d.id, src.thumbnail)
    }
  }
  return out
}

/** Copies BGRA bitmaps into one large image (multi-monitor screenshot). */
export function compositeImages(canvas: { width: number; height: number }, parts: Array<{ image: NativeImage; rect: Rect }>): NativeImage {
  const W = canvas.width
  const H = canvas.height
  const out = Buffer.alloc(W * H * 4)
  for (let i = 3; i < out.length; i += 4) out[i] = 255 // opaque black background
  for (const { image, rect } of parts) {
    const { width: w, height: h } = image.getSize()
    const src = image.toBitmap()
    const cw = Math.min(w, W - rect.x)
    const ch = Math.min(h, H - rect.y)
    for (let row = 0; row < ch; row++) {
      const s = row * w * 4
      const d = ((rect.y + row) * W + rect.x) * 4
      src.copy(out, d, s, s + cw * 4)
    }
  }
  return nativeImage.createFromBitmap(out, { width: W, height: H })
}

async function encodeImage(img: NativeImage, format: ImageFormat, quality: number): Promise<Buffer> {
  if (format === 'png') return img.toPNG()
  if (format === 'jpeg') return img.toJPEG(Math.max(1, Math.min(100, quality)))
  const bytes = await engine.request<Uint8Array>({ cmd: 'encodeImage', png: new Uint8Array(img.toPNG()), format, quality })
  return Buffer.from(bytes)
}

class ScreenshotService {
  private captures = new Map<string, StoredCapture>()
  private busy = false

  async init(): Promise<void> {
    const dir = captureTempDir()
    await mkdir(dir, { recursive: true })
    // Remove previews left over from earlier sessions.
    try {
      for (const f of await readdir(dir)) await rm(join(dir, f), { force: true })
    } catch {
      // best effort
    }
  }

  get(id: string): CaptureResult | null {
    const c = this.captures.get(id)
    if (!c) return null
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { file, ...rest } = c
    return rest
  }

  async capture(req: { mode: ScreenshotMode; displayId?: string; windowId?: string; delaySeconds?: number }): Promise<Result<CaptureResult | null>> {
    if (this.busy || regionSelector.active) return { ok: false, error: toAppError(new AppError('BUSY')) }
    this.busy = true
    const settings = settingsStore.get()
    const main = getMainWindow()
    const toolbar = getToolbarWindow()
    const hideMain = settings.general.hideWindowWhileCapturing && !!main && main.isVisible() && !main.isMinimized()
    const hideToolbar = !!toolbar && toolbar.isVisible() && !capabilities().excludeFromCapture
    try {
      const delay = req.delaySeconds ?? settings.screenshot.delaySeconds
      if (hideMain) main.hide()
      if (hideToolbar) toolbar.hide()
      if (delay > 0) {
        const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        const ok = await runCountdown(delay, d)
        if (!ok) return { ok: true, value: null }
      }
      if (hideMain || hideToolbar || delay > 0) await sleep(process.platform === 'win32' ? 260 : 180)

      const result = await this.captureImage(req)
      if (!result) return { ok: true, value: null }
      const stored = await this.store(result.image, req.mode, result.label)
      log.info(`Captured ${req.mode} screenshot ${stored.width}x${stored.height}`)
      await this.afterCapture(stored)
      return { ok: true, value: this.get(stored.id) }
    } catch (err) {
      log.error('Screenshot failed', err)
      return { ok: false, error: toAppError(err, 'NO_SOURCE') }
    } finally {
      this.busy = false
      if (hideToolbar && toolbar && !toolbar.isDestroyed()) toolbar.showInactive()
      if (hideMain && main && !main.isDestroyed() && !settings.screenshot.showPreview) main.show()
    }
  }

  private async captureImage(req: { mode: ScreenshotMode; displayId?: string; windowId?: string }): Promise<{ image: NativeImage; label: string } | null> {
    const displays = await listDisplays(false)
    if (!displays.length) throw new AppError('NO_SOURCE')

    if (req.mode === 'window') {
      const target = req.windowId ? { id: req.windowId, name: 'Window' } : await foregroundWindow()
      if (!target) throw new AppError('NO_SOURCE', 'No window is available to capture.')
      const png = await engine.request<Uint8Array>({ cmd: 'grabFrame', sourceId: target.id }, 15_000)
      const image = nativeImage.createFromBuffer(Buffer.from(png))
      if (image.isEmpty()) throw new AppError('NO_SOURCE', 'The window could not be captured. It may be minimised or protected.')
      return { image, label: target.name }
    }

    if (req.mode === 'all-displays') {
      const images = await captureDisplays(displays)
      if (!images.size) throw new AppError('NO_SOURCE')
      const usable = displays.filter((d) => images.has(d.id))
      const layout = layoutDisplays(usable)
      const parts = layout.placements.map((p) => ({ image: images.get(p.id)!, rect: p.rect }))
      return { image: compositeImages(layout.canvas, parts), label: `All displays (${usable.length})` }
    }

    if (req.mode === 'region') {
      const images = await captureDisplays(displays)
      if (!images.size) throw new AppError('NO_SOURCE')
      // Freeze-frame files for the overlays (so the selection matches the capture).
      const urls = new Map<string, string>()
      const freezeDir = join(captureTempDir(), `freeze-${randomUUID()}`)
      await mkdir(freezeDir, { recursive: true })
      try {
        for (const [id, img] of images) {
          const f = join(freezeDir, `${id}.png`)
          await writeFile(f, img.toPNG())
          urls.set(id, mediaUrl(f))
        }
        const sel = await regionSelector.select('screenshot', displays.filter((d) => images.has(d.id)), urls)
        if (!sel) return null
        const display = displays.find((d) => d.id === sel.displayId)!
        const img = images.get(sel.displayId)!
        const size = img.getSize()
        const sx = size.width / display.bounds.width
        const sy = size.height / display.bounds.height
        const crop = {
          x: Math.round(sel.rect.x * sx),
          y: Math.round(sel.rect.y * sy),
          width: Math.max(1, Math.min(size.width, Math.round(sel.rect.width * sx))),
          height: Math.max(1, Math.min(size.height, Math.round(sel.rect.height * sy)))
        }
        crop.width = Math.min(crop.width, size.width - crop.x)
        crop.height = Math.min(crop.height, size.height - crop.y)
        return { image: img.crop(crop), label: `Region on ${display.label}` }
      } finally {
        await rm(freezeDir, { recursive: true, force: true }).catch(() => undefined)
      }
    }

    // 'fullscreen' = display under the mouse pointer; 'display' = chosen display.
    let display: DisplayInfo | undefined
    if (req.mode === 'display' && req.displayId) display = displays.find((d) => d.id === req.displayId)
    if (!display) {
      const near = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      display = displays.find((d) => d.id === String(near.id)) ?? displays[0]
    }
    const images = await captureDisplays([display])
    const image = images.get(display.id)
    if (!image) throw new AppError('NO_SOURCE', 'The display could not be captured.')
    return { image, label: display.label }
  }

  private async store(image: NativeImage, mode: ScreenshotMode, label: string): Promise<StoredCapture> {
    const id = randomUUID()
    const file = join(captureTempDir(), `${id}.png`)
    await mkdir(captureTempDir(), { recursive: true })
    await writeFile(file, image.toPNG())
    const { width, height } = image.getSize()
    const c: StoredCapture = { id, file, width, height, url: mediaUrl(file), mode, sourceLabel: label, createdMs: Date.now(), savedPath: null, copied: false }
    this.captures.set(id, c)
    // Keep the most recent captures only.
    if (this.captures.size > 15) {
      const oldest = [...this.captures.values()].sort((a, b) => a.createdMs - b.createdMs)[0]
      await this.discard(oldest.id)
    }
    return c
  }

  private async afterCapture(c: StoredCapture): Promise<void> {
    const s = settingsStore.get().screenshot
    if (s.copyToClipboard) {
      const r = await this.copy({ captureId: c.id })
      c.copied = r.ok
    }
    if (s.showPreview) {
      showMainWindow()
      sendTo(getMainWindow(), 'navigate', { page: 'screenshot', params: { captureId: c.id } })
      sendTo(getMainWindow(), 'screenshot:captured', this.get(c.id)!)
      return
    }
    const saved = await this.save({ captureId: c.id, target: 'auto' })
    if (saved.ok && saved.value) {
      notify({
        kind: 'success',
        title: 'Screenshot saved',
        message: `${basename(saved.value)} · ${c.width}×${c.height}${c.copied ? ' · copied to clipboard' : ''}`,
        revealPath: saved.value
      })
    } else if (!saved.ok) {
      notify({ kind: 'error', title: 'Screenshot not saved', message: saved.error.message })
    }
  }

  async readBytes(req: { captureId?: string; path?: string }): Promise<Uint8Array> {
    if (req.captureId) {
      const c = this.captures.get(req.captureId)
      if (!c) throw new AppError('FILE_ACCESS', 'This capture is no longer available.')
      return new Uint8Array(await readFile(c.file))
    }
    if (req.path && isAllowedMediaPath(req.path)) return new Uint8Array(await readFile(req.path))
    throw new AppError('FILE_ACCESS')
  }

  private async imageFor(req: { captureId?: string; bytes?: Uint8Array; path?: string }): Promise<NativeImage> {
    let img: NativeImage | null = null
    if (req.bytes) img = nativeImage.createFromBuffer(Buffer.from(req.bytes))
    else if (req.captureId) {
      const c = this.captures.get(req.captureId)
      if (c) img = nativeImage.createFromPath(c.file)
    } else if (req.path && isAllowedMediaPath(req.path)) img = nativeImage.createFromPath(req.path)
    if (!img || img.isEmpty()) throw new AppError('FILE_ACCESS', 'The image could not be read.')
    return img
  }

  async copy(req: { captureId?: string; bytes?: Uint8Array; path?: string }): Promise<Result<null>> {
    try {
      const img = await this.imageFor(req)
      const png = img.toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
      return { ok: true, value: null }
    } catch (err) {
      return { ok: false, error: toAppError(err, 'FILE_ACCESS') }
    }
  }

  async save(req: SaveImageRequest): Promise<Result<string | null>> {
    try {
      const settings = settingsStore.get()
      const capture = req.captureId ? this.captures.get(req.captureId) : undefined
      const format = req.format ?? settings.screenshot.format
      const quality = req.quality ?? (format === 'webp' ? settings.screenshot.webpQuality : settings.screenshot.jpegQuality)
      let target: string
      if (req.target === 'overwrite') {
        if (!req.sourcePath || !isAllowedMediaPath(req.sourcePath)) throw new AppError('FILE_ACCESS')
        const ok = await confirm({
          title: 'Overwrite original?',
          message: `Replace "${basename(req.sourcePath)}" with the edited image?`,
          detail: 'The original image will be permanently replaced. Choose Cancel to keep it.',
          confirmLabel: 'Overwrite',
          danger: true
        })
        if (!ok) return { ok: true, value: null }
        target = req.sourcePath
      } else if (req.target === 'dialog') {
        const defaultName = `${req.suggestedName ?? screenshotBaseName()}${EXT[format]}`
        const chosen = await saveDialog({
          title: 'Save screenshot as',
          defaultPath: join(settings.general.screenshotsDir, defaultName),
          filters: [
            { name: 'PNG image', extensions: ['png'] },
            { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
            { name: 'WebP image', extensions: ['webp'] }
          ]
        })
        if (!chosen) return { ok: true, value: null }
        target = chosen
      } else {
        const dir = settings.general.screenshotsDir
        if (!(await ensureWritableDir(dir))) throw new AppError('INVALID_SAVE_LOCATION')
        let base = req.suggestedName ?? screenshotBaseName(capture ? new Date(capture.createdMs) : new Date())
        if (req.sourcePath) base = `${splitExt(basename(req.sourcePath))[0]}-edited`
        target = join(dir, uniqueName(base, EXT[format], (n) => existsSync(join(dir, n))))
      }
      // The extension chosen in the Save dialog decides the format there.
      const ext = extname(target).toLowerCase()
      const fmt: ImageFormat = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext === '.webp' ? 'webp' : ext === '.png' ? 'png' : format
      if (!ext) target += EXT[fmt]
      const img = await this.imageFor({ captureId: req.bytes ? undefined : req.captureId, bytes: req.bytes, path: !req.bytes && !req.captureId ? req.sourcePath : undefined })
      const data = await encodeImage(img, fmt, quality)
      await mkdir(dirname(target), { recursive: true })
      const tmp = `${target}.dt-tmp`
      await writeFile(tmp, data)
      await rename(tmp, target)
      if (capture && !req.bytes) capture.savedPath = target
      log.info(`Saved ${fmt} screenshot (${(await stat(target)).size} bytes)`)
      broadcast('library:changed', undefined, ['main'])
      return { ok: true, value: target }
    } catch (err) {
      log.error('Saving screenshot failed', err)
      return { ok: false, error: toAppError(err, 'FILE_ACCESS') }
    }
  }

  async discard(id: string): Promise<void> {
    const c = this.captures.get(id)
    if (!c) return
    this.captures.delete(id)
    await rm(c.file, { force: true }).catch(() => undefined)
  }
}

export const screenshots = new ScreenshotService()
