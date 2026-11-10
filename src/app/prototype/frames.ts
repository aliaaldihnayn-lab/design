import { renderNodesToImage } from '@lawha/core/io/formats/raster'
import {
  rectMapping,
  scrollContentGraph,
  scrollRegions,
  smartAnimateGraph,
  smartAnimatePlan,
  type ScrollRegion
} from '@lawha/core/prototype'
import type { SceneGraph } from '@lawha/scene-graph'

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

/** A screen as the player draws it: the screen, and the content of each frame that scrolls. */
export interface ScreenImages {
  screen: string
  regions: { region: ScrollRegion; image: string }[]
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
      image: draw(store, scrollContentGraph(graph, region), region.node, scale)
    }))
  }
}

/** One moving layer: its image on each screen and the CSS matrices that swap their places. */
export interface SmartLayer {
  from: string
  to: string
  /** Carries the outgoing image onto the incoming layer's place (screen units). */
  forward: [number, number, number, number]
  /** Carries the incoming image back to where the layer starts. */
  backward: [number, number, number, number]
}

export interface SmartFrames {
  from: string
  to: string
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
  scale: number
): SmartFrames {
  const graph = store.graph
  const pairs = smartAnimatePlan(graph, fromScreen, toScreen).pairs.slice(0, MAX_SMART_LAYERS)
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
    layers: pairs.map((pair) => ({
      from: draw(
        store,
        smartAnimateGraph(graph, fromScreen, { kind: 'layer', node: pair.from, hide: fromIds }),
        fromScreen,
        scale
      ),
      to: draw(
        store,
        smartAnimateGraph(graph, toScreen, { kind: 'layer', node: pair.to, hide: toIds }),
        toScreen,
        scale
      ),
      forward: rectMapping(pair.fromState, pair.toState),
      backward: rectMapping(pair.toState, pair.fromState)
    }))
  }
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
