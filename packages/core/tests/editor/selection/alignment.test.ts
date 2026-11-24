import { describe, expect, test } from 'bun:test'

import { getNodeOrThrow } from '#core-tests/helpers/assert'
import { createRect, firstPageId } from '#core-tests/helpers/scene'

import { createEditor } from '@lawha/core'
import { SceneGraph } from '@lawha/scene-graph'
import { getAbsolutePositionFull, getNodeWorldBounds } from '@lawha/scene-graph/coordinate'

describe('single-node alignment to parent', () => {
  function setup() {
    const graph = new SceneGraph()
    const frame = graph.createNode('FRAME', firstPageId(graph), {
      name: 'Container',
      x: 0,
      y: 0,
      width: 400,
      height: 300
    })
    const child = createRect(graph, frame.id, {
      name: 'Child',
      x: 50,
      y: 50,
      width: 100,
      height: 80
    })
    return { graph, frame, child }
  }

  test('align left within parent', () => {
    const { graph, child } = setup()
    graph.updateNode(child.id, { x: 0 })
    expect(getNodeOrThrow(graph, child.id).x).toBe(0)
  })

  test('align right within parent', () => {
    const { graph, frame, child } = setup()
    const targetX = frame.width - child.width
    graph.updateNode(child.id, { x: targetX })
    expect(getNodeOrThrow(graph, child.id).x).toBe(300)
  })

  test('align center horizontal within parent', () => {
    const { graph, frame, child } = setup()
    const targetX = (frame.width - child.width) / 2
    graph.updateNode(child.id, { x: targetX })
    expect(getNodeOrThrow(graph, child.id).x).toBe(150)
  })

  test('align top within parent', () => {
    const { graph, child } = setup()
    graph.updateNode(child.id, { y: 0 })
    expect(getNodeOrThrow(graph, child.id).y).toBe(0)
  })

  test('align bottom within parent', () => {
    const { graph, frame, child } = setup()
    const targetY = frame.height - child.height
    graph.updateNode(child.id, { y: targetY })
    expect(getNodeOrThrow(graph, child.id).y).toBe(220)
  })

  test('align center vertical within parent', () => {
    const { graph, frame, child } = setup()
    const targetY = (frame.height - child.height) / 2
    graph.updateNode(child.id, { y: targetY })
    expect(getNodeOrThrow(graph, child.id).y).toBe(110)
  })
})

describe('multi-node alignment', () => {
  function setup() {
    const graph = new SceneGraph()
    const page = firstPageId(graph)
    const a = createRect(graph, page, { name: 'A', x: 10, y: 20, width: 50, height: 30 })
    const b = createRect(graph, page, { name: 'B', x: 100, y: 80, width: 60, height: 40 })
    const c = createRect(graph, page, { name: 'C', x: 200, y: 50, width: 40, height: 50 })
    return { graph, a, b, c }
  }

  test('align left — all nodes move to min x', () => {
    const { graph, a, b, c } = setup()
    const nodes = [a, b, c].map((n) => getNodeOrThrow(graph, n.id))
    const abs = nodes.map((n) => graph.getAbsolutePosition(n.id))
    const minX = Math.min(...abs.map((p) => p.x))

    for (const n of nodes) {
      const nodeAbs = graph.getAbsolutePosition(n.id)
      graph.updateNode(n.id, { x: n.x + (minX - nodeAbs.x) })
    }

    expect(getNodeOrThrow(graph, a.id).x).toBe(10)
    expect(getNodeOrThrow(graph, b.id).x).toBe(10)
    expect(getNodeOrThrow(graph, c.id).x).toBe(10)
  })

  test('align right — all nodes align to max right edge', () => {
    const { graph, a, b, c } = setup()
    const nodes = [a, b, c].map((n) => getNodeOrThrow(graph, n.id))
    const abs = nodes.map((n) => graph.getAbsolutePosition(n.id))
    const maxX = Math.max(...abs.map((p, i) => p.x + nodes[i].width))

    for (const n of nodes) {
      const nodeAbs = graph.getAbsolutePosition(n.id)
      const targetX = maxX - n.width
      graph.updateNode(n.id, { x: n.x + (targetX - nodeAbs.x) })
    }

    expect(getNodeOrThrow(graph, a.id).x).toBe(190)
    expect(getNodeOrThrow(graph, b.id).x).toBe(180)
    expect(getNodeOrThrow(graph, c.id).x).toBe(200)
  })

  test('align top — all nodes move to min y', () => {
    const { graph, a, b, c } = setup()
    const nodes = [a, b, c].map((n) => getNodeOrThrow(graph, n.id))
    const abs = nodes.map((n) => graph.getAbsolutePosition(n.id))
    const minY = Math.min(...abs.map((p) => p.y))

    for (const n of nodes) {
      const nodeAbs = graph.getAbsolutePosition(n.id)
      graph.updateNode(n.id, { y: n.y + (minY - nodeAbs.y) })
    }

    expect(getNodeOrThrow(graph, a.id).y).toBe(20)
    expect(getNodeOrThrow(graph, b.id).y).toBe(20)
    expect(getNodeOrThrow(graph, c.id).y).toBe(20)
  })
})

