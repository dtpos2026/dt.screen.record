import { app, nativeImage, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../../shared/constants'
import { appError, toAppError } from '../../shared/errors'
import { splitExt, uniqueName, validateFileName } from '../../shared/filenames'
import type { ExportOptions, MediaItem, Result } from '../../shared/types'
import { confirm, messageBox } from '../dialogs'
import { createLogger, redact } from '../logger'
import { isAllowedMediaPath, mediaUrl } from '../protocols'
import { settingsStore } from '../settings-store'
import { broadcast } from './events'
import { ffmpeg } from './ffmpeg'
import { exportArgs, exportPlan, thumbnailArgs } from './ffmpeg-args'
import { imageSize } from './image-meta'

const log = createLogger('library')

interface CacheEntry {
  size: number
  mtimeMs: number
  width: number | null
  height: number | null
  durationSec: number | null
  fps: number | null
}

const isVideo = (ext: string) => (VIDEO_EXTENSIONS as readonly string[]).includes(ext)
const isImage = (ext: string) => (IMAGE_EXTENSIONS as readonly string[]).includes(ext)

export function thumbnailsDir(): string {
  return join(app.getPath('userData'), 'thumbnails')
}

class LibraryService {
  private cache: Record<string, CacheEntry> = {}
  private cacheLoaded = false
  private cacheDirty = false
  private watchers: FSWatcher[] = []
  private changeTimer: NodeJS.Timeout | null = null
  private jobs = new Map<string, { child: ChildProcess | null; output: string; cancelled: boolean }>()

  roots(): Array<{ dir: string; folder: MediaItem['folder'] }> {
    const g = settingsStore.get().general
    const list: Array<{ dir: string; folder: MediaItem['folder'] }> = [{ dir: g.recordingsDir, folder: 'recordings' }]
    if (g.screenshotsDir !== g.recordingsDir) list.push({ dir: g.screenshotsDir, folder: 'screenshots' })
    return list
  }

  isLibraryFile(p: string): boolean {
    return this.roots().some((r) => dirname(p) === r.dir) && isAllowedMediaPath(p)
  }

  /** Watches the output folders so the library updates when files change. */
  watch(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
    for (const { dir } of this.roots()) {
      if (!existsSync(dir)) continue
      try {
        const w = watch(dir, { persistent: false }, (_event, file) => {
          if (file && (String(file).startsWith('.') || String(file).endsWith('.part') || String(file).endsWith('.dt-tmp'))) return
          if (this.changeTimer) clearTimeout(this.changeTimer)
          this.changeTimer = setTimeout(() => broadcast('library:changed', undefined, ['main']), 600)
        })
        w.on('error', () => undefined)
        this.watchers.push(w)
      } catch {
        // Folder watching is a convenience only.
      }
    }
  }

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return
    this.cacheLoaded = true
    try {
      this.cache = JSON.parse(await readFile(join(app.getPath('userData'), 'library-cache.json'), 'utf8'))
    } catch {
      this.cache = {}
    }
  }

  private async saveCache(): Promise<void> {
    if (!this.cacheDirty) return
    this.cacheDirty = false
    try {
      await writeFile(join(app.getPath('userData'), 'library-cache.json'), JSON.stringify(this.cache))
    } catch {
      // ignore
    }
  }

  async list(): Promise<MediaItem[]> {
    await this.loadCache()
    const items: MediaItem[] = []
    const seen = new Set<string>()
    const pending: Array<() => Promise<void>> = []
    for (const { dir, folder } of this.roots()) {
      const names = await readdir(dir).catch(() => null)
      if (!names) continue
      for (const name of names) {
        if (name.startsWith('.')) continue
        const ext = extname(name).toLowerCase()
        if (!isVideo(ext) && !isImage(ext)) continue
        const p = join(dir, name)
        const s = await stat(p).catch(() => null)
        if (!s || !s.isFile()) continue
        seen.add(p)
        const item: MediaItem = {
          path: p,
          name,
          kind: isVideo(ext) ? 'video' : 'image',
          ext,
          size: s.size,
          createdMs: s.birthtimeMs || s.mtimeMs,
          modifiedMs: s.mtimeMs,
          width: null,
          height: null,
          durationSec: null,
          fps: null,
          url: mediaUrl(p, s.mtimeMs),
          thumbnailUrl: null,
          folder
        }
        const c = this.cache[p]
        if (c && c.size === s.size && c.mtimeMs === s.mtimeMs) {
          Object.assign(item, { width: c.width, height: c.height, durationSec: c.durationSec, fps: c.fps })
        } else {
          pending.push(async () => {
            const meta = await this.readMeta(p, item.kind)
            this.cache[p] = { size: s.size, mtimeMs: s.mtimeMs, ...meta }
            this.cacheDirty = true
            Object.assign(item, meta)
          })
        }
        const thumb = this.thumbPath(p, s.mtimeMs)
        if (existsSync(thumb)) item.thumbnailUrl = mediaUrl(thumb)
        items.push(item)
      }
    }
    // Probe new files a few at a time.
    for (let i = 0; i < pending.length; i += 4) await Promise.all(pending.slice(i, i + 4).map((f) => f().catch(() => undefined)))
    for (const k of Object.keys(this.cache)) if (!seen.has(k)) delete this.cache[k]
    this.cacheDirty = true
    void this.saveCache()
    return items.sort((a, b) => b.createdMs - a.createdMs)
  }

  private async readMeta(p: string, kind: MediaItem['kind']): Promise<Omit<CacheEntry, 'size' | 'mtimeMs'>> {
    if (kind === 'image') {
      const size = await imageSize(p)
      return { width: size?.width ?? null, height: size?.height ?? null, durationSec: null, fps: null }
    }
    const probe = ffmpeg.available ? await ffmpeg.probe(p) : null
    return { width: probe?.width ?? null, height: probe?.height ?? null, durationSec: probe?.durationSec ?? null, fps: probe?.fps ?? null }
  }

  private thumbPath(p: string, mtimeMs: number): string {
    const h = createHash('sha1').update(`${p}|${mtimeMs}`).digest('hex').slice(0, 24)
    return join(thumbnailsDir(), `${h}.jpg`)
  }

  async thumbnail(p: string): Promise<string | null> {
    if (!this.isLibraryFile(p)) return null
    const s = await stat(p).catch(() => null)
    if (!s) return null
    const out = this.thumbPath(p, s.mtimeMs)
    if (existsSync(out)) return mediaUrl(out)
    await mkdir(thumbnailsDir(), { recursive: true })
    const ext = extname(p).toLowerCase()
    try {
      if (isImage(ext) && ext !== '.webp') {
        const img = nativeImage.createFromPath(p)
        if (img.isEmpty()) return null
        const { width } = img.getSize()
        const small = width > 480 ? img.resize({ width: 480, quality: 'good' }) : img
        await writeFile(out, small.toJPEG(80))
        return mediaUrl(out)
      }
      if (!ffmpeg.available) return ext === '.webp' ? mediaUrl(p, s.mtimeMs) : null
      const dur = this.cache[p]?.durationSec ?? null
      const at = isVideo(ext) ? Math.min(1, Math.max(0, (dur ?? 2) / 3)) : 0
      const r = await ffmpeg.run(thumbnailArgs(p, out, at), { timeoutMs: 20_000 })
      if (r.code !== 0 || !existsSync(out)) {
        // Very short clips: retry at the first frame.
        const r2 = await ffmpeg.run(thumbnailArgs(p, out, 0), { timeoutMs: 20_000 })
        if (r2.code !== 0 || !existsSync(out)) return ext === '.webp' ? mediaUrl(p, s.mtimeMs) : null
      }
      return mediaUrl(out)
    } catch (err) {
      log.warn('Thumbnail failed', err)
      return null
    }
  }

  async rename(p: string, newName: string): Promise<Result<MediaItem>> {
    if (!this.isLibraryFile(p)) return { ok: false, error: appError('FILE_ACCESS') }
    const [, ext] = splitExt(basename(p))
    const [rawBase] = splitExt(newName)
    const base = splitExt(newName)[1] === ext ? rawBase : newName
    const check = validateFileName(base)
    if (!check.ok) return { ok: false, error: appError('FILE_ACCESS', check.reason, '') }
    const target = join(dirname(p), `${check.name}${ext}`)
    if (target === p) {
      const item = (await this.list()).find((i) => i.path === p)
      return item ? { ok: true, value: item } : { ok: false, error: appError('FILE_ACCESS') }
    }
    if (existsSync(target)) return { ok: false, error: appError('FILE_ACCESS', 'A file with that name already exists.', 'Choose a different name.') }
    try {
      await rename(p, target)
      const item = (await this.list()).find((i) => i.path === target)
      broadcast('library:changed', undefined, ['main'])
      return item ? { ok: true, value: item } : { ok: false, error: appError('FILE_ACCESS') }
    } catch (err) {
      return { ok: false, error: toAppError(err, 'FILE_ACCESS') }
    }
  }

  /** Moves files to the Recycle Bin after an explicit confirmation. */
  async delete(paths: string[]): Promise<Result<string[]>> {
    const valid = paths.filter((p) => this.isLibraryFile(p) && existsSync(p))
    if (!valid.length) return { ok: false, error: appError('FILE_ACCESS', 'Nothing to delete.') }
    const ok = await confirm({
      title: 'Delete files?',
      message: valid.length === 1 ? `Delete "${basename(valid[0])}"?` : `Delete ${valid.length} files?`,
      detail: 'The files will be moved to the Recycle Bin, where you can restore them if needed.',
      confirmLabel: 'Move to Recycle Bin',
      danger: true
    })
    if (!ok) return { ok: true, value: [] }
    const deleted: string[] = []
    const failed: string[] = []
    for (const p of valid) {
      try {
        await shell.trashItem(p)
        deleted.push(p)
      } catch {
        failed.push(p)
      }
    }
    if (failed.length) {
      const response = await messageBox({
        type: 'warning',
        buttons: ['Delete permanently', 'Keep files'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Recycle Bin unavailable',
        message: `${failed.length} file(s) could not be moved to the Recycle Bin.`,
        detail: 'This can happen on network or removable drives. Delete them permanently instead? This cannot be undone.'
      })
      if (response === 0) {
        for (const p of failed) {
          try {
            await rm(p)
            deleted.push(p)
          } catch (err) {
            log.warn('Permanent delete failed', err)
          }
        }
      }
    }
    log.info(`Deleted ${deleted.length} library file(s)`)
    broadcast('library:changed', undefined, ['main'])
    return { ok: true, value: deleted }
  }

  reveal(p: string): void {
    if (this.isLibraryFile(p) || isAllowedMediaPath(p)) shell.showItemInFolder(p)
  }

  async open(p: string): Promise<Result<null>> {
    if (!this.isLibraryFile(p)) return { ok: false, error: appError('FILE_ACCESS') }
    const err = await shell.openPath(p)
    return err ? { ok: false, error: appError('FILE_ACCESS', `Windows could not open the file: ${err}`) } : { ok: true, value: null }
  }

  // ---------------------------------------------------------------- export / compression

  async startExport(p: string, options: ExportOptions): Promise<Result<string>> {
    if (!this.isLibraryFile(p) || !isVideo(extname(p).toLowerCase())) return { ok: false, error: appError('FILE_ACCESS') }
    const info = await ffmpeg.detect()
    if (!info.available) return { ok: false, error: appError('ENCODER_UNAVAILABLE', 'FFmpeg is not available, so videos cannot be exported.', 'Reinstall Digital Target Screen Studio to restore the bundled FFmpeg.') }
    const encoder = options.encoder === 'auto' ? await ffmpeg.pickEncoder('auto') : info.h264Encoders.some((e) => e.id === options.encoder) ? options.encoder : null
    if (!encoder) return { ok: false, error: appError('ENCODER_UNAVAILABLE') }
    const probe = await ffmpeg.probe(p)
    if (!probe?.hasVideo || !probe.width || !probe.height) return { ok: false, error: appError('FILE_ACCESS', 'The video could not be read.') }
    const input = {
      input: p,
      output: '',
      sourceWidth: probe.width,
      sourceHeight: probe.height,
      sourceFps: probe.fps,
      hasAudio: probe.hasAudio,
      resolution: options.resolution,
      fps: options.fps,
      quality: options.quality,
      encoder,
      audioBitrateKbps: options.audioBitrateKbps,
      removeAudio: options.removeAudio
    }
    const plan = exportPlan(input)
    const [base] = splitExt(basename(p))
    const dir = dirname(p)
    const output = join(dir, uniqueName(`${base}_${Math.min(plan.width, plan.height)}p`, '.mp4', (n) => existsSync(join(dir, n))))
    const partial = `${output}.part`
    const jobId = randomUUID()
    const job = { child: null as ChildProcess | null, output, cancelled: false }
    this.jobs.set(jobId, job)
    const duration = probe.durationSec ?? 0
    const t0 = Date.now()
    const progress = (pct: number, status: 'running' | 'done' | 'error' | 'cancelled', extra: { outputPath?: string; error?: string } = {}) => {
      const elapsed = (Date.now() - t0) / 1000
      const eta = pct > 2 && status === 'running' ? Math.round((elapsed / pct) * (100 - pct)) : null
      broadcast('export:progress', { jobId, sourcePath: p, percent: pct, etaSec: eta, status, ...extra }, ['main'])
    }
    progress(0, 'running')
    log.info(`Export started with ${encoder}: ${plan.width}x${plan.height}@${plan.fps}`)
    void ffmpeg
      .run(exportArgs({ ...input, output: partial }), {
        durationSec: duration,
        onProgress: (pct) => progress(pct, 'running'),
        onSpawn: (child) => {
          job.child = child
        }
      })
      .then(async (r) => {
        this.jobs.delete(jobId)
        if (job.cancelled) {
          await rm(partial, { force: true }).catch(() => undefined)
          progress(0, 'cancelled')
          return
        }
        if (r.code !== 0) {
          await rm(partial, { force: true }).catch(() => undefined)
          log.error('Export failed', r.stderr.slice(-1200))
          progress(0, 'error', { error: 'The export failed. Try another encoder or a lower resolution.' })
          return
        }
        const check = await ffmpeg.probe(partial)
        if (!check?.hasVideo) {
          await rm(partial, { force: true }).catch(() => undefined)
          progress(0, 'error', { error: 'The exported file could not be verified.' })
          return
        }
        await rename(partial, output)
        log.info(`Export finished in ${Math.round((Date.now() - t0) / 1000)} s: ${redact(output)}`)
        progress(100, 'done', { outputPath: output })
        broadcast('library:changed', undefined, ['main'])
      })
    return { ok: true, value: jobId }
  }

  cancelExport(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.cancelled = true
    job.child?.kill('SIGKILL')
  }

  cancelAllExports(): void {
    for (const id of this.jobs.keys()) this.cancelExport(id)
  }
}

export const library = new LibraryService()
