import { describe, expect, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@lawha/core/io/formats/fig'
import { SceneGraph, type Fill } from '@lawha/scene-graph'

async function roundTrip(fill: Partial<Fill>): Promise<Fill | undefined> {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const tile = graph.createNode('ELLIPSE', pageId, { name: 'Tile', width: 10, height: 10 })
  graph.createNode('RECTANGLE', pageId, {
    name: 'Patterned',
    width: 100,
    height: 80,
    fills: [
      {
        type: 'PATTERN',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        sourceNodeId: tile.id,
        scale: 1,
        ...fill
      }
    ]
  })
  const bytes = await exportFigFile(graph)
  const parsed = await parseFigFile(bytes.buffer as ArrayBuffer)
  return [...parsed.getAllNodes()].find((n) => n.name === 'Patterned')?.fills[0]
}

describe('pattern placement in .fig files', () => {
  test('keeps a pattern fill’s offset and turn, which Figma’s paint has no field for', async () => {
    const fill = await roundTrip({ patternOffset: { x: 12, y: -4 }, patternRotation: 30 })
    expect(fill).toMatchObject({
      type: 'PATTERN',
      patternOffset: { x: 12, y: -4 },
      patternRotation: 30
    })
  })

  test('a pattern that neither moves nor turns saves nothing extra', async () => {
    const fill = await roundTrip({ patternOffset: { x: 0, y: 0 }, patternRotation: 0 })
    expect(fill?.patternOffset).toBeUndefined()
    expect(fill?.patternRotation).toBeUndefined()
  })
})
