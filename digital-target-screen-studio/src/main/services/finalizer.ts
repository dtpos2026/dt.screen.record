import { existsSync } from 'node:fs'
import { copyFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../shared/errors'
import { recordingBaseName, uniqueName } from '../../shared/filenames'
import { createLogger } from '../logger'
import { diskInfo } from './disk'
import { ffmpeg } from './ffmpeg'
import { codecFromMime, finalizeArgs } from './ffmpeg-args'
import type { RecordingMeta } from './recording-writer'

const log = createLogger('finalize')

export interface FinalizeOutcome {
  path: string
  /** True when the raw WebM had to be kept because MP4 conversion was unavailable or failed. */
  fellBackToWebm: boolean
  durationSec: number | null
  width: number | null
  height: number | null
  note?: string
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(from, to)
    await rm(from, { force: true })
  }
}

/**
 * Turns a raw recording into the final file and validates it. The raw file
 * is only deleted after the final file has been verified, so a failure never
 * loses the recording.
 */
export async function finalizeRecording(
  rawPath: string,
  metaPath: string | null,
  meta: RecordingMeta,
  outDir: string,
  onProgress: (pct: number) => void
): Promise<FinalizeOutcome> {
  const rawStat = await stat(rawPath).catch(() => null)
  if (!rawStat || rawStat.size === 0) throw new AppError('FINALIZE_FAILED', 'No video data was recorded.', 'The capture source may have stopped immediately. Try again or choose another source.')
  const base = recordingBaseName(new Date(meta.startedMs))
  const exists = (n: string) => existsSync(join(outDir, n))

  /**
   * Keeps the recording without converting to MP4. With FFmpeg available the
   * stream is remuxed (no quality loss) so the file gets a proper duration
   * and seek index: VP8/VP9 into WebM, H.264 into Matroska (.mkv).
   */
  const keepWebm = async (note?: string): Promise<FinalizeOutcome> => {
    const isH264 = codecFromMime(meta.mimeType) === 'h264'
    if (ffmpeg.available) {
      const ext = isH264 ? '.mkv' : '.webm'
      const target = join(outDir, uniqueName(base, ext, exists))
      const part = `${target}.part`
      const r = await ffmpeg.run(['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-fflags', '+genpts', '-i', rawPath, '-map', '0', '-c', 'copy', '-f', isH264 ? 'matroska' : 'webm', part])
      const probe = r.code === 0 ? await ffmpeg.probe(part) : null
      if (probe?.hasVideo) {
        await rename(part, target)
        await rm(rawPath, { force: true }).catch(() => undefined)
        if (metaPath) await rm(metaPath, { force: true }).catch(() => undefined)
        onProgress(100)
        return { path: target, fellBackToWebm: meta.outputFormat !== 'webm', durationSec: probe.durationSec, width: probe.width, height: probe.height, note }
      }
      await rm(part, { force: true }).catch(() => undefined)
    }
    const target = join(outDir, uniqueName(base, '.webm', exists))
    await moveFile(rawPath, target)
    if (metaPath) await rm(metaPath, { force: true }).catch(() => undefined)
    onProgress(100)
    return { path: target, fellBackToWebm: meta.outputFormat !== 'webm', durationSec: meta.elapsedMs / 1000, width: meta.width, height: meta.height, note }
  }

  if (meta.outputFormat === 'webm') return keepWebm()
  if (!ffmpeg.available) return keepWebm('FFmpeg is not available, so the recording was saved as WebM.')

  const free = (await diskInfo(outDir)).freeBytes
  if (free != null && free < rawStat.size * 1.1 + 50 * 1024 * 1024) {
    return keepWebm('There was not enough free space to convert to MP4, so the recording was saved as WebM.')
  }

  const sourceVideoCodec = codecFromMime(meta.mimeType)
  const needsEncoder = sourceVideoCodec !== 'h264' || meta.constantFrameRate
  const encoder = needsEncoder ? await ffmpeg.pickEncoder(meta.encoderPreference) : null
  if (needsEncoder && !encoder) return keepWebm('No H.264 encoder is available, so the recording was saved as WebM.')

  const output = join(outDir, uniqueName(base, '.mp4', exists))
  const partial = `${output}.part`
  const args = finalizeArgs({
    input: rawPath,
    output: partial,
    sourceVideoCodec,
    hasAudio: meta.hasAudio,
    constantFrameRate: meta.constantFrameRate,
    fps: meta.fps,
    bitrate: meta.videoBitsPerSecond,
    encoder,
    audioBitrateKbps: meta.audioBitrateKbps,
    sampleRate: meta.sampleRate
  })
  const t0 = Date.now()
  const r = await ffmpeg.run(args, { durationSec: Math.max(0.5, meta.elapsedMs / 1000), onProgress: (p) => onProgress(p) })
  if (r.code !== 0) {
    await rm(partial, { force: true }).catch(() => undefined)
    log.error('MP4 conversion failed', r.stderr.slice(-1500))
    return keepWebm('Converting to MP4 failed, so the original WebM recording was kept.')
  }
  const probe = await ffmpeg.probe(partial)
  const valid = !!probe && probe.hasVideo && (probe.durationSec ?? 0) > 0.2 && (!meta.hasAudio || probe.hasAudio)
  if (!valid) {
    await rm(partial, { force: true }).catch(() => undefined)
    log.error('Converted MP4 failed validation', probe)
    return keepWebm('The converted MP4 could not be verified, so the original WebM recording was kept.')
  }
  await rename(partial, output)
  await rm(rawPath, { force: true }).catch(() => undefined)
  if (metaPath) await rm(metaPath, { force: true }).catch(() => undefined)
  log.info(`Finalised MP4 ${probe.width}x${probe.height} ${probe.durationSec?.toFixed(1)}s in ${Date.now() - t0} ms (${sourceVideoCodec === 'h264' && !meta.constantFrameRate ? 'stream copy' : encoder})`)
  onProgress(100)
  return { path: output, fellBackToWebm: false, durationSec: probe.durationSec, width: probe.width, height: probe.height }
}
