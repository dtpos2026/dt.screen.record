import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SettingsPatch } from '../../src/shared/settings'
import type { RecordingState } from '../../src/shared/types'
import type { DtBridge } from '../../src/shared/ipc'

export const ROOT = resolve(__dirname, '../..')

declare global {
  interface Window {
    dt: DtBridge
  }
}

export interface Launched {
  app: ElectronApplication
  page: Page
  userData: string
  outDir: string
}

export async function mainWindow(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find((x) => x.url().includes('/index.html'))
    if (w) {
      await w.waitForLoadState('domcontentloaded')
      await w.waitForFunction(() => typeof window.dt?.invoke === 'function')
      return w
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('Main window did not open')
}

export async function launch(opts: { userData?: string; outDir?: string; env?: Record<string, string>; settings?: SettingsPatch; keepSettings?: boolean } = {}): Promise<Launched> {
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'dt-e2e-ud-'))
  const outDir = opts.outDir ?? mkdtempSync(join(tmpdir(), 'dt-e2e-out-'))
  const args = process.platform === 'linux' ? ['--no-sandbox', ROOT] : [ROOT]
  const env = { ...process.env, DT_USER_DATA: userData, DT_E2E: '1', ...opts.env } as Record<string, string>
  // A relaunch right after a crash can briefly find the old instance's lock; retry.
  let app: ElectronApplication | null = null
  for (let attempt = 1; !app; attempt++) {
    try {
      app = await electron.launch({ args, cwd: ROOT, env })
    } catch (err) {
      if (attempt >= 4) throw err
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  const page = await mainWindow(app)
  if (opts.keepSettings) return { app, page, userData, outDir }
  await setSettings(page, {
    general: { recordingsDir: outDir, screenshotsDir: outDir, showSplash: false, closeToTray: false },
    recording: { countdownSeconds: 0, minimizeOnStart: false, durationLimitSeconds: 0, sourceMode: 'display', resolution: 'native', fps: 30 },
    audio: { systemAudio: false, microphone: false },
    screenshot: { showPreview: true, copyToClipboard: false, delaySeconds: 0, format: 'png' },
    toolbar: { showWhileRecording: false, alwaysVisible: false },
    ...opts.settings
  })
  return { app, page, userData, outDir }
}

export async function setSettings(page: Page, patch: SettingsPatch): Promise<void> {
  await page.evaluate((p) => window.dt.invoke('settings:update', p), patch)
}

export async function state(page: Page): Promise<RecordingState> {
  return page.evaluate(() => window.dt.invoke('recording:state'))
}

export async function waitForStatus(page: Page, status: RecordingState['status'], timeoutMs = 60_000): Promise<RecordingState> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const s = await state(page)
    if (s.status === status) return s
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Timed out waiting for status ${status} (now ${(await state(page)).status})`)
}

/** Starts a recording, waits `ms` of recording time, stops it and returns the saved file. */
export async function recordFor(page: Page, ms: number): Promise<{ path: string; state: RecordingState }> {
  const r = await page.evaluate(() => window.dt.invoke('recording:start'))
  if (!r.ok) throw new Error(`start failed: ${JSON.stringify(r.error)}`)
  await waitForStatus(page, 'recording', 20_000)
  await page.waitForTimeout(ms)
  await page.evaluate(() => window.dt.invoke('recording:stop'))
  const s = await waitForStatus(page, 'idle', 90_000)
  if (!s.lastSavedPath) throw new Error(`not saved: ${JSON.stringify(s.lastError)}`)
  return { path: s.lastSavedPath, state: s }
}

function ffprobeBin(): string {
  const bundled = join(ROOT, 'resources', 'ffmpeg', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  return existsSync(bundled) ? bundled : 'ffprobe'
}

export interface Probe {
  duration: number
  video?: { codec: string; width: number; height: number }
  audio?: { codec: string; sampleRate: number; channels: number }
}

export function probe(file: string): Probe {
  const out = execFileSync(ffprobeBin(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString()
  const j = JSON.parse(out) as { format: { duration: string }; streams: Array<Record<string, string | number>> }
  const v = j.streams.find((s) => s.codec_type === 'video')
  const a = j.streams.find((s) => s.codec_type === 'audio')
  return {
    duration: Number(j.format.duration),
    video: v ? { codec: String(v.codec_name), width: Number(v.width), height: Number(v.height) } : undefined,
    audio: a ? { codec: String(a.codec_name), sampleRate: Number(a.sample_rate), channels: Number(a.channels) } : undefined
  }
}

/** Mean / max audio level in dBFS (FFmpeg volumedetect). */
export function volumeDetect(file: string): { mean: number; max: number } {
  const ff = ffprobeBin().replace(/ffprobe(\.exe)?$/, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  const r = spawnSync(ff, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
  const stderr = String(r.stderr)
  const mean = /mean_volume: (-?[\d.]+) dB/.exec(stderr)
  const max = /max_volume: (-?[\d.]+) dB/.exec(stderr)
  return { mean: mean ? Number(mean[1]) : -999, max: max ? Number(max[1]) : -999 }
}

export function imageInfo(file: string): { type: string; width: number; height: number } {
  const b = readFileSync(file)
  if (b.readUInt32BE(0) === 0x89504e47) return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    return { type: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  throw new Error(`Unknown image type: ${file}`)
}

export function filesIn(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f))
}

export async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 20_000, label = 'condition'): Promise<NonNullable<T>> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn()
    if (v) return v as NonNullable<T>
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

export const isLinux = process.platform === 'linux'
export const multiMonitor = process.env.DT_E2E_MULTI_MONITOR === '1'
export function hasCommand(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
