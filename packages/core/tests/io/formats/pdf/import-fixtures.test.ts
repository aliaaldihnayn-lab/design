import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expectDefined } from '#core-tests/helpers/assert'
import { FIXTURES, fontFixture } from '#core-tests/helpers/paths'

import { SkiaRenderer } from '@lawha/core/canvas'
import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import type { SceneGraph, SceneNode } from '@lawha/scene-graph'

import { getCanvasKit } from '#core/canvaskit'
import { installTextMeasurer } from '#core/layout/text-measurement'
import { fontManager } from '#core/text/font/manager'

/**
 * Real-world PDFs: `chromium-card.pdf` is Chromium's print of an HTML banner (subset CID fonts,
 * Type 3 fonts, shaped Arabic in visual order with ActualText spans, page clips around every
 * element, CSS transforms, gradients, a clipped image); `illustrator-box.ai` is written the way
 * Illustrator writes its PDF-compatible files (layers as optional content, a symbol as a form
 * XObject, clip groups, Identity-H TrueType subsets, tracking and horizontal scale, spot and
 * CMYK colours, a gradient through `sh`, a second artboard with an offset crop box). Their
 * generators are in `tests/fixtures/pdf/generators`.
 */
setDefaultTimeout(120_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)
let uninstall: (() => void) | null = null

beforeAll(async () => {
  const naskh = await fontFixture('NotoNaskhArabic-Regular.ttf')
  const inter = await fontFixture('InterVariable-Latin.ttf')
  await fontManager.markLoaded('Noto Naskh Arabic', 'Regular', naskh)
  for (const style of ['Regular', 'Bold'])
    for (const family of ['Inter', 'Free Sans', 'Liberation Serif'])
      await fontManager.markLoaded(family, style, inter)
  // Text layers are measured as the app measures them, with CanvasKit and the loaded fonts.
  const ck = await getCanvasKit()
  const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1), 'surface'))
  await renderer.loadFonts()
  uninstall = installTextMeasurer((node, maxWidth) => renderer.measureTextNode(node, maxWidth))
})

afterAll(() => uninstall?.())

async function open(name: string): Promise<SceneGraph> {
  const data = new Uint8Array(await readFile(join(FIXTURES, 'pdf', name)))
  return (await io.readDocument({ name, data })).graph
}

function descendants(graph: SceneGraph, id: string): SceneNode[] {
  const node = graph.getNode(id)
  if (!node) return []
  return node.childIds.flatMap((child) => [
    expectDefined(graph.getNode(child)),
    ...descendants(graph, child)
  ])
}

function frames(graph: SceneGraph): SceneNode[] {
  return graph.getPages()[0].childIds.map((id) => expectDefined(graph.getNode(id)))
}

function texts(graph: SceneGraph, frame: SceneNode): SceneNode[] {
  return descendants(graph, frame.id).filter((node) => node.type === 'TEXT')
}

function textNode(graph: SceneGraph, frame: SceneNode, text: string): SceneNode {
  const found = texts(graph, frame).find((node) => node.text === text)
  return expectDefined(
    found,
    `text "${text}" among ${JSON.stringify(texts(graph, frame).map((n) => n.text))}`
  )
}

/** Bounds relative to the page frame. */
function boxIn(graph: SceneGraph, frame: SceneNode, node: SceneNode) {
  const box = graph.getAbsoluteBounds(node.id)
  return { ...box, x: box.x - frame.x, y: box.y - frame.y }
}

