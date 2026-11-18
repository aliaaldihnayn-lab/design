import type { Element } from '@xmldom/xmldom'
import { isEqual, maxBy, omitBy } from 'es-toolkit'

import type { CharacterStyleOverride, Fill, SceneNode, StyleRun } from '@lawha/scene-graph'
import { BLACK } from '@lawha/scene-graph/constants'
import type { Color } from '@lawha/scene-graph/primitives'

import { resolveTypeface, solidFillColor, type PPTXTheme } from './theme'
import { attr, boolAttr, child, children, descend, numAttr } from './xml'

/** 1 px = 9525 EMU; 1 pt = 12700 EMU, so a point is 4/3 px. */
export const EMU_PER_PX = 9525
const PX_PER_PT = 96 / 72

/** What one level of a list style, a paragraph, or a run says about the text it styles. */
export interface TextStyle {
  align?: SceneNode['textAlignHorizontal']
  rtl?: boolean
  /** Points. */
  size?: number
  bold?: boolean
  italic?: boolean
  decoration?: SceneNode['textDecoration']
  color?: Color
  latin?: string
  cs?: string
  /** Pixels. */
  letterSpacing?: number
  lineHeight?: SceneNode['lineHeight']
}

const ALIGN: Record<string, SceneNode['textAlignHorizontal']> = {
  l: 'LEFT',
  ctr: 'CENTER',
  r: 'RIGHT',
  just: 'JUSTIFIED',
  dist: 'JUSTIFIED'
}

const ANCHOR: Record<string, SceneNode['textAlignVertical']> = {
  t: 'TOP',
  ctr: 'CENTER',
  b: 'BOTTOM'
}

const RTL_SCRIPT = /[֐-ࣿיִ-﷿ﹰ-﻿]/

function defined(value: TextStyle): TextStyle {
  return omitBy(value, (entry) => entry === undefined)
}

/** Run properties (`a:rPr`, `a:defRPr`, `a:endParaRPr`). */
export function readRunStyle(rPr: Element | undefined, theme: PPTXTheme): TextStyle {
  if (!rPr) return {}
  const size = numAttr(rPr, 'sz')
  const underline = attr(rPr, 'u')
  const strike = attr(rPr, 'strike')
  let decoration: TextStyle['decoration']
  if (underline && underline !== 'none') decoration = 'UNDERLINE'
  else if (strike && strike !== 'noStrike') decoration = 'STRIKETHROUGH'
  else if (underline === 'none' || strike === 'noStrike') decoration = 'NONE'
  const spacing = numAttr(rPr, 'spc')
  return defined({
    size: size === null ? undefined : size / 100,
    bold: boolAttr(rPr, 'b') ?? undefined,
    italic: boolAttr(rPr, 'i') ?? undefined,
    decoration,
    color: solidFillColor(rPr, theme) ?? undefined,
    latin: resolveTypeface(attr(child(rPr, 'latin'), 'typeface'), theme) ?? undefined,
    cs: resolveTypeface(attr(child(rPr, 'cs'), 'typeface'), theme) ?? undefined,
    letterSpacing: spacing === null ? undefined : (spacing / 100) * PX_PER_PT
  })
}

/** Paragraph properties (`a:pPr`, `a:lvl1pPr`), with the run defaults they carry. */
export function readParagraphStyle(pPr: Element | undefined, theme: PPTXTheme): TextStyle {
  if (!pPr) return {}
  const align = attr(pPr, 'algn')
  return {
    ...readRunStyle(child(pPr, 'defRPr'), theme),
    ...defined({
      align: align ? ALIGN[align] : undefined,
      rtl: boolAttr(pPr, 'rtl') ?? undefined,
      lineHeight: readLineSpacing(child(pPr, 'lnSpc'))
    })
  }
}

function readLineSpacing(lnSpc: Element | undefined): SceneNode['lineHeight'] | undefined {
  const points = numAttr(child(lnSpc, 'spcPts'), 'val')
  if (points !== null) return { value: (points / 100) * PX_PER_PT, unit: 'PIXELS' }
  const percent = numAttr(child(lnSpc, 'spcPct'), 'val')
  if (percent === null) return undefined
  // PowerPoint's single spacing is the font's own line height, which Lawha calls automatic.
  if (percent === 100000) return null
  return { value: (percent / 1000) * 1.2, unit: 'PERCENT' }
}

