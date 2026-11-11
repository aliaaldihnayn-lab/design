import type { SceneGraph, SceneNode, VariableType, VariableValue } from '@lawha/scene-graph'
import { findLayerByPath } from '@lawha/scene-graph/behaviours'

import { setPluginData } from '#core/figma-api/plugin-data'
import {
  INTERACTIONS_KEY,
  readInteractions,
  type Action,
  type Interaction,
  type Transition
} from '#core/prototype/model'
import { withVariableScope } from '#core/prototype/variables'

/** The collection the kit keeps its controls' shared state in, such as a select's value. */
export const KIT_STATE_COLLECTION = 'Kit state'

export const INSTANT: Transition = {
  type: 'instant',
  direction: 'left',
  duration: 0,
  easing: 'linear'
}
export const QUICK: Transition = {
  type: 'smart-animate',
  direction: 'left',
  duration: 160,
  easing: 'ease-out'
}
export const DISSOLVE: Transition = {
  type: 'dissolve',
  direction: 'left',
  duration: 160,
  easing: 'ease-out'
}

/**
 * Wires a kit component set's variants together after it is drawn: the layers of each variant
 * by name, the interactions between them, and the variables they share.
 */
export class KitWiring {
  constructor(
    readonly graph: SceneGraph,
    readonly set: SceneNode
  ) {}

  /** The variant of the set with exactly these property values, as `State=Open`. */
  variant(name: string): SceneNode {
    const found = this.graph.getChildren(this.set.id).find((child) => child.name === name)
    if (!found) throw new Error(`${this.set.name} has no variant ${name}`)
    return found
  }

  /** A layer of a variant by its path of names, or the variant itself for ''. */
  layer(variant: string, path = ''): SceneNode {
    const found = findLayerByPath(this.graph, this.variant(variant).id, path)
    if (!found) throw new Error(`${this.set.name} ${variant} has no layer ${path}`)
    return found
  }

  /** A layer below another by its path of names, or the layer itself for ''. */
  below(root: SceneNode, path = ''): SceneNode {
    const found = findLayerByPath(this.graph, root.id, path)
    if (!found) throw new Error(`${root.name} has no layer ${path}`)
    return found
  }

  /** Adds an interaction to a layer, after the ones it has. */
  on(node: SceneNode, trigger: Interaction['trigger'], actions: readonly Action[]): void {
    if (actions.length === 0) return
    const [action, ...andThen] = actions
    const interaction: Interaction =
      andThen.length > 0 ? { trigger, action, andThen } : { trigger, action }
    const current = this.graph.getNode(node.id)
    if (!current) return
    setPluginData(
      this.graph,
      current,
      INTERACTIONS_KEY,
      JSON.stringify([...readInteractions(current), interaction])
    )
  }

  /** Change to another variant of the set. */
  changeTo(
    variant: string,
    transition: Transition = QUICK
  ): Extract<Action, { type: 'change-to' }> {
    return { type: 'change-to', destination: this.variant(variant).id, transition }
  }

  /** A variable of the kit's state collection, created on first use and reused after. */
  variable(name: string, type: VariableType, value: VariableValue): string {
    const graph = this.graph
    const collection =
      [...graph.variableCollections.values()].find((item) => item.name === KIT_STATE_COLLECTION) ??
      graph.createCollection(KIT_STATE_COLLECTION)
    const existing = [...graph.variables.values()].find(
      (variable) => variable.collectionId === collection.id && variable.name === name
    )
    if (existing) return existing.id
    // Each instance of the control keeps its own value, as two selects hold their own picks.
    const created = graph.createVariable(name, type, collection.id, value)
    created.pluginData = withVariableScope(created, 'instance')
    return created.id
  }

  /** Keeps Lawha data on a layer, such as the suggestions a variant filters. */
  data(node: SceneNode, key: string, value: unknown): void {
    const current = this.graph.getNode(node.id)
    if (current) setPluginData(this.graph, current, key, JSON.stringify(value))
  }

  /** Shows a variable's value in a text layer, or shows the layer only while it is true. */
  bind(node: SceneNode, field: 'text' | 'visible', variableId: string): void {
    this.graph.bindVariable(node.id, field, variableId)
  }
}
