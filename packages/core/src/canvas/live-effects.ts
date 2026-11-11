import type { Path } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getNodeLocalMatrix } from '@lawha/scene-graph/coordinate'
import type {
  MeshEffect,
  PathEffect,
  PathEffectSource,
  WarpEffect,
  WidthEffect
} from '@lawha/scene-graph/path-effects'
import { LAWHA_PLUGIN_DATA, readPluginData, withPluginData } from '@lawha/scene-graph/plugin-data'
import type { Rect } from '@lawha/scene-graph/primitives'

import { mapContours, meshFunction, meshInBox, warpFunction, warpStep } from '#core/vector/warp'

import { placedPath } from './boolean'
import { canTakePathEffect, widthFill, widthOutlinePath, widthStroke } from './path-effects'
import { cubicsToPath, pathToCubics } from './paths/cubic'
import type { SkiaRenderer } from './renderer'
import { shapeBuilderSourcePath, vectorPropsForPath } from './shape-builder'

/** What a live effect is set to, without the outline it reshapes. */
export type PathEffectSettings =
  | Omit<WarpEffect, 'source'>
  | Omit<MeshEffect, 'source'>
  | Omit<WidthEffect, 'source'>

/** The live path effect on a layer, if it has a valid one. */
export function pathEffectOf(node: SceneNode): PathEffect | undefined {
  return readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.pathEffect)
}

