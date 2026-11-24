import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { generateAndroid } from '#brand/android'
import { checkBrandAssets } from '#brand/check'
import { brand, repositoryRoot, webFiles } from '#brand/config'
import { generateDesktop } from '#brand/desktop'
import { canonicalIcns, icoSizes, validateFiles, validateMaskable } from '#brand/validate'
import { generateWeb } from '#brand/web'
import sharp from 'sharp'

const files = await generateWeb(repositoryRoot)

/** The artwork master as authored, which the generated files are derived from. */
function master(name: 'mark' | 'mark-micro'): string {
  return readFileSync(join(repositoryRoot, 'assets/brand', `${name}.svg`), 'utf8')
}

/** The pixel a point in the master's user space lands on once it is drawn at `size` pixels. */
function pixelOf(source: string, size: number, x: number, y: number): [number, number] {
  const box = /viewBox="([\d.\s-]+)"/.exec(source)?.[1]?.trim().split(/\s+/).map(Number)
  if (box?.length !== 4) throw new Error('The master has no viewBox')
  const [minX, minY, width, height] = box
  return [Math.floor(((x - minX) / width) * size), Math.floor(((y - minY) / height) * size)]
}

/** The fill of the first element with this `data-part`. */
function partFill(source: string, part: string): string {
  const fill = new RegExp(`data-part="${part}"[^>]*fill="(#[0-9A-Fa-f]{6})"`).exec(source)?.[1]
  if (!fill) throw new Error(`The master has no ${part} fill`)
  return fill
}

function rgbaOf(hex: string): number[] {
  return [...Buffer.from(hex.slice(1), 'hex'), 255]
}

function file(name: string): Buffer {
  const bytes = files.get(name)
  if (!bytes) throw new Error(`Missing ${name}`)
  return bytes
}

