import type { SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData, withPluginData } from '@lawha/scene-graph/plugin-data'
import type { Color, Vector } from '@lawha/scene-graph/primitives'
import { randomHex } from '@lawha/scene-graph/random'

import { recordEdit } from '#core/editor/history/edit'
import type { NodePreview } from '#core/editor/node-preview'
import type { EditorContext, Tool } from '#core/editor/types'
import { storeImage } from '#core/figma-api/images'
import {
  createCanvasKitRasterCodec,
  type RasterCodec,
  type RGBAImage
} from '#core/io/formats/raster'
import {
  createStrokeCoverage,
  dabSpacing,
  eraseDab,
  paintDab,
  strokeDabs,
  type BrushTip,
  type StrokeCoverage
} from '#core/pixels/brush'
import { cloneDab, type CloneSampling } from '#core/pixels/clone'
import { compositeOver, type PaintResample } from '#core/pixels/composite'
import { fillRegion, pixelColor, selectSimilar } from '#core/pixels/fill'
import {
  createHealingStroke,
  finishHealingStroke,
  healDab,
  type HealingStroke
} from '#core/pixels/heal'
import { combineMasks, type PixelMask } from '#core/pixels/mask'

import {
  canvasToGrid,
  gridScale,
  isPaintable,
  loadPixelSurface,
  paintFillIndex,
  paintGrid,
  paintedLayerChanges,
  type PixelSurface
} from './layer'
import { renderLayerGrid } from './sample'
import { createPixelSelectionActions, type PixelSession } from './select'
import { DEFAULT_PIXEL_TOOL_SETTINGS, type PixelOverlay, type PixelToolSettings } from './types'

/** The tools that paint along a drag. */
export type PixelStrokeTool = Extract<Tool, 'BRUSH' | 'ERASER' | 'CLONE_STAMP' | 'HEALING_BRUSH'>

/** The tools the brush cursor follows on the canvas. */
const BRUSH_CURSOR_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  'BRUSH',
  'ERASER',
  'CLONE_STAMP',
  'HEALING_BRUSH'
])

/** Where the clone stamp and healing brush copy from, set with Alt-click, as in Affinity. */
interface CloneSource {
  nodeId: string
  /** The source point in canvas coordinates. */
  point: Vector
  /**
   * From where a stroke paints to where it copies, in canvas units, fixed by the first stroke
   * after the source was set, so later strokes keep copying from the same relative place.
   */
  offset: Vector | null
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
  /** What the clone stamp and healing brush copy, and from how far away. */
  sampling: CloneSampling | null
  /** The healing brush's solved region, which settles into one patch as the stroke ends. */
  healing: HealingStroke | null
}

