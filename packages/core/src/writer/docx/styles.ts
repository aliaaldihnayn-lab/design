import type { Element } from '@xmldom/xmldom'

import type { WriterDefaults } from '#core/writer/model'

import { attrOf, kid, kids, parseXML, toggleOf, valOf } from './xml'

/**
 * Word's style inheritance, resolved as Word resolves it: document defaults (`w:docDefaults`),
 * then the paragraph style and each style it is based on, then the character style and its
 * bases, then the run's own properties. Only the properties the model keeps are read.
 */

/** Run properties, each left out when nothing on the chain sets it. */
export interface RunProperties {
  bold?: boolean
  boldComplex?: boolean
  italic?: boolean
  italicComplex?: boolean
  underline?: boolean
  strike?: boolean
  vertAlign?: 'superscript' | 'subscript' | 'baseline'
  /** Latin font (`w:ascii`, else `w:hAnsi`). */
  font?: string
  /** Complex-script font (`w:cs`), which Arabic and Hebrew text use. */
  fontComplex?: string
  /** Half-points. */
  size?: number
  sizeComplex?: number
  color?: string
  highlight?: string
  shading?: string
}

export interface ParagraphProperties {
  bidi?: boolean
  jc?: string
  numId?: string
  ilvl?: number
}

interface StyleEntry {
  id: string
  type: string
  name: string
  basedOn: string | null
  run: RunProperties
  paragraph: ParagraphProperties
}

export interface StyleSheet {
  /** Lowercase names by style id, as heading detection reads them. */
  names: Map<string, string>
  /** Defaults with the default paragraph style applied: what unstyled text looks like. */
  defaultRun: RunProperties
  defaultParagraph: ParagraphProperties
  /** The default paragraph style's id, used where a paragraph names none. */
  defaultParagraphStyle: string | null
  styles: Map<string, StyleEntry>
}

const HEX = /^[0-9a-f]{6}$/i

function definedEntries<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null)
  ) as Partial<T>
}

const toggle = (parent: Element | null, name: string) => toggleOf(parent, name) ?? undefined

/** The properties a `w:rPr` sets itself. */
export function readRunProperties(rPr: Element | null): RunProperties {
  if (!rPr) return {}
  const fonts = kid(rPr, 'rFonts')
  const u = kid(rPr, 'u')
  const strike = toggleOf(rPr, 'strike') ?? toggleOf(rPr, 'dstrike')
  const vertAlign = valOf(rPr, 'vertAlign')
  const size = Number(valOf(rPr, 'sz'))
  const sizeComplex = Number(valOf(rPr, 'szCs'))
  const color = valOf(rPr, 'color')
  const fill = attrOf(kid(rPr, 'shd'), 'fill')
  return definedEntries<RunProperties>({
    bold: toggle(rPr, 'b'),
    boldComplex: toggle(rPr, 'bCs'),
    italic: toggle(rPr, 'i'),
    italicComplex: toggle(rPr, 'iCs'),
    underline: u ? valOf(rPr, 'u') !== 'none' : undefined,
    strike: strike ?? undefined,
    vertAlign:
      vertAlign === 'superscript' || vertAlign === 'subscript' || vertAlign === 'baseline'
        ? vertAlign
        : undefined,
    font: attrOf(fonts, 'ascii') ?? attrOf(fonts, 'hAnsi') ?? undefined,
    fontComplex: attrOf(fonts, 'cs') ?? undefined,
    size: size > 0 ? size : undefined,
    sizeComplex: sizeComplex > 0 ? sizeComplex : undefined,
    color: color && HEX.test(color) ? color.toLowerCase() : undefined,
    highlight: valOf(rPr, 'highlight') ?? undefined,
    shading: fill && HEX.test(fill) ? fill.toLowerCase() : undefined
  })
}

/** The properties a `w:pPr` sets itself. */
export function readParagraphProperties(pPr: Element | null): ParagraphProperties {
  if (!pPr) return {}
  const numPr = kid(pPr, 'numPr')
  const ilvl = valOf(numPr, 'ilvl')
  return definedEntries<ParagraphProperties>({
    bidi: toggle(pPr, 'bidi'),
    jc: valOf(pPr, 'jc') ?? undefined,
    numId: valOf(numPr, 'numId') ?? undefined,
    ilvl: ilvl === null ? undefined : Number(ilvl)
  })
}

