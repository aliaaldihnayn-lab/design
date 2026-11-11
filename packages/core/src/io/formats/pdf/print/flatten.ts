import type { CanvasKit } from 'canvaskit-wasm'

import type { Fill, SceneGraph, SceneNode } from '@lawha/scene-graph'
import { BLACK, WHITE } from '@lawha/scene-graph/constants'
import type { VisualBounds } from '@lawha/scene-graph/geometry'
import { computeImageHash } from '@lawha/scene-graph/images'

import type { PDFPageSpec } from '#core/io/formats/pdf/plan'
import {
  computeContentBounds,
  createCanvasKitRasterCodec,
  renderRegionToImage,
  type RasterCodec
} from '#core/io/formats/raster'

/**
 * Transparency flattening for PDF/X-1a, which allows none: each layer that draws with
 * transparency (opacity, a translucent paint, a blend mode, an effect, a mask, an image with an
 * alpha channel) is drawn, together with everything under it inside its bounds, into one opaque
 * image at press resolution, which takes its place. What lies outside those bounds, and every
 * layer above, stays vector, as an atomic-region flattener leaves it.
 */

export interface FlattenOptions {
  /** CanvasKit, loaded only when there is something to flatten or an image to look into. */
  canvasKit: () => Promise<CanvasKit>
  /** Points past each spec's layer box, by spec index, that the flattened images cover too. */
  outset: (specIndex: number) => number
  /** Pixels per inch of the flattened images; 300 by default. */
  resolution?: number
}

const DEFAULT_RESOLUTION = 300
/** The largest flattened image, in pixels, so a huge sheet cannot exhaust memory. */
const MAX_PIXELS = 48_000_000

function paintIsTranslucent(paint: Fill): boolean {
  if (!paint.visible) return false
  if (paint.opacity < 1 || paint.color.a < 1) return true
  if (paint.blendMode && paint.blendMode !== 'NORMAL' && paint.blendMode !== 'PASS_THROUGH')
    return true
  return (paint.gradientStops ?? []).some((stop) => stop.color.a < 1)
}

/** Whether an encoded image may have an alpha channel, from its header alone. */
function mayHaveAlpha(bytes: Uint8Array): boolean {
  // JPEG has no alpha; a PNG says in its header whether it can have any.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return false
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const colorType = bytes[25]
    const header = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
    return colorType === 4 || colorType === 6 || header.includes('tRNS')
  }
  return true
}

/** Whether an encoded image has pixels that are not fully opaque. */
function imageHasAlpha(bytes: Uint8Array, codec: RasterCodec): boolean {
  const image = codec.decode(bytes)
  if (!image) return false
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] < 255) return true
  return false
}

/** Whether the layer itself, not its children, draws with transparency. */
export function drawsTransparency(node: SceneNode, hasAlpha: (hash: string) => boolean): boolean {
  if (node.opacity < 1) return true
  if (node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') return true
  if (node.isMask) return true
  if (node.effects.some((effect) => effect.visible)) return true
  for (const paint of [...node.fills, ...node.strokes]) {
    if (paintIsTranslucent(paint)) return true
    if (paint.visible && paint.type === 'IMAGE' && paint.imageHash && hasAlpha(paint.imageHash))
      return true
  }
  return false
}

function isTurned(node: SceneNode): boolean {
  return Math.abs(node.rotation) > 1e-6 || node.flipX || node.flipY
}

/** Layers to flatten under `root`, back to front: a transparent layer stands for its subtree. */
function transparentUnits(
  graph: SceneGraph,
  root: SceneNode,
  hasAlpha: (hash: string) => boolean
): SceneNode[] {
  if (drawsTransparency(root, hasAlpha)) return [root]
  const units: SceneNode[] = []
  // `turned` is the outermost turned layer above, which the image must replace whole, since an
  // upright image cannot sit inside it.
  const visit = (node: SceneNode, turned: SceneNode | null) => {
    if (!node.visible) return
    const outer = turned ?? (isTurned(node) ? node : null)
    if (drawsTransparency(node, hasAlpha)) {
      const unit = outer ?? node
      if (!units.includes(unit)) units.push(unit)
      return
    }
    for (const child of graph.getChildren(node.id)) visit(child, outer)
  }
  for (const child of graph.getChildren(root.id)) visit(child, null)
  return units
}

/** The images the layer and its descendants paint with. */
function imageHashes(graph: SceneGraph, id: string): string[] {
  const node = graph.getNode(id)
  if (!node) return []
  const own = [...node.fills, ...node.strokes].flatMap((paint) =>
    paint.type === 'IMAGE' && paint.imageHash ? [paint.imageHash] : []
  )
  return [...own, ...node.childIds.flatMap((child) => imageHashes(graph, child))]
}

/** Every layer of the page in the order it is drawn. */
function paintOrder(graph: SceneGraph, pageId: string): string[] {
  const out: string[] = []
  const visit = (id: string) => {
    out.push(id)
    for (const child of graph.getNode(id)?.childIds ?? []) visit(child)
  }
  for (const child of graph.getNode(pageId)?.childIds ?? []) visit(child)
  return out
}

function intersect(a: VisualBounds, b: VisualBounds): VisualBounds | null {
  const box = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY)
  }
  return box.maxX > box.minX && box.maxY > box.minY ? box : null
}

