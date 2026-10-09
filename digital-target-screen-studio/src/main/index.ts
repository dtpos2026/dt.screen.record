import { app, BrowserWindow, session } from 'electron'
import { BRAND } from '../shared/constants'
import type { Settings } from '../shared/settings'
import { registerIpcHandlers, takeScreenshot } from './ipc/handlers'
import { createLogger, initLogger } from './logger'
import { isTrustedUrl } from './paths'
import { registerProtocolHandlers, registerSchemes, setMediaRoots } from './protocols'
import { settingsStore } from './settings-store'
import { messageBox } from './dialogs'
import { createMainWindow, createSplash, getMainWindow, roleOf, showMainWindow } from './windows'
import { engine } from './services/engine-client'
import { broadcast, notify } from './services/events'
import { ffmpeg } from './services/ffmpeg'
import { setToolbarVisible, syncToolbar, syncWebcam } from './services/floating'
import { library, thumbnailsDir } from './services/library'
import { recorder } from './services/recorder'
import { captureTempDir, screenshots } from './services/screenshots'
import { registerShortcuts, unregisterAllShortcuts } from './services/shortcuts'
import { createTray, destroyTray, rebuild as rebuildTray, updateTray } from './services/tray'
import { getScreenSources } from './services/displays'

// ------------------------------------------------------------------ early setup

if (process.env.DT_USER_DATA) app.setPath('userData', process.env.DT_USER_DATA)
if (process.env.DT_E2E === '1' && process.env.DT_E2E_REAL_AUDIO !== '1') {
  // Automated tests only: use Chromium's fake camera/microphone.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

registerSchemes()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  void bootstrap()
}

let quitting = false
let trayHintShown = false

async function bootstrap(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId(BRAND.appId)
  await app.whenReady()
  initLogger()
  const log = createLogger('app')
  log.info(`${BRAND.product} ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`)

  const settings = settingsStore.load()
  registerProtocolHandlers()
  setMediaRoots(() => {
    const g = settingsStore.get().general
    return [g.recordingsDir, g.screenshotsDir, thumbnailsDir(), captureTempDir()]
  })
  configureSession()
  registerIpcHandlers()

  const startHidden = process.argv.includes('--hidden') || settings.general.startMinimized
  const splash = settings.general.showSplash && !startHidden ? createSplash() : null
  const splashShownAt = Date.now()
  const main = createMainWindow({ show: false })
  main.once('ready-to-show', () => {
    const wait = splash ? Math.max(0, 1100 - (Date.now() - splashShownAt)) : 0
    setTimeout(() => {
      if (!startHidden) main.show()
      if (splash && !splash.isDestroyed()) splash.destroy()
    }, wait)
  })
  wireMainWindow(main)

  engine.ensure()
  engine.onCrash(() => {
    recorder.onEngineCrash()
    setTimeout(() => engine.ensure(), 500)
  })

  createTray({
    toggleRecording: () => void recorder.toggle(),
    togglePause: () => void recorder.togglePause(),
    discard: () => void recorder.discard(),
    screenshot: takeScreenshot,
    toggleToolbar: () => setToolbarVisible(),
    quit: () => app.quit()
  })

  recorder.onChange((s) => {
    updateTray(s)
    syncToolbar(s.status)
  })

  applyShortcuts(settings)
  applyLoginItem(settings)
  syncToolbar('idle')
  syncWebcam()

  let previous = settings
  settingsStore.on('changed', (next: Settings) => {
    broadcast('settings:changed', next)
    if (JSON.stringify(next.shortcuts) !== JSON.stringify(previous.shortcuts)) applyShortcuts(next)
    if (next.general.launchAtStartup !== previous.general.launchAtStartup) applyLoginItem(next)
    if (next.general.recordingsDir !== previous.general.recordingsDir || next.general.screenshotsDir !== previous.general.screenshotsDir) {
      library.watch()
      broadcast('library:changed', undefined, ['main'])
    }
    if (JSON.stringify(next.toolbar) !== JSON.stringify(previous.toolbar)) syncToolbar()
    if (JSON.stringify(next.webcam) !== JSON.stringify(previous.webcam)) syncWebcam()
    rebuildTray()
    previous = next
  })

  await screenshots.init()
  library.watch()
  void ffmpeg.detect().then((info) => {
    if (!info.available) {
      notify({ kind: 'warning', title: 'FFmpeg not found', message: 'Recordings will be saved as WebM. MP4 conversion and video export are unavailable.' })
    }
  })
  // Offer to recover recordings interrupted by a crash or power loss.
  setTimeout(() => void recorder.announceRecoverable(), 2500)

  app.on('activate', () => showMainWindow())
}

