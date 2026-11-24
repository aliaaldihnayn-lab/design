import { sumBy } from 'es-toolkit'

import type { SceneNode } from '@lawha/scene-graph'
import {
  getAbsolutePositionFull,
  getNodeWorldBounds,
  getWorldMatrix
} from '@lawha/scene-graph/coordinate'
import Matrix from '@lawha/scene-graph/matrix'
import type { Vector } from '@lawha/scene-graph/primitives'

import { createArrangeActions } from '#core/editor/alignment/arrange'
import { createFlipRotateActions } from '#core/editor/alignment/flip-rotate'
import { packPositions, tidyPositions, type PlacedBox } from '#core/editor/alignment/tidy'

import { collectNodePositions, commitPositionChange } from './history/position'
import type { EditorContext } from './types'

function computeAlignTarget(
  min: number,
  max: number,
  size: number,
  align: 'min' | 'center' | 'max'
): number {
  if (align === 'min') return min
  if (align === 'center') return (min + max) / 2 - size / 2
  return max - size
}

/**
 * Aligns one layer within its parent by the box it draws in the parent's frame, as Figma does, so
 * a turned or reflected layer lines up by its outline, not by its unturned position.
 */
function alignSingleNode(
  ctx: EditorContext,
  node: SceneNode,
  axis: 'horizontal' | 'vertical',
  align: 'min' | 'center' | 'max'
) {
  const parent = node.parentId ? ctx.graph.getNode(node.parentId) : undefined
  const pw = parent?.width ?? 0
  const ph = parent?.height ?? 0
  const drawn = getNodeWorldBounds(node)

  if (axis === 'horizontal') {
    const target = computeAlignTarget(0, pw, drawn.width, align)
    ctx.graph.updateNode(node.id, { x: node.x + target - drawn.x })
  } else {
    const target = computeAlignTarget(0, ph, drawn.height, align)
    ctx.graph.updateNode(node.id, { y: node.y + target - drawn.y })
  }
}

/**
 * Aligns layers by the boxes they draw on the canvas, as Figma does: a turned or reflected layer,
 * or one inside a turned frame, lines up by its outline, and moves along its parent's own axes.
 */
function alignMultipleNodes(
  ctx: EditorContext,
  nodes: SceneNode[],
  axis: 'horizontal' | 'vertical',
  align: 'min' | 'center' | 'max'
) {
  const drawn = new Map(nodes.map((node) => [node.id, getAbsolutePositionFull(node, ctx.graph)]))
  const boxes = [...drawn.values()]
  const start = axis === 'horizontal' ? 'boundX' : 'boundY'
  const size = axis === 'horizontal' ? 'width' : 'height'
  const min = Math.min(...boxes.map((box) => box[start]))
  const max = Math.max(...boxes.map((box) => box[start] + box[size]))

  for (const node of nodes) {
    const box = drawn.get(node.id)
    if (!box) continue
    const distance = computeAlignTarget(min, max, box[size], align) - box[start]
    const delta = parentLocalDelta(
      ctx,
      node,
      axis === 'horizontal' ? { x: distance, y: 0 } : { x: 0, y: distance }
    )
    if (delta) ctx.graph.updateNode(node.id, { x: node.x + delta.x, y: node.y + delta.y })
  }
}

function canPositionNode(ctx: EditorContext, node: SceneNode): boolean {
  const parent = node.parentId ? ctx.graph.getNode(node.parentId) : undefined
  return !parent || parent.layoutMode === 'NONE' || node.layoutPositioning === 'ABSOLUTE'
}

function parentLocalDelta(ctx: EditorContext, node: SceneNode, worldDelta: Vector): Vector | null {
  const parent = node.parentId ? ctx.graph.getNode(node.parentId) : undefined
  if (!parent) return worldDelta
  const inverse = Matrix.invert(getWorldMatrix(parent, ctx.graph))
  if (!inverse) return null
  const origin = Matrix.mapPoint(inverse, { x: 0, y: 0 })
  const target = Matrix.mapPoint(inverse, worldDelta)
  return { x: target.x - origin.x, y: target.y - origin.y }
}

