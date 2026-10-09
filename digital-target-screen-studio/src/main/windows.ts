import { app, BrowserWindow, nativeTheme, screen, type BrowserWindowConstructorOptions, type WebContents } from 'electron'
import { resolveTheme, THEME_CHROME, type EffectiveTheme, type ThemeSetting } from '../shared/settings'
import { createLogger } from './logger'
import { brandAsset, isTrustedUrl, preloadPath, rendererUrl, type RendererPage } from './paths'

const log = createLogger('windows')

export type WindowRole = 'main' | 'engine' | 'toolbar' | 'overlay' | 'countdown' | 'webcam' | 'border' | 'splash'

const roles = new Map<number, WindowRole>()

export function roleOf(contents: WebContents): WindowRole | undefined {
  return roles.get(contents.id)
}

/** Applies a theme setting to native UI (menus, dialogs) and returns the effective theme. */
export function applyNativeTheme(theme: ThemeSetting): EffectiveTheme {
  nativeTheme.themeSource = theme === 'system' ? 'system' : theme === 'light' ? 'light' : 'dark'
  return resolveTheme(theme, nativeTheme.shouldUseDarkColors)
}

/** Updates the main window's caption buttons and background to match the theme. */
export function applyWindowChrome(theme: EffectiveTheme): void {
  const win = getMainWindow()
  if (!win) return
  const c = THEME_CHROME[theme]
  win.setBackgroundColor(c.background)
  if (process.platform !== 'darwin') {
    try {
      win.setTitleBarOverlay({ color: c.background, symbolColor: c.symbol, height: 44 })
    } catch {
      // Title-bar overlay is not available on every platform/window manager.
    }
  }
}

function hardened(options: BrowserWindowConstructorOptions, extra?: Electron.WebPreferences): BrowserWindowConstructorOptions {
  return {
    ...options,
    icon: brandAsset(process.platform === 'win32' ? 'icon.ico' : 'icon-256.png'),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      ...extra
    }
  }
}

/** Blocks navigation away from our pages, new windows and webviews. */
function guard(win: BrowserWindow, role: WindowRole): void {
  const id = win.webContents.id
  roles.set(id, role)
  win.on('closed', () => roles.delete(id))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault()
      log.warn('Blocked navigation to untrusted URL')
    }
  })
  win.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  if (!app.isPackaged) {
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error' || details.level === 'warning') log.debug(`[${role}] ${details.message}`)
    })
  }
}

function load(win: BrowserWindow, page: RendererPage, query?: Record<string, string>): Promise<void> {
  return win.loadURL(rendererUrl(page, query)).catch((err) => log.error(`Failed to load ${page}`, err))
}

// ---------------------------------------------------------------- main window

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** Lets the preload apply the theme before the first paint (the page's settings take over after). */
function themeArgs(theme: EffectiveTheme): Electron.WebPreferences {
  return { additionalArguments: [`--dt-theme=${theme}`] }
}

export function createMainWindow(opts: { show: boolean; theme: EffectiveTheme }): BrowserWindow {
  const chrome = THEME_CHROME[opts.theme]
  const work = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1320, Math.max(980, Math.round(work.width * 0.78)))
  const height = Math.min(860, Math.max(660, Math.round(work.height * 0.82)))
  const win = new BrowserWindow(
    hardened({
      width,
      height,
      minWidth: 960,
      minHeight: 640,
      show: false,
      title: 'Digital Target Screen Studio',
      backgroundColor: chrome.background,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: chrome.background, symbolColor: chrome.symbol, height: 44 },
      autoHideMenuBar: true
    }, themeArgs(opts.theme))
  )
  win.setMenu(null)
  guard(win, 'main')
  if (opts.show) win.once('ready-to-show', () => win.show())
  void load(win, 'index')
  mainWindow = win
  return win
}

export function showMainWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

// ---------------------------------------------------------------- splash

export function createSplash(): BrowserWindow {
  const win = new BrowserWindow(
    hardened({
      width: 460,
      height: 300,
      frame: false,
      resizable: false,
      movable: true,
      show: false,
      center: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true
    })
  )
  guard(win, 'splash')
  win.once('ready-to-show', () => win.show())
  void load(win, 'splash')
  return win
}

// ---------------------------------------------------------------- engine (hidden)

let engineWindow: BrowserWindow | null = null

export function getEngineWindow(): BrowserWindow | null {
  return engineWindow && !engineWindow.isDestroyed() ? engineWindow : null
}

