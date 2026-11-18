import {
  CalendarDate,
  DateFormatter,
  GregorianCalendar,
  IslamicUmalquraCalendar,
  getDayOfWeek,
  parseDate,
  startOfMonth,
  startOfYear,
  toCalendar,
  type Calendar
} from '@internationalized/date'
import { isEqual } from 'es-toolkit'
import * as v from 'valibot'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { findLayerByPath } from '@lawha/scene-graph/behaviours'
import { copyFills } from '@lawha/scene-graph/copy'
import { instanceMainComponent } from '@lawha/scene-graph/instances'

import { getPluginData } from '#core/figma-api/plugin-data'

import type { Action } from './model'
import { instanceScope, playKey, playValue, type PlayValue, type PlayVariables } from './variables'

/**
 * A date picker's calendar while the prototype runs: the month it shows, the dates picked, and
 * which days can be picked, kept in the instance's own variables. The calendar's day, month, and
 * year cells are layers of its variants, which this fills in for whatever month, year, or decade
 * is on show, in the Gregorian or Umm al-Qura Hijri calendar. The document never changes.
 */
export const CALENDAR_KEY = 'prototype.calendar'

export const CALENDARS = ['gregory', 'islamic-umalqura'] as const
export type CalendarSystem = (typeof CALENDARS)[number]

/** A Gregorian day as ISO 8601, `2026-11-11`, as the calendar keeps dates in any system. */
const isoDateSchema = v.pipe(v.string(), v.isoDate())

const calendarSpecSchema = v.object({
  calendar: v.optional(v.picklist(CALENDARS), 'gregory'),
  locale: v.optional(v.string(), 'en-US'),
  range: v.optional(v.boolean(), false),
  /** The day whose month the calendar opens on before anything is picked. */
  opening: v.optional(isoDateSchema),
  min: v.optional(isoDateSchema),
  max: v.optional(isoDateSchema),
  disabledDates: v.optional(v.array(isoDateSchema)),
  /** Days of the week that cannot be picked, 0 for Sunday to 6 for Saturday. */
  disabledWeekdays: v.optional(
    v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6)))
  ),
  /** The variables, by id, the calendar keeps its state in: per instance in the kit. */
  variables: v.object({
    view: v.string(),
    start: v.string(),
    end: v.optional(v.string()),
    startText: v.string(),
    endText: v.optional(v.string())
  })
})

export type CalendarSpec = v.InferOutput<typeof calendarSpecSchema>

/** What a calendar's own settings on an instance may change: its range and disabled days. */
const calendarOverridesSchema = v.partial(
  v.pick(calendarSpecSchema, ['min', 'max', 'disabledDates', 'disabledWeekdays', 'opening'])
)

export type CalendarOverrides = v.InferOutput<typeof calendarOverridesSchema>

function parsed<T>(text: string, schema: v.GenericSchema<unknown, T>): T | null {
  if (!text) return null
  const result = v.safeParse(v.pipe(v.string(), v.parseJson(), schema), text)
  return result.success ? result.output : null
}

/** A variant's calendar, or null when it has none or it is malformed. */
export function readCalendar(node: SceneNode): CalendarSpec | null {
  return parsed(getPluginData(node, CALENDAR_KEY), calendarSpecSchema)
}

/** An instance's own minimum, maximum, and disabled days, which win over its component's. */
export function readCalendarOverrides(node: SceneNode): CalendarOverrides {
  return parsed(getPluginData(node, CALENDAR_KEY), calendarOverridesSchema) ?? {}
}

/** The calendar an instance shows: its variant's or set's, with the instance's own settings. */
export function calendarOf(graph: SceneGraph, instance: SceneNode): CalendarSpec | null {
  const main = instanceMainComponent(graph, instance)
  if (!main) return null
  const set = main.parentId ? graph.getNode(main.parentId) : undefined
  const spec = readCalendar(main) ?? (set ? readCalendar(set) : null)
  return spec ? { ...spec, ...readCalendarOverrides(instance) } : null
}

/** The `@internationalized/date` calendar of a system. */
export function calendarSystem(id: CalendarSystem): Calendar {
  return id === 'islamic-umalqura' ? new IslamicUmalquraCalendar() : new GregorianCalendar()
}

function formatter(spec: Pick<CalendarSpec, 'calendar' | 'locale'>, options: object) {
  return new DateFormatter(spec.locale, { calendar: spec.calendar, timeZone: 'UTC', ...options })
}

