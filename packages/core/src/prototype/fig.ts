import { isEqual } from 'es-toolkit'
import * as v from 'valibot'

import type { GUID } from '@lawha/kiwi/fig'
import { guidToString } from '@lawha/kiwi/fig/guid'
import type { SceneGraph, SceneNode } from '@lawha/scene-graph'

import {
  conditionalFromFig,
  conditionalToFig,
  setVariableFromFig,
  setVariableToFig,
  type FigVariableIds
} from './fig-variables'
import type { Action, Interaction, Transition } from './model'
import { DIRECTIONS, EASINGS, triggerSchema } from './schema'

/** A pointer or focus trigger, as `triggerSchema` reads it. */
const pointerTriggerSchema = v.pipe(
  triggerSchema,
  v.check((trigger) => trigger.type !== 'after-delay' && trigger.type !== 'key')
)

/**
 * Figma's own prototype interactions, as a `.fig` record keeps them (`prototypeInteractions`),
 * read into Lawha's and written back, Set variable and conditionals included. Interactions
 * Figma has no equivalent for, such as focus triggers and calendars, stay in Lawha's plugin
 * data only.
 */

type Direction = (typeof DIRECTIONS)[number]

const TRIGGER_TO_FIG: Partial<Record<Interaction['trigger']['type'], string>> = {
  click: 'ON_CLICK',
  hover: 'ON_HOVER',
  press: 'ON_PRESS',
  'after-delay': 'AFTER_TIMEOUT',
  key: 'ON_KEY_DOWN',
  'mouse-enter': 'MOUSE_ENTER',
  'mouse-leave': 'MOUSE_LEAVE',
  'mouse-down': 'MOUSE_DOWN',
  'mouse-up': 'MOUSE_UP',
  drag: 'DRAG'
}

const FIG_TO_TRIGGER = new Map(Object.entries(TRIGGER_TO_FIG).map(([lawha, fig]) => [fig, lawha]))
// Figma's older pointer events read as the ones Lawha keeps.
FIG_TO_TRIGGER.set('MOUSE_IN', 'mouse-enter')
FIG_TO_TRIGGER.set('MOUSE_OUT', 'mouse-leave')

const EASING_TO_FIG: Record<Transition['easing'], string> = {
  linear: 'LINEAR',
  'ease-in': 'IN_CUBIC',
  'ease-out': 'OUT_CUBIC',
  'ease-in-out': 'INOUT_CUBIC',
  'ease-in-back': 'IN_BACK_CUBIC',
  'ease-out-back': 'OUT_BACK_CUBIC',
  'ease-in-out-back': 'INOUT_BACK_CUBIC',
  spring: 'GENTLE_SPRING',
  'custom-spring': 'CUSTOM_SPRING'
}

const FIG_TO_EASING = new Map<string, Transition['easing']>(
  EASINGS.map((easing) => [EASING_TO_FIG[easing], easing])
)
for (const preset of ['SPRING', 'SPRING_PRESET_ONE', 'SPRING_PRESET_TWO', 'SPRING_PRESET_THREE'])
  FIG_TO_EASING.set(preset, 'spring')

const SIDE: Record<Direction, string> = {
  left: 'LEFT',
  right: 'RIGHT',
  up: 'TOP',
  down: 'BOTTOM'
}

/** Each transition's Figma type, its side filled in for those that come from one. */
const TRANSITION_TO_FIG: Record<Transition['type'], (side: string) => string> = {
  instant: () => 'INSTANT_TRANSITION',
  dissolve: () => 'DISSOLVE',
  'smart-animate': () => 'SMART_ANIMATE',
  'slide-in': (side) => `SLIDE_FROM_${side}`,
  'slide-out': (side) => `SLIDE_OUT_TO_${side}`,
  push: (side) => `PUSH_FROM_${side}`,
  'move-in': (side) => `MOVE_FROM_${side}`,
  'move-out': (side) => `MOVE_OUT_TO_${side}`
}

