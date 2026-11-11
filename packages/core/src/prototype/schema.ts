import * as v from 'valibot'

/**
 * What starts an interaction. `hover` and `press` last while the pointer is over or down: a
 * Change to they start is undone when it leaves or lifts, as Figma's While hovering and While
 * pressing. The others fire once.
 */
export const TRIGGERS = [
  'click',
  'hover',
  'press',
  'after-delay',
  'key',
  'mouse-enter',
  'mouse-leave',
  'mouse-down',
  'mouse-up',
  'focus',
  'blur',
  'drag'
] as const

/** Triggers a pointer or focus event on the layer itself starts, without a key or timer. */
export const POINTER_TRIGGERS = [
  'click',
  'hover',
  'press',
  'mouse-enter',
  'mouse-leave',
  'mouse-down',
  'mouse-up',
  'focus',
  'blur',
  'drag'
] as const
export const TRANSITION_TYPES = [
  'instant',
  'dissolve',
  'slide-in',
  'slide-out',
  'push',
  'move-in',
  'move-out',
  'smart-animate'
] as const
export const DIRECTIONS = ['left', 'right', 'up', 'down'] as const
export const EASINGS = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-back',
  'ease-out-back',
  'ease-in-out-back',
  'spring',
  'custom-spring'
] as const
export const OVERLAY_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const

export const springSchema = v.object({
  stiffness: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(1000)), 300),
  damping: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(100)), 20),
  mass: v.optional(v.pipe(v.number(), v.minValue(0.1), v.maxValue(10)), 1)
})

export const transitionSchema = v.object({
  type: v.picklist(TRANSITION_TYPES),
  /** Where the incoming screen comes from (slide, push, move in). */
  direction: v.optional(v.picklist(DIRECTIONS), 'left'),
  /** Milliseconds, 0–5000. */
  duration: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(5000)), 300),
  easing: v.optional(v.picklist(EASINGS), 'ease-out'),
  /** A custom spring's physics, read when the easing is `custom-spring`. */
  spring: v.optional(springSchema)
})

export const triggerSchema = v.variant('type', [
  v.object({
    type: v.picklist([
      'click',
      'hover',
      'press',
      'mouse-enter',
      'mouse-leave',
      'mouse-down',
      'mouse-up',
      'focus',
      'blur',
      'drag'
    ]),
    /** Mouse enter, leave, down, and up: ms to wait first, as Figma's delay. */
    delay: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(60000)))
  }),
  v.object({
    type: v.literal('after-delay'),
    delay: v.pipe(v.number(), v.minValue(0), v.maxValue(60000))
  }),
  v.object({ type: v.literal('key'), key: v.pipe(v.string(), v.minLength(1)) })
])

/**
 * A finite number, bounded rather than `v.finite()` so the AI and MCP tools that take
 * interactions can list their input as JSON Schema.
 */
const finiteNumberSchema = v.pipe(
  v.number(),
  v.minValue(-Number.MAX_VALUE),
  v.maxValue(Number.MAX_VALUE)
)

/** A value a prototype variable can be set to or compared with. */
export const playValueSchema = v.union([v.string(), finiteNumberSchema, v.boolean()])

/**
 * Sets a variable while the prototype runs, as Figma's Set variable: to `value`, to its
 * opposite with `toggle`, or by `add` to a number. The document keeps the variable's value.
 */
const setVariableSchema = v.object({
  type: v.literal('set-variable'),
  /** The variable's id. */
  variable: v.pipe(v.string(), v.minLength(1)),
  value: v.optional(playValueSchema),
  toggle: v.optional(v.boolean()),
  add: v.optional(finiteNumberSchema)
})

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'truthy',
  'falsy'
] as const

/** A comparison of a variable's running value: equal, ordered, or whether it reads as true. */
export const conditionSchema = v.object({
  variable: v.pipe(v.string(), v.minLength(1)),
  op: v.picklist(CONDITION_OPERATORS),
  value: v.optional(playValueSchema)
})

const changeToSchema = v.object({
  type: v.literal('change-to'),
  /** A variant (component) of the same component set. */
  destination: v.pipe(v.string(), v.minLength(1)),
  transition: transitionSchema
})

