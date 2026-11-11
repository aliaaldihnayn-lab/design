import type { Action, Interaction, Transition, Trigger } from '@lawha/core/prototype'

export interface PrototypeOption {
  value: string
  label: string
}

export const DEFAULT_TRANSITION: Transition = {
  type: 'dissolve',
  direction: 'left',
  duration: 300,
  easing: 'ease-out'
}

export const SPRING_FIELDS = ['stiffness', 'damping', 'mass'] as const
export type SpringField = (typeof SPRING_FIELDS)[number]
export const DEFAULT_SPRING = { stiffness: 300, damping: 20, mass: 1 }

const DIRECTIONAL_TRANSITIONS = new Set<Transition['type']>([
  'slide-in',
  'slide-out',
  'push',
  'move-in',
  'move-out'
])

const camel = (s: string) => s.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())

/** The message for an option value, `trigger` + `after-delay` reading `triggerAfterDelay`. */
export function optionLabel(messages: object, prefix: string, value: string): string {
  const key = `${prefix}${camel(value)}`
  const message: unknown = Reflect.get(messages, key)
  return typeof message === 'string' ? message : value
}

export const transitionOf = (i: Interaction) =>
  'transition' in i.action ? i.action.transition : undefined

export const showsDirection = (tr: Transition | undefined) =>
  !!tr && DIRECTIONAL_TRANSITIONS.has(tr.type)

export function clampNumber(value: string, max: number): number {
  return Math.max(0, Math.min(max, Number(value) || 0))
}

export function defaultTrigger(type: Trigger['type']): Trigger {
  if (type === 'after-delay') return { type, delay: 1000 }
  if (type === 'key') return { type, key: 'Enter' }
  return { type }
}

export interface ActionDefaults {
  /** The screen a new navigation or overlay goes to. */
  destination: string
  transition: Transition
  /** The first variable a Set variable action can change. */
  variable?: { id: string; type: string }
  /** Another variant than the one the layer sits in. */
  otherVariant?: string
}

export function defaultAction(type: Action['type'], defaults: ActionDefaults): Action {
  const { destination, transition, variable } = defaults
  switch (type) {
    case 'navigate':
      return { type, destination, transition }
    case 'overlay':
      return { type, destination, position: 'center', closeOnOutside: true, transition }
    case 'back':
      return { type, transition }
    case 'open-url':
      return { type, url: 'https://example.com' }
    case 'scroll-to':
      return { type, destination }
    case 'set-variable':
      return { type, variable: variable?.id ?? '', toggle: variable?.type === 'BOOLEAN' }
    case 'change-to':
      return { type, destination: defaults.otherVariant ?? destination, transition }
    default:
      return { type: 'close-overlay' }
  }
}
