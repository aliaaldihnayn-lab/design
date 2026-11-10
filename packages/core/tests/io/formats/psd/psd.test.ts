import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { readPsd, writePsdUint8Array } from 'ag-psd'

import { getCanvasKit } from '@lawha/core/canvaskit'
import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { SceneGraph } from '@lawha/scene-graph'

setDefaultTimeout(60_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)

function solid(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return { width, height, data }
}

/** A PSD as Photoshop writes one: a background, a group with a red square, and a text layer. */
function samplePSD(): Uint8Array {
  return writePsdUint8Array(
    {
      width: 200,
      height: 100,
      imageData: solid(200, 100, [255, 255, 255, 255]),
      children: [
        {
          name: 'Background',
          left: 0,
          top: 0,
          right: 200,
          bottom: 100,
          imageData: solid(200, 100, [255, 255, 255, 255])
        },
        {
          name: 'Shapes',
          opened: true,
          children: [
            {
              name: 'Red',
              left: 20,
              top: 30,
              right: 60,
              bottom: 70,
              opacity: 0.5,
              blendMode: 'multiply',
              imageData: solid(40, 40, [255, 0, 0, 255])
            }
          ]
        },
        {
          name: 'Title',
          left: 100,
          top: 10,
          right: 190,
          bottom: 40,
          imageData: solid(90, 30, [0, 0, 0, 0]),
          text: {
            text: 'مرحبا',
            transform: [1, 0, 0, 1, 100, 30],
            style: { font: { name: 'Cairo-Bold' }, fontSize: 24, fillColor: { r: 0, g: 0, b: 255 } }
          }
        }
      ]
    },
    { generateThumbnail: false }
  )
}

async function read(bytes: Uint8Array) {
  return (await io.readDocument({ name: 'poster.psd', data: bytes })).graph
}

describe('opening PSD', () => {
  test('layers, groups, positions, opacity and blend modes come in as editable layers', async () => {
    const graph = await read(samplePSD())
    const frame = expectDefined(graph.getNode(graph.getPages()[0].childIds[0]))
    expect(frame).toMatchObject({ name: 'poster', width: 200, height: 100 })
    const [background, group, ...rest] = frame.childIds.map((id) =>
      expectDefined(graph.getNode(id))
    )
    expect(background.name).toBe('Background')
    expect(group).toMatchObject({ name: 'Shapes', type: 'FRAME' })
    const red = expectDefined(graph.getNode(group.childIds[0]))
    expect(red).toMatchObject({
      name: 'Red',
      x: 20,
      y: 30,
      width: 40,
      height: 40,
      blendMode: 'MULTIPLY'
    })
    // Photoshop keeps opacity in 8 bits: 50% is 128/255.
    expect(red.opacity).toBeCloseTo(0.5, 2)
    expect(red.fills[0].type).toBe('IMAGE')
    const text = expectDefined(rest.find((node) => node.type === 'TEXT'))
    expect(text).toMatchObject({
      text: 'مرحبا',
      fontFamily: 'Cairo',
      fontWeight: 700,
      fontSize: 24,
      textDirection: 'RTL'
    })
    expect(text.fills[0]).toMatchObject({ color: { r: 0, g: 0, b: 1 } })
  })

  test('the image pixels of a layer are kept exactly', async () => {
    const graph = await read(samplePSD())
    const frame = expectDefined(graph.getNode(graph.getPages()[0].childIds[0]))
    const group = expectDefined(graph.getNode(frame.childIds[1]))
    const red = expectDefined(graph.getNode(group.childIds[0]))
    const png = expectDefined(graph.images.get(expectDefined(red.fills[0].imageHash)))
    const ck = await getCanvasKit()
    const image = expectDefined(ck.MakeImageFromEncoded(png))
    const px = expectDefined(
      image.readPixels(5, 5, {
        width: 1,
        height: 1,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB
      })
    )
    expect([...px]).toEqual([255, 0, 0, 255])
    image.delete()
  })
})

const px = (value: number) => ({ units: 'Pixels' as const, value })

/** A rectangle path's four corner knots, in document pixels. */
function rectKnots(left: number, top: number, right: number, bottom: number) {
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom]
  ].map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] }))
}

