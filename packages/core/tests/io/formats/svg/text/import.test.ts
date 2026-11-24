import { afterEach, describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { createSVGNodes } from '@lawha/core/io/formats/svg'
import { SceneGraph, type SceneNode } from '@lawha/scene-graph'

import { installTextMeasurer } from '#core/layout/text-measurement'

let uninstall: (() => void) | null = null
afterEach(() => {
  uninstall?.()
  uninstall = null
})

function importedText(svg: string): SceneNode {
  const graph = new SceneGraph()
  const root = expectDefined(createSVGNodes(graph, graph.getPages()[0].id, svg))
  return expectDefined(graph.getChildren(root.id).find((node) => node.type === 'TEXT'))
}

describe('SVG text length', () => {
  test('sizes text whose fonts cannot measure it yet, so it stays where it was drawn', () => {
    // A measurer that cannot measure yet, as the app's is while a face is still loading.
    uninstall = installTextMeasurer(() => null)
    const text = importedText(
      '<svg width="400" height="100"><text x="380" y="50" font-size="20" font-family="Unknown Face" text-anchor="end" textLength="150">Right edge</text></svg>'
    )
    expect(text.width).toBe(150)
    expect(text.x + text.width).toBe(380)
  })

  test('gives way to the size its fonts measure', () => {
    uninstall = installTextMeasurer(() => ({ width: 90, height: 24 }))
    const text = importedText(
      '<svg width="400" height="100"><text x="10" y="50" font-size="20" textLength="150">Measured</text></svg>'
    )
    expect(text.width).toBe(90)
    expect(text.x).toBe(10)
  })
})