// Aligning layers an auto layout holds in place moves nothing, so it adds no undo step.
test('aligning auto layout children records no undo step', () => {
  const editor = createEditor()
  const pageId = editor.state.currentPageId
  const row = editor.graph.createNode('FRAME', pageId, {
    width: 300,
    height: 100,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED'
  })
  const a = editor.graph.createNode('RECTANGLE', row.id, { width: 40, height: 40 })
  const b = editor.graph.createNode('RECTANGLE', row.id, { width: 40, height: 60 })
  editor.runLayoutForNode(row.id)
  editor.alignNodes([a.id, b.id], 'vertical', 'max')
  expect(editor.undo.canUndo).toBe(false)
})

describe('aligning turned and reflected layers', () => {
  // Each layer's box as drawn on the canvas, which Figma aligns by.
  function drawnBoxes(editor: ReturnType<typeof createEditor>, ids: string[]) {
    return ids.map((id) => {
      const box = getAbsolutePositionFull(getNodeOrThrow(editor.graph, id), editor.graph)
      return {
        left: box.boundX,
        right: box.boundX + box.width,
        top: box.boundY,
        bottom: box.boundY + box.height
      }
    })
  }

  function setup(parentRotation = 0) {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const parent =
      parentRotation === 0
        ? pageId
        : editor.graph.createNode('FRAME', pageId, {
            x: 0,
            y: 0,
            width: 600,
            height: 400,
            rotation: parentRotation
          }).id
    const ids = [
      editor.graph.createNode('RECTANGLE', parent, { x: 100, y: 100, width: 80, height: 40, rotation: 30 }).id,
      editor.graph.createNode('RECTANGLE', parent, { x: 260, y: 180, width: 60, height: 60 }).id,
      editor.graph.createNode('RECTANGLE', parent, {
        x: 420,
        y: 140,
        width: 50,
        height: 90,
        rotation: -45,
        flipX: true
      }).id
    ]
    return { editor, ids }
  }

  for (const parentRotation of [0, 20]) {
    test(`lines up the edges they draw (parent turned ${parentRotation}°)`, () => {
      const { editor, ids } = setup(parentRotation)
      const before = drawnBoxes(editor, ids)
      const left = Math.min(...before.map((box) => box.left))
      const right = Math.max(...before.map((box) => box.right))
      const top = Math.min(...before.map((box) => box.top))

      editor.alignNodes(ids, 'horizontal', 'min')
      for (const box of drawnBoxes(editor, ids)) expect(box.left).toBeCloseTo(left, 6)
      editor.undoAction()

      editor.alignNodes(ids, 'horizontal', 'max')
      for (const box of drawnBoxes(editor, ids)) expect(box.right).toBeCloseTo(right, 6)
      editor.undoAction()

      editor.alignNodes(ids, 'vertical', 'center')
      const middles = drawnBoxes(editor, ids).map((box) => (box.top + box.bottom) / 2)
      for (const middle of middles) expect(middle).toBeCloseTo(middles[0], 6)
      editor.undoAction()

      editor.alignNodes(ids, 'vertical', 'min')
      const after = drawnBoxes(editor, ids)
      for (const box of after) expect(box.top).toBeCloseTo(top, 6)
      // Aligning one axis leaves the other alone, even when the parent is turned.
      after.forEach((box, index) => expect(box.left).toBeCloseTo(before[index].left, 6))
      editor.dispose()
    })
  }

  test('a turned layer aligns to its parent by its outline', () => {
    const editor = createEditor()
    const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      width: 400,
      height: 300
    })
    const id = editor.graph.createNode('RECTANGLE', frame.id, {
      x: 150,
      y: 100,
      width: 100,
      height: 50,
      rotation: 45
    }).id
    editor.alignNodes([id], 'horizontal', 'min')
    editor.alignNodes([id], 'vertical', 'max')
    const box = getNodeWorldBounds(getNodeOrThrow(editor.graph, id))
    expect(box.x).toBeCloseTo(0, 6)
    expect(box.y + box.height).toBeCloseTo(300, 6)
    editor.dispose()
  })
})
