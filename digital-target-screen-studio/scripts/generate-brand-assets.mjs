#!/usr/bin/env node
/**
 * Generates every Digital Target brand asset from vector sources:
 *   - the triangle brand mark and the "DIGITAL TARGET" lockup (SVG, text outlined)
 *   - the application icon (PNG sizes + multi-resolution .ico)
 *   - tray icons (idle / recording)
 *   - NSIS installer sidebar and header bitmaps
 *
 * To use an official logo file instead, replace the SVGs in resources/brand/
 * (keep the file names) and run `npm run brand` again.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = {
  brand: join(root, 'resources', 'brand'),
  build: join(root, 'build'),
  web: join(root, 'src', 'renderer', 'src', 'assets', 'brand')
}
Object.values(out).forEach((d) => mkdirSync(d, { recursive: true }))

const PRIMARY = '#3C096C'
const SECONDARY = '#5A189A'
const ACCENT = '#E0AAFF'

// ---------------------------------------------------------------- geometry

/** Four right triangles (right angle top-right of each cell), as in the official logo. */
function markPath(x, y, size) {
  const c = size / 2
  const tri = (cx, cy) => `M${x + cx} ${y + cy}H${x + cx + c}V${y + cy + c}Z`
  return [tri(0, 0), tri(c, 0), tri(0, c), tri(c, c)].join('')
}

const fontBuf = readFileSync(join(root, 'node_modules/@fontsource/poppins/files/poppins-latin-700-normal.woff'))
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength))

function textPath(text, x, baseline, size, letterSpacing = 0) {
  let cursor = x
  const parts = []
  for (const ch of text) {
    const glyph = font.charToGlyph(ch)
    parts.push(glyph.getPath(cursor, baseline, size).toPathData(2))
    cursor += (glyph.advanceWidth / font.unitsPerEm) * size + letterSpacing
  }
  return { d: parts.join(''), width: cursor - x - letterSpacing }
}

// ---------------------------------------------------------------- SVG sources

const markWhite = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#FFFFFF" d="${markPath(0, 0, 100)}"/></svg>\n`
const markAccent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="${ACCENT}" d="${markPath(0, 0, 100)}"/></svg>\n`

function iconSvg({ rounded = true, padding = 0.24 } = {}) {
  const s = 1024
  const p = Math.round(s * padding)
  const r = rounded ? Math.round(s * 0.22) : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${SECONDARY}"/>
      <stop offset="1" stop-color="${PRIMARY}"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
  <rect x="6" y="6" width="${s - 12}" height="${s - 12}" rx="${Math.max(0, r - 6)}" fill="none" stroke="${ACCENT}" stroke-opacity="0.18" stroke-width="12"/>
  <path fill="#FFFFFF" d="${markPath(p, p, s - 2 * p)}"/>
</svg>
`
}

