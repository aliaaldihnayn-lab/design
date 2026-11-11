import type { Element } from '@xmldom/xmldom'

import type { Fill, SceneNode } from '@lawha/scene-graph'
import { WHITE } from '@lawha/scene-graph/constants'
import { parseSVGPath } from '@lawha/scene-graph/parse-path'
import type { Color, Rect } from '@lawha/scene-graph/primitives'
import { transformVectorNetwork } from '@lawha/scene-graph/vector-network'

import { computeAccurateBounds } from '#core/vector/curve-math'

import { readFills } from './paint'
import { placement, type FrameInfo, type ShapeContext } from './space'
import { hexColor, themeColor } from './theme'
import { attr, child, children, descend, numAttr, relAttr } from './xml'

/**
 * A chart as editable shapes: PowerPoint keeps the values a chart last drew in its part's caches,
 * so bars, columns, lines, areas, pies, doughnuts and scatter dots are drawn from them, with the
 * series' colours, the title, category labels, value gridlines and a legend, in a frame of the
 * chart's size. Types it cannot draw, or a chart without cached values, are left to the caller.
 */

interface Series {
  name: string
  values: number[]
  /** Scatter charts' x values. */
  xs: number[]
  color: Color
  /** Pie slices' own colours, by point index. */
  pointColors: Map<number, Color>
}

interface ChartData {
  kind: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter'
  title: string | null
  categories: string[]
  series: Series[]
  holeSize: number
}

const PLOT_TYPES: Record<string, ChartData['kind']> = {
  barChart: 'column',
  bar3DChart: 'column',
  lineChart: 'line',
  line3DChart: 'line',
  areaChart: 'area',
  area3DChart: 'area',
  pieChart: 'pie',
  pie3DChart: 'pie',
  ofPieChart: 'pie',
  doughnutChart: 'doughnut',
  scatterChart: 'scatter'
}

const GREY: Color = { r: 0.35, g: 0.35, b: 0.35, a: 1 }
const GRID: Color = { r: 0.85, g: 0.85, b: 0.85, a: 1 }
const LABEL_SIZE = 12

/** A cache's points by index (`c:strCache`, `c:numCache`). */
function cachePoints(ref: Element | undefined): string[] {
  const cache =
    descend(ref, 'strRef', 'strCache') ??
    descend(ref, 'numRef', 'numCache') ??
    descend(ref, 'multiLvlStrRef', 'multiLvlStrCache', 'lvl') ??
    child(ref, 'strLit') ??
    child(ref, 'numLit')
  const out: string[] = []
  for (const pt of children(cache, 'pt')) {
    out[numAttr(pt, 'idx') ?? out.length] = child(pt, 'v')?.textContent ?? ''
  }
  // A cache may skip points it has no value for.
  return Array.from({ length: out.length }, (_, i) => (i in out ? out[i] : ''))
}

function richText(el: Element | undefined): string {
  return children(descend(el, 'tx', 'rich'), 'p')
    .map((p) =>
      children(p, 'r')
        .map((run) => child(run, 't')?.textContent ?? '')
        .join('')
    )
    .join('\n')
}

function paintColor(ctx: ShapeContext, spPr: Element | undefined): Color | null {
  const fill = readFills(ctx, spPr, { width: 1, height: 1 })?.find(
    (paint) => paint.type === 'SOLID'
  )
  if (fill) return fill.color
  const line = readFills(ctx, child(spPr, 'ln'), { width: 1, height: 1 })?.[0]
  return line?.type === 'SOLID' ? line.color : null
}

/** Office's default theme accents, for a deck whose theme names none. */
const OFFICE_ACCENTS = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']

/** Office's series colours: the theme accents in turn. */
function accent(ctx: ShapeContext, index: number): Color {
  const slot = index % 6
  return themeColor(ctx.theme, `accent${slot + 1}`) ?? hexColor(OFFICE_ACCENTS[slot]) ?? GREY
}

