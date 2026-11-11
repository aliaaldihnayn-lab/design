import { omit } from 'es-toolkit'
import * as v from 'valibot'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { findLayerByPath } from '@lawha/scene-graph/behaviours'

import type { FigmaAPI, FigmaComponentNode } from '#core/figma-api'
import { getPluginData, setPluginData } from '#core/figma-api/plugin-data'
import {
  INTERACTIONS_KEY,
  readInteractions,
  type Action,
  type Interaction
} from '#core/prototype/model'
import { actionSchema, transitionSchema, triggerSchema } from '#core/prototype/schema'
import {
  PROPERTY_BINDINGS_KEY,
  readPropertyBindings,
  type PropertyBinding
} from '#core/prototype/variables'
import { defineTool, requireNode } from '#core/tools/schema'

/**
 * Tools that author interactive components: states as variants of one set, the interactions
 * that move an instance between them in place, and component properties that follow prototype
 * variables. They write the same model the prototype panel and the kit write.
 */

const DEFAULT_TRANSITION = {
  type: 'smart-animate',
  direction: 'left',
  duration: 200,
  easing: 'ease-out'
} as const

const stateInteractionSchema = v.object({
  from: v.pipe(v.string(), v.minLength(1), v.description('The state (variant value) it starts in')),
  layer: v.optional(
    v.pipe(
      v.string(),
      v.description(
        'Layer path inside that variant, names joined by "/"; the variant itself when empty'
      )
    ),
    ''
  ),
  trigger: triggerSchema,
  to: v.optional(
    v.pipe(v.string(), v.description('The state to change to in place (Change to); omit for none'))
  ),
  transition: v.optional(transitionSchema),
  actions: v.optional(
    v.pipe(
      v.array(actionSchema),
      v.maxLength(20),
      v.description('Further actions: set-variable, conditional, overlay, close-overlay, …')
    )
  )
})

type StateInteraction = v.InferOutput<typeof stateInteractionSchema>

/** The variant of a set that shows a state of its property, by value or by full name. */
function variantFor(graph: SceneGraph, set: SceneNode, property: string, state: string) {
  return graph
    .getChildren(set.id)
    .find(
      (variant) =>
        variant.componentPropertyValues[property] === state ||
        variant.name === state ||
        variant.name === `${property}=${state}`
    )
}

/** The variant property a set's states are written in: the given one, else its first. */
function stateProperty(set: SceneNode, property: string | undefined): string | undefined {
  if (property) return property
  return set.componentPropertyDefinitions.find((item) => item.type === 'VARIANT')?.name
}

function addInteraction(graph: SceneGraph, node: SceneNode, interaction: Interaction): void {
  const current = graph.getNode(node.id)
  if (!current) return
  setPluginData(
    graph,
    current,
    INTERACTIONS_KEY,
    JSON.stringify([...readInteractions(current, graph), interaction])
  )
}

/** Writes one state interaction on a set; an error message when a name does not resolve. */
function writeStateInteraction(
  graph: SceneGraph,
  set: SceneNode,
  property: string,
  item: StateInteraction
): string | null {
  const from = variantFor(graph, set, property, item.from)
  if (!from) return `${set.name} has no state ${item.from}`
  const layer = findLayerByPath(graph, from.id, item.layer)
  if (!layer) return `${from.name} has no layer ${item.layer}`
  const actions: Action[] = []
  if (item.to !== undefined) {
    const to = variantFor(graph, set, property, item.to)
    if (!to) return `${set.name} has no state ${item.to}`
    actions.push({
      type: 'change-to',
      destination: to.id,
      transition: item.transition ?? { ...DEFAULT_TRANSITION }
    })
  }
  actions.push(...(item.actions ?? []))
  if (actions.length === 0) return 'Give "to" or at least one action'
  const [action, ...andThen] = actions
  addInteraction(
    graph,
    layer,
    andThen.length > 0
      ? { trigger: item.trigger, action, andThen }
      : { trigger: item.trigger, action }
  )
  return null
}

/** A component set from a set, or from a frame or component cloned once per state. */
function setFromNode(
  figma: FigmaAPI,
  id: string,
  property: string,
  states: readonly string[]
): { set: SceneNode } | { error: string } {
  const proxy = requireNode(figma, id)
  const raw = figma.graph.getNode(id)
  if (!proxy || !raw) return { error: `Node ${id} not found` }
  if (raw.type === 'COMPONENT_SET') return { set: raw }
  if (states.length < 2) return { error: 'Give at least two states to make variants from a layer' }
  const base = raw.type === 'COMPONENT' ? proxy : figma.createComponentFromNode(proxy)
  const components: FigmaComponentNode[] = []
  for (const [index, state] of states.entries()) {
    const node = index === 0 ? base : base.clone()
    node.name = `${property}=${state}`
    if (index > 0) node.x = base.x + index * (base.width + 40)
    if (node.type !== 'COMPONENT') return { error: 'Could not make a component of the layer' }
    components.push(node as FigmaComponentNode)
  }
  const name = raw.name
  const parent = base.parent ?? figma.currentPage
  const set = figma.combineAsVariants(components, parent)
  // The set keeps the layer's name, as the control it is.
  set.name = name
  const created = figma.graph.getNode(set.id)
  return created ? { set: created } : { error: 'Could not combine the states' }
}