const show = (date: CalendarDate) => date.toDate('UTC')

/** A day as the picker's field shows it, such as `Nov 10, 2026`. */
export function formatPickedDate(
  spec: Pick<CalendarSpec, 'calendar' | 'locale'>,
  date: CalendarDate
): string {
  return formatter(spec, { dateStyle: 'medium' }).format(show(date))
}

/** A Gregorian ISO day in the spec's calendar. */
function inCalendar(spec: CalendarSpec, iso: string): CalendarDate {
  return toCalendar(parseDate(iso), calendarSystem(spec.calendar))
}

const isoOf = (date: CalendarDate) => toCalendar(date, new GregorianCalendar()).toString()

/** Whether a day can be picked: inside the minimum and maximum, and not disabled. */
export function dayEnabled(spec: CalendarSpec, date: CalendarDate): boolean {
  const iso = isoOf(date)
  if (spec.min && iso < spec.min) return false
  if (spec.max && iso > spec.max) return false
  if (spec.disabledDates?.includes(iso)) return false
  // Sunday first, whatever the locale's week, so the setting reads the same everywhere.
  const weekday = getDayOfWeek(date, 'en-US')
  return !spec.disabledWeekdays?.includes(weekday)
}

/** The cells of a month grid: six weeks from the locale's first day of the week. */
export const DAY_CELLS = 42
/** The cells of the month and year grids. */
export const PERIOD_CELLS = 12

export interface CalendarDay {
  date: CalendarDate
  text: string
  inMonth: boolean
  enabled: boolean
}

/** The days a month grid shows, the month's own and the weeks' ends around it. */
export function monthDays(spec: CalendarSpec, month: CalendarDate): CalendarDay[] {
  const first = startOfMonth(month)
  const start = first.subtract({ days: getDayOfWeek(first, spec.locale) })
  const number = formatter(spec, { day: 'numeric' })
  return Array.from({ length: DAY_CELLS }, (_, index) => {
    const date = start.add({ days: index })
    return {
      date,
      text: number.format(show(date)),
      inMonth: date.month === first.month && date.year === first.year,
      enabled: dayEnabled(spec, date)
    }
  })
}

/** The weekday initials above a month grid, from the locale's first day of the week. */
export function weekdayNames(spec: CalendarSpec, month: CalendarDate): string[] {
  const days = monthDays(spec, month).slice(0, 7)
  const weekday = formatter(spec, { weekday: 'narrow' })
  return days.map((day) => weekday.format(show(day.date)))
}

/** A month's name, and a year as the calendar numbers it. */
export const monthName = (spec: CalendarSpec, date: CalendarDate) =>
  formatter(spec, { month: 'long' }).format(show(date))
export const yearName = (spec: CalendarSpec, date: CalendarDate) =>
  formatter(spec, { year: 'numeric' }).format(show(date))

/** The first year of the twelve the year grid shows around `date`. */
export function decadeStart(date: CalendarDate): CalendarDate {
  const first = startOfYear(date)
  return first.subtract({ years: first.year % PERIOD_CELLS })
}

/** The month a calendar shows: as moved to, else the start picked, else its opening month. */
export function calendarView(
  graph: SceneGraph,
  variables: PlayVariables,
  spec: CalendarSpec,
  scope: string | null
): CalendarDate {
  const day =
    isoValue(graph, variables, spec.variables.view, scope) ||
    isoValue(graph, variables, spec.variables.start, scope) ||
    spec.opening
  const date = day
    ? inCalendar(spec, day)
    : toCalendar(new CalendarDate(2026, 1, 1), calendarSystem(spec.calendar))
  return startOfMonth(date)
}

/** A calendar action: moving the view, or picking a day, month, or year cell. */
export type CalendarAction = Extract<Action, { type: 'calendar' }>