describe('brand generation', () => {
  test('produces the web and docs contract, without taking ownership of the PWA manifest', async () => {
    await validateFiles(files, 'web')
    await validateFiles(files, 'docs')
    for (const name of webFiles) expect(files.has(name)).toBe(true)
    expect([...files.keys()].some((name) => name.endsWith('.webmanifest'))).toBe(false)
    expect(icoSizes(file('favicon.ico')).sort((a, b) => a - b)).toEqual([16, 32, 48])
  })

  test('draws the master polygon solid, with its open notch and margin transparent', async () => {
    // Points in the 100-unit master: both bands of the mark, the notch that opens to the left
    // between them, and the margin the owner's artwork leaves around it.
    const inside = [
      [50, 35],
      [50, 65]
    ] as const
    const notch = [30, 50] as const
    const margin = [
      [10, 10],
      [88, 88]
    ] as const
    for (const [name, size] of [
      ['mark', 256],
      ['mark-micro', 16],
      ['mark-micro', 32]
    ] as const) {
      const source = master(name)
      const pixels = await sharp(file(`brand/${name}.svg`), { density: (72 * size) / 16 })
        .resize(size, size)
        .ensureAlpha()
        .raw()
        .toBuffer()
      expect(pixels.length).toBe(size * size * 4)
      const alphaAt = ([x, y]: readonly [number, number]) => {
        const [px, py] = pixelOf(source, size, x, y)
        return pixels[(py * size + px) * 4 + 3]
      }
      for (const spot of inside) expect(alphaAt(spot)).toBe(255)
      for (const spot of margin) expect(alphaAt(spot)).toBe(0)
      // At 16px the notch is under two pixels tall; it still reads as a gap, not ink.
      if (size >= 32) expect(alphaAt(notch)).toBe(0)
      else expect(alphaAt(notch)).toBeLessThan(128)
    }
  })

  test('keeps the micro master the same polygon as the main master', () => {
    const path = (source: string) => /data-part="body"[^>]*\sd="([^"]+)"/.exec(source)?.[1]
    expect(path(master('mark-micro'))).toBe(path(master('mark')))
    expect(path(master('mark'))).toBeTruthy()
  })

  test('draws the mark in the master ink on light surfaces and white on dark ones', async () => {
    for (const name of ['mark', 'mark-micro'] as const) {
      const source = master(name)
      expect(partFill(source, 'body').toUpperCase()).toBe(brand.ink)
      for (const suffix of ['', '-dark']) {
        const pixels = await sharp(file(`brand/${name}${suffix}.svg`), { density: 1152 })
          .resize(256, 256)
          .ensureAlpha()
          .raw()
          .toBuffer()
        const [x, y] = pixelOf(source, 256, 50, 35)
        const offset = (y * 256 + x) * 4
        expect([...pixels.subarray(offset, offset + 4)]).toEqual(
          rgbaOf(suffix ? brand.paper : partFill(source, 'body'))
        )
      }
    }
    for (const [name, color] of [
      ['brand/mark-1024.png', brand.ink],
      ['brand/mark-dark-1024.png', brand.paper]
    ] as const) {
      const { data, info } = await sharp(file(name))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      expect([info.width, info.height]).toEqual([1024, 1024])
      expect(data[3]).toBe(0)
      const offset = (Math.round(0.35 * 1024) * 1024 + 512) * 4
      expect([...data.subarray(offset, offset + 4)]).toEqual(rgbaOf(color))
    }
  })

  test('keeps dark-mode favicon styling and separates light/dark UI artwork', () => {
    expect(file('brand/favicon.svg').toString()).toContain('prefers-color-scheme: dark')
    expect(file('brand/mark-dark.svg').equals(file('brand/mark.svg'))).toBe(false)
    expect(file('brand/mark-micro-dark.svg').equals(file('brand/mark-micro.svg'))).toBe(false)
  })

  test('keeps monochrome artwork flat: black for light surfaces, white for dark', async () => {
    for (const suffix of ['', '-dark']) {
      const pixels = await sharp(file(`brand/mark-mono${suffix}.svg`))
        .ensureAlpha()
        .raw()
        .toBuffer()
      const colors = new Set<string>()
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] === 255)
          colors.add(pixels.subarray(offset, offset + 3).toString('hex'))
      }
      expect(colors.size).toBeGreaterThan(0)
      const expected = Buffer.from((suffix ? brand.paper : brand.ink).slice(1), 'hex')
      for (const color of colors) {
        // Overlapping antialiased edges can round a channel down by one.
        expect(
          Buffer.from(color, 'hex').every((channel, i) => Math.abs(channel - expected[i]) <= 1)
        ).toBe(true)
      }
    }
  })

  test('shares the peach rounded tile, with the black mark, across profile and any-purpose PWA assets', async () => {
    const peach = rgbaOf(brand.background)
    for (const [name, size] of [
      ['brand/app-icon-1024.png', 1024],
      ['brand/favicon-96x96.png', 96],
      ['brand/pwa-192.png', 192],
      ['brand/pwa-512.png', 512]
    ] as const) {
      const { data, info } = await sharp(file(name))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      expect([info.width, info.height]).toEqual([size, size])
      expect(data[3]).toBe(0)
      // No desktop-style inset: the peach reaches the midpoint of each edge.
      for (const [x, y] of [
        [size / 2, 0],
        [0, size / 2],
        [size - 1, size / 2],
        [size / 2, size - 1]
      ]) {
        const edge = (y * size + x) * 4
        expect([...data.subarray(edge, edge + 4)]).toEqual(peach)
      }
      const offset = (Math.round((size * 80) / 1024) * size + size / 2) * 4
      expect([...data.subarray(offset, offset + 4)]).toEqual(peach)
      // The mark's upper band, in the ink, where the owner's artwork puts it.
      const ink = (Math.round(size * 0.36) * size + size / 2) * 4
      expect([...data.subarray(ink, ink + 4)]).toEqual(rgbaOf(brand.ink))
    }
    const svg = await sharp(file('brand/app-icon.svg')).ensureAlpha().raw().toBuffer()
    const png = await sharp(file('brand/app-icon-1024.png')).ensureAlpha().raw().toBuffer()
    expect(svg.equals(png)).toBe(true)
  })

  test('builds the Android adaptive icon as a black mark over the peach background', async () => {
    const android = await generateAndroid(repositoryRoot)
    await validateFiles(android, 'android')
    const background = android.get('values/ic_launcher_background.xml')?.toString() ?? ''
    expect(background).toContain(`<color name="ic_launcher_background">${brand.background}</color>`)
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = android.get(`mipmap-anydpi-v26/${name}`)?.toString() ?? ''
      expect(xml).toContain('@color/ic_launcher_background')
      expect(xml).toContain('@mipmap/ic_launcher_foreground')
    }
    const { data, info } = await sharp(android.get('mipmap-xxxhdpi/ic_launcher_foreground.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([432, 432])
    expect(data[3]).toBe(0)
    const center = (216 * 432 + 216) * 4
    const band = (Math.round(432 * (0.5 - 0.15 * brand.androidForegroundScale)) * 432 + 216) * 4
    expect(data[center + 3]).toBe(0)
    expect([...data.subarray(band, band + 4)]).toEqual(rgbaOf(brand.ink))
    // A foreground that fills the canvas leaves the safe zone and is rejected.
    const wrong = new Map(android)
    wrong.set(
      'mipmap-xxxhdpi/ic_launcher_foreground.png',
      await sharp(file('brand/pwa-512.png')).resize(432, 432).png().toBuffer()
    )
    await expect(validateFiles(wrong, 'android')).rejects.toThrow('safe zone')
  })

  test('rejects a transparent maskable icon', async () => {
    await expect(
      validateMaskable(await sharp(file('brand/mark.svg')).resize(512).png().toBuffer())
    ).rejects.toThrow('opaque')
  })

  test('rejects missing and wrong-size output', async () => {
    const missing = new Map(files)
    missing.delete('favicon.ico')
    await expect(validateFiles(missing, 'docs')).rejects.toThrow('Missing brand output')
    const wrong = new Map(files)
    wrong.set('apple-touch-icon.png', file('brand/pwa-512.png'))
    await expect(validateFiles(wrong, 'docs')).rejects.toThrow('apple-touch-icon.png')
  })

  test('validates native icon and StoreLogo dimensions', async () => {
    const desktop = await generateDesktop(repositoryRoot)
    await validateFiles(desktop, 'desktop')
    for (const name of ['icon.png', 'StoreLogo.png']) {
      const wrong = new Map(desktop)
      wrong.set(name, await sharp(file('brand/app-icon.svg')).resize(64, 64).png().toBuffer())
      await expect(validateFiles(wrong, 'desktop')).rejects.toThrow(name)
    }
  }, 30_000)

  test('web output is byte-reproducible across repeated adapter instances', async () => {
    await checkBrandAssets(repositoryRoot, ['web', 'android'])
  })

  test('normalizes ICNS frame ordering without changing frame bytes', () => {
    const chunk = (type: string) => {
      const buffer = Buffer.alloc(9)
      buffer.write(type)
      buffer.writeUInt32BE(9, 4)
      buffer[8] = 42
      return buffer
    }
    const a = chunk('ic07'),
      b = chunk('ic08')
    const header = Buffer.alloc(8)
    header.write('icns')
    header.writeUInt32BE(26, 4)
    expect(canonicalIcns(Buffer.concat([header, b, a]))).toEqual(Buffer.concat([header, a, b]))
    expect(() => canonicalIcns(Buffer.from('icns'))).toThrow('header')
    const bad = Buffer.concat([header, a, b])
    bad.writeUInt32BE(0, 12)
    expect(() => canonicalIcns(bad)).toThrow('chunk length')
  })

  test('rejects ICO frames that point outside their container', () => {
    const bad = Buffer.from(file('favicon.ico'))
    bad.writeUInt32LE(bad.length, 18)
    expect(() => icoSizes(bad)).toThrow('bounds')
  })
})