export const createInteractiveComponent = defineTool({
  name: 'create_interactive_component',
  description:
    'Make an interactive component: every state of a control is a variant of ONE component set, and interactions change an instance between them in place (Figma’s Change to), so a dropdown opens, a tab switches, or a button shows hover and pressed on the same frame in preview and the player, never one frame per state. Pass a component set, or a frame or component with states (["Closed", "Open"]) to clone it into variants named <property>=<state>, then edit each variant’s look. interactions: { from, layer (path inside the from variant), trigger (click, hover = while hovering, press = while pressing, key, after-delay, mouse-enter/leave, focus, blur, drag), to, transition (smart-animate, dissolve, move-in, push, slide-in, …; easing incl. spring and custom-spring), actions (set-variable, conditional, overlay, close-overlay …) }.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: v.pipe(
      v.string(),
      v.description('A component set, or a frame or component to make the states from')
    ),
    property: v.optional(v.pipe(v.string(), v.minLength(1)), 'State'),
    states: v.optional(v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.maxLength(24)), []),
    interactions: v.optional(v.pipe(v.array(stateInteractionSchema), v.maxLength(100)), [])
  }),
  execute: (figma, args) => {
    const made = setFromNode(figma, args.id, args.property, args.states)
    if ('error' in made) return made
    const property = stateProperty(made.set, args.property) ?? args.property
    for (const item of args.interactions) {
      const error = writeStateInteraction(figma.graph, made.set, property, item)
      if (error) return { error, id: made.set.id }
    }
    return {
      id: made.set.id,
      name: made.set.name,
      variants: figma.graph
        .getChildren(made.set.id)
        .map((variant) => ({ id: variant.id, name: variant.name })),
      interactions: args.interactions.length
    }
  }
})

export const addStateInteraction = defineTool({
  name: 'add_state_interaction',
  description:
    'Add one in-place interaction to an interactive component set: on a layer of the "from" state’s variant, a trigger changes the instance to the "to" state with a transition, and may run further actions (set-variable, conditional, overlay, close-overlay). Hover and press changes last only while the pointer is over or down, as Figma’s While hovering and While pressing.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    set_id: v.pipe(v.string(), v.description('The component set whose variants are the states')),
    property: v.optional(
      v.pipe(
        v.string(),
        v.description('Variant property of the states; the set’s first by default')
      )
    ),
    ...stateInteractionSchema.entries
  }),
  execute: (figma, args) => {
    const set = figma.graph.getNode(args.set_id)
    if (set?.type !== 'COMPONENT_SET') return { error: `${args.set_id} is not a component set` }
    const property = stateProperty(set, args.property)
    if (!property) return { error: `${set.name} has no variant property` }
    const error = writeStateInteraction(figma.graph, set, property, args)
    return error ? { error } : { set_id: set.id, from: args.from, to: args.to ?? null }
  }
})

export const bindPropertyToVariable = defineTool({
  name: 'bind_property_to_variable',
  description:
    'Make an instance’s component property follow a prototype variable while the design runs: a variant property shows the variable’s value (or the on/off values for a boolean, such as State Default while agreed is true and Disabled while it is false), a boolean or text property takes its value. With set-variable actions this lets one control drive another, as a checkbox enabling a button. Pass variable: null to remove the binding.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    instance_id: v.string(),
    property: v.pipe(v.string(), v.description('The component property’s name, such as State')),
    variable: v.nullable(v.pipe(v.string(), v.description('Variable id or name'))),
    on: v.optional(v.string()),
    off: v.optional(v.string())
  }),
  execute: (figma, args) => {
    const node = figma.graph.getNode(args.instance_id)
    if (node?.type !== 'INSTANCE') return { error: `${args.instance_id} is not an instance` }
    const bindings: Record<string, PropertyBinding> = omit(readPropertyBindings(node), [
      args.property
    ])
    if (args.variable !== null) {
      const variable =
        figma.graph.variables.get(args.variable) ??
        [...figma.graph.variables.values()].find((item) => item.name === args.variable)
      if (!variable) return { error: `No variable ${args.variable}` }
      bindings[args.property] =
        args.on !== undefined || args.off !== undefined
          ? { variable: variable.id, on: args.on, off: args.off }
          : variable.id
    }
    const empty = Object.keys(bindings).length === 0
    if (empty && !getPluginData(node, PROPERTY_BINDINGS_KEY))
      return { instance_id: node.id, bindings }
    setPluginData(figma.graph, node, PROPERTY_BINDINGS_KEY, empty ? '' : JSON.stringify(bindings))
    return { instance_id: node.id, bindings }
  }
})
