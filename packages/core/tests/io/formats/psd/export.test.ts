import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { readPsd, type Layer } from 'ag-psd'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { SceneGraph, type Fill } from '@lawha/scene-graph'

setDefaultTimeout(60_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)

function fill(r: number, g: number, b: number): Fill[] {
  return [{ type: 'SOLID', color: { r, g, b, a: 1 }, opacity: 1, visible: true }]
}

/** Where a colour first shows in a Photoshop layer, in canvas pixels. */
function firstPixel(layer: Layer, match: (rgba: number[]) => boolean) {
  const image = expectDefined(layer.imageData)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4
      const rgba = Array.from(image.data.slice(offset, offset + 4))
      if (match(rgba)) return { x: x + (layer.left ?? 0), y: y + (layer.top ?? 0) }
    }
  }
  return null
}

describe('exporting PSD layers', () => {
  test('a layer drawn past its box on one side, as by a shadow or a turn, stays in place', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const frame = graph.createNode('FRAME', page, { width: 200, height: 120, fills: fill(1, 1, 1) })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Shadowed',
      x: 20,
      y: 20,
      width: 40,
      height: 40,
      fills: fill(0, 0, 1),
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 1 },
          offset: { x: 20, y: 20 },
          radius: 0,
          spread: 0,
          visible: true
        }
      ]
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Turned',
      x: 120,
      y: 30,
      width: 50,
      height: 20,
      rotation: 30,
      fills: fill(1, 0, 0)
    })
    const result = await io.exportContent('psd', {
      graph,
      target: { scope: 'node', nodeId: frame.id }
    })
    if (typeof result.data === 'string') throw new Error('Expected bytes')
    const [shadowed, turned] = expectDefined(
      readPsd(new Uint8Array(result.data), { useImageData: true }).children
    )
    const blue = ([r, g, b, a]: number[]) => b > 200 && r < 50 && g < 50 && a > 200
    expect(firstPixel(shadowed, blue)).toEqual({ x: 20, y: 20 })
    expect(shadowed).toMatchObject({ left: 20, top: 20, right: 80, bottom: 80 })
    // The turned box covers 118.3–171.7 across and 18.8–61.2 down.
    expect(turned.left).toBe(118)
    expect(turned.top).toBe(19)
  })
})
