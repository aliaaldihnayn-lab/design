import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { writePsdUint8Array, type BezierPath, type Layer } from 'ag-psd'

import { getCanvasKit } from '@lawha/core/canvaskit'
import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { headlessRenderNodes } from '@lawha/core/io/formats/raster'
import type { SceneGraph, SceneNode } from '@lawha/scene-graph'

setDefaultTimeout(60_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)
const WIDTH = 120
const HEIGHT = 80

type RGBA = [number, number, number, number]

function solid(width: number, height: number, rgba: RGBA) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return { width, height, data }
}

/** A pixel layer of one colour over a box, in canvas pixels. */
function pixels(
  name: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
  rgba: RGBA
): Layer {
  return { name, left, top, right, bottom, imageData: solid(right - left, bottom - top, rgba) }
}

function rectPath(left: number, top: number, right: number, bottom: number): BezierPath {
  return {
    open: false,
    fillRule: 'even-odd',
    operation: 'combine',
    knots: [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom]
    ].map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] }))
  }
}

const WHITE: RGBA = [255, 255, 255, 255]
const RED: RGBA = [255, 0, 0, 255]
const BLUE: RGBA = [0, 0, 255, 255]

function psd(children: Layer[]): Uint8Array {
  return writePsdUint8Array(
    {
      width: WIDTH,
      height: HEIGHT,
      children: [pixels('Background', 0, 0, WIDTH, HEIGHT, WHITE), ...children]
    },
    { generateThumbnail: false }
  )
}

async function open(children: Layer[]) {
  const { graph } = await io.readDocument({ name: 'layers.psd', data: psd(children) })
  const frame = expectDefined(graph.getNode(graph.getPages()[0].childIds[0]))
  return { graph, frame }
}

function named(graph: SceneGraph, parent: SceneNode, name: string): SceneNode {
  return expectDefined(
    graph.getChildren(parent.id).find((node) => node.name === name),
    name
  )
}

/** The canvas colour at a point of the rendered document. */
async function renderedAt(graph: SceneGraph, frame: SceneNode) {
  const page = graph.getPages()[0]
  const png = expectDefined(await headlessRenderNodes(graph, page.id, [frame.id]))
  const ck = await getCanvasKit()
  const image = expectDefined(ck.MakeImageFromEncoded(png))
  const data = expectDefined(
    image.readPixels(0, 0, {
      width: image.width(),
      height: image.height(),
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB
    })
  )
  const width = image.width()
  image.delete()
  return (x: number, y: number) =>
    Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3))
}

describe('opening PSD groups', () => {
  test('a group, nested or not, is the box of the layers it shows', async () => {
    const { graph, frame } = await open([
      {
        name: 'Outer',
        children: [
          pixels('Left', 10, 10, 30, 30, RED),
          { name: 'Inner', children: [pixels('Right', 60, 40, 90, 70, BLUE)] },
          { ...pixels('Hidden', 0, 0, 120, 80, BLUE), hidden: true }
        ]
      }
    ])
    const outer = named(graph, frame, 'Outer')
    expect(outer).toMatchObject({ type: 'GROUP', x: 10, y: 10, width: 80, height: 60 })
    expect(graph.getAbsoluteBounds(outer.id)).toMatchObject({ x: 10, y: 10, width: 80, height: 60 })
    const inner = named(graph, outer, 'Inner')
    expect(inner).toMatchObject({ type: 'GROUP', x: 50, y: 30, width: 30, height: 30 })
    // The layers keep their place on the canvas.
    const right = named(graph, inner, 'Right')
    expect(graph.getAbsoluteBounds(right.id)).toMatchObject({ x: 60, y: 40, width: 30, height: 30 })
  })
})

