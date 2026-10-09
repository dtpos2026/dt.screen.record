import { expect, test, type Page } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  filesIn,
  hasCommand,
  imageInfo,
  isLinux,
  launch,
  multiMonitor,
  probe,
  recordFor,
  setSettings,
  state,
  volumeDetect,
  waitFor,
  waitForStatus,
  type Launched
} from './helpers'

test.describe.configure({ mode: 'serial' })

let L: Launched
let page: Page

test.beforeAll(async () => {
  L = await launch()
  page = L.page
})

test.afterAll(async () => {
  await L?.app.close().catch(() => undefined)
})

test('main window loads, all pages render without errors', async () => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const name of ['Screen Recorder', 'Screenshot Tool', 'Media Library', 'Settings', 'About Digital Target', 'Dashboard']) {
    await page.getByRole('button', { name }).first().click()
    await expect(page.locator('.titlebar h1')).toHaveText(name === 'About Digital Target' ? 'About Digital Target' : name)
  }
  await page.getByRole('button', { name: 'About Digital Target' }).first().click()
  await expect(page.getByText('Version 1.0.0').first()).toBeVisible()
  await expect(page.locator('.license-list tbody tr')).not.toHaveCount(0)
  expect(errors).toEqual([])
  const info = await page.evaluate(() => window.dt.invoke('app:info'))
  expect(info.name).toBe('Digital Target Screen Studio')
  expect(info.company).toBe('Digital Target')
})

test('IPC rejects invalid payloads', async () => {
  const err = await page.evaluate(() => window.dt.invoke('library:rename', { path: 42 } as never).then(() => 'ok', (e: Error) => e.message))
  expect(err).toContain('Invalid request')
  const blocked = await page.evaluate(() => (window.dt.invoke as (c: string) => Promise<unknown>)('not:a:channel').then(() => 'ok', (e: Error) => e.message))
  expect(blocked).toContain('Blocked IPC channel')
})

test('full-screen recording with microphone, pause and resume produces a valid MP4', async () => {
  await setSettings(page, { audio: { microphone: true, systemAudio: false }, recording: { sourceMode: 'display', resolution: 'native' } })
  const r = await page.evaluate(() => window.dt.invoke('recording:start'))
  expect(r.ok).toBe(true)
  await waitForStatus(page, 'recording')
  await page.waitForTimeout(2500)
  await page.evaluate(() => window.dt.invoke('recording:pause'))
  expect((await state(page)).status).toBe('paused')
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.dt.invoke('recording:resume'))
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.dt.invoke('recording:stop'))
  const s = await waitForStatus(page, 'idle', 90_000)
  expect(s.lastError).toBeNull()
  expect(s.lastSavedPath).toMatch(/DT-Recording_.*\.mp4$/)
  const p = probe(s.lastSavedPath!)
  expect(p.video?.codec).toBe('h264')
  expect(p.audio?.codec).toBe('aac')
  expect(p.audio?.sampleRate).toBe(48000)
  expect(p.audio?.channels).toBe(2)
  // 2.5 s + 2 s recorded; the 2 s pause must not be in the file.
  expect(p.duration).toBeGreaterThan(3.8)
  expect(p.duration).toBeLessThan(5.6)
  const vol = volumeDetect(s.lastSavedPath!)
  expect(vol.max).toBeGreaterThan(-30)
  expect(vol.max).toBeLessThanOrEqual(0)
  // No temporary files are left behind.
  expect(filesIn(L.outDir, /\.part$/)).toEqual([])
  expect(filesIn(join(L.outDir, '.dt-in-progress'), /\.webm$/)).toEqual([])
})

test('duration limit stops and saves automatically', async () => {
  await setSettings(page, { audio: { microphone: false }, recording: { durationLimitSeconds: 3, resolution: '720' } })
  const r = await page.evaluate(() => window.dt.invoke('recording:start'))
  expect(r.ok).toBe(true)
  const s0 = await waitForStatus(page, 'recording')
  expect(s0.limitMs).toBe(3000)
  const s = await waitForStatus(page, 'idle', 30_000)
  const p = probe(s.lastSavedPath!)
  expect(p.duration).toBeGreaterThan(2.4)
  expect(p.duration).toBeLessThan(4)
  expect(p.video?.height).toBe(720)
  expect(p.audio).toBeUndefined()
  await setSettings(page, { recording: { durationLimitSeconds: 0, resolution: 'native' } })
})

