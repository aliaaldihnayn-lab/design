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