describe('opening PSD masks', () => {
  test('layers clipped to the layer below draw only inside its pixels', async () => {
    const { graph, frame } = await open([
      pixels('Base', 20, 20, 60, 60, RED),
      { ...pixels('Clipped', 0, 0, 120, 80, BLUE), clipping: true },
      pixels('Free', 100, 0, 120, 20, RED)
    ])
    const group = named(graph, frame, 'Base')
    expect(group).toMatchObject({ type: 'GROUP', x: 20, y: 20, width: 40, height: 40 })
    expect(graph.getChildren(group.id).map((node) => [node.name, node.isMask])).toEqual([
      ['Base', false],
      ['Clipping mask', true],
      ['Clipped', false]
    ])
    const at = await renderedAt(graph, frame)
    expect(at(40, 40)).toEqual([0, 0, 255])
    // Outside the base, the clipped layer is not drawn.
    expect(at(80, 40)).toEqual([255, 255, 255])
    expect(at(110, 10)).toEqual([255, 0, 0])
  })

  test('a layer mask hides the layer where it is black and beyond it by its default', async () => {
    const mask = solid(40, 40, [0, 0, 0, 255])
    // A white square in the middle of the mask: only there does the layer show.
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 30; x++) mask.data.set([255, 255, 255, 255], (y * 40 + x) * 4)
    }
    const { graph, frame } = await open([
      {
        ...pixels('Photo', 0, 0, 120, 80, BLUE),
        mask: { left: 20, top: 20, right: 60, bottom: 60, defaultColor: 0, imageData: mask }
      }
    ])
    const group = named(graph, frame, 'Photo')
    expect(group).toMatchObject({ type: 'GROUP', x: 20, y: 20, width: 40, height: 40 })
    const [layerMask] = graph.getChildren(group.id)
    expect(layerMask).toMatchObject({ isMask: true, maskType: 'LUMINANCE' })
    const at = await renderedAt(graph, frame)
    expect(at(40, 40)).toEqual([0, 0, 255])
    expect(at(25, 25)).toEqual([255, 255, 255])
    expect(at(100, 70)).toEqual([255, 255, 255])
  })

  test('a disabled layer mask hides nothing', async () => {
    const { graph, frame } = await open([
      {
        ...pixels('Photo', 0, 0, 120, 80, BLUE),
        mask: {
          left: 20,
          top: 20,
          right: 60,
          bottom: 60,
          defaultColor: 0,
          disabled: true,
          imageData: solid(40, 40, [0, 0, 0, 255])
        }
      }
    ])
    expect(named(graph, frame, 'Photo').type).toBe('RECTANGLE')
  })

  test('a vector mask on a pixel layer shows it only inside the path', async () => {
    const { graph, frame } = await open([
      {
        ...pixels('Photo', 0, 0, 120, 80, BLUE),
        hidden: true,
        vectorMask: { paths: [rectPath(10, 10, 50, 40)] }
      }
    ])
    const group = named(graph, frame, 'Photo')
    // The layer's visibility belongs to the group that holds it with its mask.
    expect(group).toMatchObject({
      type: 'GROUP',
      visible: false,
      x: 10,
      y: 10,
      width: 40,
      height: 30
    })
    const [vectorMask, content] = graph.getChildren(group.id)
    expect(vectorMask).toMatchObject({ isMask: true, type: 'VECTOR' })
    expect(content.visible).toBe(true)
    graph.updateNode(group.id, { visible: true })
    const at = await renderedAt(graph, frame)
    expect(at(30, 25)).toEqual([0, 0, 255])
    expect(at(80, 60)).toEqual([255, 255, 255])
  })
})

describe('opening PSD shape paths', () => {
  const shape = (paths: BezierPath[]): Layer => ({
    name: 'Shape',
    vectorFill: { type: 'color', color: { r: 255, g: 0, b: 0 } },
    vectorMask: { paths }
  })

  test('paths that combine add up, overlapping or not, rather than cutting holes', async () => {
    const { graph, frame } = await open([
      shape([rectPath(10, 10, 60, 60), rectPath(30, 30, 90, 70)])
    ])
    const at = await renderedAt(graph, frame)
    // Where the two rectangles overlap stays filled.
    expect(at(45, 45)).toEqual([255, 0, 0])
    expect(at(80, 65)).toEqual([255, 0, 0])
  })

  test('a subpath without an operation is part of the path before it, its hole cut out', async () => {
    const hole: BezierPath = { ...rectPath(30, 30, 50, 50), operation: undefined }
    const { graph, frame } = await open([shape([rectPath(10, 10, 70, 70), hole])])
    const at = await renderedAt(graph, frame)
    expect(at(20, 20)).toEqual([255, 0, 0])
    expect(at(40, 40)).toEqual([255, 255, 255])
  })

  test('a first path that subtracts cuts it out of the whole canvas', async () => {
    const { graph, frame } = await open([
      shape([{ ...rectPath(10, 10, 50, 50), operation: 'subtract' }])
    ])
    const at = await renderedAt(graph, frame)
    expect(at(30, 30)).toEqual([255, 255, 255])
    expect(at(90, 60)).toEqual([255, 0, 0])
  })
})