test('WebM output keeps VP9 without conversion', async () => {
  await setSettings(page, { recording: { outputFormat: 'webm' } })
  const { path } = await recordFor(page, 2000)
  expect(path).toMatch(/\.webm$/)
  const p = probe(path)
  expect(['vp9', 'vp8']).toContain(p.video?.codec)
  expect(p.duration).toBeGreaterThan(1.2)
  await setSettings(page, { recording: { outputFormat: 'mp4' } })
})

test('custom region recording via the selection overlay', async () => {
  const pending = page.evaluate(() => window.dt.invoke('recording:selectRegion', {}))
  const overlay = await waitFor(() => L.app.windows().find((w) => w.url().includes('overlay.html')), 15_000, 'overlay')
  await overlay.waitForLoadState('domcontentloaded')
  await overlay.waitForTimeout(400)
  await overlay.mouse.move(200, 150)
  await overlay.mouse.down()
  await overlay.mouse.move(840, 510, { steps: 10 })
  await overlay.mouse.up()
  await expect(overlay.locator('.ov-size')).toHaveText(/640 × 360/)
  // The overlay closes on key-down, so only send that half of the key press.
  await overlay.keyboard.down('Enter').catch(() => undefined)
  const sel = await pending
  expect(sel.ok && sel.value?.rect.width).toBe(640)
  const { path, state: s } = await recordFor(page, 2000)
  expect(s.lastError).toBeNull()
  const p = probe(path)
  expect(p.video).toMatchObject({ width: 640, height: 360 })
  await setSettings(page, { recording: { sourceMode: 'display', region: null } })
})

test('window recording and window screenshot', async () => {
  test.skip(!isLinux || !hasCommand('xclock'), 'needs a second application window')
  const windows = await page.evaluate(() => window.dt.invoke('capture:windows'))
  const clock = windows.find((w) => w.name.toLowerCase().includes('xclock'))
  test.skip(!clock, 'xclock window not available')
  const shot = await page.evaluate((id) => window.dt.invoke('screenshot:capture', { mode: 'window', windowId: id }), clock!.id)
  expect(shot.ok).toBe(true)
  if (shot.ok && shot.value) {
    expect(shot.value.width).toBeGreaterThan(300)
    expect(shot.value.width).toBeLessThan(500)
  }
  await setSettings(page, { recording: { sourceMode: 'window' } })
  await page.evaluate((w) => window.dt.invoke('recording:selectWindow', { sourceId: w.id, name: w.name }), clock!)
  const { path } = await recordFor(page, 2000)
  const p = probe(path)
  expect(p.video!.width).toBeGreaterThan(300)
  expect(p.video!.width).toBeLessThan(500)
  expect(p.video!.width % 2).toBe(0)
  await setSettings(page, { recording: { sourceMode: 'display' } })
})

test('full-screen screenshot at native resolution in PNG, JPEG and WebP', async () => {
  const displays = await page.evaluate(() => window.dt.invoke('capture:displays', {}))
  const primary = displays.find((d) => d.isPrimary)!
  const shot = await page.evaluate((id) => window.dt.invoke('screenshot:capture', { mode: 'display', displayId: id }), primary.id)
  expect(shot.ok).toBe(true)
  const cap = shot.ok ? shot.value! : null
  expect(cap).toMatchObject({ width: primary.physicalSize.width, height: primary.physicalSize.height })
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const saved = await page.evaluate(({ id, format }) => window.dt.invoke('screenshot:save', { captureId: id, target: 'auto', format, quality: 90 }), { id: cap!.id, format })
    expect(saved.ok).toBe(true)
    const file = saved.ok ? saved.value! : ''
    const info = imageInfo(file)
    expect(info).toEqual({ type: format, width: primary.physicalSize.width, height: primary.physicalSize.height })
  }
  const copied = await page.evaluate((id) => window.dt.invoke('screenshot:copy', { captureId: id }), cap!.id)
  expect(copied.ok).toBe(true)
  const clipSize = await L.app.evaluate(async ({ clipboard }) => {
    const items = await clipboard.read()
    const item = items.find((i) => i.types.includes('image/png'))
    if (!item) return 0
    const blob = (await item.getType('image/png')) as Blob
    return blob.size
  })
  expect(clipSize).toBeGreaterThan(1000)
})