function transitionTypeToFig(transition: Transition): string {
  return TRANSITION_TO_FIG[transition.type](SIDE[transition.direction])
}

const FIG_DIRECTION = new Map(DIRECTIONS.map((direction) => [SIDE[direction], direction]))

function transitionFromFig(type: string | undefined): Pick<Transition, 'type' | 'direction'> {
  if (!type || type === 'INSTANT_TRANSITION') return { type: 'instant', direction: 'left' }
  if (type === 'DISSOLVE' || type === 'FADE') return { type: 'dissolve', direction: 'left' }
  if (type === 'SMART_ANIMATE' || type === 'MAGIC_MOVE')
    return { type: 'smart-animate', direction: 'left' }
  const match = /^(SLIDE_FROM|SLIDE_OUT_TO|PUSH_FROM|MOVE_FROM|MOVE_OUT_TO)_(\w+)$/.exec(type)
  const direction = (match && FIG_DIRECTION.get(match[2])) ?? 'left'
  const kinds: Record<string, Transition['type']> = {
    SLIDE_FROM: 'slide-in',
    SLIDE_OUT_TO: 'slide-out',
    PUSH_FROM: 'push',
    MOVE_FROM: 'move-in',
    MOVE_OUT_TO: 'move-out'
  }
  return { type: (match && kinds[match[1]]) ?? 'dissolve', direction }
}

const guidSchema = v.object({ sessionID: v.number(), localID: v.number() })

const figActionSchema = v.looseObject({
  connectionType: v.optional(v.string()),
  navigationType: v.optional(v.string()),
  transitionNodeID: v.optional(guidSchema),
  transitionType: v.optional(v.string()),
  transitionDuration: v.optional(v.number()),
  transitionShouldSmartAnimate: v.optional(v.boolean()),
  easingType: v.optional(v.string()),
  easingFunction: v.optional(v.array(v.number())),
  connectionURL: v.optional(v.string()),
  overlayRelativePosition: v.optional(v.unknown())
})

const figInteractionSchema = v.looseObject({
  isDeleted: v.optional(v.boolean()),
  event: v.optional(
    v.looseObject({
      interactionType: v.optional(v.string()),
      transitionTimeout: v.optional(v.number()),
      interactionDuration: v.optional(v.number()),
      keyTrigger: v.optional(v.looseObject({ keyCodes: v.optional(v.array(v.number())) }))
    })
  ),
  actions: v.optional(v.array(figActionSchema))
})

type FigAction = v.InferOutput<typeof figActionSchema>
type FigInteraction = v.InferOutput<typeof figInteractionSchema>

/** Key codes Figma records for the keys a key trigger names, as `KeyboardEvent.key`. */
const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  ' ': 32,
  Space: 32,
  Tab: 9,
  Backspace: 8,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40
}
const CODE_KEYS = new Map(
  Object.entries(KEY_CODES)
    .filter(([key]) => key !== 'Space')
    .map(([key, code]) => [code, key])
)

function keyToCode(key: string): number | undefined {
  if (Object.hasOwn(KEY_CODES, key)) return KEY_CODES[key]
  return key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined
}

function codeToKey(code: number): string {
  return CODE_KEYS.get(code) ?? String.fromCharCode(code).toLowerCase()
}

function transitionToFig(transition: Transition): Record<string, unknown> {
  const out: Record<string, unknown> = {
    transitionType: transitionTypeToFig(transition),
    transitionDuration: transition.duration / 1000,
    easingType: EASING_TO_FIG[transition.easing]
  }
  if (transition.type === 'smart-animate') out.transitionShouldSmartAnimate = true
  if (transition.easing === 'custom-spring' && transition.spring) {
    const { mass, stiffness, damping } = transition.spring
    out.easingFunction = [mass, stiffness, damping, 0]
  }
  return out
}