describe('a PDF Chromium printed', () => {
  test('shapes keep their size and place inside the clips around them', async () => {
    const graph = await open('chromium-card.pdf')
    const [card] = frames(graph)
    expect([Math.round(card.width), Math.round(card.height)]).toEqual([1221, 151])
    const red = descendants(graph, card.id).filter(
      (node) =>
        node.type === 'VECTOR' &&
        node.fills[0]?.type === 'SOLID' &&
        node.fills[0].color.r > 0.75 &&
        node.fills[0].color.g < 0.1
    )
    // The red panel fills the page's height; a clip applied twice once cut it to three quarters.
    const panel = expectDefined(red.find((node) => boxIn(graph, card, node).x < 1))
    const box = boxIn(graph, card, panel)
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([420, 151])
    // The thin curve stays inside the panel's clip.
    const curve = expectDefined(
      descendants(graph, card.id).find(
        (node) =>
          node.type === 'VECTOR' && node.strokes[0]?.color.r === 1 && node.fills.length === 0
      )
    )
    const curveBox = boxIn(graph, card, curve)
    expect(curveBox.x).toBeCloseTo(20, 0)
    expect(curveBox.y + curveBox.height).toBeLessThanOrEqual(151)
    expect(expectDefined(graph.getNode(expectDefined(curve.parentId))).name).toBe('Group')
  })

  test('gradients and the clipped image come in', async () => {
    const graph = await open('chromium-card.pdf')
    const [card, poster] = frames(graph)
    const linear = descendants(graph, card.id).find(
      (node) => node.fills[0]?.type === 'GRADIENT_LINEAR'
    )
    const stops = expectDefined(linear?.fills[0].gradientStops)
    expect(stops[0].color.r).toBeGreaterThan(0.75)
    expect(stops.at(-1)?.color.g).toBeGreaterThan(0.75)
    expect(
      descendants(graph, poster.id).some((node) => node.fills[0]?.type === 'GRADIENT_RADIAL')
    ).toBe(true)
    const image = expectDefined(
      descendants(graph, poster.id).find((node) => node.fills[0]?.type === 'IMAGE')
    )
    expect(image.type).toBe('RECTANGLE')
    const box = boxIn(graph, poster, image)
    expect([Math.round(box.x), Math.round(box.y)]).toEqual([20, 20])
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([360, 240])
    expect(graph.images.has(expectDefined(image.fills[0].imageHash))).toBe(true)
    // Its rounded clip comes with it.
    expect(expectDefined(graph.getNode(expectDefined(image.parentId))).name).toBe('Group')
  })

  test('letter-spaced Latin is one layer, its tracking kept and no spaces added', async () => {
    const graph = await open('chromium-card.pdf')
    const [card] = frames(graph)
    const word = textNode(graph, card, 'ALQIMMAC')
    expect(word.fontSize).toBeCloseTo(54, 0)
    expect(word.letterSpacing.value).toBeCloseTo(8, 1)
    expect(boxIn(graph, card, word).x).toBeCloseTo(30, 0)
  })

  test('shaped Arabic reads in logical order with its marks, its box where it is drawn', async () => {
    const graph = await open('chromium-card.pdf')
    const [card, poster] = frames(graph)
    // Dotless forms, ligatures and marks drawn apart come back as the letters they show.
    const name = textNode(graph, card, 'القِمَّة للمُقاوَلات')
    expect(name.textAlignHorizontal).toBe('RIGHT')
    const box = boxIn(graph, card, name)
    // Chromium drew it from x 553.5 to 730: the layer starts where the line starts, on the right.
    expect(box.x + box.width).toBeCloseTo(730, 0)
    expect(box.width).toBeCloseTo(176.5, -1)
    // Latin inside Arabic keeps its place, and Arabic-Indic digits their order.
    textNode(graph, card, 'شركة ALQIMMAC')
    textNode(graph, card, '٢٠٢٤')
    const lines = texts(graph, poster).filter((node) => /[؀-ۿ]/.test(node.text))
    expect(lines.map((node) => node.text)).toEqual([
      'نصٌّ عربيٌّ طويلٌ يلتفُّ على سطرين داخل',
      'الإطار مع English كلمات mixed.'
    ])
  })

  test('mirrored and turned text keeps its transform', async () => {
    const graph = await open('chromium-card.pdf')
    const [, poster] = frames(graph)
    const mirrored = textNode(graph, poster, 'MIRRORED')
    expect(Math.abs(mirrored.rotation) === 180 || mirrored.flipX).toBe(true)
    const turned = textNode(graph, poster, 'Rotated text')
    expect(turned.rotation).toBeCloseTo(90, 0)
  })
})

describe('an Illustrator file', () => {
  test('layers come in as groups named after them, a hidden layer hidden', async () => {
    const graph = await open('illustrator-box.ai')
    const [artboard] = frames(graph)
    const layers = artboard.childIds.map((id) => expectDefined(graph.getNode(id)))
    expect(layers.map((layer) => layer.name)).toEqual(['Background', 'Text', 'Guides'])
    expect(layers.map((layer) => layer.visible)).toEqual([true, true, false])
  })

  test('colours: a spot colour by its tint, CMYK, and a gradient filled through its clip', async () => {
    const graph = await open('illustrator-box.ai')
    const [artboard] = frames(graph)
    const nodes = descendants(graph, artboard.id)
    // PANTONE 185 C at full tint, through its CMYK alternate.
    const outline = expectDefined(
      nodes.find((node) => node.type === 'VECTOR' && node.strokes[0]?.weight === 3)
    )
    expect(outline.strokes[0].color.r).toBeGreaterThan(0.9)
    expect(outline.strokes[0].color.g).toBeLessThan(0.3)
    const gradient = expectDefined(nodes.find((node) => node.fills[0]?.type === 'GRADIENT_LINEAR'))
    // `sh` inside a clip fills the clip's own shape rather than a page-sized rectangle.
    const box = boxIn(graph, artboard, gradient)
    expect([Math.round(box.x), Math.round(box.width), Math.round(box.height)]).toEqual([
      930, 260, 100
    ])
  })

  test('text from Identity-H subsets: Arabic through ActualText, tracking with horizontal scale', async () => {
    const graph = await open('illustrator-box.ai')
    const [artboard] = frames(graph)
    for (const [text, right, width] of [
      ['القِمَّة للمُقاوَلات', 728, 176.5],
      ['لا إله إلا الله', 728, 87.7],
      ['شركة', 1180, 50.2]
    ] as const) {
      const node = textNode(graph, artboard, text)
      const box = boxIn(graph, artboard, node)
      expect(box.x + box.width).toBeCloseTo(right, 0)
      expect(Math.abs(box.width - width)).toBeLessThan(2)
    }
    const word = textNode(graph, artboard, 'ALQIMMAC')
    // 6 pt of tracking at 105% width, less the kerning the file set: the letters keep their
    // places though live text has no horizontal scale.
    expect(word.letterSpacing.value).toBeGreaterThan(4.5)
    expect(textNode(graph, artboard, 'Rotated 30').rotation).toBeCloseTo(-30, 0)
    textNode(graph, artboard, 'ALQIMMAC 2024')
  })

  test('an artboard with a crop box is its cropped size, its image and pattern in place', async () => {
    const graph = await open('illustrator-box.ai')
    const [, second] = frames(graph)
    expect([Math.round(second.width), Math.round(second.height)]).toEqual([500, 300])
    const nodes = descendants(graph, second.id)
    const image = expectDefined(nodes.find((node) => node.fills[0]?.type === 'IMAGE'))
    expect(boxIn(graph, second, image)).toMatchObject({ x: 30, y: 50, width: 220, height: 220 })
    expect(nodes.some((node) => node.fills[0]?.type === 'GRADIENT_RADIAL')).toBe(true)
  })
})
