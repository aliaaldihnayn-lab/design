import { expect, setDefaultTimeout, test } from 'bun:test'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { SceneGraph, type Fill } from '@lawha/scene-graph'

import { latin1 } from '#core/io/formats/pdf/print/file'

setDefaultTimeout(120_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)

function solid(r: number, g: number, b: number): Fill {
  return { type: 'SOLID', color: { r, g, b, a: 1 }, opacity: 1, visible: true }
}

async function exportPrint(graph: SceneGraph, nodeIds: string[]): Promise<Uint8Array> {
  const result = await io.exportContent('pdf-print', {
    graph,
    target: { scope: 'selection', nodeIds }
  })
  if (typeof result.data === 'string') throw new Error('PDF is binary')
  return result.data
}

const numbers = (text: string | undefined) => (text ?? '').trim().split(/\s+/).map(Number)

test('a flattened image does not repeat along its far edges', async () => {
  // As Chromium prints a clipped image: a rounded card cut from a taller picture.
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', pageId, {
    width: 400,
    height: 300,
    fills: [solid(1, 1, 1)],
    clipsContent: true
  })
  const group = graph.createNode('GROUP', frame.id, { name: 'Clip path group', x: 20.3, y: 20.3 })
  graph.createNode('RECTANGLE', group.id, {
    width: 360,
    height: 199.5,
    cornerRadius: 20,
    isMask: true,
    maskType: 'VECTOR',
    fills: [solid(0, 0, 0)]
  })
  graph.createNode('RECTANGLE', group.id, {
    width: 360,
    height: 240,
    fills: [solid(0.2, 0.4, 1)]
  })
  const pdf = latin1(await exportPrint(graph, [frame.id]))
  const patterns = [...pdf.matchAll(/\/PatternType 1[\s\S]*?endstream/g)].map(([text]) => text)
  // The pattern the page paints with, placed by its matrix; svg2pdf also writes a unit one.
  const placed = patterns.filter((pattern) => /\/I\d+ Do/.test(pattern) && /\/Matrix/.test(pattern))
  expect(placed.length).toBeGreaterThan(0)
  for (const pattern of placed) {
    const step = [/\/XStep\s+([\d.]+)/, /\/YStep\s+([\d.]+)/].map((key) =>
      Number(key.exec(pattern)?.[1])
    )
    // The tile scales the image by each `s 0 0 s` before drawing it `w 0 0 h` in size.
    const scale = [...pattern.matchAll(/([\d.]+) 0\. 0\. \1 [-\d.]+ [-\d.]+ cm/g)].reduce(
      (product, [, value]) => product * Number(value),
      1
    )
    const [width = 0, height = 0] = numbers(
      /([\d.]+) 0 0 ([\d.]+) [-\d.]+ [-\d.]+ cm/.exec(pattern)?.slice(1).join(' ')
    )
    // Readers round a tile's edge to their pixels: the next tile has to start well past the
    // image, or its first row shows as a hairline along the far edge.
    expect(step[0]).toBeGreaterThan(width * scale + 1)
    expect(step[1]).toBeGreaterThan(height * scale + 1)
  }
})
