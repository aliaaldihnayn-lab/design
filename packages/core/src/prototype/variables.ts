import * as v from 'valibot'

import type {
  ComponentPropertyDefinition,
  SceneGraph,
  SceneNode,
  Variable
} from '@lawha/scene-graph'
import { findLayerByPath, layerPath } from '@lawha/scene-graph/behaviours'
import { componentPropertyDefinitions } from '@lawha/scene-graph/components'
import { resolveVariable, variableText, variableTruthy } from '@lawha/scene-graph/variables'

import { getPluginData, LAWHA_PLUGIN_DATA_NAMESPACE } from '#core/figma-api/plugin-data'

import type { Action } from './model'
import type { conditionSchema, playValueSchema } from './schema'

/**
 * Prototype variables: values a running prototype sets and reads, so one control can drive
 * another, as Figma's prototype variables. They start at the document's values in the active
 * modes and change only while the prototype runs; the document never changes.
 */
export type PlayValue = v.InferOutput<typeof playValueSchema>
export type Condition = v.InferOutput<typeof conditionSchema>

/** The variables a running prototype has set, by variable id. */
export type PlayVariables = ReadonlyMap<string, PlayValue>

/** What an instance's component properties show, bound to variables by property name. */
export const PROPERTY_BINDINGS_KEY = 'prototype.bindings'

/**
 * A property's binding: the variable's id, or the variable with the variant values its true and
 * false show, such as a Disabled state while a box is unchecked.
 */
const propertyBindingSchema = v.union([
  v.string(),
  v.object({ variable: v.string(), on: v.optional(v.string()), off: v.optional(v.string()) })
])
const propertyBindingsSchema = v.record(v.string(), propertyBindingSchema)

export type PropertyBinding = v.InferOutput<typeof propertyBindingSchema>

/**
 * A variable's scope while the prototype runs, as Lawha data on the variable: `instance` keeps a
 * value for each instance that sets or shows it, so two selects hold their own picks; otherwise
 * one value is shared by every layer that uses it.
 */
export const VARIABLE_SCOPE_KEY = 'prototype.scope'

export type VariableScope = 'instance' | 'shared'

/** Whether a variable keeps a value per instance while the prototype runs. */
/** The variable with this id, or else the one with this name. */
export function findVariable(graph: SceneGraph, idOrName: string): Variable | undefined {
  return (
    graph.variables.get(idOrName) ??
    [...graph.variables.values()].find((variable) => variable.name === idOrName)
  )
}

export function variableScope(variable: Variable | undefined): VariableScope {
  const entry = variable?.pluginData?.find(
    (item) => item.pluginId === LAWHA_PLUGIN_DATA_NAMESPACE && item.key === VARIABLE_SCOPE_KEY
  )
  return entry?.value === 'instance' ? 'instance' : 'shared'
}

/** A variable's plugin data with its scope set: per instance, or shared, the default. */
export function withVariableScope(
  variable: Variable,
  scope: VariableScope
): Variable['pluginData'] {
  const kept = (variable.pluginData ?? []).filter(
    (item) => !(item.pluginId === LAWHA_PLUGIN_DATA_NAMESPACE && item.key === VARIABLE_SCOPE_KEY)
  )
  return scope === 'instance'
    ? [...kept, { pluginId: LAWHA_PLUGIN_DATA_NAMESPACE, key: VARIABLE_SCOPE_KEY, value: scope }]
    : kept
}

/**
 * The instance a layer's per-instance variables belong to: the layer, if it is an instance,
 * or its nearest instance ancestor below the root, by root and layer path; null outside one.
 */
