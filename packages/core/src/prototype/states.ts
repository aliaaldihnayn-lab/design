import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { findLayerByPath, layerPath } from '@lawha/scene-graph/behaviours'
import { instanceMainComponent } from '@lawha/scene-graph/instances'

import { runCalendarAction } from './calendar'
import { readInteractions, type Action, type Interaction, type Transition } from './model'
import { shownHighlight } from './suggestions'
import { instanceScope, runVariableActions, type PlayVariables } from './variables'

/**
 * Interactive components: while a prototype runs, each instance can show another variant of
 * its set in place, as Figma's Change to does. The state is which variant each instance shows,
 * by its layer path below the running root, so it survives the variant switches that rebuild
 * an instance's layers with new ids. The document never changes.
 */
export type ComponentStates = ReadonlyMap<string, string>

/** An instance that shows another variant, and how it animates there. */
export interface StateChange {
  /** The instance's layer path below the root. */
  instance: string
  /** The variant it showed. */
  from: string
  /** The variant it shows now. */
  to: string
  transition: Transition
}

/**
 * A change that lasts only while the pointer stays over the layer or held down on it, as
 * While hovering and While pressing: the instance goes back to `variant` on `release`.
 */
export interface StateHold {
  instance: string
  variant: string
  release: 'hover' | 'press'
}

/** What an event on a running root does. */
export interface StateDispatch {
  /** Variant changes, applied in order. */
  changes: StateChange[]
  /** Actions for the host: overlays, navigation, variables, links. */
  actions: Action[]
  holds: StateHold[]
  /** The layer path whose interaction handled the event, or null when none did. */
  handledBy: string | null
  /** The prototype variables after the event: changed by its Set variable actions. */
  variables: PlayVariables
}

const NO_VARIABLES: PlayVariables = new Map()

function nothing(variables: PlayVariables): StateDispatch {
  return { changes: [], actions: [], holds: [], handledBy: null, variables }
}

/** How deep `interactionsOf` follows a layer into the main components it comes from. */
const SOURCE_DEPTH = 8

/** The instance a layer sits in: itself if it is one, else its nearest instance ancestor. */
function owningInstance(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.type === 'INSTANCE') return current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

/**
 * The layer of the main component a layer inside an instance comes from: the main component
 * itself for the instance, otherwise the layer at the same path below it.
 */
function sourceLayer(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  if (node.type === 'INSTANCE') return instanceMainComponent(graph, node) ?? undefined
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  const instance = parent && owningInstance(graph, parent)
  const main = instance && instanceMainComponent(graph, instance)
  if (!instance || !main) return undefined
  return findLayerByPath(graph, main.id, layerPath(graph, instance.id, node.id))
}

/**
 * A layer's interactions: its own, or, for a layer an instance draws, those of the main
 * component layer it comes from, since a variant's reactions run in every instance of it.
 */
export function interactionsOf(graph: SceneGraph, node: SceneNode): Interaction[] {
  let current: SceneNode | undefined = node
  for (let depth = 0; current && depth < SOURCE_DEPTH; depth++) {
    const own = readInteractions(current, graph)
    if (own.length > 0) return own
    current = sourceLayer(graph, current)
  }
  return []
}

/** The component set a variant belongs to, or undefined for a component outside a set. */
function setOf(graph: SceneGraph, variant: SceneNode | undefined): string | undefined {
  const parent = variant?.parentId ? graph.getNode(variant.parentId) : undefined
  return parent?.type === 'COMPONENT_SET' ? parent.id : undefined
}

/**
 * The instance a Change to on `layer` switches: the layer or its nearest ancestor that is an
 * instance of a variant in the destination's set, as Figma swaps the closest such instance.
 */