/** A list style's level (`a:lstStyle/a:lvlNpPr`, or a master's `p:titleStyle/a:lvlNpPr`). */
export function levelStyle(list: Element | undefined, level: number, theme: PPTXTheme): TextStyle {
  return readParagraphStyle(child(list, `lvl${level}pPr`), theme)
}

export interface TextBody {
  text: string
  base: TextStyle
  runs: { start: number; length: number; style: TextStyle }[]
  verticalAlign: SceneNode['textAlignVertical']
  /** EMU insets: left, top, right, bottom. */
  insets: [number, number, number, number]
  fontScale: number
}

type TextLayout = Pick<TextBody, 'verticalAlign' | 'insets' | 'fontScale'>

/** Insets, anchor and autofit: the shape's, else those of the placeholders it stands in for. */
function bodyLayout(bodyPrs: (Element | undefined)[]): TextLayout {
  const number = (name: string) =>
    bodyPrs.map((el) => numAttr(el, name)).find((value) => value !== null) ?? null
  const anchor = bodyPrs.map((el) => attr(el, 'anchor')).find((value) => value !== null)
  const autofit = bodyPrs.map((el) => child(el, 'normAutofit')).find((el) => el !== undefined)
  return {
    verticalAlign: ANCHOR[anchor ?? 't'] ?? 'TOP',
    insets: [
      number('lIns') ?? 91440,
      number('tIns') ?? 45720,
      number('rIns') ?? 91440,
      number('bIns') ?? 45720
    ],
    fontScale: (numAttr(autofit, 'fontScale') ?? 100000) / 100000
  }
}

interface Piece {
  text: string
  style: TextStyle
}

/** A paragraph's runs and line breaks, each with its resolved style. */
function paragraphPieces(paragraph: Element, style: TextStyle, theme: PPTXTheme): Piece[] {
  const pieces: Piece[] = []
  for (const run of children(paragraph)) {
    if (run.localName === 'br') pieces.push({ text: '\n', style })
    if (run.localName !== 'r' && run.localName !== 'fld') continue
    const text = child(run, 't')?.textContent ?? ''
    if (text) pieces.push({ text, style: { ...style, ...readRunStyle(child(run, 'rPr'), theme) } })
  }
  return pieces
}

/**
 * The text of a `p:txBody`, its styles resolved through `inherited`: the list-style levels a
 * placeholder takes from its master and layout, outermost first.
 */
export function readTextBody(
  body: Element,
  theme: PPTXTheme,
  inherited: (level: number) => TextStyle,
  inheritedBodies: Element[] = []
): TextBody | null {
  const shapeList = child(body, 'lstStyle')
  const pieces: Piece[] = []
  const paragraphStyles: TextStyle[] = []
  for (const [index, paragraph] of children(body, 'p').entries()) {
    // pptxgenjs repeats `a:pPr` before every run; the first is the paragraph's.
    const pPr = child(paragraph, 'pPr')
    const level = (numAttr(pPr, 'lvl') ?? 0) + 1
    const style = {
      ...inherited(level),
      ...levelStyle(shapeList, level, theme),
      ...readParagraphStyle(pPr, theme)
    }
    paragraphStyles.push(style)
    if (index > 0) pieces.push({ text: '\n', style })
    pieces.push(...paragraphPieces(paragraph, style, theme))
  }
  const text = pieces.map((piece) => piece.text).join('')
  const first = paragraphStyles.at(0)
  if (!text.trim() || !first) return null

  const base = pieces.find((piece) => piece.text !== '\n')?.style ?? first
  const runs: TextBody['runs'] = []
  let offset = 0
  for (const piece of pieces) {
    runs.push({ start: offset, length: piece.text.length, style: piece.style })
    offset += piece.text.length
  }
  return {
    text,
    base: { ...base, align: first.align ?? base.align, rtl: first.rtl ?? base.rtl },
    runs,
    ...bodyLayout([body, ...inheritedBodies].map((el) => child(el, 'bodyPr')))
  }
}

function solid(color: Color): Fill {
  return { type: 'SOLID', color: { ...color }, opacity: 1, visible: true }
}

