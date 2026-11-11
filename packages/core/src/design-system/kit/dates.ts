import {
  DateFormatter,
  GregorianCalendar,
  IslamicUmalquraCalendar,
  getDayOfWeek,
  getLocalTimeZone,
  startOfMonth,
  toCalendar,
  today,
  type Calendar,
  type CalendarDate
} from '@internationalized/date'

import { glyph, label, setAttrs, type KitDefinition } from './jsx'
import type { KitTheme } from './theme'
import { INSTANT, QUICK, type KitWiring } from './wire'

/**
 * A date picker whose calendar opens in place: the closed field, then the previous, current,
 * and next month as variants, which the header's arrows move between. Days come from
 * `@internationalized/date`, in the Gregorian or the Umm al-Qura Hijri calendar.
 */

export type KitCalendar = 'gregory' | 'islamic-umalqura'

export interface DateKitOptions {
  calendar?: KitCalendar
  /** The month the calendar opens on; today's when unset. */
  today?: CalendarDate
}

const MONTHS = 3
const CELLS = 42
const CLOSED = 'State=Closed'
const month = (index: number) => `State=Month ${index + 1}`

function calendarOf(id: KitCalendar): Calendar {
  return id === 'islamic-umalqura' ? new IslamicUmalquraCalendar() : new GregorianCalendar()
}

interface MonthGrid {
  title: string
  days: { date: CalendarDate; inMonth: boolean; text: string }[]
  weekdays: string[]
}

function monthGrid(first: CalendarDate, locale: string, calendar: KitCalendar): MonthGrid {
  const zone = 'UTC'
  const options = {
    calendar: calendar === 'islamic-umalqura' ? 'islamic-umalqura' : 'gregory',
    timeZone: zone
  }
  const title = new DateFormatter(locale, { ...options, month: 'long', year: 'numeric' }).format(
    first.toDate(zone)
  )
  const offset = getDayOfWeek(first, locale)
  const start = first.subtract({ days: offset })
  const number = new DateFormatter(locale, { ...options, day: 'numeric' })
  const days = Array.from({ length: CELLS }, (_, index) => {
    const date = start.add({ days: index })
    return { date, inMonth: date.month === first.month, text: number.format(date.toDate(zone)) }
  })
  const weekday = new DateFormatter(locale, { ...options, weekday: 'narrow' })
  const weekdays = days.slice(0, 7).map((day) => weekday.format(day.date.toDate(zone)))
  return { title, days, weekdays }
}

/** The months the picker draws: the one before the opening month, it, and the one after. */
function months(options: DateKitOptions): CalendarDate[] {
  const calendar = calendarOf(options.calendar ?? 'gregory')
  const opening = startOfMonth(toCalendar(options.today ?? today(getLocalTimeZone()), calendar))
  return [opening.subtract({ months: 1 }), opening, opening.add({ months: 1 })]
}

function formatted(date: CalendarDate, locale: string, calendar: KitCalendar): string {
  return new DateFormatter(locale, {
    dateStyle: 'medium',
    calendar: calendar === 'islamic-umalqura' ? 'islamic-umalqura' : 'gregory',
    timeZone: 'UTC'
  }).format(date.toDate('UTC'))
}

const localeOf = (theme: KitTheme) => (theme.rtl ? 'ar-SA' : 'en-US')

function field(theme: KitTheme, placeholder: string, open: boolean, range: boolean): string {
  const value = range
    ? `${label(theme, 'Start', placeholder, { extra: 'grow={1}' })}${label(theme, 'Dash', '–', { color: theme.muted })}${label(theme, 'End', '', { extra: 'grow={1}' })}`
    : label(theme, 'Value', placeholder, { extra: 'grow={1}' })
  return `<Frame name="Field" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} px={12} py={10} w="fill" items="center" rounded={8} bg=${theme.surface} stroke=${open ? theme.primary : theme.border} strokeWidth={${open ? 2 : 1}}>${value}${glyph('chevronDown', theme.muted, { layer: 'Chevron' })}</Frame>`
}

function calendarJSX(theme: KitTheme, grid: MonthGrid): string {
  const [previous, next] = theme.rtl
    ? (['chevronRight', 'chevronLeft'] as const)
    : (['chevronLeft', 'chevronRight'] as const)
  const head = grid.weekdays
    .map(
      (day, index) =>
        `<Frame name="Weekday ${index + 1}" w={36} h={24} flex="row" items="center" justify="center">${label(theme, 'Label', day, { size: 11, color: theme.muted })}</Frame>`
    )
    .join('')
  const cells = grid.days
    .map(
      (day, index) =>
        `<Frame name="Day ${index + 1}" w={36} h={36} rounded={18} flex="row" items="center" justify="center">${label(theme, 'Number', day.text, { size: 13, color: day.inMonth ? theme.text : theme.border })}</Frame>`
    )
    .join('')
  return `<Frame name="Calendar" flex="col" gap={6} p={12} rounded={12} bg=${theme.surface} stroke=${theme.border} shadow="0 8 24 #0000001F">
    <Frame name="Header" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} w="fill" items="center">
      <Frame name="Previous" w={28} h={28} flex="row" items="center" justify="center">${glyph(previous, theme.text, { layer: 'Glyph' })}</Frame>
      ${label(theme, 'Title', grid.title, { weight: 600, extra: 'grow={1} textAlign="center"' })}
      <Frame name="Next" w={28} h={28} flex="row" items="center" justify="center">${glyph(next, theme.text, { layer: 'Glyph' })}</Frame>
    </Frame>
    <Frame name="Weekdays" flex="row" ${theme.rtl ? 'flow="rtl"' : ''}>${head}</Frame>
    <Frame name="Days" grid columns="repeat(7, 36px)" ${theme.rtl ? 'flow="rtl"' : ''}>${cells}</Frame>
  </Frame>`
}

