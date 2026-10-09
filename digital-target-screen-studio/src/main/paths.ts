import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Folder with bundled runtime resources (icons, FFmpeg, licenses). */
export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

export function brandAsset(name: string): string {
  return join(resourcesDir(), 'brand', name)
}

export function preloadPath(): string {
  return join(__dirname, '../preload/index.cjs')
}

export function rendererDir(): string {
  return join(__dirname, '../renderer')
}

export type RendererPage = 'index' | 'engine' | 'toolbar' | 'overlay' | 'countdown' | 'webcam' | 'border' | 'splash'

/** URL for a renderer page: Vite dev server in development, app:// in production. */
export function rendererUrl(page: RendererPage, query?: Record<string, string>): string {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : ''
  const dev = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && dev) return `${dev}/${page}.html${qs}`
  return `app://bundle/${page}.html${qs}`
}

/** Origins our own pages are served from (used for IPC sender checks). */
export function trustedOrigins(): string[] {
  const origins = ['app://bundle']
  const dev = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && dev) origins.push(new URL(dev).origin)
  return origins
}

export function isTrustedUrl(url: string | undefined | null): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    const origin = u.protocol === 'app:' ? `app://${u.host}` : u.origin
    return trustedOrigins().includes(origin)
  } catch {
    return false
  }
}

export function licensesFile(): string | null {
  const p = join(resourcesDir(), 'licenses', 'licenses.json')
  return existsSync(p) ? p : null
}
