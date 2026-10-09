import { describe, expect, it } from 'vitest'
import { computeOutputSize, computeVideoBitrate, denormalizeToFrame, encoderScale, fitContain, fitWithin, layoutDisplays, normalizeRegion, regionPhysicalSize } from '@shared/recording-math'

describe('computeOutputSize', () => {
  it('never upscales a 1080p source to 4K', () => {
    const r = computeOutputSize({ width: 1920, height: 1080 }, '2160')
    expect(r).toMatchObject({ width: 1920, height: 1080, limitedBySource: true })
  })
  it('downscales 4K to 1080p', () => {
    expect(computeOutputSize({ width: 3840, height: 2160 }, '1080')).toMatchObject({ width: 1920, height: 1080, limitedBySource: false })
  })
  it('records 4K natively', () => {
    expect(computeOutputSize({ width: 3840, height: 2160 }, 'native')).toMatchObject({ width: 3840, height: 2160 })
  })
  it('bounds the shorter side for ultrawide and portrait displays', () => {
    expect(computeOutputSize({ width: 3440, height: 1440 }, '1080')).toMatchObject({ width: 2580, height: 1080 })
    expect(computeOutputSize({ width: 1080, height: 1920 }, '720')).toMatchObject({ width: 720, height: 1280 })
  })
  it('keeps dimensions even', () => {
    const r = computeOutputSize({ width: 1366, height: 769 }, 'native')
    expect(r.width % 2).toBe(0)
    expect(r.height % 2).toBe(0)
  })
  it('applies encoder limits to 5K and multi-monitor canvases', () => {
    const r = computeOutputSize({ width: 5120, height: 2880 }, 'native')
    expect(r.limitedByEncoder).toBe(true)
    expect(r.width).toBeLessThanOrEqual(4096)
    expect(r.width * r.height).toBeLessThanOrEqual(4096 * 2304)
    expect(encoderScale(1920, 1080)).toBe(1)
  })
})

describe('bitrate', () => {
  it('scales with resolution and quality', () => {
    const hd = computeVideoBitrate({ width: 1920, height: 1080 }, 30, 'high')
    const uhd = computeVideoBitrate({ width: 3840, height: 2160 }, 30, 'high')
    expect(uhd).toBeGreaterThan(hd * 3)
    expect(computeVideoBitrate({ width: 1920, height: 1080 }, 30, 'standard')).toBeLessThan(hd)
    expect(computeVideoBitrate({ width: 1920, height: 1080 }, 30, 'custom', 25)).toBe(25_000_000)
  })
})

describe('regions', () => {
  const display = { bounds: { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 }
  it('normalises and clamps a DIP region', () => {
    expect(normalizeRegion({ x: 640, y: 360, width: 1000, height: 100 }, display)).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 100 / 720 })
  })
  it('maps to even physical pixels inside the frame', () => {
    const r = denormalizeToFrame({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, { width: 1920, height: 1080 })
    expect(r).toEqual({ x: 480, y: 270, width: 960, height: 540 })
    const edge = denormalizeToFrame({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, { width: 101, height: 101 })
    expect(edge.x + edge.width).toBeLessThanOrEqual(101)
    expect(edge.y + edge.height).toBeLessThanOrEqual(101)
  })
  it('converts DIP to physical size with display scaling', () => {
    expect(regionPhysicalSize({ x: 0, y: 0, width: 800, height: 600 }, display)).toEqual({ width: 1200, height: 900 })
  })
})

describe('layout', () => {
  it('places mixed-DPI monitors in physical pixels', () => {
    const l = layoutDisplays([
      { id: 'a', physicalOrigin: { x: 0, y: 0 }, physicalSize: { width: 3840, height: 2160 } },
      { id: 'b', physicalOrigin: { x: 3840, y: 540 }, physicalSize: { width: 1920, height: 1080 } }
    ])
    expect(l.canvas).toEqual({ width: 5760, height: 2160 })
    expect(l.placements[1].rect).toEqual({ x: 3840, y: 540, width: 1920, height: 1080 })
  })
  it('handles monitors left of / above the primary', () => {
    const l = layoutDisplays([
      { id: 'a', physicalOrigin: { x: 0, y: 0 }, physicalSize: { width: 1920, height: 1080 } },
      { id: 'b', physicalOrigin: { x: -1280, y: -200 }, physicalSize: { width: 1280, height: 1024 } }
    ])
    expect(l.placements[1].rect.x).toBe(0)
    expect(l.placements[0].rect).toEqual({ x: 1280, y: 200, width: 1920, height: 1080 })
  })
  it('fits and letterboxes', () => {
    expect(fitContain({ width: 1000, height: 500 }, { width: 800, height: 800 })).toEqual({ x: 0, y: 200, width: 800, height: 400 })
    expect(fitWithin({ width: 1000, height: 500 }, { width: 4000, height: 4000 })).toEqual({ width: 1000, height: 500 })
  })
})
