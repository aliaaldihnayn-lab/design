import { renderNodesToImage } from '@lawha/core/io/formats/raster'
import {
  pinnedLayerGraph,
  rectMapping,
  scrollContentGraph,
  scrollRegions,
  smartAnimateGraph,
  smartAnimatePlan,
  type GeometryStyle,
  type ScrollRegion
} from '@lawha/core/prototype'
import type { SceneGraph } from '@lawha/scene-graph'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'

/** The most layers Smart Animate moves on their own; the rest cross-fade with their screen. */
const MAX_SMART_LAYERS = 40

/** Draws one layer of a private copy of the document as a PNG object URL; '' when empty. */
function draw(
  store: EditorStore,
  copy: { graph: SceneGraph; pageId: string } | null,
  nodeId: string,
  scale: number
): string {
  const renderer = store.renderer
  if (!renderer || !copy) return ''
  const bytes = renderNodesToImage(renderer.ck, renderer, copy.graph, copy.pageId, [nodeId], {
    scale,
    format: 'PNG'
  })
  return bytes ? URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) : ''
}

/** A scrolling frame as the player draws it: its content, and its fixed and sticky layers. */
export interface RegionImages {
  region: ScrollRegion
  image: string
  /** Each pinned layer's image, by node id. */
  pinned: Record<string, string>
}

/** A screen as the player draws it: the screen, and the content of each frame that scrolls. */
export interface ScreenImages {
  screen: string
  regions: RegionImages[]
}

/** Every object URL a screen's images hold. */
export function screenImageURLs(entry: ScreenImages): string[] {
  return [
    entry.screen,
    ...entry.regions.flatMap((region) => [region.image, ...Object.values(region.pinned)])
  ]
}

/** Renders a screen; content in scrolling frames is drawn apart so the player can scroll it. */
export function renderScreen(store: EditorStore, screenId: string, scale: number): ScreenImages {
  const graph = store.graph
  const regions = scrollRegions(graph, screenId)
  const hide = regions.flatMap((region) => graph.getNode(region.node)?.childIds ?? [])
  return {
    screen: draw(
      store,
      smartAnimateGraph(graph, screenId, { kind: 'background', hide }),
      screenId,
      scale
    ),
    regions: regions.map((region) => ({
      region,
      image: draw(store, scrollContentGraph(graph, region, regions), region.node, scale),
      pinned: Object.fromEntries(
        region.pinned.map((layer) => [
          layer.node,
          draw(store, pinnedLayerGraph(graph, layer), layer.node, scale)
        ])
      )
    }))
  }
}

/**
 * One moving layer: its image on each screen and the CSS matrices that swap their places, or,
 * for a box, its geometry at each end, which the player tweens without images.
 */
export interface SmartLayer {
  from: string
  to: string
  geometry: { from: GeometryStyle; to: GeometryStyle } | null
  /** Carries the outgoing image onto the incoming layer's place (screen units). */
  forward: [number, number, number, number]
  /** Carries the incoming image back to where the layer starts. */
  backward: [number, number, number, number]
}

export interface SmartFrames {
  from: string
  to: string
  /** Where each screen's images sit, in the outgoing screen's units. */
  fromBox: Rect
  toBox: Rect
  layers: SmartLayer[]
}

/**
 * Frame images for Smart Animate between two screens: each screen without its matched layers,
 * and each matched layer alone on each screen, so the player can tween every layer from where
 * it is to where it goes while the rest cross-fades.
 */
export function renderSmartAnimate(
  store: EditorStore,
  fromScreen: string,
  toScreen: string,
  scale: number,
  /** Where the incoming screen sits over the outgoing one, as an overlay does. */
  toOffset: Vector = { x: 0, y: 0 }
): SmartFrames {
  const graph = store.graph
  const pairs = smartAnimatePlan(graph, fromScreen, toScreen, toOffset).pairs.slice(
    0,
    MAX_SMART_LAYERS
  )
  const size = (id: string) => {
    const node = graph.getNode(id)
    return { width: node?.width ?? 0, height: node?.height ?? 0 }
  }
  const fromIds = pairs.map((p) => p.from)
  const toIds = pairs.map((p) => p.to)
  return {
    from: draw(
      store,
      smartAnimateGraph(graph, fromScreen, { kind: 'background', hide: fromIds }),
      fromScreen,
      scale
    ),
    to: draw(
      store,
      smartAnimateGraph(graph, toScreen, { kind: 'background', hide: toIds }),
      toScreen,
      scale
    ),
    fromBox: { x: 0, y: 0, ...size(fromScreen) },
    toBox: { ...toOffset, ...size(toScreen) },
    layers: pairs.map((pair) => ({
      geometry: pair.geometry,
      from: pair.geometry
        ? ''
        : draw(
            store,
            smartAnimateGraph(graph, fromScreen, { kind: 'layer', node: pair.from, hide: fromIds }),
            fromScreen,
            scale
          ),
      to: pair.geometry
        ? ''
        : draw(
            store,
            smartAnimateGraph(graph, toScreen, { kind: 'layer', node: pair.to, hide: toIds }),
            toScreen,
            scale
          ),
      forward: rectMapping(pair.fromState, pair.toState),
      // The incoming image sits in the incoming screen's box, so its mapping starts there.
      backward: rectMapping(shift(pair.toState, toOffset), shift(pair.fromState, toOffset))
    }))
  }
}

function shift(rect: Rect, by: Vector): Rect {
  return { x: rect.x - by.x, y: rect.y - by.y, width: rect.width, height: rect.height }
}

export function revokeSmartFrames(frames: SmartFrames | null): void {
  if (!frames) return
  for (const url of [frames.from, frames.to, ...frames.layers.flatMap((l) => [l.from, l.to])])
    if (url) URL.revokeObjectURL(url)
}

/** A CSS matrix for a mapping in screen units, drawn at `scale` CSS pixels per unit. */
export function cssMatrix(
  [sx, sy, tx, ty]: [number, number, number, number],
  scale: number
): string {
  return `matrix(${sx}, 0, 0, ${sy}, ${tx * scale}, ${ty * scale})`
}
