import {
  getLocalTimeZone,
  parseDate,
  startOfMonth,
  startOfYear,
  toCalendar,
  today,
  type CalendarDate
} from '@internationalized/date'

import {
  CALENDAR_KEY,
  DAY_CELLS,
  PERIOD_CELLS,
  calendarSystem,
  decadeStart,
  monthDays,
  monthName,
  weekdayNames,
  yearName,
  type CalendarSpec,
  type CalendarSystem
} from '#core/prototype/calendar'
import type { Action } from '#core/prototype/model'

import { glyph, label, setAttrs, type KitDefinition } from './jsx'
import type { KitTheme } from './theme'
import { INSTANT, QUICK, type KitWiring } from './wire'

/**
 * A date picker whose calendar opens in place, onto any month and year: the closed field; the
 * days of the month on show, which the header's arrows move between; and month and year grids,
 * which the header's month and year open, to jump anywhere. The cells are filled in for the
 * month on show while the prototype runs, in the Gregorian or Umm al-Qura Hijri calendar, with
 * days outside the minimum and maximum, or disabled, dimmed and not picked.
 */

export type KitCalendar = CalendarSystem

export interface DateKitOptions {
  calendar?: KitCalendar
  /** The month the calendar opens on; today's when unset. */
  today?: CalendarDate
  /** The first and last days that can be picked, as Gregorian ISO days. */
  minDate?: string
  maxDate?: string
  /** Days that cannot be picked, as Gregorian ISO days. */
  disabledDates?: readonly string[]
  /** Days of the week that cannot be picked, 0 for Sunday to 6 for Saturday. */
  disabledWeekdays?: readonly number[]
}

const CLOSED = 'State=Closed'
const OPEN = 'State=Open'
const MONTHS = 'State=Months'
const YEARS = 'State=Years'
const VIEWS = [OPEN, MONTHS, YEARS] as const
type View = (typeof VIEWS)[number]

const localeOf = (theme: KitTheme) => (theme.rtl ? 'ar-SA' : 'en-US')

/** The calendar the picker draws, without its variables yet: what its cells show when built. */
function designSpec(theme: KitTheme, options: DateKitOptions, range: boolean): CalendarSpec {
  const calendar = options.calendar ?? 'gregory'
  // The day itself, so its month is found in the picker's own calendar.
  const opening = toCalendar(options.today ?? today(getLocalTimeZone()), calendarSystem('gregory'))
  return {
    calendar,
    locale: localeOf(theme),
    range,
    opening: opening.toString(),
    min: options.minDate,
    max: options.maxDate,
    disabledDates: options.disabledDates ? [...options.disabledDates] : undefined,
    disabledWeekdays: options.disabledWeekdays ? [...options.disabledWeekdays] : undefined,
    variables: { view: '', start: '', startText: '' }
  }
}

function openingMonth(spec: CalendarSpec): CalendarDate {
  return startOfMonth(
    toCalendar(parseDate(spec.opening ?? '2026-01-01'), calendarSystem(spec.calendar))
  )
}

function field(theme: KitTheme, placeholder: string, open: boolean, range: boolean): string {
  const value = range
    ? `${label(theme, 'Start', placeholder, { extra: 'grow={1}' })}${label(theme, 'Dash', '–', { color: theme.muted })}${label(theme, 'End', '', { extra: 'grow={1}' })}`
    : label(theme, 'Value', placeholder, { extra: 'grow={1}' })
  return `<Frame name="Field" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} px={12} py={10} w="fill" items="center" rounded={8} bg=${theme.surface} stroke=${open ? theme.primary : theme.border} strokeWidth={${open ? 2 : 1}}>${value}${glyph('chevronDown', theme.muted, { layer: 'Chevron' })}</Frame>`
}

/** A header button: the month or year on show, which opens its grid. */
function headerButton(theme: KitTheme, name: string, text: string, active: boolean): string {
  return `<Frame name="${name}" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={2} px={6} py={4} items="center" rounded={6} bg=${active ? theme.subtle : '"#FFFFFF00"'}>${label(theme, 'Label', text, { weight: 600 })}${glyph('chevronDown', theme.muted, { size: 12, layer: 'Chevron' })}</Frame>`
}