function readChart(ctx: ShapeContext, chartPart: string): ChartData | null {
  const chart = child(ctx.pkg.xml(chartPart), 'chart')
  const plotArea = child(chart, 'plotArea')
  const plot = children(plotArea).find((el) => Object.hasOwn(PLOT_TYPES, el.localName ?? ''))
  if (!plot) return null
  let kind = PLOT_TYPES[plot.localName ?? '']
  if (kind === 'column' && attr(child(plot, 'barDir'), 'val') === 'bar') kind = 'bar'
  const chartCtx = { ...ctx, part: chartPart }
  const varyColors = attr(child(plot, 'varyColors'), 'val') === '1'
  const series = children(plot, 'ser').map((ser, index): Series => {
    const values = cachePoints(child(ser, kind === 'scatter' ? 'yVal' : 'val')).map(Number)
    const pointColors = new Map<number, Color>()
    for (const dPt of children(ser, 'dPt')) {
      const color = paintColor(chartCtx, child(dPt, 'spPr'))
      if (color) pointColors.set(numAttr(child(dPt, 'idx'), 'val') ?? 0, color)
    }
    if ((kind === 'pie' || kind === 'doughnut' || varyColors) && pointColors.size === 0) {
      values.forEach((_, point) => pointColors.set(point, accent(ctx, point)))
    }
    return {
      name: cachePoints(child(ser, 'tx'))[0] ?? `Series ${index + 1}`,
      values,
      xs: kind === 'scatter' ? cachePoints(child(ser, 'xVal')).map(Number) : [],
      color: paintColor(chartCtx, child(ser, 'spPr')) ?? accent(ctx, index),
      pointColors
    }
  })
  if (!series.some((item) => item.values.some(Number.isFinite))) return null
  const firstSer = children(plot, 'ser')[0]
  const deleted = attr(child(chart, 'autoTitleDeleted'), 'val') === '1'
  const title = child(chart, 'title')
  return {
    kind,
    title: title ? richText(title) || (series.length === 1 ? series[0].name : null) : null,
    categories: deleted && !title ? [] : cachePoints(child(firstSer, 'cat')),
    series,
    holeSize: (numAttr(child(plot, 'holeSize'), 'val') ?? 50) / 100
  }
}

// ── Drawing ──────────────────────────────────────────────

function solid(color: Color, opacity = 1): Fill {
  return { type: 'SOLID', color: { ...color }, opacity, visible: true }
}

function label(
  ctx: ShapeContext,
  parentId: string,
  text: string,
  rect: Rect,
  align: SceneNode['textAlignHorizontal'],
  size = LABEL_SIZE
) {
  ctx.graph.createNode('TEXT', parentId, {
    name: text,
    text,
    ...rect,
    fontSize: size,
    fontFamily: ctx.theme.fonts.minor,
    textAlignHorizontal: align,
    textAlignVertical: 'CENTER',
    textAutoResize: 'NONE',
    fills: [solid(GREY)]
  })
}

function vector(
  ctx: ShapeContext,
  parentId: string,
  name: string,
  d: string,
  props: Partial<SceneNode>
) {
  const network = parseSVGPath(d, 'NONZERO', {
    includeOpenRegions: (props.fills ?? []).length > 0
  })
  // The layer sits at its path's bounds, its path moved to start there.
  const box = computeAccurateBounds(network)
  ctx.graph.createNode('VECTOR', parentId, {
    name,
    ...props,
    x: Math.round(box.x * 100) / 100,
    y: Math.round(box.y * 100) / 100,
    width: Math.max(Math.round(box.width * 100) / 100, 0.01),
    height: Math.max(Math.round(box.height * 100) / 100, 0.01),
    vectorNetwork: transformVectorNetwork([1, 0, -box.x, 0, 1, -box.y, 0, 0, 1], network)
  })
}

function rect(ctx: ShapeContext, parentId: string, name: string, box: Rect, color: Color) {
  ctx.graph.createNode('RECTANGLE', parentId, {
    name,
    x: Math.round(box.x * 100) / 100,
    y: Math.round(box.y * 100) / 100,
    width: Math.max(0.5, Math.round(box.width * 100) / 100),
    height: Math.max(0.5, Math.round(box.height * 100) / 100),
    fills: [solid(color)]
  })
}

/** A value axis's range, from zero or the data, to a round step. */
function valueRange(values: number[]) {
  const finite = values.filter(Number.isFinite)
  const min = Math.min(0, ...finite)
  const max = Math.max(0, ...finite)
  const span = max - min || 1
  const step = 10 ** Math.floor(Math.log10(span / 4))
  const nice = [1, 2, 5, 10].map((m) => m * step).find((s) => span / s <= 5) ?? step * 10
  return { min: Math.floor(min / nice) * nice, max: Math.ceil(max / nice) * nice, step: nice }
}

