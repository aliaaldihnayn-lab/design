import { describe, expect, test } from 'bun:test'

import { toUint8Array } from 'js-base64'

import { FigmaAPI } from '@lawha/core/figma-api'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'

import { expectDefined, expectFills } from '#tests/helpers/assert'

// A 1×1 PNG: the tool takes only bytes it can read as an image.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
const PNG = toUint8Array(PNG_BASE64)

function setup() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  return { graph, figma }
}

describe('set_image_fill tool', () => {
  const tool = expectDefined(
    ALL_TOOLS.find((t) => t.name === 'set_image_fill'),
    'set_image_fill tool'
  )

  test('sets an IMAGE fill with correct imageHash and scaleMode', () => {
    const { figma } = setup()
    const shape = expectDefined(
      ALL_TOOLS.find((t) => t.name === 'create_shape'),
      'create_shape tool'
    )
    const node = shape.execute(figma, {
      type: 'RECTANGLE',
      x: 0,
      y: 0,
      width: 100,
      height: 100
    }) as { id: string }

    const b64 = PNG_BASE64
    const result = tool.execute(figma, { id: node.id, image_data: b64 }) as {
      id: string
      imageHash: string
      scaleMode: string
    }

    expect(result.imageHash).toBeTruthy()
    expect(result.scaleMode).toBe('FILL')

    const fills = expectFills(expectDefined(figma.getNodeById(node.id), 'image-filled node').fills)
    expect(fills).toHaveLength(1)
    expect(fills[0]).toMatchObject({
      type: 'IMAGE',
      imageHash: result.imageHash,
      scaleMode: 'FILL'
    })
  })

  test('returns error for non-existent node', () => {
    const { figma } = setup()
    const result = tool.execute(figma, { id: 'nonexistent', image_data: PNG_BASE64 }) as {
      error: string
    }
    expect(result.error).toContain('not found')
  })

  test('default scale mode is FILL', () => {
    const { figma } = setup()
    const shape = expectDefined(
      ALL_TOOLS.find((t) => t.name === 'create_shape'),
      'create_shape tool'
    )
    const node = shape.execute(figma, { type: 'RECTANGLE', x: 0, y: 0, width: 50, height: 50 }) as {
      id: string
    }

    const result = tool.execute(figma, { id: node.id, image_data: PNG_BASE64 }) as {
      scaleMode: string
    }
    expect(result.scaleMode).toBe('FILL')
  })

  test('all scale modes work', () => {
    const modes = ['FILL', 'FIT', 'CROP', 'TILE'] as const
    for (const mode of modes) {
      const { figma } = setup()
      const shape = expectDefined(
        ALL_TOOLS.find((t) => t.name === 'create_shape'),
        'create_shape tool'
      )
      const node = shape.execute(figma, {
        type: 'RECTANGLE',
        x: 0,
        y: 0,
        width: 50,
        height: 50
      }) as { id: string }

      const result = tool.execute(figma, {
        id: node.id,
        image_data: PNG_BASE64,
        scale_mode: mode
      }) as { scaleMode: string }
      expect(result.scaleMode).toBe(mode)

      const fills = expectFills(
        expectDefined(figma.getNodeById(node.id), 'image-filled node').fills
      )
      expect(fills[0]).toMatchObject({ scaleMode: mode })
    }
  })

  test('image data is stored in graph.images', () => {
    const { graph, figma } = setup()
    const shape = expectDefined(
      ALL_TOOLS.find((t) => t.name === 'create_shape'),
      'create_shape tool'
    )
    const node = shape.execute(figma, { type: 'RECTANGLE', x: 0, y: 0, width: 50, height: 50 }) as {
      id: string
    }

    const result = tool.execute(figma, { id: node.id, image_data: PNG_BASE64 }) as {
      imageHash: string
    }
    expect(graph.images.get(result.imageHash)).toEqual(PNG)
  })

  test('refuses data that is not Base64 or not an image, and leaves the fills', () => {
    const { figma } = setup()
    const rect = figma.createRectangle()
    const before = JSON.stringify(rect.fills)
    for (const image_data of ['x', 'not base64!', 'aGVsbG8gd29ybGQ=']) {
      const result = tool.execute(figma, { id: rect.id, image_data }) as { error?: string }
      expect(result.error).toBeString()
    }
    expect(JSON.stringify(rect.fills)).toBe(before)
  })
})
