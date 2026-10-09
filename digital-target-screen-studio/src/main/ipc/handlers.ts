import { app, shell, systemPreferences } from 'electron'
import { readFileSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { BRAND } from '../../shared/constants'
import type { ScreenshotMode } from '../../shared/settings'
import type { AppInfo } from '../../shared/types'
import { openDialog } from '../dialogs'
import { createLogger } from '../logger'
import { licensesFile } from '../paths'
import { settingsStore } from '../settings-store'
import { getMainWindow, showMainWindow, type WindowRole } from '../windows'
import { capabilities } from '../services/capabilities'
import { cancelCountdown } from '../services/countdown'
import { diskInfo, ensureWritableDir } from '../services/disk'
import { listDisplays, listWindows } from '../services/displays'
import { engine } from '../services/engine-client'
import { broadcast, notify, sendTo } from '../services/events'
import { ffmpeg } from '../services/ffmpeg'
import { popupScreenshotMenu, resizeToolbar, setToolbarVisible } from '../services/floating'
import { library } from '../services/library'
import { recorder } from '../services/recorder'
import { regionSelector } from '../services/region-selector'
import { screenshots } from '../services/screenshots'
import { handle, on } from './router'
import { S } from './schemas'

const log = createLogger('handlers')

const MAIN: WindowRole[] = ['main']
const CONTROLS: WindowRole[] = ['main', 'toolbar']
const ANY_UI: WindowRole[] = ['main', 'toolbar', 'overlay', 'countdown', 'webcam', 'border', 'splash', 'engine']

let licensesCache: AppInfo['licenses'] | null = null
function licenses(): AppInfo['licenses'] {
  if (licensesCache) return licensesCache
  try {
    const f = licensesFile()
    licensesCache = f ? (JSON.parse(readFileSync(f, 'utf8')) as AppInfo['licenses']) : []
  } catch {
    licensesCache = []
  }
  return licensesCache
}

export function appInfo(): AppInfo {
  const caps = capabilities()
  const s = settingsStore.get()
  return {
    name: BRAND.product,
    company: BRAND.company,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    windowsBuild: caps.windowsBuild,
    isPackaged: app.isPackaged,
    capabilities: {
      systemAudio: caps.systemAudio,
      systemAudioNote: caps.systemAudioNote,
      excludeFromCapture: caps.excludeFromCapture,
      hardwareAcceleration: caps.hardwareAcceleration
    },
    paths: { recordings: s.general.recordingsDir, screenshots: s.general.screenshotsDir, logs: join(app.getPath('userData'), 'logs') },
    licenses: licenses()
  }
}

export function takeScreenshot(mode: ScreenshotMode): void {
  void screenshots.capture({ mode }).then((r) => {
    if (!r.ok && r.error.code !== 'BUSY') notify({ kind: 'error', title: 'Screenshot failed', message: r.error.message })
  })
}

const SYSTEM_SETTINGS_URI: Record<string, string> = {
  microphone: 'ms-settings:privacy-microphone',
  camera: 'ms-settings:privacy-webcam',
  sound: 'ms-settings:sound',
  display: 'ms-settings:display'
}

export function registerIpcHandlers(): void {
  // ---------------------------------------------------------------- app & settings
  handle('app:info', ANY_UI, null, () => appInfo())
  handle('app:quit', MAIN, null, () => app.quit())
  handle('settings:get', ANY_UI, null, () => settingsStore.get())
  handle('settings:update', ['main', 'toolbar', 'webcam'], S.settingsPatch, (patch) => settingsStore.update(patch))
  handle('settings:reset', MAIN, null, () => settingsStore.reset())

  handle('dialog:chooseFolder', MAIN, S.chooseFolder, async ({ purpose }) => {
    const s = settingsStore.get().general
    const current = purpose === 'recordings' ? s.recordingsDir : s.screenshotsDir
    const picked = await openDialog({
      title: purpose === 'recordings' ? 'Choose where recordings are saved' : 'Choose where screenshots are saved',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    })
    if (!picked?.[0]) return null
    if (!(await ensureWritableDir(picked[0]))) {
      notify({ kind: 'error', title: 'Folder not writable', message: 'Choose a folder you have permission to write to.' })
      return null
    }
    settingsStore.update({ general: purpose === 'recordings' ? { recordingsDir: picked[0] } : { screenshotsDir: picked[0] } })
    library.watch()
    return picked[0]
  })

  handle('shell:openFolder', ['main', 'toolbar'], S.openFolder, async ({ kind }) => {
    const s = settingsStore.get().general
    const dir = kind === 'recordings' ? s.recordingsDir : kind === 'screenshots' ? s.screenshotsDir : join(app.getPath('userData'), 'logs')
    await ensureWritableDir(dir)
    await shell.openPath(dir)
  })

  handle('shell:openSystemSettings', MAIN, S.systemSettings, async ({ target }) => {
    if (process.platform === 'win32') await shell.openExternal(SYSTEM_SETTINGS_URI[target])
  })

  handle('system:disk', MAIN, S.disk, ({ kind }) => {
    const s = settingsStore.get().general
    return diskInfo(kind === 'recordings' ? s.recordingsDir : s.screenshotsDir)
  })

  handle('system:mediaAccess', MAIN, null, () => {
    const status = (t: 'microphone' | 'camera' | 'screen') => {
      try {
        return process.platform === 'win32' || process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus(t) : 'granted'
      } catch {
        return 'unknown'
      }
    }
    return { microphone: status('microphone'), camera: status('camera'), screen: status('screen') }
  })

  // ---------------------------------------------------------------- sources
  handle('capture:displays', CONTROLS, S.displays, ({ thumbnails }) => listDisplays(!!thumbnails))
  handle('capture:windows', MAIN, null, () => listWindows())

  // ---------------------------------------------------------------- recording
  handle('recording:start', CONTROLS, null, () => recorder.start())
  handle('recording:stop', CONTROLS, null, async () => {
    await recorder.stop()
  })
  handle('recording:pause', CONTROLS, null, () => recorder.pause())
  handle('recording:resume', CONTROLS, null, () => recorder.resume())
  handle('recording:toggle', CONTROLS, null, () => recorder.toggle())
  handle('recording:discard', CONTROLS, null, () => recorder.discard())
  handle('recording:cancelCountdown', ['main', 'toolbar', 'countdown'], null, () => {
    recorder.cancelCountdown()
    cancelCountdown()
  })
  handle('recording:state', ANY_UI, null, () => recorder.getState())
  handle('recording:selectRegion', MAIN, S.selectRegion, async ({ displayId }) => {
    if (recorder.isBusy) return { ok: false, error: { code: 'BUSY', message: 'Stop the current recording first.' } }
    const displays = await listDisplays(false)
    const targets = displayId ? displays.filter((d) => d.id === displayId) : displays
    const current = settingsStore.get().recording.region
    const main = getMainWindow()
    const wasVisible = !!main?.isVisible()
    main?.hide()
    try {
      const sel = await regionSelector.select('record', targets.length ? targets : displays, null, current ? { displayId: current.displayId, rect: current } : null)
      if (!sel) return { ok: true, value: null }
      settingsStore.update({ recording: { region: { displayId: sel.displayId, ...sel.rect }, sourceMode: 'region' } })
      return { ok: true, value: sel }
    } finally {
      if (wasVisible) showMainWindow()
    }
  })
  handle('recording:selectWindow', MAIN, S.selectWindow, ({ sourceId, name }) => recorder.selectWindow(sourceId, name))
  handle('recording:recoverable', MAIN, null, () => recorder.recoverable())
  handle('recording:recover', MAIN, S.recoverId, ({ id }) => recorder.recover(id))
  handle('recording:discardRecoverable', MAIN, S.recoverId, ({ id }) => recorder.discardRecoverable(id))

  // ---------------------------------------------------------------- screenshots
  handle('screenshot:capture', CONTROLS, S.screenshotCapture, (req) => screenshots.capture(req))
  handle('screenshot:readBytes', MAIN, S.readBytes, (req) => screenshots.readBytes(req))
  handle('screenshot:save', MAIN, S.save, (req) => screenshots.save(req))
  handle('screenshot:copy', MAIN, S.copy, (req) => screenshots.copy(req))
  handle('screenshot:discard', MAIN, S.captureId, ({ captureId }) => screenshots.discard(captureId))
  handle('screenshot:get', MAIN, S.captureId, ({ captureId }) => screenshots.get(captureId))

  // ---------------------------------------------------------------- library
  handle('library:list', MAIN, null, () => library.list())
  handle('library:thumbnail', MAIN, S.path, ({ path }) => library.thumbnail(path))
  handle('library:rename', MAIN, S.rename, ({ path, newName }) => library.rename(path, newName))
  handle('library:delete', MAIN, S.paths, ({ paths }) => library.delete(paths))
  handle('library:reveal', ['main', 'toolbar'], S.path, ({ path }) => library.reveal(path))
  handle('library:open', MAIN, S.path, ({ path }) => library.open(path))

  // ---------------------------------------------------------------- export
  handle('export:info', MAIN, S.exportInfo, ({ refresh }) => ffmpeg.detect(!!refresh))
  handle('export:start', MAIN, S.exportStart, ({ path, options }) => library.startExport(path, options))
  handle('export:cancel', MAIN, S.jobId, ({ jobId }) => library.cancelExport(jobId))

  // ---------------------------------------------------------------- windows
  handle('window:navigate', ['main', 'toolbar', 'webcam'], S.navigate, (req) => {
    showMainWindow()
    sendTo(getMainWindow(), 'navigate', req)
  })
  handle('window:minimize', MAIN, null, () => getMainWindow()?.minimize())
  handle('toolbar:toggle', ['main', 'toolbar'], S.toolbarToggle, ({ visible }) => setToolbarVisible(visible))
  handle('toolbar:screenshotMenu', ['toolbar'], null, () => popupScreenshotMenu(takeScreenshot))
  handle('toolbar:resize', ['toolbar'], S.toolbarResize, ({ width, height }) => resizeToolbar(width, height))

  // ---------------------------------------------------------------- overlays
  handle('overlay:init', ['overlay'], null, (_p, e) => regionSelector.initFor(e.sender))
  handle('overlay:submit', ['overlay'], S.overlaySubmit, ({ rect }, e) => regionSelector.submit(e.sender, rect))
  handle('webcam:config', ['webcam'], null, () => settingsStore.get().webcam)
  handle('webcam:close', ['webcam'], null, () => {
    settingsStore.update({ webcam: { enabled: false } })
  })

  // ---------------------------------------------------------------- engine
  handle('engine:ready', ['engine'], null, () => engine.markReady())
  handle('engine:reply', ['engine'], S.engineReply, (r) => engine.reply(r.reqId, r.ok, r.value, r.error))
  handle('engine:chunk', ['engine'], S.engineChunk, ({ sessionId, data }) => recorder.onChunk(sessionId, data))
  on('engine:levels', ['engine'], S.levels, (levels) => broadcast('audio:levels', levels, ['main', 'toolbar']))
  on('engine:warning', ['engine'], S.engineWarning, ({ sessionId, message }) => recorder.onEngineWarning(sessionId, message))
  on('engine:fatal', ['engine'], S.engineFatal, (p) => recorder.onEngineFatal(p.sessionId, p.error))

  log.info('IPC handlers registered')
}
