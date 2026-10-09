import { screen, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  LOW_DISK_WARNING_BYTES,
  MIN_FREE_BYTES_TO_START,
  MIN_FREE_BYTES_WHILE_RECORDING
} from '../../shared/constants'
import { AppError, appError, toAppError } from '../../shared/errors'
import { formatBytes, formatDuration } from '../../shared/format'
import {
  computeOutputSize,
  computeVideoBitrate,
  layoutDisplays,
  normalizeRegion,
  regionPhysicalSize
} from '../../shared/recording-math'
import type { Settings } from '../../shared/settings'
import type {
  AppErrorInfo,
  DisplayInfo,
  EngineStartResult,
  RecordingPlan,
  RecordingState,
  RecoverableRecording,
  Rect,
  Result
} from '../../shared/types'
import { confirm } from '../dialogs'
import { createLogger, redact } from '../logger'
import { settingsStore } from '../settings-store'
import { createBorderWindow, getMainWindow, showMainWindow } from '../windows'
import { capabilities } from './capabilities'
import { cancelCountdown, countdownActive, runCountdown } from './countdown'
import { diskInfo, ensureWritableDir } from './disk'
import { electronDisplay, findDisplay, listDisplays, listWindows } from './displays'
import { engine } from './engine-client'
import { broadcast, notify } from './events'
import { finalizeRecording } from './finalizer'
import { regionSelector } from './region-selector'
import { RecordingWriter, listRecoverable, readMeta, type RecordingMeta } from './recording-writer'
import { codecFromMime } from './ffmpeg-args'
import { ffmpeg } from './ffmpeg'

const log = createLogger('recorder')

function idleState(prev?: RecordingState): RecordingState {
  return {
    status: 'idle',
    sessionId: null,
    elapsedMs: 0,
    updatedAt: Date.now(),
    limitMs: 0,
    countdownRemaining: 0,
    sourceLabel: '',
    sourceMode: null,
    output: null,
    audio: { system: false, microphone: false },
    warnings: [],
    lastError: prev?.lastError ?? null,
    lastSavedPath: prev?.lastSavedPath ?? null,
    finalizeProgress: 0
  }
}

interface PreparedSource {
  plan: RecordingPlan['video']
  label: string
  display: DisplayInfo | null
  regionAbs: Rect | null
  expected: { width: number; height: number }
}

/**
 * Recording session controller (state machine):
 * idle → countdown → starting → recording ⇄ paused → stopping → finalizing → idle
 */
class Recorder {
  private state: RecordingState = idleState()
  private writer: RecordingWriter | null = null
  private settings: Settings | null = null
  private accumulatedMs = 0
  private activeSince: number | null = null
  private limitTimer: NodeJS.Timeout | null = null
  private diskTimer: NodeJS.Timeout | null = null
  private metaTimer: NodeJS.Timeout | null = null
  private border: BrowserWindow | null = null
  private stopRequested = false
  private restoreMainAfter = false
  private selectedWindow: { id: string; name: string } | null = null
  private listeners = new Set<(s: RecordingState) => void>()

  getState(): RecordingState {
    return { ...this.state, elapsedMs: this.elapsed(), updatedAt: Date.now() }
  }

  get isBusy(): boolean {
    return this.state.status !== 'idle'
  }

  get isActive(): boolean {
    return this.state.status === 'recording' || this.state.status === 'paused'
  }

