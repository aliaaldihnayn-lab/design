import * as v from 'valibot'

import type { GUID } from '@lawha/kiwi/fig'
import { guidToString } from '@lawha/kiwi/fig/guid'
import type { SceneGraph, SceneNode } from '@lawha/scene-graph'

import type { Action, Interaction, Transition } from './model'
import { DIRECTIONS, EASINGS, triggerSchema } from './schema'

/** A pointer or focus trigger, as `triggerSchema` reads it. */
const pointerTriggerSchema = v.pipe(
  triggerSchema,
  v.check((trigger) => trigger.type !== 'after-delay' && trigger.type !== 'key')
)

/**
 * Figma's own prototype interactions, as a `.fig` record keeps them (`prototypeInteractions`),
 * read into Lawha's and written back. Interactions Figma has no equivalent for, such as focus
 * triggers, stay in Lawha's plugin data only.
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

/** A Lawha action as a Figma action, or null when Figma has no equivalent. */
function actionToFig(action: Action, guidOf: (id: string) => GUID | undefined): object | null {
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
    default:
      return null
  }
}

function actionFromFig(
  action: FigAction,
  nodeOf: (guid: GUID) => string | undefined
): Action | null {
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

/**
 * Lawha's interactions as Figma's `prototypeInteractions`: those with a Figma trigger and at
 * least one action Figma can run. `guidOf` gives a destination's GUID in the written file and
 * `nextGuid` a fresh one for each interaction.
 */
export function figPrototypeInteractions(
  interactions: readonly Interaction[],
  guidOf: (id: string) => GUID | undefined,
  nextGuid: () => GUID
): object[] {
  const out: object[] = []
  for (const interaction of interactions) {
    const { trigger } = interaction
    const interactionType = TRIGGER_TO_FIG[trigger.type]
    if (!interactionType) continue
    const actions = [interaction.action, ...(interaction.andThen ?? [])]
      .map((action) => actionToFig(action, guidOf))
      .filter((action) => action !== null)
    if (actions.length === 0) continue
    const event: Record<string, unknown> = { interactionType }
    if (trigger.type === 'after-delay') event.transitionTimeout = trigger.delay / 1000
    else if (trigger.type === 'key') {
      const code = keyToCode(trigger.key)
      if (code === undefined) continue
      event.keyTrigger = { keyCodes: [code], triggerDevice: 'KEYBOARD' }
    } else if ('delay' in trigger && trigger.delay) event.transitionTimeout = trigger.delay / 1000
    out.push({ id: nextGuid(), event, actions })
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
  nodeOf: (guid: GUID) => string | undefined
): Interaction[] {
  const parsed = v.safeParse(v.array(figInteractionSchema), raw)
  if (!parsed.success) return []
  const out: Interaction[] = []
  for (const interaction of parsed.output) {
    if (interaction.isDeleted) continue
    const trigger = triggerFromFig(interaction)
    const actions = (interaction.actions ?? [])
      .map((action) => actionFromFig(action, nodeOf))
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

/** The interactions a layer read from a `.fig` file keeps in Figma's own form. */
export function figInteractionsOf(graph: SceneGraph, node: SceneNode): Interaction[] {
  const raw = node.source.fig.rawNodeFields.prototypeInteractions
  if (raw === undefined) return []
  return interactionsFromFig(raw, (guid) => nodeBySourceGuid(graph, guid))
}