export const mergeRun = (...layers: RunProperties[]): RunProperties =>
  Object.assign({}, ...layers) as RunProperties

const mergeParagraph = (...layers: ParagraphProperties[]): ParagraphProperties =>
  Object.assign({}, ...layers) as ParagraphProperties

export function readStyleSheet(source: string | null): StyleSheet {
  const root = parseXML(source ?? '')
  const styles = new Map<string, StyleEntry>()
  const names = new Map<string, string>()
  let defaultParagraphStyle: string | null = null
  for (const style of kids(root, 'style')) {
    const id = attrOf(style, 'styleId')
    if (!id) continue
    const type = attrOf(style, 'type') ?? 'paragraph'
    const name = (valOf(style, 'name') ?? id).toLowerCase()
    names.set(id, name)
    styles.set(id, {
      id,
      type,
      name,
      basedOn: valOf(style, 'basedOn'),
      run: readRunProperties(kid(style, 'rPr')),
      paragraph: readParagraphProperties(kid(style, 'pPr'))
    })
    const isDefault = ['1', 'true', 'on'].includes(attrOf(style, 'default') ?? '')
    if (type === 'paragraph' && isDefault) defaultParagraphStyle = id
  }
  const defaults = kid(root, 'docDefaults')
  const docRun = readRunProperties(kid(kid(defaults, 'rPrDefault'), 'rPr'))
  const docParagraph = readParagraphProperties(kid(kid(defaults, 'pPrDefault'), 'pPr'))
  const sheet: StyleSheet = {
    names,
    defaultRun: docRun,
    defaultParagraph: docParagraph,
    defaultParagraphStyle,
    styles
  }
  if (defaultParagraphStyle) {
    sheet.defaultRun = mergeRun(docRun, styleRun(sheet, defaultParagraphStyle))
    sheet.defaultParagraph = mergeParagraph(
      docParagraph,
      styleParagraph(sheet, defaultParagraphStyle)
    )
  }
  return sheet
}

/** A style and the styles it is based on, base first; a loop in `basedOn` ends the chain. */
function chain(sheet: StyleSheet, id: string | null): StyleEntry[] {
  const out: StyleEntry[] = []
  const seen = new Set<string>()
  let current = id ? sheet.styles.get(id) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    out.unshift(current)
    current = current.basedOn ? sheet.styles.get(current.basedOn) : undefined
  }
  return out
}

/** Run properties a style gives, its bases' included. */
export function styleRun(sheet: StyleSheet, id: string | null): RunProperties {
  return mergeRun(...chain(sheet, id).map((style) => style.run))
}

export function styleParagraph(sheet: StyleSheet, id: string | null): ParagraphProperties {
  return mergeParagraph(...chain(sheet, id).map((style) => style.paragraph))
}

/** Paragraph properties in effect: defaults, the paragraph's style chain, then its own. */
export function effectiveParagraph(
  sheet: StyleSheet,
  styleId: string | null,
  own: ParagraphProperties
): ParagraphProperties {
  return mergeParagraph(sheet.defaultParagraph, styleId ? styleParagraph(sheet, styleId) : {}, own)
}

/** Run properties in effect: defaults, the paragraph style's, the character style's, its own. */
export function effectiveRun(
  sheet: StyleSheet,
  paragraphStyleId: string | null,
  characterStyleId: string | null,
  own: RunProperties
): RunProperties {
  return mergeRun(
    sheet.defaultRun,
    paragraphStyleId ? styleRun(sheet, paragraphStyleId) : {},
    characterStyleId ? styleRun(sheet, characterStyleId) : {},
    own
  )
}

/** The document's default fonts and size, as the model keeps them. */
export function documentDefaults(sheet: StyleSheet): WriterDefaults | null {
  const run = sheet.defaultRun
  const out: WriterDefaults = {}
  if (run.font) out.fontFamily = run.font
  if (run.fontComplex && run.fontComplex !== run.font) out.fontFamilyComplex = run.fontComplex
  if (run.size) out.fontSize = run.size / 2
  if (run.sizeComplex && run.sizeComplex !== run.size) out.fontSizeComplex = run.sizeComplex / 2
  return Object.keys(out).length ? out : null
}