function cell(theme: KitTheme, name: string, text: string, width: number, opacity = 1): string {
  return `<Frame name="${name}" w={${width}} h={36} rounded={18} flex="row" items="center" justify="center">${label(theme, 'Number', text, { size: 13, extra: `opacity={${opacity}}` })}</Frame>`
}

function calendarJSX(theme: KitTheme, spec: CalendarSpec, view: View): string {
  const month = openingMonth(spec)
  const [previous, next] = theme.rtl
    ? (['chevronRight', 'chevronLeft'] as const)
    : (['chevronLeft', 'chevronRight'] as const)
  const decade = decadeStart(month)
  const yearText =
    view === YEARS
      ? `${yearName(spec, decade)} – ${yearName(spec, decade.add({ years: PERIOD_CELLS - 1 }))}`
      : yearName(spec, month)
  const header = `<Frame name="Header" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={4} w="fill" items="center">
      <Frame name="Previous" w={28} h={28} flex="row" items="center" justify="center">${glyph(previous, theme.text, { layer: 'Glyph' })}</Frame>
      <Frame name="Title" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} grow={1} gap={2} items="center" justify="center">
        ${headerButton(theme, 'Month', monthName(spec, month), view === MONTHS)}
        ${headerButton(theme, 'Year', yearText, view === YEARS)}
      </Frame>
      <Frame name="Next" w={28} h={28} flex="row" items="center" justify="center">${glyph(next, theme.text, { layer: 'Glyph' })}</Frame>
    </Frame>`
  let body: string
  if (view === OPEN) {
    const head = weekdayNames(spec, month)
      .map(
        (day, index) =>
          `<Frame name="Weekday ${index + 1}" w={36} h={24} flex="row" items="center" justify="center">${label(theme, 'Label', day, { size: 11, color: theme.muted })}</Frame>`
      )
      .join('')
    const days = monthDays(spec, month)
      .map((day, index) =>
        cell(theme, `Day ${index + 1}`, day.text, 36, day.enabled ? (day.inMonth ? 1 : 0.4) : 0.25)
      )
      .join('')
    body = `<Frame name="Weekdays" flex="row" ${theme.rtl ? 'flow="rtl"' : ''}>${head}</Frame>
      <Frame name="Days" grid columns="repeat(7, 36px)" ${theme.rtl ? 'flow="rtl"' : ''}>${days}</Frame>`
  } else {
    const first = view === MONTHS ? startOfYear(month) : decade
    const cells = Array.from({ length: PERIOD_CELLS }, (_, index) =>
      view === MONTHS
        ? cell(theme, `Month ${index + 1}`, monthName(spec, first.add({ months: index })), 84)
        : cell(theme, `Year ${index + 1}`, yearName(spec, first.add({ years: index })), 84)
    ).join('')
    body = `<Frame name="${view === MONTHS ? 'Months' : 'Years'}" grid columns="repeat(3, 84px)" rowGap={4} ${theme.rtl ? 'flow="rtl"' : ''}>${cells}</Frame>`
  }
  // Hidden looks the running calendar gives picked days, and a range's days between.
  const styles = `<Frame name="Selected" visible={false} w={36} h={36} rounded={18} bg=${theme.primary}>${label(theme, 'Number', '', { size: 13, color: theme.onPrimary })}</Frame>
    <Frame name="Between" visible={false} w={36} h={36} rounded={18} bg=${theme.subtle}>${label(theme, 'Number', '', { size: 13 })}</Frame>`
  return `<Frame name="Calendar" flex="col" gap={6} p={12} rounded={12} bg=${theme.surface} stroke=${theme.border} shadow="0 8 24 #0000001F">${header}${body}${styles}</Frame>`
}

/** Each view's arrows move by a month, a year, or the twelve years the year grid shows. */
const SHIFT: Record<View, number> = { [OPEN]: 1, [MONTHS]: 12, [YEARS]: 12 * PERIOD_CELLS }