export function instanceScope(graph: SceneGraph, rootId: string, layerId: string): string | null {
  let current = graph.getNode(layerId)
  while (current && current.id !== rootId) {
    if (current.type === 'INSTANCE') return `${rootId}\u0000${layerPath(graph, rootId, current.id)}`
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return null
}

/** Where a running variable's value is kept: its id, with the instance for a per-instance one. */
export function playKey(graph: SceneGraph, variableId: string, scope?: string | null): string {
  if (!scope || variableScope(graph.variables.get(variableId)) !== 'instance') return variableId
  return `${variableId}\u0000${scope}`
}

/**
 * A variable's value while the prototype runs: as set, in the instance `scope` names for a
 * per-instance variable, else the document's in its mode.
 */
export function playValue(
  graph: SceneGraph,
  variables: PlayVariables,
  variableId: string,
  scope?: string | null
): PlayValue | undefined {
  const key = playKey(graph, variableId, scope)
  if (variables.has(key)) return variables.get(key)
  const value = resolveVariable(graph, variableId)
  return typeof value === 'object' ? undefined : value
}

function compare(op: Condition['op'], left: PlayValue | undefined, right: PlayValue | undefined) {
  switch (op) {
    case 'truthy':
      return variableTruthy(left) === true
    case 'falsy':
      return variableTruthy(left) !== true
    case 'eq':
      return String(left) === String(right)
    case 'neq':
      return String(left) !== String(right)
  }
  const a = Number(left)
  const b = Number(right)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (op === 'gt') return a > b
  if (op === 'gte') return a >= b
  if (op === 'lt') return a < b
  return a <= b
}

/** Whether every condition holds for the variables' running values. */
export function conditionsHold(
  graph: SceneGraph,
  variables: PlayVariables,
  conditions: readonly Condition[],
  scope?: string | null
): boolean {
  return conditions.every((condition) =>
    compare(condition.op, playValue(graph, variables, condition.variable, scope), condition.value)
  )
}

/** The value a Set variable gives: its value, the opposite, or the sum. */
function setValue(
  graph: SceneGraph,
  variables: PlayVariables,
  action: Extract<Action, { type: 'set-variable' }>,
  scope?: string | null
): PlayValue | undefined {
  const current = playValue(graph, variables, action.variable, scope)
  if (action.toggle) return !(variableTruthy(current) ?? false)
  if (action.add !== undefined) return (Number(current) || 0) + action.add
  return action.value
}

/**
 * Runs the variable actions of a list in order, conditionals choosing their branch from the
 * values set before them, and returns the other actions for the player to run and the
 * variables as they end up.
 */
export function runVariableActions(
  graph: SceneGraph,
  variables: PlayVariables,
  actions: readonly Action[],
  /** The instance the actions run in, which per-instance variables are kept for. */
  scope?: string | null
): { actions: Action[]; variables: Map<string, PlayValue> } {
  const next = new Map(variables)
  const out: Action[] = []
  const visit = (list: readonly Action[]) => {
    for (const action of list) {
      if (action.type === 'set-variable') {
        const value = setValue(graph, next, action, scope)
        if (value !== undefined) next.set(playKey(graph, action.variable, scope), value)
      } else if (action.type === 'conditional')
        visit(
          conditionsHold(graph, next, action.when, scope)
            ? action.actions
            : (action.otherwise ?? [])
        )
      else out.push(action)
    }
  }
  visit(actions)
  return { actions: out, variables: next }
}

/** The component properties an instance shows from variables, by property name. */
export function readPropertyBindings(node: SceneNode): Record<string, PropertyBinding> {
  const text = getPluginData(node, PROPERTY_BINDINGS_KEY)
  if (!text) return {}
  const parsed = v.safeParse(v.pipe(v.string(), v.parseJson(), propertyBindingsSchema), text)
  return parsed.success ? parsed.output : {}
}

/** Variant values that mean on and off, matched case-insensitively. */
const ON_WORDS = ['true', 'on', 'yes', 'checked', 'open', 'selected', 'active', 'enabled']
const OFF_WORDS = ['false', 'off', 'no', 'unchecked', 'closed', 'default', 'inactive', 'disabled']

/** The option of a variant property a value shows: its text, or for a boolean, on or off. */
function variantOption(options: readonly string[], value: PlayValue): string | undefined {
  const text = String(value).toLowerCase()
  const exact = options.find((option) => option.toLowerCase() === text)
  if (exact || typeof value !== 'boolean') return exact
  const words = value ? ON_WORDS : OFF_WORDS
  return options.find((option) => words.includes(option.toLowerCase()))
}

/** What an instance with bound properties shows: variant values and other property values. */
export interface BoundInstanceState {
  variants: Record<string, string>
  properties: Record<string, string>
}

/** Shows a bound property's value in an instance's state, as its type takes it. */
function showBoundProperty(
  state: BoundInstanceState,
  definition: ComponentPropertyDefinition,
  binding: PropertyBinding | undefined,
  value: PlayValue
): void {
  if (definition.type === 'VARIANT') {
    const on = variableTruthy(value) ?? false
    const mapped = typeof binding === 'object' ? (on ? binding.on : binding.off) : undefined
    const option = mapped ?? variantOption(definition.variantOptions ?? [], value)
    if (option) state.variants[definition.name] = option
  } else if (definition.type === 'BOOLEAN')
    state.properties[definition.id] = String(variableTruthy(value) ?? false)
  else if (definition.type === 'TEXT') state.properties[definition.id] = variableText(value) ?? ''
}

/**
 * The states the variables give the instances below a root, by layer path: each property an
 * instance binds to a variable shows the variable's running value.
 */
export function boundInstanceStates(
  graph: SceneGraph,
  rootId: string,
  variables: PlayVariables
): Map<string, BoundInstanceState> {
  const out = new Map<string, BoundInstanceState>()
  const walk = (node: SceneNode) => {
    if (node.type === 'INSTANCE') {
      const bindings = readPropertyBindings(node)
      const state: BoundInstanceState = { variants: {}, properties: {} }
      for (const definition of componentPropertyDefinitions(graph, node)) {
        const binding = Object.hasOwn(bindings, definition.name)
          ? bindings[definition.name]
          : undefined
        const variableId = typeof binding === 'string' ? binding : binding?.variable
        const scope = instanceScope(graph, rootId, node.id)
        const value = variableId ? playValue(graph, variables, variableId, scope) : undefined
        if (value === undefined) continue
        showBoundProperty(state, definition, binding, value)
      }
      if (Object.keys(state.variants).length + Object.keys(state.properties).length > 0)
        out.set(layerPath(graph, rootId, node.id), state)
    }
    for (const child of graph.getChildren(node.id)) walk(child)
  }
  const root = graph.getNode(rootId)
  if (root) walk(root)
  return out
}

/**
 * Shows the running values of the variables a private graph's layers bind their text and
 * visibility to: as the prototype has set them, else the document's in the active modes.
 * Writes into `graph`, a copy the caller owns, and returns the layers it changed.
 */
export function showPlayVariables(
  graph: SceneGraph,
  rootId: string,
  variables: PlayVariables
): string[] {
  const changed: string[] = []
  const walk = (node: SceneNode, scope: string | null) => {
    const own = node.type === 'INSTANCE' ? instanceScope(graph, rootId, node.id) : scope
    const text = node.boundVariables.text
    if (node.type === 'TEXT' && text) {
      const shown = variableText(playValue(graph, variables, text, own))
      if (shown !== undefined && shown !== node.text) {
        graph.updateNode(node.id, { text: shown, styleRuns: [], derivedTextGlyphs: null })
        changed.push(node.id)
      }
    }
    const visible = node.boundVariables.visible
    if (visible) {
      const shown = variableTruthy(playValue(graph, variables, visible, own))
      if (shown !== undefined && shown !== node.visible) {
        graph.updateNode(node.id, { visible: shown })
        changed.push(node.id)
      }
    }
    for (const child of graph.getChildren(node.id)) walk(child, own)
  }
  const root = findLayerByPath(graph, rootId, '')
  if (root) walk(root, null)
  return changed
}
