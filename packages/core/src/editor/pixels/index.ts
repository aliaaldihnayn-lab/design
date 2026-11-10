import type { SceneNode } from '@lawha/scene-graph'
import type { Color, Vector } from '@lawha/scene-graph/primitives'
import { randomHex } from '@lawha/scene-graph/random'

import type { NodePreview } from '#core/editor/node-preview'
import type { EditorContext, Tool } from '#core/editor/types'
import { storeImage } from '#core/figma-api/images'
import { createCanvasKitRasterCodec, type RasterCodec } from '#core/io/formats/raster'
import {
  createStrokeCoverage,
  dabSpacing,
  eraseDab,
  paintDab,
  strokeDabs,
  type BrushTip,
  type StrokeCoverage
} from '#core/pixels/brush'
import { compositeOver } from '#core/pixels/composite'
import { fillRegion, pixelColor, selectSimilar } from '#core/pixels/fill'
import { combineMasks, type PixelMask } from '#core/pixels/mask'

import {
  canvasToGrid,
  gridScale,
  isPaintable,
  loadPixelSurface,
  paintedLayerChanges,
  type PixelSurface
} from './layer'
import { DEFAULT_PIXEL_TOOL_SETTINGS, type PixelOverlay, type PixelToolSettings } from './types'

/** The tools that paint along a drag. */
export type PixelStrokeTool = Extract<Tool, 'BRUSH' | 'ERASER'>

/** The tools the brush cursor follows on the canvas. */
const BRUSH_CURSOR_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['BRUSH', 'ERASER'])

/** What the pixel tools share across actions. */
export interface PixelSession {
  /** The pixel selection the tools keep to, on one layer's grid. */
  selection: { nodeId: string; mask: PixelMask } | null
}

interface StrokeSession {
  tool: PixelStrokeTool
  nodeId: string
  surface: PixelSurface
  /** The paint layer as the stroke found it. */
  before: Uint8Array
  coverage: StrokeCoverage
  tip: BrushTip
  color: Color
  mask: PixelMask | null
  last: Vector
  carry: number
  changed: boolean
  preview: NodePreview
  /** The name the stroke's pixels are shown under on the canvas until it is committed. */
  liveHash: string
  original: Pick<SceneNode, 'fills' | 'pluginData'>
}

const STROKE_LABELS: Record<PixelStrokeTool, string> = {
  BRUSH: 'Paint',
  ERASER: 'Erase'
}

function emptyOverlay(): PixelOverlay {
  return { nodeId: null, outline: null, grid: null, marquee: null, brush: null, cloneSource: null }
}

/**
 * Affinity's pixel tools on any shape or frame: the brush, eraser, and fill bucket paint into a
 * paint layer, an image fill kept on top of the layer's own fills, which stay as they were; the
 * colour picker reads what the layer shows. Each stroke or fill is one undo step.
 */
