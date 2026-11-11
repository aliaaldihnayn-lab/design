import * as v from 'valibot'

import { buildKit, insertKitComponent, KIT_KINDS } from '#core/design-system/kit'
import { defineTool, toolNumber } from '#core/tools/schema'

const kindSchema = v.pipe(
  v.picklist(KIT_KINDS),
  v.description('Which control of the interactive kit')
)

const kitOptions = {
  rtl: v.optional(
    v.pipe(v.boolean(), v.description('Right to left, with Arabic default labels (default false)')),
    false
  ),
  calendar: v.optional(
    v.pipe(
      v.picklist(['gregory', 'islamic-umalqura']),
      v.description('The date pickers’ calendar: Gregorian (default) or Umm al-Qura Hijri')
    ),
    'gregory'
  ),
  hour_cycle: v.optional(
    v.pipe(
      v.picklist([12, 24]),
      v.description('The time picker’s clock: 24 hours (default) or 12 with AM and PM')
    ),
    24
  )
}

const isoDaySchema = v.pipe(v.string(), v.isoDate(), v.description('A Gregorian day, YYYY-MM-DD'))

export const insertKitComponentTool = defineTool({
  name: 'insert_kit_component',
  description:
    'Insert a live interactive control from the built-in kit: every state is a variant of one component wired with in-place interactions (Change to, hover and press states, keys, timers) and prototype variables, so it works on the canvas in preview (Ctrl+Alt+Enter) and in the player without one frame per state. Kinds: button (default, hover, pressed, focus, disabled, loading), text-input / textarea (real typing, placeholder, counter), search (with clear), number-stepper, select and menu (open in place, arrow keys, Enter), combobox (suggestions filter as you type), multi-select (chips), tabs, accordion, modal and drawer (overlays), popover, tooltip, toast, switch, checkbox (with indeterminate), radio-group, slider and range-slider (dragged in steps, arrow keys), date-picker and date-range-picker (Gregorian or Hijri; month and year grids reach any month; min_date, max_date, disabled_dates and disabled_weekdays limit the days), time-picker (12 or 24 hour clock), file-upload, stepper, pagination, carousel, progress, spinner, rating. The kit is drawn once on an "Interactive kit" page, themed by the document’s design-system variables (color/primary, color/text/primary…), and reused by later inserts. Each instance keeps its own value (picked option, checked state, dates).',
  execution: { kind: 'async', mutation: 'document' },
  input: v.strictObject({
    kind: kindSchema,
    parent_id: v.optional(
      v.pipe(v.string(), v.description('Frame to insert into; the current page by default'))
    ),
    x: v.optional(toolNumber(v.pipe(v.number(), v.description('X in the parent')))),
    y: v.optional(toolNumber(v.pipe(v.number(), v.description('Y in the parent')))),
    centered: v.optional(
      v.pipe(v.boolean(), v.description('x and y are where the control’s centre goes')),
      false
    ),
    min_date: v.optional(
      v.pipe(isoDaySchema, v.description('Date pickers: the first day that can be picked'))
    ),
    max_date: v.optional(
      v.pipe(isoDaySchema, v.description('Date pickers: the last day that can be picked'))
    ),
    disabled_dates: v.optional(
      v.pipe(
        v.array(isoDaySchema),
        v.maxLength(366),
        v.description('Date pickers: days that cannot be picked')
      )
    ),
    disabled_weekdays: v.optional(
      v.pipe(
        v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6))),
        v.maxLength(7),
        v.description('Date pickers: weekdays that cannot be picked, 0 Sunday to 6 Saturday')
      )
    ),
    ...kitOptions
  }),
  execute: async (figma, args) => {
    const parentId = args.parent_id ?? figma.currentPage.id
    if (!figma.graph.getNode(parentId)) return { error: `Node ${parentId} not found` }
    const { instanceId, component } = await insertKitComponent(figma.graph, args.kind, {
      parentId,
      x: args.x,
      y: args.y,
      rtl: args.rtl,
      calendar: args.calendar,
      hourCycle: args.hour_cycle,
      minDate: args.min_date,
      maxDate: args.max_date,
      disabledDates: args.disabled_dates,
      disabledWeekdays: args.disabled_weekdays
    })
    const instance = figma.graph.getNode(instanceId)
    if (instance && args.centered)
      figma.graph.updateNode(instanceId, {
        x: instance.x - instance.width / 2,
        y: instance.y - instance.height / 2
      })
    return {
      id: instanceId,
      name: instance?.name,
      component: { id: component.id, name: component.name, created: component.created }
    }
  }
})

export const buildInteractiveKitTool = defineTool({
  name: 'build_interactive_kit',
  description:
    'Draw the interactive kit’s components on its own page (“Interactive kit”), themed by the document’s design-system variables, so they appear in the assets panel and can be instanced: every control’s states are variants of one component wired to run live. Run it after build_design_system to style the kit with the new tokens. Pass kinds to draw only some.',
  execution: { kind: 'async', mutation: 'document' },
  input: v.strictObject({
    kinds: v.optional(v.pipe(v.array(kindSchema), v.minLength(1))),
    ...kitOptions
  }),
  execute: async (figma, args) => {
    const built = await buildKit(figma.graph, args.kinds ?? KIT_KINDS, {
      rtl: args.rtl,
      calendar: args.calendar,
      hourCycle: args.hour_cycle
    })
    return {
      components: built.map((item) => ({
        kind: item.kind,
        id: item.id,
        name: item.name,
        created: item.created
      }))
    }
  }
})