export function changeTarget(
  graph: SceneGraph,
  layer: SceneNode,
  destination: string
): SceneNode | undefined {
  const set = setOf(graph, graph.getNode(destination))
  if (!set) return undefined
  let current: SceneNode | undefined = layer
  while (current) {
    if (current.type === 'INSTANCE') {
      const main = instanceMainComponent(graph, current)
      if (main && setOf(graph, main) === set) return current
    }
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

/** Every action an interaction runs, in order: its action and the ones after it. */
export function actionsOf(interaction: Interaction): Action[] {
  return [interaction.action, ...(interaction.andThen ?? [])]
}

/** Whether an interaction answers an event: its trigger type, and its key for a key press. */
function answers(interaction: Interaction, type: Interaction['trigger']['type'], key?: string) {
  if (interaction.trigger.type !== type) return false
  if (interaction.trigger.type !== 'key') return true
  return !!key && interaction.trigger.key.toLowerCase() === key.toLowerCase()
}

/**
 * Runs an interaction of the layer at `path` below `rootId` in `graph`, the root as it shows
 * now: Change to actions become state changes, held for hover and press triggers, and every
 * other action goes to the host.
 */
export function runInteraction(
  graph: SceneGraph,
  rootId: string,
  path: string,
  interaction: Interaction,
  variables: PlayVariables = NO_VARIABLES
): StateDispatch {
  const layer = findLayerByPath(graph, rootId, path)
  if (!layer) return nothing(variables)
  const changes: StateChange[] = []
  const actions: Action[] = []
  const holds: StateHold[] = []
  // Variables are set and conditionals decided first, in order, so a branch can Change to.
  const expanded = runLayerActions(graph, rootId, layer, variables, actionsOf(interaction))
  for (const action of expanded.actions) {
    if (action.type !== 'change-to') {
      actions.push(action)
      continue
    }
    const instance = changeTarget(graph, layer, action.destination)
    const from = instance && instanceMainComponent(graph, instance)
    // A highlight on a filtered list skips the options it hides.
    const to = instance && shownHighlight(graph, instance, action.destination)
    if (!instance || !from || !to || from.id === to) continue
    const instancePath = layerPath(graph, rootId, instance.id)
    changes.push({
      instance: instancePath,
      from: from.id,
      to,
      transition: action.transition
    })
    const release = interaction.trigger.type
    if (release === 'hover' || release === 'press')
      holds.push({ instance: instancePath, variant: from.id, release })
  }
  return { changes, actions, holds, handledBy: path, variables: expanded.variables }
}

/**
 * Runs the variable and calendar actions of a layer's list in order, in the instance the layer
 * sits in, and returns the actions left for the player and the variables as they end up.
 */
function runLayerActions(
  graph: SceneGraph,
  rootId: string,
  layer: SceneNode,
  variables: PlayVariables,
  list: readonly Action[]
): { actions: Action[]; variables: PlayVariables } {
  const scope = instanceScope(graph, rootId, layer.id)
  let current = variables
  const actions: Action[] = []
  let pending: Action[] = []
  const flush = () => {
    const run = runVariableActions(graph, current, pending, scope)
    actions.push(...run.actions)
    current = run.variables
    pending = []
  }
  for (const action of list) {
    if (action.type !== 'calendar') {
      pending.push(action)
      continue
    }
    flush()
    const run = runCalendarAction(graph, rootId, layer, current, action)
    current = run.variables
    pending.push(...run.actions)
  }
  flush()
  return { actions, variables: current }
}

/** The layer paths from `path` up to the root, deepest first. */
function ancestorPaths(path: string): string[] {
  const segments = path ? path.split('/') : []
  const out: string[] = []
  for (let i = segments.length; i >= 0; i--) out.push(segments.slice(0, i).join('/'))
  return out
}

/**
 * An event on the layer at `path` below `rootId`, as the root shows now. As in Figma, it goes
 * to the layer and then its ancestors; the nearest one with an interaction for the trigger
 * handles it.
 */
export function dispatchStateEvent(
  graph: SceneGraph,
  rootId: string,
  path: string,
  type: Interaction['trigger']['type'],
  variables: PlayVariables = NO_VARIABLES
): StateDispatch {
  for (const candidate of ancestorPaths(path)) {
    const layer = findLayerByPath(graph, rootId, candidate)
    if (!layer || !layer.visible) continue
    const match = interactionsOf(graph, layer).find((item) => answers(item, type))
    if (match) return runInteraction(graph, rootId, candidate, match, variables)
  }
  return nothing(variables)
}

/** Every visible layer below the root with its path, the root first. */
function layersBelow(graph: SceneGraph, rootId: string): { path: string; node: SceneNode }[] {
  const out: { path: string; node: SceneNode }[] = []
  const walk = (node: SceneNode, path: string) => {
    if (!node.visible) return
    out.push({ path, node })
    for (const child of graph.getChildren(node.id)) walk(child, layerPath(graph, rootId, child.id))
  }
  const root = graph.getNode(rootId)
  if (root) walk(root, '')
  return out
}

/** A key press on a running root: the first layer, in document order, bound to the key. */
export function dispatchStateKey(
  graph: SceneGraph,
  rootId: string,
  key: string,
  variables: PlayVariables = NO_VARIABLES
): StateDispatch {
  for (const { path, node } of layersBelow(graph, rootId)) {
    const match = interactionsOf(graph, node).find((item) => answers(item, 'key', key))
    if (match) return runInteraction(graph, rootId, path, match, variables)
  }
  return nothing(variables)
}

/** An After delay interaction of a layer the root shows now. */
export interface StateTimer {
  path: string
  delay: number
  interaction: Interaction
  /**
   * What the timer belongs to: the layer and the variant of the instance it sits in, so a
   * host restarts it only when that variant shows again.
   */
  key: string
}

/** The After delay interactions of the layers a running root shows now. */
export function stateTimers(graph: SceneGraph, rootId: string): StateTimer[] {
  const timers: StateTimer[] = []
  for (const { path, node } of layersBelow(graph, rootId)) {
    const instance = owningInstance(graph, node)
    const variant = instance ? (instanceMainComponent(graph, instance)?.id ?? '') : ''
    for (const [index, interaction] of interactionsOf(graph, node).entries()) {
      if (interaction.trigger.type !== 'after-delay') continue
      timers.push({
        path,
        delay: interaction.trigger.delay,
        interaction,
        key: `${path}\0${variant}\0${index}`
      })
    }
  }
  return timers
}

/** The layer paths below the root whose layers answer pointer or focus triggers. */
export function interactiveLayers(
  graph: SceneGraph,
  rootId: string
): Map<string, Set<Interaction['trigger']['type']>> {
  const out = new Map<string, Set<Interaction['trigger']['type']>>()
  for (const { path, node } of layersBelow(graph, rootId)) {
    const triggers = interactionsOf(graph, node).map((item) => item.trigger.type)
    if (triggers.length > 0) out.set(path, new Set(triggers))
  }
  return out
}

/**
 * The states after `changes`: each instance shows its new variant, and the instances inside
 * it start again from their designed variants, as Figma resets nested interactive components.
 */
export function applyStateChanges(
  states: ComponentStates,
  changes: readonly Pick<StateChange, 'instance' | 'to'>[]
): Map<string, string> {
  const next = new Map(states)
  for (const change of changes) {
    const prefix = change.instance ? `${change.instance}/` : ''
    for (const path of next.keys())
      if (path !== change.instance && path.startsWith(prefix)) next.delete(path)
    next.set(change.instance, change.to)
  }
  return next
}

/** The variant property values that show a variant, for `resolvePlayState`'s `variants`. */
export function variantValues(graph: SceneGraph, variantId: string): Record<string, string> {
  return { ...graph.getNode(variantId)?.componentPropertyValues }
}

/** Whether a component set's variants change one another in place: any has a Change to. */
export function isInteractiveComponent(graph: SceneGraph, setOrComponent: SceneNode): boolean {
  const variants =
    setOrComponent.type === 'COMPONENT_SET'
      ? graph.getChildren(setOrComponent.id)
      : [setOrComponent]
  const hasChange = (node: SceneNode): boolean =>
    readInteractions(node, graph).some((item) =>
      actionsOf(item).some((action) => action.type === 'change-to')
    ) || graph.getChildren(node.id).some(hasChange)
  return variants.some(hasChange)
}

/**
 * The variants a Change to on a layer can show: those of the set whose variant holds the
 * layer, or, for a layer an instance draws, those of the instance's set; the nearest wins.
 */
export function changeDestinations(graph: SceneGraph, nodeId: string): SceneNode[] {
  let current = graph.getNode(nodeId)
  while (current) {
    const own = current.type === 'COMPONENT' ? current : undefined
    const variant = current.type === 'INSTANCE' ? instanceMainComponent(graph, current) : own
    const set = setOf(graph, variant ?? undefined)
    if (set) return graph.getChildren(set).filter((child) => child.type === 'COMPONENT')
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return []
}