function transitionFromFigAction(action: FigAction): Transition {
  const kind = action.transitionShouldSmartAnimate
    ? { type: 'smart-animate' as const, direction: 'left' as const }
    : transitionFromFig(action.transitionType)
  const easing =
    (action.easingType ? FIG_TO_EASING.get(action.easingType) : undefined) ?? 'ease-out'
  const spring = action.easingFunction ?? []
  const physics =
    easing === 'custom-spring' && spring.length >= 3
      ? { spring: { mass: spring[0], stiffness: spring[1], damping: spring[2] } }
      : {}
  return {
    ...kind,
    duration: Math.min(5000, Math.max(0, Math.round((action.transitionDuration ?? 0.3) * 1000))),
    easing,
    ...physics
  }
}

/** How actions find what they point at in the written file. */
interface FigTargets {
  graph?: SceneGraph
  guidOf: (id: string) => GUID | undefined
  variables?: FigVariableIds
}

/** A Lawha action as a Figma action, or null when Figma has no equivalent. */
function actionToFig(action: Action, targets: FigTargets): object | null {
  const { guidOf, graph, variables } = targets
  const internal = (destination: string, navigationType: string, transition?: Transition) => {
    const guid = guidOf(destination)
    if (!guid) return null
    return {
      connectionType: 'INTERNAL_NODE',
      navigationType,
      transitionNodeID: guid,
      ...(transition ? transitionToFig(transition) : {})
    }
  }
  switch (action.type) {
    case 'navigate':
      return internal(action.destination, 'NAVIGATE', action.transition)
    case 'overlay':
      return internal(action.destination, 'OVERLAY', action.transition)
    case 'change-to':
      return internal(action.destination, 'SWAP_STATE', action.transition)
    case 'scroll-to':
      return internal(action.destination, 'SCROLL_TO')
    case 'back':
      return {
        connectionType: 'BACK',
        ...(action.transition ? transitionToFig(action.transition) : {})
      }
    case 'close-overlay':
      return { connectionType: 'CLOSE' }
    case 'open-url':
      return { connectionType: 'URL', connectionURL: action.url }
    case 'set-variable':
      return graph && variables ? setVariableToFig(graph, action, variables) : null
    case 'conditional':
      return graph && variables
        ? conditionalToFig(graph, action, variables, (list) => actionsToFig(list, targets))
        : null
    default:
      return null
  }
}

function actionsToFig(list: readonly Action[], targets: FigTargets): object[] {
  return list.map((action) => actionToFig(action, targets)).filter((action) => action !== null)
}

/** How read actions find what they point at in the document. */
interface FigSources {
  nodeOf: (guid: GUID) => string | undefined
  variables?: FigVariableIds
}

function actionsFromFig(raw: unknown, sources: FigSources): Action[] {
  const parsed = v.safeParse(v.array(figActionSchema), raw)
  if (!parsed.success) return []
  return parsed.output
    .map((action) => actionFromFig(action, sources))
    .filter((action) => action !== null)
}

function actionFromFig(action: FigAction, sources: FigSources): Action | null {
  const { nodeOf, variables } = sources
  if (action.connectionType === 'SET_VARIABLE')
    return variables ? setVariableFromFig(action, variables) : null
  if (action.connectionType === 'CONDITIONAL')
    return variables
      ? conditionalFromFig(action, variables, (list) => actionsFromFig(list, sources))
      : null
  const destination = action.transitionNodeID ? nodeOf(action.transitionNodeID) : undefined
  const transition = transitionFromFigAction(action)
  switch (action.connectionType) {
    case 'BACK':
      return { type: 'back', transition }
    case 'CLOSE':
      return { type: 'close-overlay' }
    case 'URL':
      return v.is(v.pipe(v.string(), v.url()), action.connectionURL)
        ? { type: 'open-url', url: action.connectionURL }
        : null
    case 'INTERNAL_NODE': {
      if (!destination) return null
      switch (action.navigationType ?? 'NAVIGATE') {
        case 'NAVIGATE':
        case 'SWAP':
          return { type: 'navigate', destination, transition }
        case 'OVERLAY':
          return {
            type: 'overlay',
            destination,
            position: 'center',
            closeOnOutside: true,
            transition
          }
        case 'SWAP_STATE':
          return { type: 'change-to', destination, transition }
        case 'SCROLL_TO':
          return { type: 'scroll-to', destination }
      }
      return null
    }
  }
  return null
}

