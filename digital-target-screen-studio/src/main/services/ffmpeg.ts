import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { FfmpegInfo } from '../../shared/types'
import { createLogger, redact } from '../logger'
import { resourcesDir } from '../paths'
import {
  H264_ENCODERS,
  encoderTestArgs,
  parseEncoderList,
  parseProbeJson,
  parseProgressSeconds,
  parseVersion,
  type ProbeResult
} from './ffmpeg-args'

const log = createLogger('ffmpeg')
const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)

interface Located {
  ffmpeg: string
  ffprobe: string | null
  bundled: boolean
}

function locate(): Located | null {
  const candidates: Array<{ dir: string; bundled: boolean }> = []
  if (process.env.DT_FFMPEG_DIR) candidates.push({ dir: process.env.DT_FFMPEG_DIR, bundled: false })
  if (app.isPackaged) candidates.push({ dir: join(resourcesDir(), 'ffmpeg'), bundled: true })
  else candidates.push({ dir: join(resourcesDir(), 'ffmpeg', `${process.platform}-${process.arch}`), bundled: true })
  for (const p of (process.env.PATH ?? '').split(delimiter)) if (p) candidates.push({ dir: p, bundled: false })
  for (const c of candidates) {
    const ff = join(c.dir, exe('ffmpeg'))
    if (existsSync(ff)) {
      const probe = join(c.dir, exe('ffprobe'))
      return { ffmpeg: ff, ffprobe: existsSync(probe) ? probe : null, bundled: c.bundled }
    }
  }
  return null
}

export interface RunOptions {
  /** Expected media duration, used to compute progress percent. */
  durationSec?: number
  onProgress?: (percent: number, processedSec: number) => void
  timeoutMs?: number
  /** Receives the child so callers can cancel it. */
  onSpawn?: (child: ChildProcess) => void
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  killed: boolean
}

function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    opts.onSpawn?.(child)
    let stdout = ''
    let stderr = ''
    let killed = false
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true
          child.kill('SIGKILL')
        }, opts.timeoutMs)
      : null
    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString()
      if (stdout.length < 1_000_000) stdout += s
      if (opts.onProgress) {
        const sec = parseProgressSeconds(s)
        if (sec != null) {
          const pct = opts.durationSec && opts.durationSec > 0 ? Math.min(99.5, (sec / opts.durationSec) * 100) : 0
          opts.onProgress(pct, sec)
        }
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 200_000) stderr += d.toString()
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(err), killed })
    })
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr, killed: killed || signal === 'SIGKILL' || signal === 'SIGTERM' })
    })
  })
}

class FfmpegService {
  private located: Located | null | undefined
  private info: FfmpegInfo | null = null
  private detecting: Promise<FfmpegInfo> | null = null

  private loc(): Located | null {
    if (this.located === undefined) this.located = locate()
    return this.located
  }

  get available(): boolean {
    return !!this.loc()
  }

  /** Detects FFmpeg and tests which H.264 encoders actually work on this PC. */
  detect(refresh = false): Promise<FfmpegInfo> {
    if (this.info && !refresh) return Promise.resolve(this.info)
    if (this.detecting && !refresh) return this.detecting
    if (refresh) this.located = undefined
    this.detecting = this.doDetect().then((info) => {
      this.info = info
      this.detecting = null
      return info
    })
    return this.detecting
  }

  private async doDetect(): Promise<FfmpegInfo> {
    const l = this.loc()
    if (!l) {
      log.warn('FFmpeg not found')
      return { available: false, path: null, version: null, bundled: false, h264Encoders: [], aac: false, error: 'FFmpeg was not found.' }
    }
    const v = await run(l.ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 10_000 })
    if (v.code !== 0) {
      log.error('FFmpeg failed to start', v.stderr.slice(0, 500))
      return { available: false, path: redact(l.ffmpeg), version: null, bundled: l.bundled, h264Encoders: [], aac: false, error: 'FFmpeg could not be started.' }
    }
    const enc = await run(l.ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs: 10_000 })
    const names = parseEncoderList(enc.stdout)
    const working: FfmpegInfo['h264Encoders'] = []
    for (const e of H264_ENCODERS) {
      if (!names.has(e.id)) continue
      const t = await run(l.ffmpeg, encoderTestArgs(e.id), { timeoutMs: 15_000 })
      if (t.code === 0) working.push({ id: e.id, label: e.label, hardware: e.hardware })
      else log.info(`Encoder ${e.id} unavailable on this system`)
    }
    const info: FfmpegInfo = {
      available: true,
      path: redact(l.ffmpeg),
      version: parseVersion(v.stdout),
      bundled: l.bundled,
      h264Encoders: working,
      aac: names.has('aac')
    }
    log.info(`FFmpeg ${info.version} ready; H.264 encoders: ${working.map((w) => w.id).join(', ') || 'none'}`)
    return info
  }

  /** Best encoder id, honouring a user preference when it is available. */
  async pickEncoder(preference = 'auto'): Promise<string | null> {
    const info = await this.detect()
    if (preference !== 'auto' && info.h264Encoders.some((e) => e.id === preference)) return preference
    return info.h264Encoders[0]?.id ?? null
  }

  async probe(file: string): Promise<ProbeResult | null> {
    const l = this.loc()
    if (!l) return null
    if (l.ffprobe) {
      const r = await run(l.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 20_000 })
      if (r.code === 0) {
        try {
          return parseProbeJson(r.stdout)
        } catch {
          // fall through to the ffmpeg-based probe
        }
      }
    }
    // Fallback: count the whole file by decoding to null (slower, but reliable for raw WebM).
    const r = await run(l.ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-map', '0', '-c', 'copy', '-f', 'null', '-'], { timeoutMs: 120_000 })
    return parseFfmpegInfo(r.stderr)
  }

  run(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    const l = this.loc()
    if (!l) return Promise.resolve({ code: -1, stdout: '', stderr: 'FFmpeg not available', killed: false })
    return run(l.ffmpeg, args, opts)
  }
}

/** Minimal parser for `ffmpeg -i` stderr, used when ffprobe is missing. */
export function parseFfmpegInfo(stderr: string): ProbeResult {
  const timeMatches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)]
  const dm = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  let durationSec: number | null = null
  const last = timeMatches[timeMatches.length - 1]
  if (last) durationSec = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
  else if (dm) durationSec = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])
  const vm = /Stream #\S+.*Video: (\w+).*?, (\d{2,5})x(\d{2,5})/.exec(stderr)
  const fm = /(\d+(?:\.\d+)?) fps/.exec(stderr)
  const am = /Stream #\S+.*Audio: (\w+)/.exec(stderr)
  return {
    durationSec,
    width: vm ? Number(vm[2]) : null,
    height: vm ? Number(vm[3]) : null,
    fps: fm ? Number(fm[1]) : null,
    videoCodec: vm ? vm[1] : null,
    audioCodec: am ? am[1] : null,
    hasVideo: !!vm,
    hasAudio: !!am
  }
}

export const ffmpeg = new FfmpegService()
