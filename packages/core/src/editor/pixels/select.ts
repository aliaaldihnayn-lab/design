import type { Fill, SceneGraph, SceneNode } from '@lawha/scene-graph'
import { IDENTITY_GRADIENT_TRANSFORM } from '@lawha/scene-graph/gradient'
import type { Vector } from '@lawha/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'
import { recordEdit } from '#core/editor/history/edit'
import { wrapNodes } from '#core/editor/structure/container-wrap'
import type { EditorContext } from '#core/editor/types'
import { storeImage } from '#core/figma-api/images'
import type { RasterCodec } from '#core/io/formats/raster'
import { blankImage, compositeOver } from '#core/pixels/composite'
import { selectSimilar } from '#core/pixels/fill'
import {
  combineMasks,
  createMask,
  ellipseMask,
  featherMask,
  invertMask,
  maskBounds,
  maskOutline,
  rectMask,
  type PixelMask,
  type SelectionMode
} from '#core/pixels/mask'

import { canvasToGrid, loadPixelSurface, type PixelSurface } from './layer'
import type { PixelMarquee } from './types'

/** What the pixel tools share across actions. */
export interface PixelSession {
  /** The pixel selection the tools keep to, on one layer's grid. */
  selection: { nodeId: string; mask: PixelMask } | null
}

/** What the selection actions borrow from the pixel tools. */
export interface PixelSelectionDeps {
  session: PixelSession
  codec: () => RasterCodec | null
  targetAt: (cx: number, cy: number) => SceneNode | null
  overlay: () => NonNullable<EditorContext['state']['pixelOverlay']>
}

/** A selection drawn smaller than this, in screen pixels, is a click: it deselects. */
const CLICK_SLOP = 3

/** Shift adds, Alt subtracts, both intersect, as in Affinity and Photoshop. */
export function selectionModeFor(
  modifiers: { shift?: boolean; alt?: boolean },
  fallback: SelectionMode
): SelectionMode {
  if (modifiers.shift && modifiers.alt) return 'intersect'
  if (modifiers.shift) return 'add'
  if (modifiers.alt) return 'subtract'
  return fallback
}

/** `to` moved so the box from `from` is square, as Shift constrains a selection shape. */
function squared(from: Vector, to: Vector): Vector {
  const size = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  return {
    x: from.x + Math.sign(to.x - from.x) * size,
    y: from.y + Math.sign(to.y - from.y) * size
  }
}

/**
 * Puts a mask layer showing image `hash` (white, its alpha the mask) under `node` and both in a
 * group named after it, where the mask hides what lies outside it. Returns the group's id.
 */
export function maskLayerWith(graph: SceneGraph, node: SceneNode, hash: string): string {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  if (!parent) throw new Error('A layer on no page cannot be masked')
  const fill: Fill = {
    type: 'IMAGE',
    imageHash: hash,
    imageScaleMode: 'CROP',
    imageTransform: { ...IDENTITY_GRADIENT_TRANSFORM },
    color: { ...TRANSPARENT },
    opacity: 1,
    visible: true
  }
  const index = parent.childIds.indexOf(node.id)
  const maskNode = graph.createNode('RECTANGLE', parent.id, {
    name: 'Mask',
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    flipX: node.flipX,
    flipY: node.flipY,
    fills: [fill],
    strokes: [],
    isMask: true,
    maskType: 'ALPHA'
  })
  graph.insertChildAt(maskNode.id, parent.id, index)
  return wrapNodes(graph, 'GROUP', [maskNode, node], parent.id, index, { name: node.name }).id
}

/** The selection as a mask image: white where selected, its alpha the selection. */
export function maskImage(mask: PixelMask) {
  const image = blankImage(mask.width, mask.height)
  for (let i = 0; i < mask.data.length; i++) image.data.set([255, 255, 255, mask.data[i]], i * 4)
  return image
}

