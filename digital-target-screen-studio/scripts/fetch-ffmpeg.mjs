#!/usr/bin/env node
/**
 * Downloads the LGPL (no GPL / non-free code) shared Windows x64 build of
 * FFmpeg from BtbN/FFmpeg-Builds and places the files the app needs in
 * resources/ffmpeg/win32-x64. The packaged app copies that folder to
 * resources/ffmpeg.
 *
 * Usage: node scripts/fetch-ffmpeg.mjs [--force]
 * Override the download with FFMPEG_ZIP_URL or use a local zip with FFMPEG_ZIP_PATH.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'resources', 'ffmpeg', 'win32-x64')
const VERSION = '8.1'
const URL = process.env.FFMPEG_ZIP_URL ?? `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n${VERSION}-latest-win64-lgpl-shared-${VERSION}.zip`
const KEEP = [/^ffmpeg\.exe$/, /^ffprobe\.exe$/, /^(avcodec|avformat|avutil|avfilter|avdevice|swscale|swresample)-\d+\.dll$/]

if (existsSync(join(target, 'ffmpeg.exe')) && !process.argv.includes('--force')) {
  console.log('FFmpeg already present in resources/ffmpeg/win32-x64 (use --force to refresh)')
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'dt-ffmpeg-'))
try {
  let zip = process.env.FFMPEG_ZIP_PATH
  if (!zip) {
    zip = join(work, 'ffmpeg.zip')
    console.log(`Downloading ${URL}`)
    const res = await fetch(URL, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
  }
  const sha = createHash('sha256').update(await import('node:fs').then((fs) => fs.readFileSync(zip))).digest('hex')
  console.log(`Archive SHA-256 ${sha} (${(statSync(zip).size / 1e6).toFixed(1)} MB)`)
  const extract = join(work, 'x')
  mkdirSync(extract)
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${extract}' -Force`], { stdio: 'inherit' })
  } else {
    execFileSync('unzip', ['-q', zip, '-d', extract], { stdio: 'inherit' })
  }
  const top = readdirSync(extract).map((d) => join(extract, d)).find((d) => statSync(d).isDirectory())
  if (!top) throw new Error('Unexpected archive layout')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  const bin = join(top, 'bin')
  let count = 0
  for (const f of readdirSync(bin)) {
    if (KEEP.some((re) => re.test(f))) {
      copyFileSync(join(bin, f), join(target, f))
      count++
    }
  }
  copyFileSync(join(top, 'LICENSE.txt'), join(target, 'LICENSE.txt'))
  writeFileSync(join(target, 'VERSION.txt'), `${top.split(/[\\/]/).pop()}\nsha256 ${sha}\nsource ${URL}\n`)
  writeFileSync(join(root, 'resources', 'ffmpeg', 'VERSION.txt'), `${VERSION} (LGPL shared build, ${top.split(/[\\/]/).pop()})`)
  if (!existsSync(join(target, 'ffmpeg.exe'))) throw new Error('ffmpeg.exe missing from archive')
  console.log(`FFmpeg ${VERSION} LGPL: ${count} files copied to resources/ffmpeg/win32-x64`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