function boundsOf(path: Path): Rect {
  const [left, top, right, bottom] = path.computeTightBounds()
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The outline a live effect reshapes, placed in the layer's parent as the layer sits now. */
export function effectSourceInParent(r: SkiaRenderer, node: SceneNode, effect: PathEffect) {
  const own = r.ck.Path.MakeFromSVGString(effect.source.path)
  if (!own) return null
  own.setFillType(effect.source.evenOdd ? r.ck.FillType.EvenOdd : r.ck.FillType.Winding)
  const placed = placedPath(r, own, getNodeLocalMatrix(node))
  own.delete()
  return placed
}

/** The box a live warp or mesh is laid over, in the layer's parent. */
export function effectSourceBox(r: SkiaRenderer, node: SceneNode, effect: PathEffect) {
  const placed = effectSourceInParent(r, node, effect)
  if (!placed) return null
  const box = boundsOf(placed)
  placed.delete()
  return box
}

/** The outline `settings` make of `source` (in the parent), or null when nothing is left. */
function reshape(r: SkiaRenderer, source: Path, settings: PathEffectSettings): Path | null {
  if (settings.kind === 'width')
    return widthOutlinePath(r, source, settings.weight, settings.points)
  const box = boundsOf(source)
  if (box.width <= 0 && box.height <= 0) return null
  const map =
    settings.kind === 'warp'
      ? warpFunction(box, settings)
      : meshFunction(box, meshInBox(box, settings.rows, settings.columns, settings.points))
  return cubicsToPath(
    r.ck,
    mapContours(pathToCubics(r.ck, source), map, warpStep(box)),
    source.getFillType()
  )
}

/** `source` (in the parent) as the vector at `x`, `y` holds it, for the effect to keep. */
function sourceFor(r: SkiaRenderer, source: Path, x: number, y: number): PathEffectSource {
  const builder = new r.ck.PathBuilder()
  builder.addPath(source, [1, 0, -x, 0, 1, -y, 0, 0, 1])
  const own = builder.detachAndDelete()
  const path = own.toSVGString()
  own.delete()
  return { path, evenOdd: source.getFillType() === r.ck.FillType.EvenOdd }
}

/**
 * The vector props `settings` make of `source`, an outline in the parent painted like `style`:
 * the reshaped outline, and the effect kept live in its plugin data with the outline it came
 * from, so it can be edited, expanded, or released later.
 */
function liveProps(
  r: SkiaRenderer,
  source: Path,
  style: SceneNode,
  settings: PathEffectSettings,
  name: string
): Partial<SceneNode> | null {
  const shaped = reshape(r, source, settings)
  if (!shaped) return null
  try {
    if (shaped.isEmpty()) return null
    const props = vectorPropsForPath(r, shaped, style, name)
    const effect: PathEffect = {
      ...settings,
      source: sourceFor(r, source, props.x ?? 0, props.y ?? 0)
    }
    props.pluginData = withPluginData(style.pluginData, LAWHA_PLUGIN_DATA.pathEffect, effect)
    return props
  } finally {
    shaped.delete()
  }
}

/**
 * Props that make `node` a vector with a live effect: a warp or mesh of its outline, or a width
 * profile of its stroke, painted with the stroke. A layer that already has a live effect is
 * reshaped from the outline it keeps. Null when the layer cannot take the effect.
 */
export function applyLiveEffect(
  r: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode,
  settings: PathEffectSettings
): Partial<SceneNode> | null {
  const current = pathEffectOf(node)
  if (current) return updateLiveEffect(r, node, settings)
  if (!canTakePathEffect(node, graph)) return null
  let style = node
  let name = node.name
  if (settings.kind === 'width') {
    const painted = widthStroke(node)
    if (!painted) return null
    style = { ...node, fills: [widthFill(painted.stroke)], strokes: [] }
    name = `${node.name} (Width)`
  }
  const source = shapeBuilderSourcePath(r, node, graph)
  if (!source) return null
  try {
    return liveProps(r, source, style, settings, name)
  } finally {
    source.delete()
  }
}

/**
 * Props that reshape a layer with a live effect by new settings of the same kind, from the
 * outline it keeps; null when the layer has no live effect, it is of another kind, or nothing is
 * left.
 */
export function updateLiveEffect(
  r: SkiaRenderer,
  node: SceneNode,
  settings: PathEffectSettings
): Partial<SceneNode> | null {
  const current = pathEffectOf(node)
  if (!current || current.kind !== settings.kind) return null
  const source = effectSourceInParent(r, node, current)
  if (!source) return null
  try {
    const props = liveProps(r, source, node, settings, node.name)
    if (!props) return null
    // The vector keeps its own paint; only its outline and the effect change.
    return {
      x: props.x,
      y: props.y,
      width: props.width,
      height: props.height,
      vectorNetwork: props.vectorNetwork,
      pluginData: props.pluginData
    }
  } finally {
    source.delete()
  }
}

/** Props that make a live effect's result an ordinary vector: Illustrator's Expand. */
export function expandLiveEffect(node: SceneNode): Partial<SceneNode> | null {
  if (!pathEffectOf(node)) return null
  return { pluginData: withPluginData(node.pluginData, LAWHA_PLUGIN_DATA.pathEffect, undefined) }
}

/**
 * The vector a live effect's layer goes back to: the outline it reshaped, painted as the layer
 * is, or for a width profile the centre line stroked with its paint at its weight, as
 * Illustrator's Release.
 */
export function releaseLiveEffect(r: SkiaRenderer, node: SceneNode): Partial<SceneNode> | null {
  const effect = pathEffectOf(node)
  if (!effect) return null
  const source = effectSourceInParent(r, node, effect)
  if (!source) return null
  try {
    const pluginData = withPluginData(node.pluginData, LAWHA_PLUGIN_DATA.pathEffect, undefined)
    const name = node.name.replace(/ \(Width\)$/, '')
    if (effect.kind !== 'width') {
      return { ...vectorPropsForPath(r, source, node, name), pluginData }
    }
    const paint = node.fills.find((fill) => fill.visible) ?? node.fills.at(0)
    const strokes = paint
      ? [{ ...paint, weight: effect.weight, align: 'CENTER' as const }]
      : node.strokes
    return {
      ...vectorPropsForPath(r, source, { ...node, fills: [], strokes }, name),
      strokeWeight: effect.weight,
      pluginData
    }
  } finally {
    source.delete()
  }
}