/** Mark + two-line wordmark, matching the official lockup proportions. */
function lockupSvg({ background }) {
  const markSize = 338
  const fontSize = 152
  const l1 = textPath('DIGITAL', 0, 0, fontSize, 4)
  const l2 = textPath('TARGET', 0, 0, fontSize, 4)
  const gap = 78
  const textX = markSize + gap
  const width = textX + Math.max(l1.width, l2.width)
  const pad = background ? 120 : 0
  const W = Math.ceil(width + pad * 2)
  const H = markSize + pad * 2
  const line1 = textPath('DIGITAL', pad + textX, pad + 136, fontSize, 4)
  const line2 = textPath('TARGET', pad + textX, pad + 300, fontSize, 4)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  ${background ? `<rect width="${W}" height="${H}" fill="${PRIMARY}"/>` : ''}
  <path fill="#FFFFFF" d="${markPath(pad, pad, markSize)}"/>
  <path fill="#FFFFFF" d="${line1.d}"/>
  <path fill="#FFFFFF" d="${line2.d}"/>
</svg>
`
}

const files = {
  'mark-white.svg': markWhite,
  'mark-accent.svg': markAccent,
  'app-icon.svg': iconSvg(),
  'logo-lockup-white.svg': lockupSvg({ background: false }),
  'logo-lockup.svg': lockupSvg({ background: true })
}
for (const [name, svg] of Object.entries(files)) {
  writeFileSync(join(out.brand, name), svg)
  writeFileSync(join(out.web, name), svg)
}

// ---------------------------------------------------------------- rasterising

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' }).render().asPng()
}

function rgba(svg, width) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render()
  return { width: r.width, height: r.height, pixels: Buffer.from(r.pixels) }
}

const icon = iconSvg()
// Small sizes use a square icon with less padding so the mark stays legible.
const iconSmall = iconSvg({ rounded: true, padding: 0.17 })
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  writeFileSync(join(out.brand, `icon-${size}.png`), png(size <= 48 ? iconSmall : icon, size))
}
writeFileSync(join(out.build, 'icon.png'), png(icon, 1024))

/** Multi-resolution Windows .ico with PNG-compressed entries (Vista+). */
function ico(sizes) {
  const images = sizes.map((s) => png(s <= 48 ? iconSmall : icon, s))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach((img, i) => {
    const s = sizes[i]
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16)
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16 + 1)
    dir.writeUInt8(0, i * 16 + 2)
    dir.writeUInt8(0, i * 16 + 3)
    dir.writeUInt16LE(1, i * 16 + 4)
    dir.writeUInt16LE(32, i * 16 + 6)
    dir.writeUInt32LE(img.length, i * 16 + 8)
    dir.writeUInt32LE(offset, i * 16 + 12)
    offset += img.length
  })
  return Buffer.concat([header, dir, ...images])
}
const icoBuf = ico([16, 20, 24, 32, 40, 48, 64, 128, 256])
writeFileSync(join(out.brand, 'icon.ico'), icoBuf)
writeFileSync(join(out.build, 'icon.ico'), icoBuf)

// Tray icons (32 px, downscaled by Windows to 16/20/24 as needed).
const traySvg = iconSvg({ rounded: true, padding: 0.16 })
writeFileSync(join(out.brand, 'tray.png'), png(traySvg, 32))
const trayRec = traySvg.replace('</svg>', `<circle cx="790" cy="790" r="210" fill="#FF3B5C" stroke="#FFFFFF" stroke-width="56"/></svg>`)
writeFileSync(join(out.brand, 'tray-recording.png'), png(trayRec, 32))

// ---------------------------------------------------------------- installer bitmaps (24-bit BMP)

function bmp24({ width, height, pixels }) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const size = 54 + rowSize * height
  const b = Buffer.alloc(size)
  b.write('BM', 0)
  b.writeUInt32LE(size, 2)
  b.writeUInt32LE(54, 10)
  b.writeUInt32LE(40, 14)
  b.writeInt32LE(width, 18)
  b.writeInt32LE(height, 22)
  b.writeUInt16LE(1, 26)
  b.writeUInt16LE(24, 28)
  b.writeUInt32LE(rowSize * height, 34)
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = pixels[i + 3] / 255
      // Composite on the primary purple (images have no alpha in BMP).
      const bg = [0x3c, 0x09, 0x6c]
      b[row + x * 3] = Math.round(pixels[i + 2] * a + bg[2] * (1 - a))
      b[row + x * 3 + 1] = Math.round(pixels[i + 1] * a + bg[1] * (1 - a))
      b[row + x * 3 + 2] = Math.round(pixels[i] * a + bg[0] * (1 - a))
    }
  }
  return b
}

const sidebarText1 = textPath('DIGITAL', 0, 0, 30, 1)
const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 314" width="164" height="314">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SECONDARY}"/><stop offset="1" stop-color="#240046"/></linearGradient></defs>
  <rect width="164" height="314" fill="url(#g)"/>
  <path fill="#FFFFFF" d="${markPath(52, 70, 60)}"/>
  <path fill="#FFFFFF" d="${textPath('DIGITAL', (164 - sidebarText1.width) / 2, 170, 30, 1).d}"/>
  <path fill="#FFFFFF" d="${textPath('TARGET', (164 - textPath('TARGET', 0, 0, 30, 1).width) / 2, 204, 30, 1).d}"/>
  <path fill="${ACCENT}" d="${textPath('Screen Studio', (164 - textPath('Screen Studio', 0, 0, 15, 0.5).width) / 2, 240, 15, 0.5).d}"/>
</svg>`
writeFileSync(join(out.build, 'installerSidebar.bmp'), bmp24(rgba(sidebarSvg, 164)))
writeFileSync(join(out.build, 'uninstallerSidebar.bmp'), bmp24(rgba(sidebarSvg, 164)))

const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 57" width="150" height="57">
  <rect width="150" height="57" fill="${PRIMARY}"/>
  <path fill="#FFFFFF" d="${markPath(10, 13, 31)}"/>
  <path fill="#FFFFFF" d="${textPath('DIGITAL', 52, 27, 14, 0.5).d}"/>
  <path fill="#FFFFFF" d="${textPath('TARGET', 52, 44, 14, 0.5).d}"/>
</svg>`
writeFileSync(join(out.build, 'installerHeader.bmp'), bmp24(rgba(headerSvg, 150)))

console.log('Brand assets generated in resources/brand, build/ and src/renderer/src/assets/brand')