function format(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

function drawAxes(
  ctx: ShapeContext,
  parentId: string,
  plot: Rect,
  range: ReturnType<typeof valueRange>,
  horizontal: boolean
) {
  for (let value = range.min; value <= range.max + range.step / 2; value += range.step) {
    const t = (value - range.min) / (range.max - range.min)
    if (horizontal) {
      const x = plot.x + t * plot.width
      vector(ctx, parentId, 'Gridline', `M${x} ${plot.y}L${x} ${plot.y + plot.height}`, {
        strokes: [{ ...solid(GRID), weight: 1, align: 'CENTER' }]
      })
      label(
        ctx,
        parentId,
        format(value),
        { x: x - 30, y: plot.y + plot.height + 2, width: 60, height: 16 },
        'CENTER'
      )
    } else {
      const y = plot.y + plot.height - t * plot.height
      vector(ctx, parentId, 'Gridline', `M${plot.x} ${y}L${plot.x + plot.width} ${y}`, {
        strokes: [{ ...solid(GRID), weight: 1, align: 'CENTER' }]
      })
      label(
        ctx,
        parentId,
        format(value),
        { x: plot.x - 44, y: y - 8, width: 40, height: 16 },
        'RIGHT'
      )
    }
  }
}

function drawCategories(
  ctx: ShapeContext,
  parentId: string,
  chart: ChartData,
  plot: Rect,
  horizontal: boolean
) {
  const count = Math.max(...chart.series.map((item) => item.values.length), 0)
  for (let i = 0; i < count; i++) {
    const text = chart.categories[i]
    if (!text) continue
    if (horizontal) {
      const band = plot.height / count
      label(
        ctx,
        parentId,
        text,
        { x: plot.x - 84, y: plot.y + i * band, width: 80, height: band },
        'RIGHT'
      )
    } else {
      const band = plot.width / count
      label(
        ctx,
        parentId,
        text,
        { x: plot.x + i * band, y: plot.y + plot.height + 2, width: band, height: 16 },
        'CENTER'
      )
    }
  }
}

function drawBars(ctx: ShapeContext, parentId: string, chart: ChartData, plot: Rect) {
  const horizontal = chart.kind === 'bar'
  const range = valueRange(chart.series.flatMap((item) => item.values))
  drawAxes(ctx, parentId, plot, range, horizontal)
  drawCategories(ctx, parentId, chart, plot, horizontal)
  const count = Math.max(...chart.series.map((item) => item.values.length))
  const along = horizontal ? plot.height : plot.width
  const band = along / count
  const barSize = (band * 0.75) / chart.series.length
  const scale = (horizontal ? plot.width : plot.height) / (range.max - range.min)
  chart.series.forEach((item, s) => {
    item.values.forEach((value, i) => {
      if (!Number.isFinite(value)) return
      const start = band * i + band * 0.125 + barSize * s
      const from = (0 - range.min) * scale
      const to = (value - range.min) * scale
      const color = item.pointColors.get(i) ?? item.color
      const name = `${item.name} ${chart.categories[i] ?? i + 1}`
      if (horizontal) {
        rect(
          ctx,
          parentId,
          name,
          {
            x: plot.x + Math.min(from, to),
            y: plot.y + start,
            width: Math.abs(to - from),
            height: barSize
          },
          color
        )
      } else {
        const bottom = plot.y + plot.height
        rect(
          ctx,
          parentId,
          name,
          {
            x: plot.x + start,
            y: bottom - Math.max(from, to),
            width: barSize,
            height: Math.abs(to - from)
          },
          color
        )
      }
    })
  })
}

function drawLines(ctx: ShapeContext, parentId: string, chart: ChartData, plot: Rect) {
  const range = valueRange(chart.series.flatMap((item) => item.values))
  drawAxes(ctx, parentId, plot, range, false)
  drawCategories(ctx, parentId, chart, plot, false)
  const count = Math.max(...chart.series.map((item) => item.values.length))
  const band = plot.width / count
  const y = (value: number) =>
    plot.y + plot.height - ((value - range.min) / (range.max - range.min)) * plot.height
  for (const item of chart.series) {
    const points = item.values.flatMap((value, i) =>
      Number.isFinite(value) ? [`${plot.x + band * (i + 0.5)} ${y(value)}`] : []
    )
    if (points.length === 0) continue
    if (chart.kind === 'area') {
      const first = plot.x + band * 0.5
      const last = plot.x + band * (item.values.length - 0.5)
      vector(ctx, parentId, item.name, `M${first} ${y(0)}L${points.join('L')}L${last} ${y(0)}Z`, {
        fills: [solid(item.color, 0.85)]
      })
    } else {
      vector(ctx, parentId, item.name, `M${points.join('L')}`, {
        strokes: [
          { ...solid(item.color), weight: 2.5, align: 'CENTER', join: 'ROUND', cap: 'ROUND' }
        ]
      })
    }
  }
}

function drawScatter(ctx: ShapeContext, parentId: string, chart: ChartData, plot: Rect) {
  const ys = valueRange(chart.series.flatMap((item) => item.values))
  const xs = valueRange(chart.series.flatMap((item) => item.xs))
  drawAxes(ctx, parentId, plot, ys, false)
  for (const item of chart.series) {
    item.values.forEach((value, i) => {
      const x = item.xs[i] ?? i + 1
      if (!Number.isFinite(value) || !Number.isFinite(x)) return
      ctx.graph.createNode('ELLIPSE', parentId, {
        name: `${item.name} ${i + 1}`,
        x: plot.x + ((x - xs.min) / (xs.max - xs.min)) * plot.width - 3.5,
        y: plot.y + plot.height - ((value - ys.min) / (ys.max - ys.min)) * plot.height - 3.5,
        width: 7,
        height: 7,
        fills: [solid(item.color)]
      })
    })
  }
}

function drawPie(ctx: ShapeContext, parentId: string, chart: ChartData, plot: Rect) {
  const item = chart.series[0]
  const total = item.values.reduce((sum, value) => sum + (value > 0 ? value : 0), 0)
  if (total <= 0) return
  const r = Math.min(plot.width, plot.height) / 2
  const cx = plot.x + plot.width / 2
  const cy = plot.y + plot.height / 2
  const hole = chart.kind === 'doughnut' ? r * chart.holeSize : 0
  const at = (radius: number, angle: number) =>
    `${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)}`
  // PowerPoint starts at twelve o'clock and goes clockwise.
  let angle = -Math.PI / 2
  item.values.forEach((value, i) => {
    if (!(value > 0)) return
    const sweep = (value / total) * Math.PI * 2
    const end = angle + Math.min(sweep, Math.PI * 2 - 1e-4)
    const large = sweep > Math.PI ? 1 : 0
    const outer = `M${at(r, angle)}A${r} ${r} 0 ${large} 1 ${at(r, end)}`
    const d =
      hole > 0
        ? `${outer}L${at(hole, end)}A${hole} ${hole} 0 ${large} 0 ${at(hole, angle)}Z`
        : `${outer}L${cx} ${cy}Z`
    vector(ctx, parentId, chart.categories[i] || `${item.name} ${i + 1}`, d, {
      fills: [solid(item.pointColors.get(i) ?? accent(ctx, i))],
      strokes: [{ ...solid(WHITE), weight: 1, align: 'CENTER' }]
    })
    angle += sweep
  })
}

function drawLegend(ctx: ShapeContext, parentId: string, chart: ChartData, area: Rect) {
  const pie = chart.kind === 'pie' || chart.kind === 'doughnut'
  const entries = pie
    ? chart.categories.map((name, i) => ({
        name,
        color: chart.series[0].pointColors.get(i) ?? accent(ctx, i)
      }))
    : chart.series.map((item) => ({ name: item.name, color: item.color }))
  if (entries.length < 2) return
  const width = area.width / entries.length
  entries.forEach((entry, i) => {
    const x = area.x + i * width
    rect(
      ctx,
      parentId,
      `${entry.name} key`,
      { x: x + 4, y: area.y + 5, width: 10, height: 10 },
      entry.color
    )
    label(
      ctx,
      parentId,
      entry.name,
      { x: x + 18, y: area.y, width: width - 22, height: 20 },
      'LEFT'
    )
  })
}

/** Draws the chart a graphic frame holds; false when it names no chart this can draw. */
export function addChart(
  ctx: ShapeContext,
  parentId: string,
  data: Element | undefined,
  info: FrameInfo
): boolean {
  const rel = ctx.pkg.rels(ctx.part).get(relAttr(child(data, 'chart'), 'id') ?? '')
  if (!rel || rel.external) return false
  const chart = readChart(ctx, rel.target)
  if (!chart) return false
  const chartSpace = ctx.pkg.xml(rel.target)
  const { box } = info
  const frame = ctx.graph.createNode('FRAME', parentId, {
    name: info.name || 'Chart',
    visible: info.visible,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    fills: readFills({ ...ctx, part: rel.target }, child(chartSpace, 'spPr'), box) ?? [],
    clipsContent: false,
    ...placement(box)
  })
  const titleHeight = chart.title ? 32 : 8
  if (chart.title) {
    label(
      ctx,
      frame.id,
      chart.title,
      { x: 8, y: 4, width: box.width - 16, height: 28 },
      'CENTER',
      18
    )
  }
  const pie = chart.kind === 'pie' || chart.kind === 'doughnut'
  const legend = pie ? chart.categories.length > 1 : chart.series.length > 1
  const bottom = (legend ? 24 : 0) + (pie ? 8 : 22)
  // Room for the value axis labels, wider for a bar chart's category names.
  let left = chart.kind === 'bar' ? 92 : 52
  if (pie) left = 8
  const plot = {
    x: left,
    y: titleHeight + 8,
    width: Math.max(10, box.width - left - 16),
    height: Math.max(10, box.height - titleHeight - 8 - bottom)
  }
  if (pie) drawPie(ctx, frame.id, chart, plot)
  else if (chart.kind === 'line' || chart.kind === 'area') drawLines(ctx, frame.id, chart, plot)
  else if (chart.kind === 'scatter') drawScatter(ctx, frame.id, chart, plot)
  else drawBars(ctx, frame.id, chart, plot)
  if (legend)
    drawLegend(ctx, frame.id, chart, {
      x: 8,
      y: box.height - 24,
      width: box.width - 16,
      height: 20
    })
  return true
}