  onChange(fn: (s: RecordingState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  selectWindow(id: string, name: string): void {
    this.selectedWindow = { id, name }
  }

  private elapsed(): number {
    return this.accumulatedMs + (this.activeSince ? Date.now() - this.activeSince : 0)
  }

  private set(patch: Partial<RecordingState>): void {
    this.state = { ...this.state, ...patch }
    const snapshot = this.getState()
    broadcast('recording:state', snapshot)
    for (const l of this.listeners) l(snapshot)
  }

  // ------------------------------------------------------------------ start

  async start(): Promise<Result<null>> {
    if (this.state.status !== 'idle') return { ok: false, error: appError('BUSY', 'A recording is already in progress.') }
    if (regionSelector.active) return { ok: false, error: appError('BUSY') }
    const settings = structuredClone(settingsStore.get())
    this.settings = settings
    this.stopRequested = false
    this.accumulatedMs = 0
    this.activeSince = null
    const warnings: string[] = []

    try {
      // 1. Output folder and disk space.
      const dir = settings.general.recordingsDir
      if (!(await ensureWritableDir(dir))) throw new AppError('INVALID_SAVE_LOCATION', `The recordings folder cannot be written to.`)
      const disk = await diskInfo(dir)
      if (disk.freeBytes != null && disk.freeBytes < MIN_FREE_BYTES_TO_START) {
        throw new AppError('INSUFFICIENT_DISK_SPACE', `Only ${formatBytes(disk.freeBytes)} is free on the recording drive.`)
      }
      if (disk.freeBytes != null && disk.freeBytes < LOW_DISK_WARNING_BYTES) {
        warnings.push(`Low disk space: ${formatBytes(disk.freeBytes)} free.`)
      }

      // 2. Source.
      this.set({ ...idleState(this.state), status: 'starting', lastError: null })
      const source = await this.prepareSource(settings)
      if (!source) {
        this.set({ ...idleState(this.state) })
        return { ok: true, value: null }
      }

      // 3. Audio.
      const caps = capabilities()
      const wantSystem = settings.audio.systemAudio
      if (wantSystem && !caps.systemAudio) throw new AppError('SYSTEM_AUDIO_UNSUPPORTED')
      const mic = settings.audio.microphone
        ? {
            deviceId: settings.audio.micDeviceId || 'default',
            channels: settings.audio.micChannels,
            volume: settings.audio.micVolume / 100,
            noiseSuppression: settings.audio.noiseSuppression,
            echoCancellation: settings.audio.echoCancellation,
            autoGainControl: settings.audio.autoGainControl,
            voiceEnhancement: settings.audio.voiceEnhancement
          }
        : null

      // 4. Encoding.
      const fps = settings.recording.fps
      const bitrate = computeVideoBitrate(source.expected, fps, settings.recording.quality, settings.recording.customBitrateMbps)
      let codecPreference = settings.recording.videoCodec
      if (settings.recording.outputFormat === 'webm' && (codecPreference === 'auto' || codecPreference === 'h264')) codecPreference = 'vp9'
      if (settings.recording.outputFormat === 'mp4' && !ffmpeg.available) {
        warnings.push('FFmpeg was not found, so this recording will be saved as WebM instead of MP4.')
      }
      const sessionId = randomUUID()
      const plan: RecordingPlan = {
        sessionId,
        video: source.plan,
        fps,
        videoBitsPerSecond: bitrate,
        codecPreference,
        audio: { system: wantSystem, systemVolume: settings.audio.systemVolume / 100, mic }
      }

      // 5. Countdown.
      const countdown = settings.recording.countdownSeconds
      if (countdown > 0) {
        const target = source.display ? electronDisplay(source.display.id) : undefined
        this.set({ status: 'countdown', countdownRemaining: countdown, sourceLabel: source.label, sourceMode: settings.recording.sourceMode })
        const ok = await runCountdown(countdown, target ?? screen.getPrimaryDisplay(), 'record')
        if (!ok || this.stopRequested) {
          this.set({ ...idleState(this.state) })
          return { ok: true, value: null }
        }
      }

      // 6. Get the main window out of the way.
      const main = getMainWindow()
      this.restoreMainAfter = !!main && main.isVisible() && !main.isMinimized()
      if (settings.recording.minimizeOnStart && main && this.restoreMainAfter) {
        if (settings.general.minimizeToTray) main.hide()
        else main.minimize()
      }

      // 7. Writer + engine.
      this.set({ status: 'starting', sessionId, countdownRemaining: 0 })
      const meta: RecordingMeta = {
        sessionId,
        startedMs: Date.now(),
        mimeType: '',
        width: source.expected.width,
        height: source.expected.height,
        fps,
        videoBitsPerSecond: bitrate,
        hasAudio: wantSystem || !!mic,
        audioBitrateKbps: settings.audio.bitrateKbps,
        sampleRate: settings.audio.sampleRate,
        outputFormat: settings.recording.outputFormat,
        constantFrameRate: settings.recording.constantFrameRate,
        encoderPreference: 'auto',
        elapsedMs: 0,
        sourceLabel: source.label
      }
      this.writer = await RecordingWriter.open(dir, meta)
      let result: EngineStartResult
      try {
        result = await engine.request<EngineStartResult>({ cmd: 'start', plan }, 25_000)
      } catch (err) {
        await this.writer.discard()
        this.writer = null
        throw err
      }
      await this.writer.updateMeta({ mimeType: result.mimeType, width: result.width, height: result.height, hasAudio: result.hasAudio })
      warnings.push(...result.warnings)

      // 8. Recording.
      this.activeSince = Date.now()
      const limitMs = settings.recording.durationLimitSeconds * 1000
      this.set({
        status: 'recording',
        sessionId,
        limitMs,
        sourceLabel: source.label,
        sourceMode: settings.recording.sourceMode,
        output: { width: result.width, height: result.height, fps, container: settings.recording.outputFormat.toUpperCase(), codec: codecFromMime(result.mimeType).toUpperCase() },
        audio: { system: wantSystem, microphone: !!mic },
        warnings
      })
      log.info(`Recording started: ${settings.recording.sourceMode} ${result.width}x${result.height}@${fps} ${result.mimeType} ${Math.round(bitrate / 1000)} kbps audio=${result.hasAudio}`)
      this.armTimers()
      if (source.regionAbs && settings.recording.showRegionBorder) this.showBorder(source.regionAbs)
      for (const w of warnings) notify({ kind: 'warning', title: 'Recording started with a warning', message: w })
      if (this.stopRequested) void this.stop()
      return { ok: true, value: null }
    } catch (err) {
      const info = toAppError(err, 'INIT_FAILED')
      log.error('Recording failed to start', info.code, info.message)
      this.cleanupTimers()
      this.restoreMain()
      this.set({ ...idleState(this.state), lastError: info })
      return { ok: false, error: info }
    }
  }

  private async prepareSource(settings: Settings): Promise<PreparedSource | null> {
    const mode = settings.recording.sourceMode
    const preset = settings.recording.resolution
    const displays = await listDisplays(false)
    if (!displays.length) throw new AppError('NO_SOURCE')

    if (mode === 'window') {
      const sel = this.selectedWindow
      if (!sel) throw new AppError('NO_SOURCE', 'Choose a window to record first.', 'Open Screen Recorder → Window and pick an application window.')
      const windows = await listWindows()
      const match = windows.find((w) => w.id === sel.id)
      if (!match) throw new AppError('NO_SOURCE', 'The selected window is no longer available.', 'It may have been closed or minimised. Pick the window again.')
      // A window can be at most as large as the largest display.
      const largest = displays.reduce((a, b) => (a.physicalSize.width * a.physicalSize.height >= b.physicalSize.width * b.physicalSize.height ? a : b))
      const bound = computeOutputSize(largest.physicalSize, preset)
      return {
        plan: { kind: 'window', sourceId: match.id, maxWidth: bound.width, maxHeight: bound.height },
        label: match.name,
        display: null,
        regionAbs: null,
        expected: { width: bound.width, height: bound.height }
      }
    }

    if (mode === 'all-displays') {
      const usable = displays.filter((d) => d.sourceId)
      if (!usable.length) throw new AppError('NO_SOURCE')
      if (usable.length === 1) {
        const d = usable[0]
        const size = computeOutputSize(d.physicalSize, preset)
        return { plan: { kind: 'display', sourceId: d.sourceId!, maxWidth: size.width, maxHeight: size.height }, label: d.label, display: d, regionAbs: null, expected: size }
      }
      const layout = layoutDisplays(usable)
      const size = computeOutputSize(layout.canvas, preset)
      return {
        plan: {
          kind: 'composite',
          canvas: layout.canvas,
          maxWidth: size.width,
          maxHeight: size.height,
          sources: layout.placements.map((p) => ({
            sourceId: usable.find((d) => d.id === p.id)!.sourceId!,
            dest: { x: p.rect.x / layout.canvas.width, y: p.rect.y / layout.canvas.height, width: p.rect.width / layout.canvas.width, height: p.rect.height / layout.canvas.height }
          }))
        },
        label: `All displays (${usable.length})`,
        display: null,
        regionAbs: null,
        expected: size
      }
    }

    if (mode === 'region') {
      let region = settings.recording.region
      let display = region ? displays.find((d) => d.id === region!.displayId) : undefined
      if (!region || !display) {
        const sel = await regionSelector.select('record', displays, null, null)
        if (!sel) return null
        region = { displayId: sel.displayId, ...sel.rect }
        settingsStore.update({ recording: { region } })
        display = displays.find((d) => d.id === sel.displayId)
      }
      if (!display || !display.sourceId) throw new AppError('NO_SOURCE', 'The display for the selected region is not available.')
      const rect = { x: region.x, y: region.y, width: region.width, height: region.height }
      const phys = regionPhysicalSize(rect, display)
      const size = computeOutputSize(phys, preset)
      return {
        plan: { kind: 'region', sourceId: display.sourceId, crop: normalizeRegion(rect, display), maxWidth: size.width, maxHeight: size.height },
        label: `Region ${phys.width}×${phys.height} on ${display.label}`,
        display,
        regionAbs: { x: display.bounds.x + rect.x, y: display.bounds.y + rect.y, width: rect.width, height: rect.height },
        expected: size
      }
    }

    const display = await findDisplay(settings.recording.displayId)
    if (!display || !display.sourceId) throw new AppError('NO_SOURCE')
    const size = computeOutputSize(display.physicalSize, preset)
    return {
      plan: { kind: 'display', sourceId: display.sourceId, maxWidth: size.width, maxHeight: size.height },
      label: display.label,
      display,
      regionAbs: null,
      expected: size
    }
  }

  // ------------------------------------------------------------------ controls

  async pause(): Promise<void> {
    if (this.state.status !== 'recording') return
    try {
      await engine.request({ cmd: 'pause' }, 5000)
      if (this.activeSince) this.accumulatedMs += Date.now() - this.activeSince
      this.activeSince = null
      if (this.limitTimer) clearTimeout(this.limitTimer)
      this.set({ status: 'paused' })
      log.info('Recording paused')
    } catch (err) {
      log.error('Pause failed', err)
    }
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') return
    try {
      await engine.request({ cmd: 'resume' }, 5000)
      this.activeSince = Date.now()
      this.set({ status: 'recording' })
      this.armLimit()
      log.info('Recording resumed')
    } catch (err) {
      log.error('Resume failed', err)
    }
  }

  async togglePause(): Promise<void> {
    if (this.state.status === 'recording') await this.pause()
    else if (this.state.status === 'paused') await this.resume()
  }

  async toggle(): Promise<void> {
    if (this.state.status === 'idle') await this.start()
    else if (this.state.status === 'countdown') this.cancelCountdown()
    else await this.stop()
  }

  cancelCountdown(): void {
    if (countdownActive()) {
      this.stopRequested = true
      cancelCountdown()
    }
  }

  async stop(reason: 'user' | 'limit' | 'disk' | 'source-lost' | 'quit' = 'user'): Promise<string | null> {
    const status = this.state.status
    if (status === 'countdown') {
      this.cancelCountdown()
      return null
    }
    if (status === 'starting') {
      this.stopRequested = true
      return null
    }
    if (status !== 'recording' && status !== 'paused') return null
    if (this.activeSince) this.accumulatedMs += Date.now() - this.activeSince
    this.activeSince = null
    this.cleanupTimers()
    this.hideBorder()
    this.set({ status: 'stopping' })
    try {
      await engine.request({ cmd: 'stop' }, 30_000)
    } catch (err) {
      log.error('Engine stop failed; finalising what was written', err)
    }
    return this.finalizeCurrent(reason)
  }

  private async finalizeCurrent(reason: string): Promise<string | null> {
    const writer = this.writer
    this.writer = null
    if (!writer) {
      this.set({ ...idleState(this.state) })
      return null
    }
    const elapsedMs = this.accumulatedMs
    await writer.updateMeta({ elapsedMs })
    await writer.close()
    this.set({ status: 'finalizing', finalizeProgress: 0, elapsedMs })
    const settings = this.settings ?? settingsStore.get()
    try {
      const outcome = await finalizeRecording(writer.rawPath, writer.metaPath, writer.getMeta(), settings.general.recordingsDir, (p) => {
        this.state.finalizeProgress = p
        broadcast('recording:state', this.getState())
      })
      const name = basename(outcome.path)
      log.info(`Recording saved (${reason}): ${redact(outcome.path)}`)
      this.restoreMain()
      this.set({ ...idleState(this.state), lastSavedPath: outcome.path, lastError: null })
      broadcast('library:changed', undefined)
      const why = reason === 'limit' ? 'The recording reached its time limit. ' : reason === 'disk' ? 'Disk space ran low, so recording stopped. ' : reason === 'source-lost' ? 'The capture source closed, so recording stopped. ' : ''
      notify({
        kind: outcome.note ? 'warning' : 'success',
        title: 'Recording saved',
        message: `${why}${name} · ${formatDuration((outcome.durationSec ?? elapsedMs / 1000) * 1000)}${outcome.width ? ` · ${outcome.width}×${outcome.height}` : ''}${outcome.note ? `\n${outcome.note}` : ''}`,
        revealPath: outcome.path
      })
      return outcome.path
    } catch (err) {
      const info = toAppError(err, 'FINALIZE_FAILED')
      log.error('Finalising failed', info.message)
      this.restoreMain()
      this.set({ ...idleState(this.state), lastError: info })
      notify({ kind: 'error', title: 'Recording could not be saved', message: `${info.message}${info.hint ? `\n${info.hint}` : ''}` })
      void this.announceRecoverable()
      return null
    }
  }

  async discard(): Promise<boolean> {
    if (!this.isActive) return false
    const ok = await confirm({
      title: 'Discard recording?',
      message: 'Discard the current recording?',
      detail: `${formatDuration(this.elapsed())} of recording will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Discard',
      danger: true
    })
    if (!ok || !this.isActive) return false
    this.cleanupTimers()
    this.hideBorder()
    try {
      await engine.request({ cmd: 'abort' }, 10_000)
    } catch {
      // ignore
    }
    await this.writer?.discard()
    this.writer = null
    this.activeSince = null
    this.accumulatedMs = 0
    this.restoreMain()
    this.set({ ...idleState(this.state) })
    log.info('Recording discarded by user')
    return true
  }

  // ------------------------------------------------------------------ engine callbacks

  async onChunk(sessionId: string, data: Uint8Array): Promise<boolean> {
    const w = this.writer
    if (!w || this.state.sessionId !== sessionId) return false
    await w.write(data)
    if (w.error) {
      const code = (w.error as NodeJS.ErrnoException).code
      log.error('Writing recording data failed', code)
      notify({ kind: 'error', title: 'Recording stopped', message: code === 'ENOSPC' ? 'The disk is full. What was recorded so far is being saved.' : 'The recording file could not be written.' })
      void this.stop('disk')
      return false
    }
    return true
  }

  onEngineWarning(sessionId: string, message: string): void {
    if (this.state.sessionId !== sessionId) return
    this.set({ warnings: [...this.state.warnings, message] })
    notify({ kind: 'warning', title: 'Recording warning', message })
  }

  onEngineFatal(sessionId: string, error: AppErrorInfo): void {
    if (this.state.sessionId !== sessionId || !this.isActive) return
    log.warn('Engine reported a fatal capture error', error.message)
    notify({ kind: 'warning', title: 'Capture source lost', message: `${error.message} The recording so far is being saved.` })
    void this.stop('source-lost')
  }

  onEngineCrash(): void {
    if (!this.isActive && this.state.status !== 'stopping') return
    log.error('Engine crashed during recording; saving what was written')
    if (this.activeSince) this.accumulatedMs += Date.now() - this.activeSince
    this.activeSince = null
    this.cleanupTimers()
    this.hideBorder()
    void this.finalizeCurrent('source-lost')
  }

  // ------------------------------------------------------------------ timers & helpers

  private armTimers(): void {
    this.armLimit()
    this.diskTimer = setInterval(async () => {
      if (!this.isActive || !this.settings) return
      const info = await diskInfo(this.settings.general.recordingsDir)
      if (info.freeBytes != null && info.freeBytes < MIN_FREE_BYTES_WHILE_RECORDING) {
        log.warn('Disk space low; stopping recording')
        notify({ kind: 'warning', title: 'Low disk space', message: 'Recording stopped to protect your files. The recording is being saved.' })
        void this.stop('disk')
      }
    }, 5000)
    this.metaTimer = setInterval(() => {
      void this.writer?.updateMeta({ elapsedMs: this.elapsed() })
      broadcast('recording:state', this.getState())
    }, 5000)
  }

  private armLimit(): void {
    if (this.limitTimer) clearTimeout(this.limitTimer)
    const limit = this.state.limitMs
    if (!limit) return
    const remaining = limit - this.elapsed()
    this.limitTimer = setTimeout(() => {
      if (this.state.status === 'recording') {
        log.info('Recording duration limit reached')
        void this.stop('limit')
      }
    }, Math.max(0, remaining))
  }

  private cleanupTimers(): void {
    if (this.limitTimer) clearTimeout(this.limitTimer)
    if (this.diskTimer) clearInterval(this.diskTimer)
    if (this.metaTimer) clearInterval(this.metaTimer)
    this.limitTimer = this.diskTimer = this.metaTimer = null
  }

  private showBorder(r: Rect): void {
    const pad = 4
    this.border = createBorderWindow({ x: Math.round(r.x - pad), y: Math.round(r.y - pad), width: Math.round(r.width + pad * 2), height: Math.round(r.height + pad * 2) })
  }

  private hideBorder(): void {
    if (this.border && !this.border.isDestroyed()) this.border.destroy()
    this.border = null
  }

  private restoreMain(): void {
    if (this.restoreMainAfter) {
      this.restoreMainAfter = false
      showMainWindow()
    }
  }

  // ------------------------------------------------------------------ recovery

  async recoverable(): Promise<RecoverableRecording[]> {
    return listRecoverable(settingsStore.get().general.recordingsDir, this.state.sessionId)
  }

  async announceRecoverable(): Promise<void> {
    const list = await this.recoverable().catch(() => [])
    if (list.length) broadcast('recovery:available', list, ['main'])
  }

  async recover(id: string): Promise<Result<string>> {
    if (this.isBusy) return { ok: false, error: appError('BUSY') }
    const dir = settingsStore.get().general.recordingsDir
    const item = (await this.recoverable()).find((r) => r.id === id)
    if (!item) return { ok: false, error: appError('FILE_ACCESS', 'That recording is no longer available.') }
    const s = settingsStore.get()
    let meta = await readMeta(dir, id)
    if (!meta) {
      const probe = ffmpeg.available ? await ffmpeg.probe(item.file) : null
      meta = {
        sessionId: id,
        startedMs: item.startedMs,
        mimeType: probe?.videoCodec === 'h264' ? 'video/webm;codecs=h264' : 'video/webm;codecs=vp9',
        width: probe?.width ?? 1920,
        height: probe?.height ?? 1080,
        fps: 30,
        videoBitsPerSecond: 8_000_000,
        hasAudio: probe?.hasAudio ?? false,
        audioBitrateKbps: s.audio.bitrateKbps,
        sampleRate: s.audio.sampleRate,
        outputFormat: 'mp4',
        constantFrameRate: false,
        encoderPreference: 'auto',
        elapsedMs: (probe?.durationSec ?? 60) * 1000,
        sourceLabel: 'Recovered recording'
      }
    }
    if (!meta.elapsedMs) {
      const probe = await ffmpeg.probe(item.file)
      meta.elapsedMs = (probe?.durationSec ?? 60) * 1000
    }
    // A crash can leave the raw file without audio frames at the end; do not require audio.
    meta.hasAudio = meta.hasAudio && !!(await ffmpeg.probe(item.file))?.hasAudio
    try {
      this.set({ ...idleState(this.state), status: 'finalizing' })
      const outcome = await finalizeRecording(item.file, item.file.replace(/\.webm$/, '.json'), meta, dir, (p) => {
        this.state.finalizeProgress = p
        broadcast('recording:state', this.getState())
      })
      this.set({ ...idleState(this.state), lastSavedPath: outcome.path })
      broadcast('library:changed', undefined)
      log.info('Recovered interrupted recording')
      return { ok: true, value: outcome.path }
    } catch (err) {
      this.set({ ...idleState(this.state) })
      return { ok: false, error: toAppError(err, 'FINALIZE_FAILED') }
    }
  }

  async discardRecoverable(id: string): Promise<boolean> {
    const item = (await this.recoverable()).find((r) => r.id === id)
    if (!item) return false
    const ok = await confirm({
      title: 'Delete interrupted recording?',
      message: 'Permanently delete this interrupted recording?',
      detail: `${formatBytes(item.sizeBytes)} recorded on ${new Date(item.startedMs).toLocaleString()}. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return false
    await rm(item.file, { force: true })
    await rm(item.file.replace(/\.webm$/, '.json'), { force: true })
    return true
  }
}

export const recorder = new Recorder()