function distributeMultipleNodes(
  ctx: EditorContext,
  nodes: SceneNode[],
  axis: 'horizontal' | 'vertical'
) {
  const bounds = new Map(nodes.map((node) => [node.id, getAbsolutePositionFull(node, ctx.graph)]))
  const coordinate = axis === 'horizontal' ? 'boundX' : 'boundY'
  const size = axis === 'horizontal' ? 'width' : 'height'
  const sorted = [...nodes].sort((a, b) => {
    const delta = (bounds.get(a.id)?.[coordinate] ?? 0) - (bounds.get(b.id)?.[coordinate] ?? 0)
    return delta || a.id.localeCompare(b.id)
  })
  const first = sorted[0]
  const last = sorted.at(-1)
  if (!last) return

  const start = bounds.get(first.id)?.[coordinate] ?? 0
  const end = (bounds.get(last.id)?.[coordinate] ?? 0) + (bounds.get(last.id)?.[size] ?? 0)
  const totalSize = sumBy(sorted, (node) => bounds.get(node.id)?.[size] ?? 0)
  const gap = (end - start - totalSize) / (sorted.length - 1)
  let cursor = start

  for (const node of sorted) {
    const nodeBounds = bounds.get(node.id)
    if (!nodeBounds) continue
    const distance = cursor - nodeBounds[coordinate]
    const localDelta = parentLocalDelta(
      ctx,
      node,
      axis === 'horizontal' ? { x: distance, y: 0 } : { x: 0, y: distance }
    )
    if (!localDelta) continue
    ctx.graph.updateNode(node.id, { x: node.x + localDelta.x, y: node.y + localDelta.y })
    cursor += nodeBounds[size] + gap
  }
}

type Axis = 'horizontal' | 'vertical'

/** The layers as one row or column, or null when they are not, as Figma's Spacing field reads them. */
export interface SelectionSpacing {
  axis: Axis
  /** The gaps between neighbours, in order along the axis. */
  gaps: number[]
}

function axisSpans(ctx: EditorContext, nodes: SceneNode[], axis: Axis) {
  const start = axis === 'horizontal' ? 'boundX' : 'boundY'
  const crossStart = axis === 'horizontal' ? 'boundY' : 'boundX'
  const size = axis === 'horizontal' ? 'width' : 'height'
  const crossSize = axis === 'horizontal' ? 'height' : 'width'
  return nodes
    .map((node) => {
      const bounds = getAbsolutePositionFull(node, ctx.graph)
      return {
        node,
        min: bounds[start],
        max: bounds[start] + bounds[size],
        crossMin: bounds[crossStart],
        crossMax: bounds[crossStart] + bounds[crossSize]
      }
    })
    .sort((a, b) => a.min - b.min || a.node.id.localeCompare(b.node.id))
}

/**
 * Layers form a row when none overlap along it and each overlaps its neighbour across it; layers
 * apart on both axes, like a grid or a diagonal, have no spacing in Figma.
 */
function rowAlong(ctx: EditorContext, nodes: SceneNode[], axis: Axis) {
  const spans = axisSpans(ctx, nodes, axis)
  for (let index = 1; index < spans.length; index++) {
    const previous = spans[index - 1]
    const current = spans[index]
    if (current.min < previous.max) return null
    if (current.crossMin > previous.crossMax || current.crossMax < previous.crossMin) return null
  }
  return spans
}