/** One interaction as Figma's, or null when its trigger or every action has no Figma form. */
function interactionToFig(
  interaction: Interaction,
  targets: FigTargets,
  nextGuid: () => GUID
): object | null {
  const { trigger } = interaction
  const interactionType = TRIGGER_TO_FIG[trigger.type]
  if (!interactionType) return null
  const actions = actionsToFig([interaction.action, ...(interaction.andThen ?? [])], targets)
  if (actions.length === 0) return null
  const event: Record<string, unknown> = { interactionType }
  if (trigger.type === 'after-delay') event.transitionTimeout = trigger.delay / 1000
  else if (trigger.type === 'key') {
    const code = keyToCode(trigger.key)
    if (code === undefined) return null
    event.keyTrigger = { keyCodes: [code], triggerDevice: 'KEYBOARD' }
  } else if ('delay' in trigger && trigger.delay) event.transitionTimeout = trigger.delay / 1000
  return { id: nextGuid(), event, actions }
}

/**
 * Lawha's interactions as Figma's `prototypeInteractions`: those with a Figma trigger and at
 * least one action Figma can run. `guidOf` gives a destination's GUID in the written file and
 * `nextGuid` a fresh one for each interaction.
 */
export function figPrototypeInteractions(
  interactions: readonly Interaction[],
  guidOf: (id: string) => GUID | undefined,
  nextGuid: () => GUID,
  graph?: SceneGraph,
  variables?: FigVariableIds
): object[] {
  return splitForFig(interactions, { guidOf, graph, variables }, nextGuid).figma
}

/** An interaction Figma's form loses, which Lawha keeps beside Figma's. */
export interface KeptInteraction {
  /** Its place in the layer's list. */
  at: number
  interaction: Interaction
  /** Whether Figma's list holds a part of it, which reading it back replaces. */
  figma: boolean
}

/**
 * Lawha's interactions as Figma's, and the ones Figma's form loses something of, such as a
 * focus trigger, an overlay's position, or a calendar action, which Lawha keeps in its own data.
 * An interaction is Figma's alone when reading its Figma form back gives it again.
 */
export function splitForFig(
  interactions: readonly Interaction[],
  targets: FigTargets,
  nextGuid: () => GUID
): { figma: object[]; kept: KeptInteraction[] } {
  const figma: object[] = []
  const kept: KeptInteraction[] = []
  const back = new Map<string, string>()
  const sources: FigSources = {
    nodeOf: (guid) => back.get(guidToString(guid)),
    variables: targets.variables
  }
  const remember: FigTargets = {
    ...targets,
    guidOf: (id) => {
      const guid = targets.guidOf(id)
      if (guid) back.set(guidToString(guid), id)
      return guid
    }
  }
  for (const [at, interaction] of interactions.entries()) {
    const written = interactionToFig(interaction, remember, nextGuid)
    if (written) figma.push(written)
    const read = written ? interactionsFromFig([written], sources).at(0) : undefined
    if (!read || !isEqual(read, interaction)) kept.push({ at, interaction, figma: !!written })
  }
  return { figma, kept }
}