test('region screenshot via the overlay crops at native pixels', async () => {
  const pending = page.evaluate(() => window.dt.invoke('screenshot:capture', { mode: 'region' }))
  const overlay = await waitFor(() => L.app.windows().find((w) => w.url().includes('overlay.html')), 15_000, 'overlay')
  await overlay.waitForLoadState('domcontentloaded')
  await overlay.waitForTimeout(500)
  await overlay.mouse.move(100, 100)
  await overlay.mouse.down()
  await overlay.mouse.move(500, 400, { steps: 8 })
  await overlay.mouse.up()
  await overlay.keyboard.down('Enter').catch(() => undefined)
  const r = await pending
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.value).toMatchObject({ width: 400, height: 300 })
})

test('screenshot editor: annotate, crop and save a copy', async () => {
  const shot = await page.evaluate(() => window.dt.invoke('screenshot:capture', { mode: 'fullscreen' }))
  expect(shot.ok).toBe(true)
  await page.getByRole('button', { name: 'Screenshot Tool' }).first().click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const canvas = page.locator('.editor-stage canvas')
  await expect(canvas).toBeVisible()
  // Wait until the layout is stable before using screen coordinates.
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await canvas.boundingBox())
    const stable = now === last
    last = now
    return stable
  }).toBe(true)
  const b = (await canvas.boundingBox())!
  // Rectangle
  await page.keyboard.press('r')
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.1)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.4, { steps: 5 })
  await page.mouse.up()
  // Text
  await page.keyboard.press('t')
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5)
  await page.keyboard.type('Digital Target')
  await page.keyboard.press('Enter')
  await expect(page.locator('.text-editor')).toHaveCount(0)
  // Undo / redo of the text annotation
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
  await page.getByRole('button', { name: 'Redo (Ctrl+Y)' }).click()
  // Crop to half the image (measure again in case the stage resized)
  await page.keyboard.press('c')
  const c = (await canvas.boundingBox())!
  expect(Math.abs(c.width - b.width)).toBeLessThan(1)
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Apply crop' }).click()
  const before = new Set(filesIn(L.outDir, /\.png$/))
  await page.getByRole('button', { name: 'Save copy' }).click()
  const file = await waitFor(() => filesIn(L.outDir, /\.png$/).find((f) => !before.has(f)), 15_000, 'saved edit')
  const info = imageInfo(file)
  const cap = shot.ok ? shot.value! : null
  expect(Math.abs(info.width - cap!.width / 2)).toBeLessThanOrEqual(10)
  expect(Math.abs(info.height - cap!.height / 2)).toBeLessThanOrEqual(10)
})

test('multi-monitor: per-display and combined captures', async () => {
  const displays = await page.evaluate(() => window.dt.invoke('capture:displays', {}))
  test.skip(!multiMonitor || displays.length < 2, 'needs two monitors')
  const second = displays.find((d) => !d.isPrimary)!
  const shot = await page.evaluate((id) => window.dt.invoke('screenshot:capture', { mode: 'display', displayId: id }), second.id)
  expect(shot.ok && shot.value).toMatchObject({ width: second.physicalSize.width, height: second.physicalSize.height })
  const all = await page.evaluate(() => window.dt.invoke('screenshot:capture', { mode: 'all-displays' }))
  const right = Math.max(...displays.map((d) => d.physicalOrigin.x + d.physicalSize.width)) - Math.min(...displays.map((d) => d.physicalOrigin.x))
  const bottom = Math.max(...displays.map((d) => d.physicalOrigin.y + d.physicalSize.height)) - Math.min(...displays.map((d) => d.physicalOrigin.y))
  expect(all.ok && all.value).toMatchObject({ width: right, height: bottom })

  await setSettings(page, { recording: { sourceMode: 'display', displayId: second.id, resolution: 'native' } })
  const one = await recordFor(page, 2000)
  expect(probe(one.path).video).toMatchObject({ width: second.physicalSize.width, height: second.physicalSize.height })

  await setSettings(page, { recording: { sourceMode: 'all-displays' } })
  const combined = await recordFor(page, 2000)
  expect(probe(combined.path).video).toMatchObject({ width: right, height: bottom })
  await setSettings(page, { recording: { sourceMode: 'display', displayId: '' } })
})