export function createAlignmentActions(ctx: EditorContext) {
  function positionableNodes(nodeIds: readonly string[]) {
    const nodes = nodeIds
      .map((id) => ctx.graph.getNode(id))
      .filter((node): node is SceneNode => node != null)
    return nodes.length >= 2 && nodes.every((node) => canPositionNode(ctx, node)) ? nodes : null
  }

  function selectionSpacing(nodeIds: readonly string[]): SelectionSpacing | null {
    const nodes = positionableNodes(nodeIds)
    if (!nodes) return null
    for (const axis of ['horizontal', 'vertical'] as const) {
      const spans = rowAlong(ctx, nodes, axis)
      if (spans)
        return { axis, gaps: spans.slice(1).map((span, index) => span.min - spans[index].max) }
    }
    return null
  }

  /** Spaces the row or column evenly by `gap`, keeping its first layer in place, as Figma does. */
  function setSelectionSpacing(nodeIds: readonly string[], gap: number) {
    const spacing = selectionSpacing(nodeIds)
    const nodes = positionableNodes(nodeIds)
    if (!spacing || !nodes) return
    const spans = rowAlong(ctx, nodes, spacing.axis)
    if (!spans) return
    const originals = collectNodePositions(
      ctx,
      nodes.map((node) => node.id)
    )
    let cursor = spans[0].max + gap
    for (const span of spans.slice(1)) {
      const distance = cursor - span.min
      const delta = parentLocalDelta(
        ctx,
        span.node,
        spacing.axis === 'horizontal' ? { x: distance, y: 0 } : { x: 0, y: distance }
      )
      if (delta)
        ctx.graph.updateNode(span.node.id, {
          x: span.node.x + delta.x,
          y: span.node.y + delta.y
        })
      cursor += span.max - span.min + gap
    }
    commitPositionChange(ctx, 'Change spacing', originals)
    ctx.requestRender()
  }

  function canDistributeNodes(nodeIds: string[]): boolean {
    const nodes = nodeIds
      .map((id) => ctx.graph.getNode(id))
      .filter((node): node is SceneNode => node != null)
    return nodes.length >= 3 && nodes.every((node) => canPositionNode(ctx, node))
  }

  function alignNodes(
    nodeIds: string[],
    axis: 'horizontal' | 'vertical',
    align: 'min' | 'center' | 'max'
  ) {
    if (nodeIds.length === 0) return

    const nodes = nodeIds
      .map((id) => ctx.graph.getNode(id))
      .filter((n): n is SceneNode => n != null)
    if (nodes.length === 0) return

    const originals = collectNodePositions(
      ctx,
      nodes.map((node) => node.id)
    )

    if (nodes.length === 1) {
      alignSingleNode(ctx, nodes[0], axis, align)
    } else {
      alignMultipleNodes(ctx, nodes, axis, align)
    }

    commitPositionChange(ctx, 'Align', originals)
    ctx.requestRender()
  }

  function distributeNodes(nodeIds: string[], axis: 'horizontal' | 'vertical') {
    const nodes = nodeIds
      .map((id) => ctx.graph.getNode(id))
      .filter((node): node is SceneNode => node != null)
    if (!canDistributeNodes(nodeIds)) return

    const originals = collectNodePositions(
      ctx,
      nodes.map((node) => node.id)
    )
    distributeMultipleNodes(ctx, nodes, axis)
    commitPositionChange(ctx, 'Distribute', originals)
    ctx.requestRender()
  }

  /** Whether layers can be tidied or packed: two or more that can move freely. */
  function canArrangeNodes(nodeIds: string[]): boolean {
    return positionableNodes(nodeIds) !== null
  }

  /** Moves each layer so its box on the page starts where `plan` puts it, as one undo step. */
  function placeBoxes(
    nodeIds: string[],
    label: string,
    plan: (boxes: PlacedBox[]) => Map<string, Vector>
  ) {
    const chosen = positionableNodes(nodeIds)
    if (!chosen) return
    // A layer inside another chosen layer moves with it, rather than being placed twice.
    const ids = new Set(chosen.map((node) => node.id))
    const nodes = chosen.filter(
      (node) =>
        !node.parentId || !ctx.graph.closest(node.parentId, (ancestor) => ids.has(ancestor.id))
    )
    const boxes = nodes.map((node) => {
      const bounds = getAbsolutePositionFull(node, ctx.graph)
      return {
        id: node.id,
        x: bounds.boundX,
        y: bounds.boundY,
        width: bounds.width,
        height: bounds.height
      }
    })
    const targets = plan(boxes)
    const originals = collectNodePositions(
      ctx,
      nodes.map((node) => node.id)
    )
    for (const [index, node] of nodes.entries()) {
      const box = boxes[index]
      const target = targets.get(node.id)
      if (!target) continue
      const delta = parentLocalDelta(ctx, node, { x: target.x - box.x, y: target.y - box.y })
      if (delta) ctx.graph.updateNode(node.id, { x: node.x + delta.x, y: node.y + delta.y })
    }
    commitPositionChange(ctx, label, originals)
    ctx.requestRender()
  }

  /** Figma's Tidy Up: lines layers up in rows and columns with even spacing. */
  function tidyNodes(nodeIds: string[]) {
    placeBoxes(nodeIds, 'Tidy up', tidyPositions)
  }

  /** Figma's Pack Horizontal and Pack Vertical: layers edge to edge, with no gap. */
  function packNodes(nodeIds: string[], axis: Axis) {
    placeBoxes(nodeIds, 'Pack', (boxes) => packPositions(boxes, axis))
  }

  const { flipNodes, rotateNodes } = createFlipRotateActions(ctx)
  const arrange = createArrangeActions(ctx)

  /** Whether ELK's layouts take these layers: ones that can be tidied, sharing a parent. */
  function canAutoArrangeNodes(nodeIds: string[]): boolean {
    return canArrangeNodes(nodeIds) && arrange.canAutoArrangeNodes(nodeIds)
  }

  return {
    alignNodes,
    arrangeNodes: arrange.arrangeNodes,
    canArrangeNodes,
    canAutoArrangeNodes,
    canDistributeNodes,
    distributeNodes,
    selectionSpacing,
    setSelectionSpacing,
    flipNodes,
    packNodes,
    rotateNodes,
    tidyNodes
  }
}
