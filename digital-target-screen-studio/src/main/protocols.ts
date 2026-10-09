import { net, protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { createLogger } from './logger'
import { rendererDir } from './paths'

const log = createLogger('protocol')

/**
 * Two private schemes:
 *  - app://bundle/…   serves the built renderer (instead of file://)
 *  - dtmedia://file/… serves media files, but only from folders the app
 *                      manages (recordings, screenshots, caches).
 */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: 'dtmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: dtmedia:",
  "media-src 'self' blob: dtmedia: mediastream:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: dtmedia:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

let mediaRootsProvider: () => string[] = () => []

export function setMediaRoots(provider: () => string[]): void {
  mediaRootsProvider = provider
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function isAllowedMediaPath(p: string): boolean {
  if (!isAbsolute(p)) return false
  return mediaRootsProvider().some((root) => root && isInside(p, root))
}

export function mediaUrl(filePath: string, version?: number): string {
  const encoded = Buffer.from(filePath, 'utf8').toString('base64url')
  return `dtmedia://file/${encoded}${version ? `?v=${Math.round(version)}` : ''}`
}

export function registerProtocolHandlers(): void {
  const root = resolve(rendererDir())

  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'bundle') return new Response('Not found', { status: 404 })
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '')
    const file = join(root, rel || 'index.html')
    if (!file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(file).toString())
    if (!file.endsWith('.html')) return res
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', PROD_CSP)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(res.body, { status: res.status, headers })
  })

  protocol.handle('dtmedia', (request) => {
    try {
      const url = new URL(request.url)
      const encoded = url.pathname.replace(/^\//, '')
      const filePath = Buffer.from(encoded, 'base64url').toString('utf8')
      if (!isAllowedMediaPath(filePath)) {
        log.warn('Blocked media request outside allowed folders')
        return new Response('Forbidden', { status: 403 })
      }
      const stat = statSync(filePath)
      if (!stat.isFile()) return new Response('Not found', { status: 404 })
      const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const range = request.headers.get('range')
      const baseHeaders: Record<string, string> = {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        if (m) {
          let start = m[1] ? Number(m[1]) : 0
          let end = m[2] ? Number(m[2]) : stat.size - 1
          if (!m[1] && m[2]) {
            start = Math.max(0, stat.size - Number(m[2]))
            end = stat.size - 1
          }
          end = Math.min(end, stat.size - 1)
          if (start > end || start >= stat.size) {
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
          }
          const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
          return new Response(body, {
            status: 206,
            headers: { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) }
          })
        }
      }
      const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream
      return new Response(body, { status: 200, headers: { ...baseHeaders, 'Content-Length': String(stat.size) } })
    } catch (err) {
      log.warn('Media request failed', err)
      return new Response('Not found', { status: 404 })
    }
  })
}
