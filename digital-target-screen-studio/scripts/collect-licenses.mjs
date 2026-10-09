#!/usr/bin/env node
/**
 * Collects licence information for every third-party component that ships
 * inside the application and writes:
 *   resources/licenses/licenses.json          (shown on the About page)
 *   resources/licenses/THIRD_PARTY_NOTICES.txt (full licence texts)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'licenses')
mkdirSync(outDir, { recursive: true })

/** npm packages bundled into the renderer / main process by Vite. */
const BUNDLED_ROOTS = ['react', 'react-dom', 'lucide-react', 'zod', '@fontsource/inter']

function pkgDir(name) {
  return join(root, 'node_modules', name)
}

function readPkg(name) {
  const f = join(pkgDir(name), 'package.json')
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}

function licenseText(name) {
  const dir = pkgDir(name)
  if (!existsSync(dir)) return null
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null
}

const seen = new Map()
function walk(name) {
  if (seen.has(name)) return
  const pkg = readPkg(name)
  if (!pkg) return
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'See package'
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  seen.set(name, { name, version: pkg.version, license, url: url?.replace(/^git\+/, '').replace(/\.git$/, ''), text: licenseText(name) })
  for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep)
}
BUNDLED_ROOTS.forEach(walk)

const electronVersion = readPkg('electron')?.version ?? ''
const ffmpegVersionFile = join(root, 'resources', 'ffmpeg', 'VERSION.txt')
const ffmpegVersion = existsSync(ffmpegVersionFile) ? readFileSync(ffmpegVersionFile, 'utf8').trim() : '8.1 (LGPL build)'

const runtime = [
  { name: 'Electron', version: electronVersion, license: 'MIT', url: 'https://github.com/electron/electron', text: licenseText('electron') },
  { name: 'Chromium', version: '', license: 'BSD-3-Clause and others (see LICENSES.chromium.html)', url: 'https://www.chromium.org', text: null },
  { name: 'Node.js', version: '', license: 'MIT', url: 'https://nodejs.org', text: null },
  {
    name: 'FFmpeg',
    version: ffmpegVersion,
    license: 'LGPL-3.0-or-later',
    url: 'https://ffmpeg.org',
    text:
      'This FFmpeg build is licensed under the GNU Lesser General Public License (LGPL) version 3 or later.\n' +
      'This application runs an unmodified LGPL build of FFmpeg (no GPL or non-free components) as a separate\n' +
      'executable with shared libraries. Source code: https://ffmpeg.org/download.html ; build scripts:\n' +
      'https://github.com/BtbN/FFmpeg-Builds . The full LGPL text is included in resources/ffmpeg/LICENSE.txt.\n' +
      'You may replace the FFmpeg files in the resources/ffmpeg folder with any compatible build.'
  },
  { name: 'Inter typeface', version: readPkg('@fontsource/inter')?.version ?? '', license: 'OFL-1.1', url: 'https://rsms.me/inter/', text: null },
  { name: 'Poppins typeface (logo outlines)', version: readPkg('@fontsource/poppins')?.version ?? '', license: 'OFL-1.1', url: 'https://fonts.google.com/specimen/Poppins', text: licenseText('@fontsource/poppins') }
]

const all = [...runtime, ...[...seen.values()].filter((p) => p.name !== '@fontsource/inter').sort((a, b) => a.name.localeCompare(b.name))]

writeFileSync(join(outDir, 'licenses.json'), JSON.stringify(all.map(({ name, version, license, url }) => ({ name, version, license, url })), null, 2))

const notices = [
  'DIGITAL TARGET SCREEN STUDIO — THIRD-PARTY NOTICES',
  '',
  'This product includes the following third-party software. Each component is',
  'provided under its own licence, reproduced below.',
  ''
]
for (const p of all) {
  notices.push('='.repeat(78), `${p.name}${p.version ? ` ${p.version}` : ''} — ${p.license}`, p.url ?? '', '='.repeat(78), p.text ?? '(See the project website for the full licence text.)', '')
}
writeFileSync(join(outDir, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'))
console.log(`Wrote ${all.length} licence entries to resources/licenses`)