function wireMainWindow(main: BrowserWindow): void {
  main.on('close', (event) => {
    if (quitting) return
    const s = settingsStore.get().general
    if (s.closeToTray) {
      event.preventDefault()
      main.hide()
      if (!trayHintShown) {
        trayHintShown = true
        notify({ kind: 'info', title: 'Still running in the tray', message: 'Digital Target Screen Studio keeps running so your shortcuts keep working. Right-click the tray icon to quit.' })
      }
    }
  })
  main.on('minimize', () => {
    if (settingsStore.get().general.minimizeToTray && recorder.isBusy) main.hide()
  })
}

function applyShortcuts(s: Settings): void {
  const failed = registerShortcuts(s.shortcuts, {
    recordToggle: () => void recorder.toggle(),
    pauseToggle: () => void recorder.togglePause(),
    screenshotRegion: () => takeScreenshot('region'),
    screenshotFullscreen: () => takeScreenshot('fullscreen'),
    screenshotWindow: () => takeScreenshot('window'),
    toggleToolbar: () => setToolbarVisible()
  })
  if (failed.length) {
    notify({
      kind: 'warning',
      title: 'Some shortcuts are unavailable',
      message: `${failed.join(', ')} ${failed.length === 1 ? 'is' : 'are'} already used by another app. Choose different keys in Settings → Shortcuts.`
    })
  }
}

function applyLoginItem(s: Settings): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: s.general.launchAtStartup, args: ['--hidden'] })
}

function configureSession(): void {
  const ses = session.defaultSession
  // Fully offline: no spell-check dictionary downloads and no remote requests
  // of any kind (only the Vite dev server is allowed during development).
  ses.setSpellCheckerEnabled(false)
  ses.setSpellCheckerLanguages([])
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    const allowed = !app.isPackaged && isTrustedUrl(details.url.replace(/^ws/, 'http'))
    if (!allowed) createLogger('network').warn('Blocked network request')
    callback({ cancel: !allowed })
  })
  const allowed = new Set(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen'])
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowed.has(permission) && isTrustedUrl(details.requestingUrl) && !!roleOf(wc))
  })
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    return allowed.has(permission) && isTrustedUrl(origin) && (!wc || !!roleOf(wc))
  })
  // getDisplayMedia() is only used to obtain Windows system-audio loopback.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isTrustedUrl(request.securityOrigin) && !isTrustedUrl(request.frame?.url)) {
        callback({})
        return
      }
      void getScreenSources().then((sources) => {
        if (!sources.length) callback({})
        else callback({ video: sources[0], audio: request.audioRequested ? 'loopback' : undefined })
      })
    },
    { useSystemPicker: false }
  )
  // Never let a page open new windows or navigate to remote content.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

app.on('before-quit', async (event) => {
  if (quitting) return
  if (recorder.isBusy) {
    event.preventDefault()
    showMainWindow()
    const choice = await messageBox({
      type: 'warning',
      buttons: ['Stop and save', 'Discard recording', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: 'Recording in progress',
      message: 'A recording is in progress.',
      detail: 'Save the recording before quitting?'
    })
    if (choice === 2) return
    if (choice === 0) await recorder.stop('quit')
    else {
      const discarded = await recorder.discard()
      if (!discarded) return
    }
    quitting = true
    app.quit()
    return
  }
  quitting = true
})

app.on('will-quit', () => {
  unregisterAllShortcuts()
  library.cancelAllExports()
  settingsStore.flush()
  destroyTray()
})

app.on('window-all-closed', () => {
  // Keep running in the tray; quitting is explicit.
  if (!getMainWindow() && quitting) app.quit()
})