export function createEngineWindow(): BrowserWindow {
  const win = new BrowserWindow(
    hardened(
      { width: 320, height: 200, show: false, skipTaskbar: true, focusable: false, title: 'Capture engine' },
      { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
    )
  )
  guard(win, 'engine')
  void load(win, 'engine')
  engineWindow = win
  return win
}

// ---------------------------------------------------------------- floating toolbar

let toolbarWindow: BrowserWindow | null = null
export const TOOLBAR_SIZE = { width: 640, height: 56 }

export function getToolbarWindow(): BrowserWindow | null {
  return toolbarWindow && !toolbarWindow.isDestroyed() ? toolbarWindow : null
}

/** Returns a position that is fully visible on some display (handles unplugged monitors). */
export function visiblePosition(x: number | null, y: number | null, size: { width: number; height: number }): { x: number; y: number } {
  const displays = screen.getAllDisplays()
  if (x != null && y != null) {
    const fits = displays.some((d) => {
      const a = d.workArea
      return x >= a.x - 8 && y >= a.y - 8 && x + size.width <= a.x + a.width + 8 && y + size.height <= a.y + a.height + 8
    })
    if (fits) return { x, y }
  }
  const a = screen.getPrimaryDisplay().workArea
  return { x: Math.round(a.x + (a.width - size.width) / 2), y: a.y + 16 }
}

export function createToolbarWindow(pos: { x: number | null; y: number | null }, theme: EffectiveTheme, onMoved: (x: number, y: number) => void): BrowserWindow {
  const p = visiblePosition(pos.x, pos.y, TOOLBAR_SIZE)
  const win = new BrowserWindow(
    hardened({
      ...TOOLBAR_SIZE,
      x: p.x,
      y: p.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      title: 'Digital Target toolbar'
    }, themeArgs(theme))
  )
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Keeps the toolbar out of recordings and screenshots (Windows 10 2004+).
  win.setContentProtection(true)
  guard(win, 'toolbar')
  let moveTimer: NodeJS.Timeout | null = null
  win.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      const [x, y] = win.getPosition()
      onMoved(x, y)
    }, 300)
  })
  void load(win, 'toolbar')
  toolbarWindow = win
  return win
}

// ---------------------------------------------------------------- overlays

export function createOverlayWindow(bounds: Electron.Rectangle, mode: 'screenshot' | 'record'): BrowserWindow {
  const win = new BrowserWindow(
    hardened({
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      hasShadow: false,
      show: false,
      title: 'Select area'
    })
  )
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setBounds(bounds)
  if (mode === 'record') win.setContentProtection(true)
  guard(win, 'overlay')
  void load(win, 'overlay', { mode })
  return win
}

export function createCountdownWindow(display: Electron.Display, seconds: number, purpose: 'record' | 'screenshot'): BrowserWindow {
  const size = 260
  const b = display.workArea
  const win = new BrowserWindow(
    hardened({
      width: size,
      height: size,
      x: Math.round(b.x + (b.width - size) / 2),
      y: Math.round(b.y + (b.height - size) / 2),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: 'Countdown'
    })
  )
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  guard(win, 'countdown')
  win.once('ready-to-show', () => win.showInactive())
  void load(win, 'countdown', { seconds: String(seconds), purpose })
  return win
}

export function createBorderWindow(bounds: Electron.Rectangle): BrowserWindow {
  const win = new BrowserWindow(
    hardened({
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      hasShadow: false,
      show: false,
      title: 'Recording area'
    })
  )
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.setContentProtection(true)
  guard(win, 'border')
  win.once('ready-to-show', () => win.showInactive())
  void load(win, 'border')
  return win
}

let webcamWindow: BrowserWindow | null = null

export function getWebcamWindow(): BrowserWindow | null {
  return webcamWindow && !webcamWindow.isDestroyed() ? webcamWindow : null
}

export function createWebcamWindow(cfg: { size: number; x: number | null; y: number | null }, onBounds: (b: Electron.Rectangle) => void): BrowserWindow {
  const existing = getWebcamWindow()
  if (existing) return existing
  const size = { width: cfg.size, height: cfg.size }
  const a = screen.getPrimaryDisplay().workArea
  const fallback = { x: a.x + a.width - cfg.size - 32, y: a.y + a.height - cfg.size - 32 }
  const p = cfg.x != null && cfg.y != null ? visiblePosition(cfg.x, cfg.y, size) : fallback
  const win = new BrowserWindow(
    hardened({
      ...size,
      x: p.x,
      y: p.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      // Transparent windows cannot be resized by dragging on Windows; size is
      // changed with the bubble's own buttons or in Settings.
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: 'Webcam'
    })
  )
  win.setAlwaysOnTop(true, 'screen-saver')
  guard(win, 'webcam')
  let t: NodeJS.Timeout | null = null
  const report = () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => !win.isDestroyed() && onBounds(win.getBounds()), 300)
  }
  win.on('moved', report)
  win.on('resized', report)
  win.once('ready-to-show', () => win.showInactive())
  void load(win, 'webcam')
  webcamWindow = win
  return win
}

/** Media source ids of our own windows, so they can be hidden from window pickers. */
export function ownMediaSourceIds(): Set<string> {
  const ids = new Set<string>()
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      ids.add(w.getMediaSourceId())
    } catch {
      // ignore destroyed windows
    }
  }
  return ids
}