/** A text style as character properties of a text node. */
function characterStyle(
  style: TextStyle,
  text: string,
  fontScale: number,
  fallbackColor: Color
): Required<
  Pick<
    CharacterStyleOverride,
    'fontSize' | 'fontFamily' | 'fontWeight' | 'italic' | 'textDecoration' | 'fills'
  >
> &
  Pick<CharacterStyleOverride, 'letterSpacing' | 'lineHeight'> {
  const family = RTL_SCRIPT.test(text) && style.cs ? style.cs : (style.latin ?? style.cs)
  return {
    fontSize: Math.round((style.size ?? 18) * fontScale * PX_PER_PT * 100) / 100,
    fontFamily: family ?? 'Calibri',
    fontWeight: style.bold ? 700 : 400,
    italic: style.italic ?? false,
    textDecoration: style.decoration ?? 'NONE',
    fills: [solid(style.color ?? fallbackColor)],
    letterSpacing: style.letterSpacing
      ? { value: Math.round(style.letterSpacing * 100) / 100, unit: 'PIXELS' }
      : undefined,
    lineHeight: style.lineHeight
  }
}

type CharacterStyle = ReturnType<typeof characterStyle>

/** What a run's style changes from the node's own. */
function styleOverride(style: CharacterStyle, base: CharacterStyle): CharacterStyleOverride {
  const override: CharacterStyleOverride = {}
  const keys = ['fontSize', 'fontFamily', 'fontWeight', 'italic', 'textDecoration'] as const
  for (const key of keys) {
    if (style[key] !== base[key]) Object.assign(override, { [key]: style[key] })
  }
  if (!isEqual(style.fills, base.fills)) override.fills = style.fills
  if (style.letterSpacing && !isEqual(style.letterSpacing, base.letterSpacing)) {
    override.letterSpacing = style.letterSpacing
  }
  return override
}

/** The style most of a text's characters use, which the node takes as its own. */
function commonStyle(styled: { length: number; style: CharacterStyle }[]): CharacterStyle | null {
  const tally: { style: CharacterStyle; count: number }[] = []
  for (const { length, style } of styled) {
    const entry = tally.find((item) => isEqual(item.style, style))
    if (entry) entry.count += length
    else tally.push({ style, count: length })
  }
  return maxBy(tally, (item) => item.count)?.style ?? null
}

/** A text body as a text node's properties: its base style, and runs where styles differ. */
export function textNodeProps(body: TextBody, fallbackColor: Color = BLACK): Partial<SceneNode> {
  // A paragraph break carries no characters to style.
  const styled = body.runs
    .filter((run) => body.text.slice(run.start, run.start + run.length) !== '\n')
    .map((run) => ({
      ...run,
      style: characterStyle(
        run.style,
        body.text.slice(run.start, run.start + run.length),
        body.fontScale,
        fallbackColor
      )
    }))
  const base =
    commonStyle(styled) ?? characterStyle(body.base, body.text, body.fontScale, fallbackColor)
  const styleRuns: StyleRun[] = []
  for (const run of styled) {
    const override = styleOverride(run.style, base)
    if (Object.keys(override).length === 0) continue
    const last = styleRuns.at(-1)
    if (last && last.start + last.length === run.start && isEqual(last.style, override)) {
      last.length += run.length
    } else {
      styleRuns.push({ start: run.start, length: run.length, style: override })
    }
  }
  const props: Partial<SceneNode> = {
    text: body.text,
    fontSize: base.fontSize,
    fontFamily: base.fontFamily,
    fontWeight: base.fontWeight,
    italic: base.italic,
    textDecoration: base.textDecoration,
    fills: base.fills,
    styleRuns,
    textAlignHorizontal: body.base.align ?? 'LEFT',
    textAlignVertical: body.verticalAlign,
    textDirection: body.base.rtl ? 'RTL' : 'AUTO',
    textAutoResize: 'NONE'
  }
  if (base.letterSpacing) props.letterSpacing = base.letterSpacing
  if (base.lineHeight !== undefined) props.lineHeight = base.lineHeight
  return props
}

/** The master text style a placeholder type starts from. */
export function masterTextStyle(master: Element | null, placeholderType: string | null) {
  const styles = descend(master, 'txStyles')
  if (placeholderType === 'title' || placeholderType === 'ctrTitle')
    return child(styles, 'titleStyle')
  if (placeholderType === null) return child(styles, 'otherStyle')
  return child(styles, 'bodyStyle')
}