/** Layer styles, shape layers and a fill layer, as Photoshop writes them. */
function styledPSD(): Uint8Array {
  return writePsdUint8Array(
    {
      width: 200,
      height: 100,
      imageResources: { globalAngle: 90 },
      children: [
        {
          name: 'Backdrop',
          vectorFill: { type: 'color', color: { r: 240, g: 240, b: 240 } }
        },
        {
          name: 'Card',
          left: 20,
          top: 10,
          right: 120,
          bottom: 60,
          vectorFill: { type: 'color', color: { r: 255, g: 0, b: 0 } },
          vectorStroke: {
            strokeEnabled: true,
            fillEnabled: true,
            lineWidth: px(4),
            lineAlignment: 'inside',
            content: { type: 'color', color: { r: 0, g: 0, b: 255 } }
          },
          vectorMask: {
            paths: [{ open: false, fillRule: 'non-zero', knots: rectKnots(20, 10, 120, 60) }]
          },
          vectorOrigination: {
            keyDescriptorList: [
              {
                keyOriginType: 2,
                keyOriginRRectRadii: {
                  topLeft: px(8),
                  topRight: px(8),
                  bottomLeft: px(8),
                  bottomRight: px(8)
                },
                keyOriginShapeBoundingBox: {
                  top: px(10),
                  left: px(20),
                  bottom: px(60),
                  right: px(120)
                }
              }
            ]
          },
          effects: {
            dropShadow: [
              {
                enabled: true,
                useGlobalLight: true,
                distance: px(5),
                size: px(10),
                // Photoshop's spread is a percentage that ag-psd keeps as a pixel value.
                choke: px(20),
                color: { r: 0, g: 0, b: 0 },
                opacity: 0.5,
                blendMode: 'multiply'
              }
            ],
            outerGlow: {
              enabled: true,
              size: px(6),
              color: { r: 255, g: 255, b: 0 },
              opacity: 0.75
            },
            stroke: [
              {
                enabled: true,
                size: px(2),
                position: 'outside',
                fillType: 'color',
                color: { r: 0, g: 255, b: 0 },
                opacity: 1
              }
            ]
          }
        },
        {
          name: 'Wedge',
          left: 130,
          top: 10,
          right: 190,
          bottom: 70,
          vectorFill: {
            type: 'solid',
            name: 'Fade',
            colorStops: [
              { color: { r: 255, g: 255, b: 255 }, location: 0, midpoint: 0.5 },
              { color: { r: 0, g: 0, b: 0 }, location: 1, midpoint: 0.5 }
            ],
            opacityStops: [
              { opacity: 1, location: 0, midpoint: 0.5 },
              { opacity: 1, location: 1, midpoint: 0.5 }
            ],
            style: 'linear',
            angle: 90
          },
          vectorMask: {
            paths: [
              {
                open: false,
                fillRule: 'non-zero',
                knots: [
                  [160, 10],
                  [190, 70],
                  [130, 70]
                ].map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] }))
              }
            ]
          }
        },
        {
          name: 'Headline',
          left: 10,
          top: 70,
          right: 120,
          bottom: 95,
          imageData: solid(110, 25, [0, 0, 0, 0]),
          text: {
            text: 'Sale',
            transform: [1, 0, 0, 1, 10, 90],
            style: {
              font: { name: 'Montserrat-ExtraBoldItalic' },
              fontSize: 20,
              fillColor: { r: 0, g: 0, b: 0 }
            }
          },
          effects: {
            solidFill: [{ enabled: true, color: { r: 255, g: 128, b: 0 }, opacity: 1 }],
            innerShadow: [
              {
                enabled: true,
                angle: 0,
                distance: px(2),
                size: px(3),
                color: { r: 0, g: 0, b: 0 },
                opacity: 1
              }
            ]
          }
        }
      ]
    },
    { generateThumbnail: false }
  )
}

