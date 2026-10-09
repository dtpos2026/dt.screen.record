import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { IN_PROGRESS_FOLDER } from '../../shared/constants'
import type { RecoverableRecording } from '../../shared/types'

/** Information needed to finalise a raw recording (also used for crash recovery). */
export interface RecordingMeta {
  sessionId: string
  startedMs: number
  mimeType: string
  width: number
  height: number
  fps: number
  videoBitsPerSecond: number
  hasAudio: boolean
  audioBitrateKbps: number
  sampleRate: number
  outputFormat: 'mp4' | 'webm'
  constantFrameRate: boolean
  encoderPreference: string
  elapsedMs: number
  sourceLabel: string
}

export function inProgressDir(recordingsDir: string): string {
  return join(recordingsDir, IN_PROGRESS_FOLDER)
}

/**
 * Streams MediaRecorder chunks straight to disk. Because WebM is written
 * incrementally, everything recorded up to a crash or power loss stays
 * playable and can be recovered on the next start.
 */
export class RecordingWriter {
  readonly rawPath: string
  readonly metaPath: string
  private fh: FileHandle | null = null
  private chain: Promise<void> = Promise.resolve()
  private failed: Error | null = null
  bytesWritten = 0

  private constructor(dir: string, private meta: RecordingMeta) {
    this.rawPath = join(dir, `${meta.sessionId}.webm`)
    this.metaPath = join(dir, `${meta.sessionId}.json`)
  }

  static async open(recordingsDir: string, meta: RecordingMeta): Promise<RecordingWriter> {
    const dir = inProgressDir(recordingsDir)
    await mkdir(dir, { recursive: true })
    if (process.platform === 'win32') {
      // Hide the working folder in Explorer (best effort).
      spawn('attrib', ['+h', dir], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
    }
    const w = new RecordingWriter(dir, meta)
    w.fh = await open(w.rawPath, 'w')
    await w.saveMeta()
    return w
  }

  get error(): Error | null {
    return this.failed
  }

  write(data: Uint8Array): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (!this.fh || this.failed) return
      try {
        await this.fh.write(data)
        this.bytesWritten += data.byteLength
      } catch (err) {
        this.failed = err as Error
      }
    })
    return this.chain
  }

  async updateMeta(partial: Partial<RecordingMeta>): Promise<void> {
    this.meta = { ...this.meta, ...partial }
    await this.saveMeta()
  }

  getMeta(): RecordingMeta {
    return this.meta
  }

  private async saveMeta(): Promise<void> {
    try {
      await writeFile(this.metaPath, JSON.stringify(this.meta, null, 2))
    } catch {
      // Metadata is only a recovery aid.
    }
  }

  async close(): Promise<void> {
    await this.chain
    if (this.fh) {
      try {
        await this.fh.sync()
      } catch {
        // ignore
      }
      await this.fh.close()
      this.fh = null
    }
    await this.saveMeta()
  }

  async discard(): Promise<void> {
    await this.close().catch(() => undefined)
    await rm(this.rawPath, { force: true }).catch(() => undefined)
    await rm(this.metaPath, { force: true }).catch(() => undefined)
  }
}

export async function listRecoverable(recordingsDir: string, exclude: string | null): Promise<RecoverableRecording[]> {
  const dir = inProgressDir(recordingsDir)
  if (!existsSync(dir)) return []
  const out: RecoverableRecording[] = []
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.webm')) continue
    const id = f.slice(0, -5)
    if (id === exclude || !/^[\w-]{6,64}$/.test(id)) continue
    const file = join(dir, f)
    const s = await stat(file).catch(() => null)
    if (!s || s.size < 1024) continue
    out.push({ id, file, sizeBytes: s.size, startedMs: s.birthtimeMs || s.mtimeMs })
  }
  return out.sort((a, b) => b.startedMs - a.startedMs)
}

export async function readMeta(recordingsDir: string, id: string): Promise<RecordingMeta | null> {
  try {
    return JSON.parse(await readFile(join(inProgressDir(recordingsDir), `${id}.json`), 'utf8')) as RecordingMeta
  } catch {
    return null
  }
}
