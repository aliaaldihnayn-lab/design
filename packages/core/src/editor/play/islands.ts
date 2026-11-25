import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { hasBehaviour } from '@lawha/scene-graph/behaviours'
import { instanceMainComponent } from '@lawha/scene-graph/instances'

import { interactionsOf, isInteractiveComponent } from '#core/prototype/states'
import { readPropertyBindings } from '#core/prototype/variables'

/** A control with a behaviour, or a layer with interactions: an interactive component's too. */
function containsControl(graph: SceneGraph, node: SceneNode): boolean {
  if (hasBehaviour(graph, node) || interactionsOf(graph, node).length > 0) return true
  if (Object.keys(readPropertyBindings(node)).length > 0) return true
  return graph.getChildren(node.id).some((child) => containsControl(graph, child))
}

/**
 * The layers a previewing canvas runs as live islands: each top-level layer of the page that
 * holds an instance with a behaviour or a layer with prototype interactions, so the controls
 * and interactive components inside it and the layout around them run live in place. The
 * canvas leaves them to the islands.
 */
export function playIslandRoots(graph: SceneGraph, pageId: string): string[] {
  return graph
    .getChildren(pageId)
    .filter((node) => node.visible && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET')
    .filter((node) => containsControl(graph, node))
    .map((node) => node.id)
}

/**
 * The triggers the player's drawn screens answer, on their hotspots or for the whole screen;
 * a layer with another, such as mouse enter, drag, or focus, needs its screen run live.
 */
const DRAWN_SCREEN_TRIGGERS = new Set(['click', 'hover', 'press', 'key', 'after-delay'])

/**
 * Whether a layer is, or holds, a control, an interactive component instance, or a trigger only
 * a live screen answers.
 */
function holdsComponent(graph: SceneGraph, node: SceneNode): boolean {
  if (hasBehaviour(graph, node) || Object.keys(readPropertyBindings(node)).length > 0) return true
  if (
    interactionsOf(graph, node).some(
      (interaction) => !DRAWN_SCREEN_TRIGGERS.has(interaction.trigger.type)
    )
  )
    return true
  if (node.type === 'INSTANCE') {
    const main = instanceMainComponent(graph, node)
    const owner = main?.parentId ? graph.getNode(main.parentId) : undefined
    if (main && isInteractiveComponent(graph, owner?.type === 'COMPONENT_SET' ? owner : main))
      return true
  }
  return graph.getChildren(node.id).some((child) => holdsComponent(graph, child))
}

/**
 * The screens of a page that hold live components: controls with behaviours, interactive
 * components, or layers with triggers such as drag or focus. The prototype player runs these as
 * islands; screens with only clicks, hovers, presses, keys, and delays keep its drawn images and
 * hotspots.
 */
export function liveComponentScreens(graph: SceneGraph, screenIds: readonly string[]): string[] {
  return screenIds.filter((id) => {
    const node = graph.getNode(id)
    return !!node && holdsComponent(graph, node)
  })
}