export function createPixelActions(
  ctx: EditorContext,
  beginNodePreview: (label?: string) => NodePreview
) {
  let stroke: StrokeSession | null = null
  /** The pixel selection the tools keep to, on one layer's grid. */
  const session: PixelSession = { selection: null }
  /** The grid scale of the layer painted last, so the brush cursor matches its pixels. */
  let lastScale: { nodeId: string; scale: number } | null = null

  function codec(): RasterCodec | null {
    const ck = ctx.getCk()
    return ck ? createCanvasKitRasterCodec(ck) : null
  }

  function overlay(): PixelOverlay {
    ctx.state.pixelOverlay ??= emptyOverlay()
    return ctx.state.pixelOverlay
  }

  function setPixelTools(changes: Partial<PixelToolSettings>) {
    ctx.state.pixelTools = { ...ctx.state.pixelTools, ...changes }
  }

  /**
   * The layer a pixel tool works on at a canvas point: the one selected, or else the topmost
   * paintable layer there, which becomes the selection, as Affinity paints on the active layer.
   */
  function pixelTargetAt(cx: number, cy: number): SceneNode | null {
    const graph = ctx.graph
    if (session.selection) {
      const node = graph.getNode(session.selection.nodeId)
      if (isPaintable(node)) return node
    }
    if (ctx.state.selectedIds.size === 1) {
      const [id] = ctx.state.selectedIds
      const node = graph.getNode(id)
      if (isPaintable(node)) return node
    }
    const hit = graph.hitTestDeep(cx, cy, ctx.state.currentPageId, 0)
    if (!isPaintable(hit ?? undefined) || !hit) return null
    ctx.setSelectedIds(new Set([hit.id]))
    return hit
  }

  function selectionMask(node: SceneNode, surface: PixelSurface): PixelMask | null {
    const { selection } = session
    if (selection?.nodeId !== node.id) return null
    const { mask } = selection
    return mask.width === surface.width && mask.height === surface.height ? mask : null
  }

  function showLive(session: StrokeSession, pixels: PixelSurface['paint'] | null) {
    for (const renderer of ctx.getRenderers()) {
      renderer.setLivePixels(session.liveHash, pixels, [session.nodeId])
    }
    ctx.requestRepaint()
  }

  function dab(session: StrokeSession, at: Vector) {
    const { surface, before, coverage, tip, mask } = session
    if (session.tool === 'ERASER') eraseDab(surface.paint, before, coverage, at, tip, mask)
    else paintDab(surface.paint, before, coverage, at, tip, session.color, mask)
    session.changed = true
  }

  /** Starts a stroke at a canvas point; false when nothing there can be painted on. */
  function pixelStrokeBegin(tool: PixelStrokeTool, cx: number, cy: number): boolean {
    pixelStrokeCancel()
    const node = pixelTargetAt(cx, cy)
    const raster = codec()
    if (!node || !raster) return false
    const surface = loadPixelSurface(ctx.graph, raster, node)
    const at = surface && canvasToGrid(ctx.graph, node, surface, { x: cx, y: cy })
    if (!surface || !at) return false
    const settings = ctx.state.pixelTools
    const liveHash = `live-paint-${randomHex(8)}`
    const original = structuredClone({ fills: node.fills, pluginData: node.pluginData })
    const preview = beginNodePreview(STROKE_LABELS[tool])
    try {
      preview.update(node.id, {
        fills: paintedLayerChanges(original, surface.paintIndex, liveHash).fills
      })
    } catch {
      preview.cancel()
      return false
    }
    const session: StrokeSession = {
      tool,
      nodeId: node.id,
      surface,
      before: surface.paint.data.slice(),
      coverage: createStrokeCoverage(surface.paint),
      tip: { size: settings.size, hardness: settings.hardness, opacity: settings.opacity },
      color: settings.color,
      mask: selectionMask(node, surface),
      last: at,
      carry: 0,
      changed: false,
      preview,
      liveHash,
      original
    }
    stroke = session
    lastScale = { nodeId: node.id, scale: gridScale(node, surface) }
    dab(session, at)
    showLive(session, surface.paint)
    return true
  }

  /** Paints from the last point to a canvas point, a dab every quarter brush. */
  function pixelStrokeMove(cx: number, cy: number) {
    const session = stroke
    if (!session) return
    const node = ctx.graph.getNode(session.nodeId)
    const at = node && canvasToGrid(ctx.graph, node, session.surface, { x: cx, y: cy })
    if (!at) return
    const { dabs, carry } = strokeDabs(session.last, at, dabSpacing(session.tip), session.carry)
    for (const centre of dabs) dab(session, centre)
    session.carry = carry
    session.last = at
    pixelHover(cx, cy)
    if (dabs.length > 0) showLive(session, session.surface.paint)
  }

  function finishStroke(session: StrokeSession) {
    stroke = null
    showLive(session, null)
  }

  function pixelStrokeCancel() {
    const session = stroke
    if (!session) return
    finishStroke(session)
    session.preview.cancel()
  }

  /** Stores the stroke's paint layer and records the stroke as one undo step. */
  function pixelStrokeEnd(): boolean {
    const session = stroke
    if (!session) return false
    const png = session.changed ? codec()?.encodePNG(session.surface.paint) : null
    if (!png) {
      pixelStrokeCancel()
      return false
    }
    const hash = storeImage(ctx.graph, png)
    try {
      session.preview.update(
        session.nodeId,
        paintedLayerChanges(session.original, session.surface.paintIndex, hash)
      )
      session.preview.commit()
    } finally {
      finishStroke(session)
    }
    return true
  }

  /** Writes a changed paint layer back as one undo step. */
  function commitSurface(node: SceneNode, surface: PixelSurface, label: string): boolean {
    const png = codec()?.encodePNG(surface.paint)
    if (!png) return false
    const hash = storeImage(ctx.graph, png)
    const preview = beginNodePreview(label)
    try {
      preview.update(node.id, paintedLayerChanges(node, surface.paintIndex, hash))
      preview.commit()
    } catch {
      preview.cancel()
      return false
    }
    ctx.requestRender()
    return true
  }

  /**
   * Fills the area like the pixel clicked, as the layer shows it, with the brush colour on the
   * paint layer, within the selection when there is one. False when nothing was filled.
   */
  function pixelFillAt(cx: number, cy: number): boolean {
    const node = pixelTargetAt(cx, cy)
    const raster = codec()
    if (!node || !raster) return false
    const surface = loadPixelSurface(ctx.graph, raster, node)
    const at = surface && canvasToGrid(ctx.graph, node, surface, { x: cx, y: cy })
    if (!surface || !at) return false
    const { tolerance, contiguous, color, opacity } = ctx.state.pixelTools
    const shown = compositeOver(surface.base, surface.paint)
    let region = selectSimilar(shown, at.x, at.y, tolerance, contiguous)
    const mask = selectionMask(node, surface)
    if (mask) region = combineMasks(mask, region, 'intersect')
    if (fillRegion(surface.paint, region, color, opacity) === 0) return false
    return commitSurface(node, surface, 'Fill')
  }

  /**
   * The colour the layer shows at a canvas point, which becomes the brush colour, as Affinity's
   * colour picker sets the primary colour. Null where no paintable layer is.
   */
  function pixelPickColorAt(cx: number, cy: number): Color | null {
    const node = pixelTargetAt(cx, cy)
    const raster = codec()
    if (!node || !raster) return null
    const surface = loadPixelSurface(ctx.graph, raster, node)
    const at = surface && canvasToGrid(ctx.graph, node, surface, { x: cx, y: cy })
    if (!surface || !at) return null
    const color = pixelColor(compositeOver(surface.base, surface.paint), at.x, at.y)
    if (!color || color.a === 0) return null
    const opaque = { ...color, a: 1 }
    setPixelTools({ color: opaque })
    return opaque
  }

  /** Shows the brush's outline under the pointer while a brush tool is active. */
  function pixelHover(cx: number, cy: number) {
    if (!BRUSH_CURSOR_TOOLS.has(ctx.state.activeTool)) {
      if (ctx.state.pixelOverlay?.brush) overlay().brush = null
      return
    }
    const [selected] = ctx.state.selectedIds
    const scale = lastScale?.nodeId === selected ? lastScale.scale : 1
    overlay().brush = { x: cx, y: cy, radius: ctx.state.pixelTools.size / 2 / scale }
    ctx.requestRepaint()
  }

  function pixelHoverEnd() {
    if (!ctx.state.pixelOverlay?.brush) return
    overlay().brush = null
    ctx.requestRepaint()
  }

  ctx.onEditorEvent('tool:changed', () => {
    pixelStrokeCancel()
    pixelHoverEnd()
  })

  return {
    setPixelTools,
    pixelStrokeBegin,
    pixelStrokeMove,
    pixelStrokeEnd,
    pixelStrokeCancel,
    pixelFillAt,
    pixelPickColorAt,
    pixelHover,
    pixelHoverEnd
  }
}

export { DEFAULT_PIXEL_TOOL_SETTINGS }
export type { PixelOverlay, PixelToolSettings }