interface Flattened {
  unit: SceneNode
  root: SceneNode
  bounds: VisualBounds
  image: Uint8Array
}

/** Renders the unit with all that is drawn before it, and nothing after, inside `bounds`. */
async function renderUnit(
  graph: SceneGraph,
  pageId: string,
  order: readonly string[],
  root: SceneNode,
  unit: SceneNode,
  bounds: VisualBounds,
  options: { ck: CanvasKit; resolution?: number }
): Promise<Uint8Array | null> {
  const scale = (options.resolution ?? DEFAULT_RESOLUTION) / 72
  const pixels = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) * scale * scale
  const fitted = pixels > MAX_PIXELS ? scale * Math.sqrt(MAX_PIXELS / pixels) : scale
  const at = order.indexOf(unit.id)
  const hidden: SceneNode[] = []
  for (const [index, id] of order.entries()) {
    const node = graph.getNode(id)
    if (!node?.visible) continue
    const later = index > at && !graph.isDescendant(id, unit.id)
    const elsewhere = !graph.isDescendant(id, root.id) && id !== root.id
    const holdsRoot = graph.isDescendant(root.id, id)
    if ((later || elsewhere) && !holdsRoot) hidden.push(node)
  }
  for (const node of hidden) node.visible = false
  graph.clearAbsPosCache()
  try {
    return await renderRegionToImage(options.ck, graph, pageId, bounds, fitted, {
      pageColor: { ...WHITE }
    })
  } finally {
    for (const node of hidden) node.visible = true
    graph.clearAbsPosCache()
  }
}

function place(graph: SceneGraph, item: Flattened) {
  const { unit, root, bounds, image } = item
  const hash = computeImageHash(image)
  graph.images.set(hash, image)
  const fill: Fill = {
    type: 'IMAGE',
    imageHash: hash,
    imageScaleMode: 'FILL',
    color: { ...BLACK },
    opacity: 1,
    visible: true
  }
  const parentId = unit.id === root.id ? root.id : unit.parentId
  const parent = parentId ? graph.getNode(parentId) : undefined
  if (!parent) return
  const origin = graph.getAbsolutePosition(parent.id)
  const imageNode = graph.createNode('RECTANGLE', parent.id, {
    name: `${unit.name} (flattened)`,
    x: bounds.minX - origin.x,
    y: bounds.minY - origin.y,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    fills: [fill],
    layoutPositioning: 'ABSOLUTE'
  })
  if (unit.id === root.id) {
    // The page layer itself draws transparency: the image now draws all of it.
    for (const child of graph.getChildren(root.id)) {
      if (child.id !== imageNode.id) child.visible = false
    }
    graph.updateNode(root.id, {
      opacity: 1,
      blendMode: 'PASS_THROUGH',
      fills: [],
      strokes: [],
      effects: [],
      isMask: false
    })
    return
  }
  graph.insertChildAt(imageNode.id, parent.id, parent.childIds.indexOf(unit.id) + 1)
  unit.visible = false
}

/**
 * Flattens the transparency of the pages' layers in `graph`, a copy made for export, and
 * returns how many regions it flattened.
 */
export async function flattenTransparency(
  graph: SceneGraph,
  specs: readonly PDFPageSpec[],
  options: FlattenOptions
): Promise<number> {
  let ck: CanvasKit | null = null
  const kit = async () => (ck ??= await options.canvasKit())
  // Images that may have alpha are decoded up front, so the walk below can ask synchronously.
  const alpha = new Map<string, boolean>()
  for (const spec of specs) {
    for (const id of spec.nodeIds) {
      for (const hash of imageHashes(graph, id)) {
        if (alpha.has(hash)) continue
        const bytes = graph.images.get(hash)
        if (!bytes || !mayHaveAlpha(bytes)) {
          alpha.set(hash, false)
          continue
        }
        alpha.set(hash, imageHasAlpha(bytes, createCanvasKitRasterCodec(await kit())))
      }
    }
  }
  const hasAlpha = (hash: string) => alpha.get(hash) ?? false
  const work: Flattened[] = []
  // Everything renders from the unchanged copy first, so each image shows what was under it.
  for (const [index, spec] of specs.entries()) {
    const order = paintOrder(graph, spec.pageId)
    const outset = options.outset(index)
    for (const id of spec.nodeIds) {
      const root = graph.getNode(id)
      if (!root?.visible) continue
      const at = graph.getAbsolutePosition(root.id)
      const sheet = {
        minX: at.x - outset,
        minY: at.y - outset,
        maxX: at.x + root.width + outset,
        maxY: at.y + root.height + outset
      }
      for (const unit of transparentUnits(graph, root, hasAlpha)) {
        const drawn = computeContentBounds(graph, [unit.id])
        const box = drawn ? intersect(drawn, sheet) : null
        if (!box) continue
        const bounds = {
          minX: Math.floor(box.minX),
          minY: Math.floor(box.minY),
          maxX: Math.ceil(box.maxX),
          maxY: Math.ceil(box.maxY)
        }
        const image = await renderUnit(graph, spec.pageId, order, root, unit, bounds, {
          ck: await kit(),
          resolution: options.resolution
        })
        if (image) work.push({ unit, root, bounds, image })
      }
    }
  }
  for (const item of work) place(graph, item)
  graph.clearAbsPosCache()
  return work.length
}