function dateKit(
  kind: 'date-picker' | 'date-range-picker',
  name: string,
  range: boolean,
  options: DateKitOptions
): KitDefinition {
  const placeholder = (theme: KitTheme) => (range ? theme.labels.pickRange : theme.labels.pickDate)
  const grids = (theme: KitTheme) =>
    months(options).map((first) => monthGrid(first, localeOf(theme), options.calendar ?? 'gregory'))
  return {
    kind,
    name,
    insert: CLOSED,
    jsx: (theme) => {
      const variants = [
        `<Component name="${CLOSED}" flex="col" gap={6} w={280}>${field(theme, placeholder(theme), false, range)}</Component>`,
        ...grids(theme).map(
          (grid, index) =>
            `<Component name="${month(index)}" flex="col" gap={6} w={280}>${field(theme, placeholder(theme), true, range)}${calendarJSX(theme, grid)}</Component>`
        )
      ]
      return `<ComponentSet ${setAttrs(name)}>${variants.join('')}</ComponentSet>`
    },
    wire: (w: KitWiring, theme: KitTheme) => {
      const short = name.replace(/^Kit\//, '')
      const calendar = options.calendar ?? 'gregory'
      const value = w.variable(`${short}/value`, 'STRING', placeholder(theme))
      const end = w.variable(`${short}/end`, 'STRING', '')
      const picking = w.variable(`${short}/picking`, 'STRING', 'start')
      const names = [CLOSED, ...Array.from({ length: MONTHS }, (_, index) => month(index))]
      for (const variant of names) {
        if (range) {
          w.bind(w.layer(variant, 'Field/Start'), 'text', value)
          w.bind(w.layer(variant, 'Field/End'), 'text', end)
        } else w.bind(w.layer(variant, 'Field/Value'), 'text', value)
      }
      w.on(w.layer(CLOSED, 'Field'), { type: 'click' }, [w.changeTo(month(1), QUICK)])
      for (const [index, grid] of grids(theme).entries()) {
        const variant = month(index)
        w.on(w.layer(variant, 'Field'), { type: 'click' }, [w.changeTo(CLOSED, QUICK)])
        w.on(w.layer(variant), { type: 'key', key: 'Escape' }, [w.changeTo(CLOSED, QUICK)])
        if (index > 0)
          w.on(w.layer(variant, 'Calendar/Header/Previous'), { type: 'click' }, [
            w.changeTo(month(index - 1), INSTANT)
          ])
        if (index < MONTHS - 1)
          w.on(w.layer(variant, 'Calendar/Header/Next'), { type: 'click' }, [
            w.changeTo(month(index + 1), INSTANT)
          ])
        for (const [cell, day] of grid.days.entries()) {
          if (!day.inMonth) continue
          const text = formatted(day.date, localeOf(theme), calendar)
          const target = w.layer(variant, `Calendar/Days/Day ${cell + 1}`)
          if (!range) {
            w.on(target, { type: 'click' }, [
              { type: 'set-variable', variable: value, value: text },
              w.changeTo(CLOSED, QUICK)
            ])
            continue
          }
          // A range picks its start, then its end, which closes it.
          w.on(target, { type: 'click' }, [
            {
              type: 'conditional',
              when: [{ variable: picking, op: 'eq', value: 'end' }],
              actions: [
                { type: 'set-variable', variable: end, value: text },
                { type: 'set-variable', variable: picking, value: 'start' },
                w.changeTo(CLOSED, QUICK)
              ],
              otherwise: [
                { type: 'set-variable', variable: value, value: text },
                { type: 'set-variable', variable: end, value: '' },
                { type: 'set-variable', variable: picking, value: 'end' }
              ]
            }
          ])
        }
      }
    }
  }
}

/** The date pickers of the kit: one date, and a range, in the calendar the options name. */
export function dateKits(options: DateKitOptions = {}): KitDefinition[] {
  const hijri = options.calendar === 'islamic-umalqura' ? ' (Hijri)' : ''
  return [
    dateKit('date-picker', `Kit/Date picker${hijri}`, false, options),
    dateKit('date-range-picker', `Kit/Date range picker${hijri}`, true, options)
  ]
}