/** The nearest instance above a layer that shows a calendar. */
function calendarInstance(graph: SceneGraph, layer: SceneNode): SceneNode | undefined {
  let current: SceneNode | undefined = layer
  while (current) {
    if (current.type === 'INSTANCE' && calendarOf(graph, current)) return current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

/** What a calendar action changes: the calendar's variables in its instance. */
interface CalendarRun {
  spec: CalendarSpec
  view: CalendarDate
  /** A variable's running value as an ISO day, or '' when it holds none. */
  day: (id: string | undefined) => string
  set: (id: string | undefined, value: PlayValue) => void
}

/** Picks the day in a month grid cell; true when that completes the choice. */
function pickDay(run: CalendarRun, cell: number): boolean {
  const { spec, set } = run
  const day = monthDays(spec, run.view).at(cell)
  if (!day?.enabled) return false
  const picked = isoOf(day.date)
  const start = run.day(spec.variables.start)
  set(spec.variables.view, isoOf(startOfMonth(day.date)))
  // A range's second pick on or after its start is its end; any other pick starts it again.
  if (spec.range && start && !run.day(spec.variables.end) && picked >= start) {
    set(spec.variables.end, picked)
    set(spec.variables.endText, formatPickedDate(spec, day.date))
    return true
  }
  set(spec.variables.start, picked)
  set(spec.variables.startText, formatPickedDate(spec, day.date))
  if (!spec.range) return true
  set(spec.variables.end, '')
  set(spec.variables.endText, '')
  return false
}

/** Moves the view, or picks a cell; true when the action's `after` actions follow. */
function applyCalendarAction(run: CalendarRun, action: CalendarAction): boolean {
  const { view } = run
  const cell = action.cell ?? 0
  const setView = (date: CalendarDate) => run.set(run.spec.variables.view, isoOf(date))
  switch (action.op) {
    case 'shift':
      setView(view.add({ months: action.months ?? 0 }))
      return false
    case 'pick-month':
      setView(startOfYear(view).add({ months: cell }))
      return true
    case 'pick-year':
      setView(decadeStart(view).add({ years: cell }).set({ month: view.month }))
      return true
    case 'pick-day':
      return pickDay(run, cell)
  }
  return false
}

/**
 * Runs a calendar action of a layer below `rootId`: moves the month on show, or picks the day,
 * month, or year in a cell. A pick that completes the choice, one day or a range's end, runs
 * the action's `after`, such as closing the picker; a disabled day does nothing.
 */
export function runCalendarAction(
  graph: SceneGraph,
  rootId: string,
  layer: SceneNode,
  variables: PlayVariables,
  action: CalendarAction
): { variables: Map<string, PlayValue>; actions: Action[] } {
  const next = new Map(variables)
  const instance = calendarInstance(graph, layer)
  const spec = instance ? calendarOf(graph, instance) : null
  if (!instance || !spec) return { variables: next, actions: [] }
  const scope = instanceScope(graph, rootId, instance.id)
  const run: CalendarRun = {
    spec,
    view: calendarView(graph, next, spec, scope),
    day: (id) => isoValue(graph, next, id, scope),
    set: (id, value) => {
      if (id) next.set(playKey(graph, id, scope), value)
    }
  }
  const completes = applyCalendarAction(run, action)
  return { variables: next, actions: completes ? (action.after ?? []) : [] }
}

/** A variable's running value as an ISO day, or '' when it holds none. */
function isoValue(
  graph: SceneGraph,
  variables: PlayVariables,
  id: string | undefined,
  scope: string | null
): string {
  const found = id ? playValue(graph, variables, id, scope) : undefined
  return typeof found === 'string' && v.is(isoDateSchema, found) ? found : ''
}

/** Layer paths below a calendar instance that the projection fills in. */
export const CALENDAR_LAYERS = {
  month: 'Calendar/Header/Title/Month/Label',
  year: 'Calendar/Header/Title/Year/Label',
  weekday: (index: number) => `Calendar/Weekdays/Weekday ${index + 1}/Label`,
  day: (index: number) => `Calendar/Days/Day ${index + 1}`,
  monthCell: (index: number) => `Calendar/Months/Month ${index + 1}`,
  yearCell: (index: number) => `Calendar/Years/Year ${index + 1}`,
  selected: 'Calendar/Selected',
  between: 'Calendar/Between'
} as const

/** The first text layer of a cell, itself if it is one. */
function textOf(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  if (node.type === 'TEXT') return node
  for (const child of graph.getChildren(node.id)) {
    const found = textOf(graph, child)
    if (found) return found
  }
  return undefined
}

export function showCalendars(
  graph: SceneGraph,
  rootId: string,
  variables: PlayVariables
): string[] {
  const changed = new Set<string>()
  const walk = (node: SceneNode) => {
    const spec = node.type === 'INSTANCE' ? calendarOf(graph, node) : null
    if (spec && findLayerByPath(graph, node.id, 'Calendar')) {
      const scope = instanceScope(graph, rootId, node.id)
      const painter = new CalendarPainter(graph, node, spec, changed)
      const view = calendarView(graph, variables, spec, scope)
      painter.header(view)
      painter.days(
        view,
        isoValue(graph, variables, spec.variables.start, scope),
        isoValue(graph, variables, spec.variables.end, scope)
      )
      painter.periods(view)
    }
    for (const child of graph.getChildren(node.id)) walk(child)
  }
  const root = graph.getNode(rootId)
  if (root) walk(root)
  return [...changed]
}

/** Fills in one calendar instance's layers in a private graph. */
class CalendarPainter {
  constructor(
    readonly graph: SceneGraph,
    readonly instance: SceneNode,
    readonly spec: CalendarSpec,
    readonly changed: Set<string>
  ) {}

  at(path: string): SceneNode | undefined {
    return findLayerByPath(this.graph, this.instance.id, path)
  }

  update(node: SceneNode | undefined, changes: Partial<SceneNode>): void {
    if (!node) return
    const differs = Object.entries(changes).some(
      ([key, value]) => !isEqual(node[key as keyof SceneNode], value)
    )
    if (!differs) return
    this.graph.updateNode(node.id, changes)
    this.changed.add(node.id)
  }

  text(node: SceneNode | undefined, text: string, opacity = 1): void {
    const label = node && textOf(this.graph, node)
    if (label) this.update(label, { text, styleRuns: [], derivedTextGlyphs: null, opacity })
  }

  /** Gives a cell the look of a hidden style layer: its fill, and its label's. */
  style(cell: SceneNode | undefined, path: string): void {
    const source = this.at(path)
    if (!cell || !source) return
    this.update(cell, { fills: copyFills(source.fills) })
    const label = textOf(this.graph, cell)
    const sourceLabel = textOf(this.graph, source)
    if (label && sourceLabel) this.update(label, { fills: copyFills(sourceLabel.fills) })
  }

  header(view: CalendarDate): void {
    const { spec } = this
    const decade = decadeStart(view)
    this.text(this.at(CALENDAR_LAYERS.month), monthName(spec, view))
    const last = decade.add({ years: PERIOD_CELLS - 1 })
    this.text(
      this.at(CALENDAR_LAYERS.year),
      this.at(CALENDAR_LAYERS.yearCell(0))
        ? `${yearName(spec, decade)} – ${yearName(spec, last)}`
        : yearName(spec, view)
    )
    for (const [index, name] of weekdayNames(spec, view).entries())
      this.text(this.at(CALENDAR_LAYERS.weekday(index)), name)
  }

  days(view: CalendarDate, start: string, end: string): void {
    for (const [index, day] of monthDays(this.spec, view).entries()) {
      const cell = this.at(CALENDAR_LAYERS.day(index))
      if (!cell) continue
      const iso = isoOf(day.date)
      if (iso === start || iso === end) this.style(cell, CALENDAR_LAYERS.selected)
      else if (start && end && iso > start && iso < end) this.style(cell, CALENDAR_LAYERS.between)
      this.text(cell, day.text, day.enabled ? (day.inMonth ? 1 : 0.4) : 0.25)
    }
  }

  periods(view: CalendarDate): void {
    const { spec } = this
    const yearStart = startOfYear(view)
    const decade = decadeStart(view)
    for (let index = 0; index < PERIOD_CELLS; index++) {
      const month = yearStart.add({ months: index })
      const monthCell = this.at(CALENDAR_LAYERS.monthCell(index))
      const monthOn = periodEnabled(spec, month, { months: 1 })
      this.text(monthCell, monthName(spec, month), monthOn ? 1 : 0.25)
      if (month.month === view.month) this.style(monthCell, CALENDAR_LAYERS.selected)
      const year = decade.add({ years: index })
      const yearCell = this.at(CALENDAR_LAYERS.yearCell(index))
      this.text(yearCell, yearName(spec, year), periodEnabled(spec, year, { years: 1 }) ? 1 : 0.25)
      if (year.year === view.year) this.style(yearCell, CALENDAR_LAYERS.selected)
    }
  }
}

/** Whether any day of a month or year starting at `first` lies inside the minimum and maximum. */
function periodEnabled(
  spec: CalendarSpec,
  first: CalendarDate,
  length: { months: number } | { years: number }
): boolean {
  const last = isoOf(first.add(length).subtract({ days: 1 }))
  return !(spec.min && last < spec.min) && !(spec.max && isoOf(first) > spec.max)
}