describe('opening PSD layer styles and shape layers', () => {
  async function layers() {
    const graph = await read(styledPSD())
    const frame = expectDefined(graph.getNode(graph.getPages()[0].childIds[0]))
    const all = frame.childIds.map((id) => expectDefined(graph.getNode(id)))
    const named = (name: string) =>
      expectDefined(
        all.find((node) => node.name === name && node.visible),
        name
      )
    return { all, named }
  }

  test('a fill layer covers the canvas in its colour', async () => {
    const { named } = await layers()
    const backdrop = named('Backdrop')
    expect(backdrop).toMatchObject({ type: 'RECTANGLE', x: 0, y: 0, width: 200, height: 100 })
    expect(backdrop.fills[0]?.color.r).toBeCloseTo(240 / 255, 3)
  })

  test('a shape layer is an editable rounded rectangle with its fill, stroke and styles', async () => {
    const { named } = await layers()
    const card = named('Card')
    expect(card).toMatchObject({
      type: 'RECTANGLE',
      x: 20,
      y: 10,
      width: 100,
      height: 50,
      cornerRadius: 8
    })
    expect(card.fills.map((fill) => fill.color)).toEqual([{ r: 1, g: 0, b: 0, a: 1 }])
    // Its own outline, then the layer style's stroke.
    expect(card.strokes.map((stroke) => [stroke.align, stroke.weight, stroke.color.b])).toEqual([
      ['INSIDE', 4, 1],
      ['OUTSIDE', 2, 0]
    ])
    const [shadow, glow] = card.effects
    // Global light at 90° shines from straight above, so the shadow falls straight down.
    expect(shadow).toMatchObject({
      type: 'DROP_SHADOW',
      radius: 10,
      spread: 2,
      blendMode: 'MULTIPLY'
    })
    expect(shadow.offset.x).toBeCloseTo(0, 6)
    expect(shadow.offset.y).toBeCloseTo(5, 6)
    expect(shadow.color.a).toBeCloseTo(0.5, 2)
    expect(glow).toMatchObject({ type: 'DROP_SHADOW', radius: 6, offset: { x: 0, y: 0 } })
    expect(glow.color).toMatchObject({ r: 1, g: 1, b: 0 })
  })

  test('a drawn path becomes a vector with its gradient', async () => {
    const { named } = await layers()
    const wedge = named('Wedge')
    expect(wedge).toMatchObject({ type: 'VECTOR', x: 130, y: 10, width: 60, height: 60 })
    expect(wedge.vectorNetwork?.vertices).toHaveLength(3)
    const fill = expectDefined(wedge.fills[0])
    expect(fill.type).toBe('GRADIENT_LINEAR')
    expect(fill.gradientStops?.map((stop) => stop.color.r)).toEqual([1, 0])
  })

  test('text takes its face from the font name, and its colour overlay and inner shadow', async () => {
    const { named } = await layers()
    const text = named('Headline')
    expect(text).toMatchObject({
      type: 'TEXT',
      fontFamily: 'Montserrat',
      fontWeight: 800,
      italic: true
    })
    expect(text.fills.map((fill) => fill.color.g)).toEqual([0, expect.closeTo(128 / 255, 3)])
    expect(text.effects[0]).toMatchObject({ type: 'INNER_SHADOW', radius: 3 })
    expect(text.effects[0].offset.x).toBeCloseTo(-2, 6)
  })

  test("a shape's pixels stay underneath, hidden", async () => {
    const { all } = await layers()
    const hiddenPixels = all.filter((node) => !node.visible && node.fills[0]?.type === 'IMAGE')
    expect(hiddenPixels.length).toBeGreaterThan(0)
  })
})

describe('exporting PSD', () => {
  test('each layer of the frame becomes a named Photoshop layer at its place', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const frame = graph.createNode('FRAME', page, {
      name: 'Card',
      width: 120,
      height: 80,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Blue box',
      x: 10,
      y: 20,
      width: 30,
      height: 25,
      opacity: 0.4,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Hidden',
      x: 60,
      y: 10,
      width: 20,
      height: 20,
      visible: false,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    const result = await io.exportContent('psd', {
      graph,
      target: { scope: 'node', nodeId: frame.id }
    })
    expect(result.extension).toBe('psd')
    if (typeof result.data === 'string') throw new Error('Expected bytes')
    const psd = readPsd(new Uint8Array(result.data), { useImageData: true })
    expect([psd.width, psd.height]).toEqual([120, 80])
    const [blue, hidden] = expectDefined(psd.children)
    expect(blue).toMatchObject({ name: 'Blue box', left: 10, top: 20, right: 40, bottom: 45 })
    expect(blue.opacity).toBeCloseTo(0.4, 2)
    expect(hidden).toMatchObject({ name: 'Hidden', hidden: true, left: 60, top: 10 })
    const pixels = expectDefined(blue.imageData)
    expect(Array.from(pixels.data.slice(0, 4))).toEqual([0, 0, 255, 255])
  })

  test('a PSD saved by Lawha opens again with the same layers', async () => {
    const graph = await read(samplePSD())
    const frame = graph.getPages()[0].childIds[0]
    const result = await io.exportContent('psd', {
      graph,
      target: { scope: 'node', nodeId: frame }
    })
    if (typeof result.data === 'string') throw new Error('Expected bytes')
    const again = await read(new Uint8Array(result.data))
    const root = expectDefined(again.getNode(again.getPages()[0].childIds[0]))
    expect([root.width, root.height]).toEqual([200, 100])
    expect(root.childIds.map((id) => again.getNode(id)?.name)).toContain('Shapes')
  })
})