export function createPixelSelectionActions(ctx: EditorContext, deps: PixelSelectionDeps) {
  const { session } = deps
  let drawing: { kind: PixelMarquee['kind']; nodeId: string; mode: SelectionMode } | null = null

  function showSelection() {
    const overlay = deps.overlay()
    const { selection } = session
    overlay.nodeId = selection?.nodeId ?? null
    overlay.outline = selection ? maskOutline(selection.mask) : null
    overlay.grid = selection ? { width: selection.mask.width, height: selection.mask.height } : null
    ctx.requestRepaint()
  }

  function setSelection(nodeId: string, mask: PixelMask | null) {
    session.selection = mask && maskBounds(mask) ? { nodeId, mask } : null
    showSelection()
  }

  function surfaceOf(node: SceneNode): PixelSurface | null {
    const codec = deps.codec()
    return codec ? loadPixelSurface(ctx.graph, codec, node) : null
  }

  /** The selection there is on `node`, if it is on the grid `surface` has. */
  function currentMask(node: SceneNode, surface: PixelSurface): PixelMask | null {
    const { selection } = session
    if (selection?.nodeId !== node.id) return null
    const { mask } = selection
    return mask.width === surface.width && mask.height === surface.height ? mask : null
  }

  /** Starts a rectangle or ellipse selection on the layer under a canvas point. */
  function pixelSelectBegin(
    kind: PixelMarquee['kind'],
    cx: number,
    cy: number,
    mode: SelectionMode = ctx.state.pixelTools.selectionMode
  ): boolean {
    const node = deps.targetAt(cx, cy)
    if (!node) return false
    drawing = { kind, nodeId: node.id, mode }
    deps.overlay().marquee = { kind, from: { x: cx, y: cy }, to: { x: cx, y: cy } }
    ctx.requestRepaint()
    return true
  }

  function pixelSelectMove(cx: number, cy: number, square = false) {
    const marquee = ctx.state.pixelOverlay?.marquee
    if (!drawing || !marquee) return
    const to = { x: cx, y: cy }
    marquee.to = square ? squared(marquee.from, to) : to
    ctx.requestRepaint()
  }

  function pixelSelectCancel() {
    drawing = null
    if (ctx.state.pixelOverlay?.marquee) {
      deps.overlay().marquee = null
      ctx.requestRepaint()
    }
  }

  /** Turns the shape dragged into the selection, joined to the one there is by its mode. */
  function pixelSelectEnd(): boolean {
    const marquee = ctx.state.pixelOverlay?.marquee
    const current = drawing
    pixelSelectCancel()
    const node = current && ctx.graph.getNode(current.nodeId)
    if (!current || !marquee || !node) return false
    const span = Math.max(
      Math.abs(marquee.to.x - marquee.from.x),
      Math.abs(marquee.to.y - marquee.from.y)
    )
    if (span * ctx.state.zoom < CLICK_SLOP) {
      if (current.mode === 'replace') pixelDeselect()
      return false
    }
    const surface = surfaceOf(node)
    const a = surface && canvasToGrid(ctx.graph, node, surface, marquee.from)
    const b = surface && canvasToGrid(ctx.graph, node, surface, marquee.to)
    if (!surface || !a || !b) return false
    const rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y)
    }
    const shape =
      current.kind === 'ellipse'
        ? ellipseMask(surface.width, surface.height, rect)
        : rectMask(surface.width, surface.height, rect)
    setSelection(node.id, combineMasks(currentMask(node, surface), shape, current.mode))
    return true
  }

  /** Selects the pixels like the one clicked, as the layer shows them, as the magic wand does. */
  function pixelMagicWandAt(
    cx: number,
    cy: number,
    mode: SelectionMode = ctx.state.pixelTools.selectionMode
  ): boolean {
    const node = deps.targetAt(cx, cy)
    const surface = node && surfaceOf(node)
    const at = node && surface && canvasToGrid(ctx.graph, node, surface, { x: cx, y: cy })
    if (!node || !surface || !at) return false
    const { tolerance, contiguous } = ctx.state.pixelTools
    const shown = compositeOver(surface.base, surface.paint)
    const region = selectSimilar(shown, at.x, at.y, tolerance, contiguous)
    if (!maskBounds(region)) return false
    setSelection(node.id, combineMasks(currentMask(node, surface), region, mode))
    return true
  }

  /** Selects the whole of the selected layer. */
  function pixelSelectAll(): boolean {
    const [id] = ctx.state.selectedIds
    const node = id ? ctx.graph.getNode(id) : undefined
    const surface = node && surfaceOf(node)
    if (!node || !surface) return false
    setSelection(node.id, createMask(surface.width, surface.height, 255))
    return true
  }

  function pixelDeselect() {
    if (!session.selection) return
    session.selection = null
    showSelection()
  }

  function pixelInvertSelection(): boolean {
    const { selection } = session
    if (!selection) return false
    setSelection(selection.nodeId, invertMask(selection.mask))
    return true
  }

  function hasPixelSelection(): boolean {
    return session.selection !== null
  }

  /**
   * Masks the selection's layer with the selection, as Affinity's New Mask Layer does: a mask
   * layer of the selection's shape goes under it and both go in a group, where the mask hides
   * what lies outside the selection. `invert` masks out the selection instead, and `feather`
   * softens the mask's edge over that many of the layer's pixels. One undo step; returns the
   * group, or null without a selection.
   */
  function pixelMaskFromSelection(
    options: { invert?: boolean; feather?: number } = {}
  ): string | null {
    const { selection } = session
    const node = selection && ctx.graph.getNode(selection.nodeId)
    const codec = deps.codec()
    if (!selection || !node?.parentId || !codec) return null
    let mask = options.invert ? invertMask(selection.mask) : selection.mask
    const feather = options.feather ?? ctx.state.pixelTools.feather
    if (feather > 0) mask = featherMask(mask, feather)
    const png = codec.encodePNG(maskImage(mask))
    if (!png) return null
    const groupId = recordEdit(ctx, { label: 'Mask from selection' }, () =>
      maskLayerWith(ctx.graph, node, storeImage(ctx.graph, png))
    )
    pixelDeselect()
    ctx.setSelectedIds(new Set([groupId]))
    ctx.requestRender()
    return groupId
  }

  // A selection belongs to its layer: it goes when the layer or the page does, or when other
  // layers are selected instead.
  ctx.onEditorEvent('selection:changed', (ids) => {
    const nodeId = session.selection?.nodeId
    if (nodeId && ids.length > 0 && !ids.includes(nodeId)) pixelDeselect()
  })
  ctx.onEditorEvent('node:deleted', (id) => {
    if (session.selection?.nodeId === id) pixelDeselect()
  })
  for (const event of ['page:changed', 'graph:replaced'] as const) {
    ctx.onEditorEvent(event, () => {
      pixelSelectCancel()
      pixelDeselect()
    })
  }

  return {
    pixelSelectBegin,
    pixelSelectMove,
    pixelSelectEnd,
    pixelSelectCancel,
    pixelMagicWandAt,
    pixelSelectAll,
    pixelDeselect,
    pixelInvertSelection,
    hasPixelSelection,
    pixelMaskFromSelection
  }
}