test('system audio is captured from the playback device', async () => {
  test.skip(!isLinux || !hasCommand('pactl'), 'covered by the real-audio run on Linux')
  // Separate launch without Chromium's fake devices so real PulseAudio loopback is used.
  execFileSync('pactl', ['set-source-volume', 'dtsink.monitor', '100%'])
  const R = await launch({ env: { DT_E2E_REAL_AUDIO: '1' }, settings: { audio: { systemAudio: true, microphone: false } } })
  try {
    const r = await R.page.evaluate(() => window.dt.invoke('recording:start'))
    expect(r.ok).toBe(true)
    await waitForStatus(R.page, 'recording')
    const tone = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=48000', '-f', 'pulse', '-device', 'dtsink', 'dt-e2e-tone'])
    await new Promise((res) => tone.on('close', res))
    await R.page.evaluate(() => window.dt.invoke('recording:stop'))
    const s = await waitForStatus(R.page, 'idle', 60_000)
    const p = probe(s.lastSavedPath!)
    expect(p.audio?.codec).toBe('aac')
    const vol = volumeDetect(s.lastSavedPath!)
    expect(vol.max).toBeGreaterThan(-20)
    // Capturing must not have changed the playback device's capture volume.
    expect(execFileSync('pactl', ['get-source-volume', 'dtsink.monitor']).toString()).toContain('100%')
  } finally {
    await R.app.close()
  }
})

test('floating toolbar starts and stops a recording', async () => {
  await page.evaluate(() => window.dt.invoke('toolbar:toggle', { visible: true }))
  const tb = await waitFor(() => L.app.windows().find((w) => w.url().includes('toolbar.html')), 15_000, 'toolbar')
  await tb.waitForLoadState('domcontentloaded')
  await tb.getByRole('button', { name: 'Start recording' }).click()
  await waitForStatus(page, 'recording')
  await expect(tb.locator('.tb-label')).toHaveText('REC')
  await page.waitForTimeout(1500)
  await tb.getByRole('button', { name: 'Pause recording' }).click()
  await waitForStatus(page, 'paused')
  await tb.getByRole('button', { name: 'Resume recording' }).click()
  await waitForStatus(page, 'recording')
  await tb.getByRole('button', { name: 'Stop and save' }).click()
  const s = await waitForStatus(page, 'idle', 60_000)
  expect(existsSync(s.lastSavedPath!)).toBe(true)
  await page.evaluate(() => window.dt.invoke('toolbar:toggle', { visible: false }))
})

test('floating toolbar takes screenshots and follows the theme', async () => {
  await setSettings(page, { screenshot: { showPreview: false, format: 'png', delaySeconds: 0 }, general: { theme: 'light' } })
  await page.evaluate(() => window.dt.invoke('toolbar:toggle', { visible: true }))
  const tb = await waitFor(() => L.app.windows().find((w) => w.url().includes('toolbar.html')), 15_000, 'toolbar')
  await tb.waitForLoadState('domcontentloaded')
  await expect(tb.locator('html')).toHaveAttribute('data-theme', 'light')
  for (const name of ['Region screenshot', 'Full-screen screenshot', 'Window screenshot', 'Screenshot options', 'Open library', 'Open settings', 'Hide toolbar']) {
    await expect(tb.getByRole('button', { name })).toBeVisible()
  }
  // Every control fits inside the toolbar window.
  const overflow = await tb.evaluate(() => {
    const bar = document.querySelector('.tb')!.getBoundingClientRect()
    return [...document.querySelectorAll('.tb-actions > *')].filter((el) => el.getBoundingClientRect().right > bar.right + 0.5).length
  })
  expect(overflow).toBe(0)

  const before = new Set(filesIn(L.outDir, /DT-Screenshot.*\.png$/))
  await tb.getByRole('button', { name: 'Full-screen screenshot' }).click()
  const file = await waitFor(() => filesIn(L.outDir, /DT-Screenshot.*\.png$/).find((f) => !before.has(f)), 20_000, 'toolbar screenshot')
  // Full screen = the display under the pointer, at its native size.
  const sizes = (await page.evaluate(() => window.dt.invoke('capture:displays', {}))).map((d) => `${d.physicalSize.width}x${d.physicalSize.height}`)
  const img = imageInfo(file)
  expect(img.type).toBe('png')
  expect(sizes).toContain(`${img.width}x${img.height}`)

  // Region: the selection overlay opens; Escape cancels without saving anything.
  const count = filesIn(L.outDir, /DT-Screenshot/).length
  await tb.getByRole('button', { name: 'Region screenshot' }).click()
  const overlay = await waitFor(() => L.app.windows().find((w) => w.url().includes('overlay.html')), 15_000, 'overlay')
  await overlay.waitForLoadState('domcontentloaded')
  await overlay.waitForTimeout(500)
  // The overlay listens for keys once React has mounted; repeat Escape until it closes.
  await waitFor(async () => {
    const open = L.app.windows().filter((w) => w.url().includes('overlay.html'))
    if (!open.length) return true
    await open[0].keyboard.press('Escape').catch(() => undefined)
    return undefined
  }, 15_000, 'overlay closed')
  expect(filesIn(L.outDir, /DT-Screenshot/).length).toBe(count)

  // The countdown chosen in the toolbar menu is shown on the toolbar.
  await setSettings(page, { screenshot: { delaySeconds: 3 } })
  await expect(tb.locator('.tb-delay')).toHaveText('3s')
  await setSettings(page, { screenshot: { delaySeconds: 0, showPreview: true }, general: { theme: 'dark' } })
  await expect(tb.locator('html')).toHaveAttribute('data-theme', 'dark')
  await tb.getByRole('button', { name: 'Open library' }).click()
  await expect(page.locator('.titlebar h1')).toHaveText('Media Library')
  await page.evaluate(() => window.dt.invoke('toolbar:toggle', { visible: false }))
})