/** Figma's interactions with the ones Lawha kept beside them put back in their places. */
export function mergeKeptInteractions(
  figma: readonly Interaction[],
  kept: readonly KeptInteraction[]
): Interaction[] {
  const out: Interaction[] = []
  const byPlace = new Map(kept.map((item) => [item.at, item]))
  let next = 0
  while (next < figma.length || byPlace.size > 0) {
    const own = byPlace.get(out.length)
    if (own) {
      byPlace.delete(out.length)
      out.push(own.interaction)
      if (own.figma) next++
    } else if (next < figma.length) out.push(figma[next++])
    else {
      // Places past Figma's list, as when a Figma user removed interactions, go at the end.
      for (const item of [...byPlace.values()].sort((a, b) => a.at - b.at))
        out.push(item.interaction)
      break
    }
  }
  return out
}

/** Lawha's pointer triggers that may wait before they fire, as Figma's mouse events. */
const DELAYED_TRIGGERS = new Set(['mouse-enter', 'mouse-leave', 'mouse-down', 'mouse-up'])

function triggerFromFig(interaction: FigInteraction): Interaction['trigger'] | null {
  const event = interaction.event
  const type = event?.interactionType ? FIG_TO_TRIGGER.get(event.interactionType) : undefined
  const delay = Math.min(60000, Math.max(0, Math.round((event?.transitionTimeout ?? 0) * 1000)))
  if (type === 'after-delay') return { type, delay }
  if (type === 'key') {
    const code = event?.keyTrigger?.keyCodes?.at(-1)
    return code === undefined ? null : { type, key: codeToKey(code) }
  }
  const parsed = v.safeParse(pointerTriggerSchema, {
    type,
    ...(type && DELAYED_TRIGGERS.has(type) && delay > 0 ? { delay } : {})
  })
  return parsed.success ? parsed.output : null
}

/** Figma's interactions as Lawha's, their destinations found with `nodeOf`. */
export function interactionsFromFig(
  raw: unknown,
  nodeOf: ((guid: GUID) => string | undefined) | FigSources
): Interaction[] {
  const sources = typeof nodeOf === 'function' ? { nodeOf } : nodeOf
  const parsed = v.safeParse(v.array(figInteractionSchema), raw)
  if (!parsed.success) return []
  const out: Interaction[] = []
  for (const interaction of parsed.output) {
    if (interaction.isDeleted) continue
    const trigger = triggerFromFig(interaction)
    const actions = (interaction.actions ?? [])
      .map((action) => actionFromFig(action, sources))
      .filter((action) => action !== null)
    if (!trigger || actions.length === 0) continue
    const [action, ...andThen] = actions
    out.push(andThen.length > 0 ? { trigger, action, andThen } : { trigger, action })
  }
  return out
}

/** Each node's id by the GUID it was read from, rebuilt when a lookup misses. */
const sourceIndexes = new WeakMap<SceneGraph, Map<string, string>>()

function nodeBySourceGuid(graph: SceneGraph, guid: GUID): string | undefined {
  const key = guidToString(guid)
  const cached = sourceIndexes.get(graph)?.get(key)
  if (cached && graph.getNode(cached)?.source.id === key) return cached
  const index = new Map<string, string>()
  for (const node of graph.getAllNodes()) if (node.source.id) index.set(node.source.id, node.id)
  sourceIndexes.set(graph, index)
  // Layers a component's definition builds keep their record's GUID as their id.
  return index.get(key) ?? (graph.getNode(key) ? key : undefined)
}

/** A variable's id by the GUID a `.fig` file gives it, which reading keeps as its id. */
function variableByGuid(graph: SceneGraph, guid: GUID): string | undefined {
  const id = guidToString(guid)
  return graph.variables.has(id) ? id : undefined
}

/** The interactions a layer read from a `.fig` file keeps in Figma's own form. */
export function figInteractionsOf(graph: SceneGraph, node: SceneNode): Interaction[] {
  const raw = node.source.fig.rawNodeFields.prototypeInteractions
  if (raw === undefined) return []
  return interactionsFromFig(raw, {
    nodeOf: (guid) => nodeBySourceGuid(graph, guid),
    variables: {
      variableOf: (guid) => variableByGuid(graph, guid),
      guidOf: () => undefined
    }
  })
}