export const CALENDAR_OPS = ['shift', 'pick-day', 'pick-month', 'pick-year'] as const

/**
 * A date picker's calendar, which Figma has no equivalent for: `shift` moves the month on show
 * by `months`, and the picks choose the day, month, or year in grid `cell`, counted from 0. A
 * pick that completes the choice runs `after`, such as a Change to that closes the picker.
 */
const calendarActionSchema = v.object({
  type: v.literal('calendar'),
  op: v.picklist(CALENDAR_OPS),
  months: v.optional(v.pipe(v.number(), v.integer(), v.minValue(-1200), v.maxValue(1200))),
  cell: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(41))),
  after: v.optional(
    v.pipe(
      v.array(
        v.variant('type', [
          changeToSchema,
          v.object({ type: v.literal('close-overlay') }),
          v.object({ type: v.literal('back'), transition: v.optional(transitionSchema) })
        ])
      ),
      v.maxLength(5)
    )
  )
})

/** The actions a step of a prototype can run, short of a conditional. */
const simpleActions = [
  v.object({
    type: v.literal('navigate'),
    destination: v.pipe(v.string(), v.minLength(1)),
    transition: transitionSchema
  }),
  v.object({ type: v.literal('back'), transition: v.optional(transitionSchema) }),
  v.object({
    type: v.literal('overlay'),
    destination: v.pipe(v.string(), v.minLength(1)),
    position: v.optional(v.picklist(OVERLAY_POSITIONS), 'center'),
    /** Clicking outside the overlay closes it. */
    closeOnOutside: v.optional(v.boolean(), true),
    /** A colour drawn behind the overlay over the screen, such as `#00000066`; none when unset. */
    background: v.optional(v.pipe(v.string(), v.hexColor())),
    transition: transitionSchema
  }),
  v.object({ type: v.literal('close-overlay') }),
  v.object({ type: v.literal('scroll-to'), destination: v.pipe(v.string(), v.minLength(1)) }),
  v.object({ type: v.literal('open-url'), url: v.pipe(v.string(), v.url()) }),
  /**
   * Interactive components: the instance holding the layer shows another variant of its set in
   * place, without leaving the screen, as Figma's Change to.
   */
  changeToSchema,
  setVariableSchema,
  calendarActionSchema
] as const

const simpleActionSchema = v.variant('type', [...simpleActions])

export const actionSchema = v.variant('type', [
  ...simpleActions,
  /**
   * Runs `actions` when every condition holds and `otherwise` when one does not, as Figma's
   * Conditional. Its branches run plain actions, not another conditional.
   */
  v.object({
    type: v.literal('conditional'),
    when: v.pipe(v.array(conditionSchema), v.minLength(1), v.maxLength(10)),
    actions: v.pipe(v.array(simpleActionSchema), v.maxLength(20)),
    otherwise: v.optional(v.pipe(v.array(simpleActionSchema), v.maxLength(20)))
  })
])

export const interactionSchema = v.object({
  trigger: triggerSchema,
  action: actionSchema,
  /** Further actions the trigger runs after `action`, in order, as Figma's action lists. */
  andThen: v.optional(v.pipe(v.array(actionSchema), v.maxLength(20)))
})
export const interactionListSchema = v.array(interactionSchema)

export const flowSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  start: v.pipe(v.string(), v.minLength(1))
})
export const flowListSchema = v.array(flowSchema)

/** Which way a frame's content scrolls in the prototype, as Figma's overflow behaviour. */
export const SCROLL_DIRECTIONS = ['none', 'vertical', 'horizontal', 'both'] as const
export const scrollDirectionSchema = v.picklist(SCROLL_DIRECTIONS)

/**
 * How a layer behaves while the frame it is in scrolls, as Figma's scroll behaviour: it scrolls
 * with the content, stays fixed in place, or scrolls until it reaches the frame's top and sticks.
 */
export const SCROLL_POSITIONS = ['scrolls', 'fixed', 'sticky'] as const
export const scrollPositionSchema = v.picklist(SCROLL_POSITIONS)