test('light, dark and system themes apply across the app', async () => {
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
  const sw = page.getByRole('radiogroup', { name: 'Theme' }).first()
  await sw.getByRole('radio', { name: 'Light' }).click()
  await expect.poll(theme).toBe('light')
  expect(await bg()).toBe('rgb(246, 243, 251)')
  expect((await page.evaluate(() => window.dt.invoke('settings:get'))).general.theme).toBe('light')
  // Text stays readable on the light background (WCAG AA, 4.5:1).
  const contrast = await page.evaluate(() => {
    const lum = (c: string) => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map((v) => {
        const x = Number(v) / 255
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const bgL = lum(getComputedStyle(document.body).backgroundColor)
    return ['.titlebar h1', '.nav-item', '.sidebar-version'].map((sel) => {
      const l = lum(getComputedStyle(document.querySelector(sel)!).color)
      return (Math.max(l, bgL) + 0.05) / (Math.min(l, bgL) + 0.05)
    })
  })
  for (const ratio of contrast) expect(ratio).toBeGreaterThan(4.5)

  await sw.getByRole('radio', { name: 'Dark' }).click()
  await expect.poll(theme).toBe('dark')
  expect(await bg()).toBe('rgb(13, 7, 23)')

  // System follows the operating system's light/dark preference.
  await sw.getByRole('radio', { name: 'System' }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(theme).toBe('light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(theme).toBe('dark')
  await page.emulateMedia({ colorScheme: null })

  // Settings page offers all four themes, including Midnight.
  await page.getByRole('button', { name: 'Settings' }).first().click()
  const picker = page.locator('.content').getByRole('radiogroup', { name: 'Theme' })
  await picker.getByRole('radio', { name: 'Midnight' }).click()
  await expect.poll(theme).toBe('midnight')
  expect(await bg()).toBe('rgb(6, 3, 12)')
  await picker.getByRole('radio', { name: 'Dark', exact: true }).click()
  await expect.poll(theme).toBe('dark')
  await page.getByRole('button', { name: 'Dashboard' }).first().click()
})

test('global shortcut takes a full-screen screenshot', async () => {
  test.skip(!isLinux || !hasCommand('xdotool'), 'needs xdotool')
  await setSettings(page, { screenshot: { showPreview: false, format: 'png' } })
  const before = new Set(filesIn(L.outDir, /^.*DT-Screenshot.*\.png$/))
  execFileSync('xdotool', ['key', '--clearmodifiers', 'alt+shift+f'])
  const file = await waitFor(() => filesIn(L.outDir, /DT-Screenshot.*\.png$/).find((f) => !before.has(f)), 20_000, 'shortcut screenshot')
  expect(imageInfo(file).type).toBe('png')
  await setSettings(page, { screenshot: { showPreview: true } })
})

test('webcam overlay opens with the selected camera', async () => {
  await setSettings(page, { webcam: { enabled: true, shape: 'circle', size: 200 } })
  const cam = await waitFor(() => L.app.windows().find((w) => w.url().includes('webcam.html')), 15_000, 'webcam window')
  await cam.waitForLoadState('domcontentloaded')
  await expect.poll(() => cam.evaluate(() => document.querySelector('video')?.videoWidth ?? 0), { timeout: 15_000 }).toBeGreaterThan(0)
  await setSettings(page, { webcam: { enabled: false } })
  await expect.poll(() => L.app.windows().some((w) => w.url().includes('webcam.html'))).toBe(false)
})

test('media library lists, renames, exports and deletes', async () => {
  const items = await page.evaluate(() => window.dt.invoke('library:list'))
  const video = items.find((i) => i.kind === 'video' && i.ext === '.mp4')!
  expect(video.durationSec).toBeGreaterThan(0)
  expect(video.width).toBeGreaterThan(0)
  expect(items.some((i) => i.kind === 'image')).toBe(true)
  const thumb = await page.evaluate((p) => window.dt.invoke('library:thumbnail', { path: p }), video.path)
  expect(thumb).toMatch(/^dtmedia:\/\//)

  const renamed = await page.evaluate((p) => window.dt.invoke('library:rename', { path: p, newName: 'Product demo' }), video.path)
  expect(renamed.ok).toBe(true)
  const newPath = renamed.ok ? renamed.value.path : ''
  expect(basename(newPath)).toBe('Product demo.mp4')
  expect(existsSync(video.path)).toBe(false)
  const bad = await page.evaluate((p) => window.dt.invoke('library:rename', { path: p, newName: '../evil' }), newPath)
  expect(bad.ok).toBe(false)

  const done = page.evaluate(
    () => new Promise<{ status: string; outputPath?: string }>((resolve) => window.dt.on('export:progress', (p) => (p.status === 'done' || p.status === 'error') && resolve(p)))
  )
  const job = await page.evaluate((p) => window.dt.invoke('export:start', { path: p, options: { resolution: '480', fps: 24, quality: 'small', encoder: 'auto', audioBitrateKbps: 128, removeAudio: false } }), newPath)
  expect(job.ok).toBe(true)
  const result = await done
  expect(result.status).toBe('done')
  const ep = probe(result.outputPath!)
  expect(ep.video?.codec).toBe('h264')
  expect(ep.video?.height).toBe(480)
  expect(statSync(result.outputPath!).size).toBeLessThan(statSync(newPath).size * 2)

  const del = await page.evaluate((p) => window.dt.invoke('library:delete', { paths: [p] }), result.outputPath!)
  expect(del.ok && del.value.length).toBe(1)
  expect(existsSync(result.outputPath!)).toBe(false)

  // Paths outside the library are refused.
  const outside = await page.evaluate(() => window.dt.invoke('library:delete', { paths: ['/etc/hostname'] }))
  expect(outside.ok).toBe(false)
})

test('interrupted recording is recovered after a crash', async () => {
  const A = await launch({ settings: { audio: { microphone: true } } })
  const r = await A.page.evaluate(() => window.dt.invoke('recording:start'))
  expect(r.ok).toBe(true)
  await waitForStatus(A.page, 'recording')
  await A.page.waitForTimeout(3500)
  const proc = A.app.process()
  const exited = new Promise((res) => proc.once('exit', res))
  // Simulate the whole app dying. On Windows, end the full process tree like
  // Task Manager does; killing only the main process leaves helpers holding the profile.
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'])
  else proc.kill('SIGKILL')
  await exited
  // Let the killed instance's helper processes shut down (Windows keeps them a moment).
  await new Promise((res) => setTimeout(res, process.platform === 'win32' ? 4000 : 1000))
  const B = await launch({ userData: A.userData, outDir: A.outDir })
  try {
    const list = await B.page.evaluate(() => window.dt.invoke('recording:recoverable'))
    expect(list.length).toBe(1)
    const rec = await B.page.evaluate((id) => window.dt.invoke('recording:recover', { id }), list[0].id)
    expect(rec.ok).toBe(true)
    const p = probe(rec.ok ? rec.value : '')
    expect(p.video?.codec).toBe('h264')
    expect(p.duration).toBeGreaterThan(1.5)
    expect(await B.page.evaluate(() => window.dt.invoke('recording:recoverable'))).toEqual([])
  } finally {
    await B.app.close()
  }
})

test('countdown runs before recording and can be cancelled', async () => {
  await setSettings(page, { recording: { countdownSeconds: 3 } })
  const pending = page.evaluate(() => window.dt.invoke('recording:start'))
  await waitForStatus(page, 'countdown', 10_000)
  const cd = await waitFor(() => L.app.windows().find((w) => w.url().includes('countdown.html')), 10_000, 'countdown window')
  await expect(cd.locator('.cd-num')).toBeVisible()
  await page.evaluate(() => window.dt.invoke('recording:cancelCountdown'))
  const r = await pending
  expect(r.ok).toBe(true)
  expect((await state(page)).status).toBe('idle')

  await setSettings(page, { recording: { countdownSeconds: 2 } })
  const t0 = Date.now()
  const started = page.evaluate(() => window.dt.invoke('recording:start'))
  await waitForStatus(page, 'recording', 15_000)
  expect(Date.now() - t0).toBeGreaterThan(1800)
  await started
  await page.waitForTimeout(800)
  await page.evaluate(() => window.dt.invoke('recording:stop'))
  await waitForStatus(page, 'idle', 60_000)
  await setSettings(page, { recording: { countdownSeconds: 0 } })
})

test('discarding a recording asks for confirmation and keeps no file', async () => {
  const before = filesIn(L.outDir, /\.(mp4|webm|mkv)$/).length
  const r = await page.evaluate(() => window.dt.invoke('recording:start'))
  expect(r.ok).toBe(true)
  await waitForStatus(page, 'recording')
  await page.waitForTimeout(1500)
  const discarded = await page.evaluate(() => window.dt.invoke('recording:discard'))
  expect(discarded).toBe(true)
  await waitForStatus(page, 'idle')
  expect(filesIn(L.outDir, /\.(mp4|webm|mkv)$/).length).toBe(before)
  expect(filesIn(join(L.outDir, '.dt-in-progress'), /\.webm$/)).toEqual([])
})

test('screenshot delay waits before capturing', async () => {
  const t0 = Date.now()
  const r = await page.evaluate(() => window.dt.invoke('screenshot:capture', { mode: 'fullscreen', delaySeconds: 2 }))
  expect(r.ok).toBe(true)
  expect(Date.now() - t0).toBeGreaterThan(1900)
})

test('clear errors for an unusable save folder and a missing microphone', async () => {
  const blocker = join(L.outDir, 'not-a-folder.txt')
  writeFileSync(blocker, 'x')
  await setSettings(page, { general: { recordingsDir: join(blocker, 'sub') } })
  const r = await page.evaluate(() => window.dt.invoke('recording:start'))
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.code).toBe('INVALID_SAVE_LOCATION')
  await setSettings(page, { general: { recordingsDir: L.outDir }, audio: { microphone: true, micDeviceId: 'device-that-does-not-exist' } })
  const ok = await page.evaluate(() => window.dt.invoke('recording:start'))
  expect(ok.ok).toBe(true)
  const s = await waitForStatus(page, 'recording')
  expect(s.warnings.join(' ')).toContain('default microphone')
  await page.waitForTimeout(800)
  await page.evaluate(() => window.dt.invoke('recording:stop'))
  const done = await waitForStatus(page, 'idle', 60_000)
  expect(probe(done.lastSavedPath!).audio?.codec).toBe('aac')
  await setSettings(page, { audio: { microphone: false, micDeviceId: 'default' } })
})

test('settings persist across restarts', async () => {
  const A = await launch({ settings: { recording: { fps: 60, quality: 'ultra' }, screenshot: { format: 'webp' }, general: { theme: 'light' } } })
  await A.page.waitForTimeout(600)
  await A.app.close()
  const B = await launch({ userData: A.userData, outDir: A.outDir, keepSettings: true })
  try {
    const s = await B.page.evaluate(() => window.dt.invoke('settings:get'))
    expect(s.recording.fps).toBe(60)
    expect(s.recording.quality).toBe('ultra')
    expect(s.screenshot.format).toBe('webp')
    expect(s.general.theme).toBe('light')
    await expect.poll(() => B.page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
  } finally {
    await B.app.close()
  }
})