function dateKit(
  kind: 'date-picker' | 'date-range-picker',
  name: string,
  range: boolean,
  options: DateKitOptions
): KitDefinition {
  const placeholder = (theme: KitTheme) => (range ? theme.labels.pickRange : theme.labels.pickDate)
  return {
    kind,
    name,
    insert: CLOSED,
    jsx: (theme) => {
      const spec = designSpec(theme, options, range)
      const variants = [
        `<Component name="${CLOSED}" flex="col" gap={6} w={280}>${field(theme, placeholder(theme), false, range)}</Component>`,
        ...VIEWS.map(
          (view) =>
            `<Component name="${view}" flex="col" gap={6} w={280}>${field(theme, placeholder(theme), true, range)}${calendarJSX(theme, spec, view)}</Component>`
        )
      ]
      return `<ComponentSet ${setAttrs(name)}>${variants.join('')}</ComponentSet>`
    },
    wire: (w: KitWiring, theme: KitTheme) => {
      const short = name.replace(/^Kit\//, '')
      const variables: CalendarSpec['variables'] = {
        view: w.variable(`${short}/view`, 'STRING', ''),
        start: w.variable(`${short}/start date`, 'STRING', ''),
        startText: w.variable(`${short}/value`, 'STRING', placeholder(theme))
      }
      if (range) {
        variables.end = w.variable(`${short}/end date`, 'STRING', '')
        variables.endText = w.variable(`${short}/end value`, 'STRING', '')
      }
      w.data(w.set, CALENDAR_KEY, { ...designSpec(theme, options, range), variables })
      for (const variant of [CLOSED, ...VIEWS]) {
        if (range) {
          w.bind(w.layer(variant, 'Field/Start'), 'text', variables.startText)
          if (variables.endText) w.bind(w.layer(variant, 'Field/End'), 'text', variables.endText)
        } else w.bind(w.layer(variant, 'Field/Value'), 'text', variables.startText)
      }
      w.on(w.layer(CLOSED, 'Field'), { type: 'click' }, [w.changeTo(OPEN, QUICK)])
      const calendar = (
        op: Extract<Action, { type: 'calendar' }>['op'],
        extra: Partial<Extract<Action, { type: 'calendar' }>> = {}
      ): Action => ({ type: 'calendar', op, ...extra })
      for (const view of VIEWS) {
        const at = (path: string) => w.layer(view, `Calendar/${path}`)
        w.on(w.layer(view, 'Field'), { type: 'click' }, [w.changeTo(CLOSED, QUICK)])
        w.on(w.layer(view), { type: 'key', key: 'Escape' }, [w.changeTo(CLOSED, QUICK)])
        w.on(at('Header/Previous'), { type: 'click' }, [
          calendar('shift', { months: -SHIFT[view] })
        ])
        w.on(at('Header/Next'), { type: 'click' }, [calendar('shift', { months: SHIFT[view] })])
        w.on(at('Header/Title/Month'), { type: 'click' }, [
          w.changeTo(view === MONTHS ? OPEN : MONTHS, INSTANT)
        ])
        w.on(at('Header/Title/Year'), { type: 'click' }, [
          w.changeTo(view === YEARS ? OPEN : YEARS, INSTANT)
        ])
      }
      for (let index = 0; index < DAY_CELLS; index++)
        w.on(w.layer(OPEN, `Calendar/Days/Day ${index + 1}`), { type: 'click' }, [
          calendar('pick-day', { cell: index, after: [w.changeTo(CLOSED, QUICK)] })
        ])
      for (let index = 0; index < PERIOD_CELLS; index++) {
        w.on(w.layer(MONTHS, `Calendar/Months/Month ${index + 1}`), { type: 'click' }, [
          calendar('pick-month', { cell: index, after: [w.changeTo(OPEN, INSTANT)] })
        ])
        w.on(w.layer(YEARS, `Calendar/Years/Year ${index + 1}`), { type: 'click' }, [
          calendar('pick-year', { cell: index, after: [w.changeTo(MONTHS, INSTANT)] })
        ])
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