const STROKE_LABELS: Record<PixelStrokeTool, string> = {
  BRUSH: 'Paint',
  ERASER: 'Erase',
  CLONE_STAMP: 'Clone',
  HEALING_BRUSH: 'Heal'
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
  let cloneSource: CloneSource | null = null

  function codec(): RasterCodec | null {
    const ck = ctx.getCk()
    return ck ? createCanvasKitRasterCodec(ck) : null
  }

  /**
   * What the layer shows on its pixel grid, as the canvas draws it (gradients, adjustments,
   * effects), from the layer alone or from every layer on the page, as the tools' sample setting
   * says. Without a renderer, its solid and image fills with the paint over them.
   */
  function shownPixels(node: SceneNode, surface: PixelSurface): RGBAImage {
    const ck = ctx.getCk()
    const scope = ctx.state.pixelTools.sampleScope
    for (const renderer of ck ? ctx.getRenderers() : []) {
      const rendered = ck && renderLayerGrid(ck, renderer, ctx.graph, node, surface, scope)
      if (rendered) return rendered
      break
    }
    return compositeOver(surface.base, surface.paint)
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
    const { sampling } = session
    if (session.tool === 'ERASER') eraseDab(surface.paint, before, coverage, at, tip, mask)
    else if (sampling && session.tool === 'CLONE_STAMP')
      cloneDab(surface.paint, before, coverage, at, tip, sampling, mask)
    else if (session.healing)
      healDab(surface.paint, before, coverage, at, tip, session.healing, mask)
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
    const cloning = tool === 'CLONE_STAMP' || tool === 'HEALING_BRUSH'
    const sampling = cloning ? cloneSampling(node, surface, { x: cx, y: cy }) : null
    if (cloning && !sampling) return false
    const settings = ctx.state.pixelTools
    const liveHash = `live-paint-${randomHex(8)}`
    const original = structuredClone({ fills: node.fills, pluginData: node.pluginData })
    const preview = beginNodePreview(STROKE_LABELS[tool])
    try {
      preview.update(node.id, {
        fills: paintedLayerChanges(original, surface, liveHash).fills
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
      original,
      sampling,
      healing: sampling && tool === 'HEALING_BRUSH' ? createHealingStroke(sampling) : null
    }
    stroke = session
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

  /**
   * What a clone or heal stroke starting at `point` copies: the layer as it shows now, from the
   * clone source's offset. Null until a source is set on this layer.
   */
  function cloneSampling(
    node: SceneNode,
    surface: PixelSurface,
    point: Vector
  ): CloneSampling | null {
    if (cloneSource?.nodeId !== node.id) return null
    cloneSource.offset ??= {
      x: cloneSource.point.x - point.x,
      y: cloneSource.point.y - point.y
    }
    const from = canvasToGrid(ctx.graph, node, surface, point)
    const to = canvasToGrid(ctx.graph, node, surface, {
      x: point.x + cloneSource.offset.x,
      y: point.y + cloneSource.offset.y
    })
    if (!from || !to) return null
    return {
      source: shownPixels(node, surface),
      offset: { x: to.x - from.x, y: to.y - from.y }
    }
  }

  /**
   * Sets where the clone stamp and healing brush copy from, on the layer under a canvas point,
   * as Alt-click does in Affinity. False where nothing can be painted.
   */
  function pixelSetCloneSource(cx: number, cy: number): boolean {
    const node = pixelTargetAt(cx, cy)
    if (!node) return false
    cloneSource = { nodeId: node.id, point: { x: cx, y: cy }, offset: null }
    overlay().cloneSource = { x: cx, y: cy }
    ctx.requestRepaint()
    return true
  }

  /** Where the clone source sits for a pointer at a canvas point, shown as a crosshair. */
  function showCloneSource(cx: number, cy: number) {
    if (!cloneSource) return
    const { offset, point } = cloneSource
    overlay().cloneSource = offset ? { x: cx + offset.x, y: cy + offset.y } : point
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
    if (session.healing && session.changed) {
      const { surface, before, coverage, healing } = session
      finishHealingStroke(surface.paint, before, coverage, healing)
    }
    const png = session.changed ? codec()?.encodePNG(session.surface.paint) : null
    if (!png) {
      pixelStrokeCancel()
      return false
    }
    const hash = storeImage(ctx.graph, png)
    try {
      session.preview.update(
        session.nodeId,
        paintedLayerChanges(session.original, session.surface, hash)
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
      preview.update(node.id, paintedLayerChanges(node, surface, hash))
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
    let region = selectSimilar(shownPixels(node, surface), at.x, at.y, tolerance, contiguous)
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
    const color = pixelColor(shownPixels(node, surface), at.x, at.y)
    if (!color || color.a === 0) return null
    const opaque = { ...color, a: 1 }
    setPixelTools({ color: opaque })
    return opaque
  }

  /**
   * The layer a brush would paint on at a canvas point, without selecting it: the one a stroke
   * there would pick.
   */
  function hoverTarget(cx: number, cy: number): SceneNode | null {
    const graph = ctx.graph
    const selected = session.selection?.nodeId ?? [...ctx.state.selectedIds].at(0)
    const node = selected && ctx.state.selectedIds.size <= 1 ? graph.getNode(selected) : undefined
    if (isPaintable(node)) return node
    const hit = graph.hitTestDeep(cx, cy, ctx.state.currentPageId, 0)
    return hit && isPaintable(hit) ? hit : null
  }

  /**
   * Shows the brush's outline under the pointer while a brush tool is active, sized to the
   * pixels of the layer it would paint on, whether or not anything was painted there yet.
   */
  function pixelHover(cx: number, cy: number) {
    if (!BRUSH_CURSOR_TOOLS.has(ctx.state.activeTool)) {
      if (ctx.state.pixelOverlay?.brush) overlay().brush = null
      return
    }
    const target = hoverTarget(cx, cy)
    const raster = target && codec()
    const grid = target && raster ? paintGrid(ctx.graph, raster, target) : null
    const scale = target && grid ? gridScale(target, grid) : 1
    overlay().brush = { x: cx, y: cy, radius: ctx.state.pixelTools.size / 2 / scale }
    if (ctx.state.activeTool === 'CLONE_STAMP' || ctx.state.activeTool === 'HEALING_BRUSH')
      showCloneSource(cx, cy)
    ctx.requestRepaint()
  }

  /** How the selected layer's paint follows it when resized, or null when it has none. */
  function pixelPaintResample(): PaintResample | null {
    const [id] = ctx.state.selectedIds
    const node = id ? ctx.graph.getNode(id) : undefined
    if (!node || paintFillIndex(node) < 0) return null
    return readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.paintLayer)?.resample ?? 'nearest'
  }

  /**
   * Sets how the selected layer's paint follows it to a new size: pixel for pixel (`nearest`),
   * so painted pixels grow into crisp blocks, or resampled smoothly. One undo step.
   */
  function setPixelPaintResample(resample: PaintResample): boolean {
    const [id] = ctx.state.selectedIds
    const node = id ? ctx.graph.getNode(id) : undefined
    const marker = node && readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.paintLayer)
    if (!node || !marker || paintFillIndex(node) < 0 || marker.resample === resample) return false
    recordEdit(ctx, { label: 'Paint resampling' }, () => {
      ctx.graph.updateNode(node.id, {
        pluginData: withPluginData(node.pluginData, LAWHA_PLUGIN_DATA.paintLayer, {
          ...marker,
          resample
        })
      })
    })
    ctx.requestRender()
    return true
  }

  function pixelHoverEnd() {
    if (!ctx.state.pixelOverlay?.brush) return
    overlay().brush = null
    ctx.requestRepaint()
  }

  ctx.onEditorEvent('tool:changed', (tool) => {
    pixelStrokeCancel()
    pixelHoverEnd()
    if (tool !== 'CLONE_STAMP' && tool !== 'HEALING_BRUSH' && ctx.state.pixelOverlay?.cloneSource)
      overlay().cloneSource = null
  })
  ctx.onEditorEvent('node:deleted', (id) => {
    if (cloneSource?.nodeId !== id) return
    cloneSource = null
    if (ctx.state.pixelOverlay) overlay().cloneSource = null
  })

  const selectionActions = createPixelSelectionActions(ctx, {
    session,
    codec,
    targetAt: pixelTargetAt,
    shownPixels,
    overlay
  })

  return {
    ...selectionActions,
    setPixelTools,
    pixelStrokeBegin,
    pixelStrokeMove,
    pixelStrokeEnd,
    pixelStrokeCancel,
    pixelFillAt,
    pixelSetCloneSource,
    pixelPickColorAt,
    pixelHover,
    pixelHoverEnd,
    pixelPaintResample,
    setPixelPaintResample
  }
}

export { DEFAULT_PIXEL_TOOL_SETTINGS }
export type { PixelOverlay, PixelToolSettings }
export type { PixelSampleScope } from './sample'
