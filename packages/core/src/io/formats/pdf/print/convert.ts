import { inflateSync } from 'fflate'

import { randomHex } from '@lawha/scene-graph/random'

import {
  formatNumber,
  PDF_OUTPUT_INTENTS,
  pdfName,
  pdfString,
  rgbToCMYK,
  spotCMYK,
  vectorCMYK,
  type PDFOutputIntentId,
  type PDFSpotColor,
  type ToCMYK
} from './color'
import { rewriteContent, spotResourceName } from './content'
import {
  addObject,
  dictValue,
  latin1,
  latin1Bytes,
  matchingDict,
  parsePDF,
  refNumber,
  removeDictKey,
  setDictValue,
  writePDF,
  type PDFFile,
  type PDFObject
} from './file'
import { convertImage, isImage, type PDFImageDecoder } from './images'
import { printIssue, type PrintIssue } from './issues'

export type PDFXStandard = 'PDF/X-1a:2003' | 'PDF/X-4'

export interface PrintConversionOptions {
  spots: readonly PDFSpotColor[]
  outputIntent: PDFOutputIntentId
  /** The press condition's ICC profile, embedded in the output intent. */
  outputProfile?: Uint8Array
  /** RGB to the press condition's CMYK, through its profile; the device formula without one. */
  toCMYK?: ToCMYK
  /** The PDF/X version to declare; PDF/X-1a by default, which allows no transparency. */
  standard?: PDFXStandard
  /** How far inside the media box the bleed box and the trim box sit, in points. */
  bleedInset: number
  /** One inset for every page, or each page's in order. */
  trimInset: number | readonly number[]
  title?: string
  decodeImage?: PDFImageDecoder
}

export interface PrintConversionResult {
  data: Uint8Array
  /** The PDF/X version the file declares, or null when something in it rules PDF/X out. */
  pdfx: PDFXStandard | null
  /** What keeps the file from being PDF/X, for the person exporting to fix. */
  issues: PrintIssue[]
}

/** Issues by code and subject, so one is listed once. */
class IssueSet {
  private readonly byKey = new Map<string, PrintIssue>()
  add(issue: PrintIssue) {
    this.byKey.set(`${issue.code}:${issue.subject ?? ''}`, issue)
  }
  get size() {
    return this.byKey.size
  }
  list(): PrintIssue[] {
    return [...this.byKey.values()]
  }
}

const STANDARD_FONTS = /^\/(Helvetica|Courier|Times|Symbol|ZapfDingbats)/

function isType(object: PDFObject, type: string): boolean {
  return new RegExp(`/Type\\s*/${type}(?![A-Za-z])`).test(object.dict)
}

function refList(value: string | null): number[] {
  if (!value) return []
  return [...value.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]))
}

/** A stream's bytes with any Flate filter undone, or null for a filter this cannot undo. */
function decodedStream(object: PDFObject): Uint8Array | null {
  if (!object.stream) return null
  const filter = dictValue(object.dict, 'Filter')
  if (!filter) return object.stream
  if (filter === '/FlateDecode') return inflateSync(object.stream)
  return null
}

interface Usage {
  spots: Set<number>
  fonts: Set<string>
}

/** Every page, pattern and form content stream with its colours turned to CMYK and spots. */
function convertContents(
  file: PDFFile,
  spots: readonly PDFSpotColor[],
  issues: IssueSet,
  toCMYK: ToCMYK
) {
  const usage: Usage = { spots: new Set(), fonts: new Set() }
  const contentIds = new Set<number>()
  for (const object of file.objects.values()) {
    if (isType(object, 'Page')) {
      for (const id of refList(dictValue(object.dict, 'Contents'))) contentIds.add(id)
    }
  }
  for (const [id, object] of file.objects) {
    const isForm = /\/Subtype\s*\/Form\b/.test(object.dict)
    if (contentIds.has(id) || isType(object, 'Pattern') || isForm) {
      const bytes = decodedStream(object)
      if (!bytes) {
        if (object.stream) issues.add(printIssue('compressed-content'))
        continue
      }
      const rewritten = rewriteContent(latin1(bytes), spots, toCMYK)
      for (const spot of rewritten.spotsUsed) usage.spots.add(spot)
      for (const font of rewritten.fontsUsed) usage.fonts.add(font)
      file.objects.set(id, {
        dict: removeDictKey(object.dict, 'Filter'),
        stream: latin1Bytes(rewritten.text)
      })
    }
  }
  return usage
}

function convertNumbers(list: string, issues: IssueSet, toCMYK: ToCMYK): string | null {
  const values = list.replace(/[[\]]/g, ' ').trim().split(/\s+/).map(Number)
  if (values.length !== 3 || values.some((v) => !Number.isFinite(v))) {
    issues.add(printIssue('gradient-colours'))
    return null
  }
  const [r, g, b] = values
  return `[${toCMYK(r, g, b).map(formatNumber).join(' ')}]`
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '')
  const out = new Uint8Array(clean.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** A sampled (type 0) function's RGB samples as CMYK. */
function convertSampled(object: PDFObject, issues: IssueSet, toCMYK: ToCMYK): PDFObject {
  const filter = dictValue(object.dict, 'Filter')
  const raw = object.stream ?? new Uint8Array()
  if (dictValue(object.dict, 'BitsPerSample') !== '8' || (filter && filter !== '/ASCIIHexDecode')) {
    issues.add(printIssue('gradient-colours'))
    return object
  }
  const samples = filter ? hexBytes(latin1(raw).replace(/>.*$/s, '')) : raw
  const out: string[] = []
  for (let i = 0; i + 2 < samples.length; i += 3) {
    const cmyk = toCMYK(samples[i] / 255, samples[i + 1] / 255, samples[i + 2] / 255)
    for (const value of cmyk)
      out.push(
        Math.round(value * 255)
          .toString(16)
          .padStart(2, '0')
      )
  }
  const unit = '[0 1 0 1 0 1 0 1]'
  let dict = setDictValue(object.dict, 'Range', unit)
  if (dictValue(dict, 'Decode') !== null) dict = setDictValue(dict, 'Decode', unit)
  dict = setDictValue(dict, 'Filter', '/ASCIIHexDecode')
  return { dict, stream: latin1Bytes(`${out.join('')}>`) }
}

function convertFunction(
  file: PDFFile,
  id: number,
  issues: IssueSet,
  seen: Set<number>,
  toCMYK: ToCMYK
) {
  if (seen.has(id)) return
  seen.add(id)
  const object = file.objects.get(id)
  if (!object) return
  const type = dictValue(object.dict, 'FunctionType')
  if (type === '0') {
    file.objects.set(id, convertSampled(object, issues, toCMYK))
  } else if (type === '2') {
    let dict = object.dict
    for (const key of ['C0', 'C1']) {
      const list = dictValue(dict, key)
      const converted = list ? convertNumbers(list, issues, toCMYK) : null
      if (converted) dict = setDictValue(dict, key, converted)
    }
    file.objects.set(id, { ...object, dict })
  } else if (type === '3') {
    for (const child of refList(dictValue(object.dict, 'Functions')))
      convertFunction(file, child, issues, seen, toCMYK)
  } else {
    issues.add(printIssue('gradient-colours'))
  }
}

/** RGB shadings, the gradients svg2pdf writes, as CMYK ones. */
function convertShadings(file: PDFFile, issues: IssueSet, toCMYK: ToCMYK) {
  const seen = new Set<number>()
  for (const [id, object] of file.objects) {
    if (dictValue(object.dict, 'ShadingType') === null) continue
    if (dictValue(object.dict, 'ColorSpace') !== '/DeviceRGB') continue
    file.objects.set(id, {
      ...object,
      dict: setDictValue(object.dict, 'ColorSpace', '/DeviceCMYK')
    })
    for (const fn of refList(dictValue(object.dict, 'Function')))
      convertFunction(file, fn, issues, seen, toCMYK)
  }
}

function convertImages(file: PDFFile, issues: IssueSet, toCMYK: ToCMYK, decode?: PDFImageDecoder) {
  for (const [id, object] of file.objects) {
    if (!isImage(object)) continue
    const converted = convertImage(object, decode, toCMYK)
    if (converted) file.objects.set(id, converted)
    else if ((dictValue(object.dict, 'ColorSpace') ?? '').includes('DeviceRGB'))
      issues.add(printIssue('image-not-converted'))
  }
}

/** The inner text of a resource sub-dictionary such as `/Font << … >>`, and where it sits. */
function subDict(dict: string, key: string) {
  const match = new RegExp(`/${key}\\s*<<`).exec(dict)
  if (!match) return null
  const open = match.index + match[0].length - 2
  const close = open + matchingDict(dict.slice(open))
  return { start: open + 2, end: close, body: dict.slice(open + 2, close) }
}

/** Resource dictionaries with the spot inks' colour spaces and only the fonts text uses. */
function updateResources(file: PDFFile, usage: Usage, spaces: Map<number, number>) {
  const entries = [...spaces].map(([spot, ref]) => `/${spotResourceName(spot)} ${ref} 0 R`)
  for (const [id, object] of file.objects) {
    if (!/\/ProcSet/.test(object.dict)) continue
    let dict = object.dict
    const fonts = subDict(dict, 'Font')
    if (fonts) {
      const kept = [...fonts.body.matchAll(/\/([^\s/]+)\s+(\d+\s+\d+\s+R)/g)]
        .filter((match) => usage.fonts.has(match[1]))
        .map((match) => `/${match[1]} ${match[2]}`)
      dict = `${dict.slice(0, fonts.start)}\n${kept.join('\n')}\n${dict.slice(fonts.end)}`
    }
    if (entries.length > 0) {
      const spacesDict = subDict(dict, 'ColorSpace')
      dict = spacesDict
        ? `${dict.slice(0, spacesDict.end)}${entries.join('\n')}\n${dict.slice(spacesDict.end)}`
        : setDictValue(dict, 'ColorSpace', `<<\n${entries.join('\n')}\n>>`)
    }
    file.objects.set(id, { ...object, dict })
  }
}

/** A Separation colour space for each spot ink used, by spot index. */
function addSpotSpaces(
  file: PDFFile,
  spots: readonly PDFSpotColor[],
  used: Set<number>,
  toCMYK: ToCMYK
) {
  const spaces = new Map<number, number>()
  for (const index of [...used].sort((a, b) => a - b)) {
    const spot = spots[index]
    const tint = addObject(file, {
      dict: `<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${spotCMYK(spot, toCMYK)
        .map(formatNumber)
        .join(' ')}] /N 1 >>`
    })
    spaces.set(
      index,
      addObject(file, { dict: `[/Separation ${pdfName(spot.name)} /DeviceCMYK ${tint} 0 R]` })
    )
  }
  return spaces
}

function isEmbedded(file: PDFFile, id: number, depth = 0): boolean {
  const object = file.objects.get(id)
  if (!object || depth > 3) return false
  if (/\/FontFile[23]?\b/.test(object.dict)) return true
  const refs = [
    ...refList(dictValue(object.dict, 'FontDescriptor')),
    ...refList(dictValue(object.dict, 'DescendantFonts'))
  ]
  return refs.some((ref) => isEmbedded(file, ref, depth + 1))
}

/** Fonts the text is set in that the file does not carry. */
function checkFonts(file: PDFFile, usage: Usage, issues: IssueSet) {
  const resources = [...file.objects.values()].filter((object) => /\/ProcSet/.test(object.dict))
  for (const font of usage.fonts) {
    for (const object of resources) {
      const ref = refNumber(dictValue(subDict(object.dict, 'Font')?.body ?? '', font))
      if (ref === null || isEmbedded(file, ref)) continue
      const base = dictValue(file.objects.get(ref)?.dict ?? '', 'BaseFont') ?? font
      issues.add(
        printIssue(STANDARD_FONTS.test(base) ? 'standard-font' : 'font-not-embedded', base.slice(1))
      )
    }
  }
}

function hasTransparency(file: PDFFile): boolean {
  for (const object of file.objects.values()) {
    for (const key of ['ca', 'CA']) {
      const value = dictValue(object.dict, key)
      if (value !== null && Number(value) < 1) return true
    }
    const mask = dictValue(object.dict, 'SMask')
    if (mask !== null && mask !== '/None') return true
  }
  return false
}

/** `D:20261110172528+03'00'` as `2026-11-10T17:25:28+03:00`. */
function isoDate(date: string): string {
  const match = /D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:([+-])(\d{2})'(\d{2}))?/.exec(date)
  if (!match) return '1970-01-01T00:00:00Z'
  const [, y, mo, d, h, mi, s, sign, oh, om] = match
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign ? `${sign}${oh}:${om}` : 'Z'}`
}

function escapeXML(text: string): string {
  return text.replace(/[<>&"]/g, (char) => `&#${char.charCodeAt(0)};`)
}

function metadata(title: string, created: string, pdfx: string | null): Uint8Array {
  const date = isoDate(created)
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXML(title)}</rdf:li></rdf:Alt></dc:title>
<xmp:CreateDate>${date}</xmp:CreateDate><xmp:ModifyDate>${date}</xmp:ModifyDate><xmp:MetadataDate>${date}</xmp:MetadataDate>
<xmp:CreatorTool>Lawha</xmp:CreatorTool><pdf:Producer>Lawha</pdf:Producer><pdf:Trapped>False</pdf:Trapped>
<xmpMM:DocumentID>uuid:${randomHex(16)}</xmpMM:DocumentID><xmpMM:InstanceID>uuid:${randomHex(16)}</xmpMM:InstanceID>
${pdfx ? `<pdfxid:GTS_PDFXVersion>${pdfx}</pdfxid:GTS_PDFXVersion>` : ''}
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`
  return new TextEncoder().encode(xmp)
}

/** Trim and bleed boxes inside each page's media box. */
function setPageBoxes(file: PDFFile, bleedInset: number, trimInsets: number | readonly number[]) {
  let index = 0
  for (const [id, object] of file.objects) {
    if (!isType(object, 'Page')) continue
    const perPage = typeof trimInsets === 'number' ? [trimInsets] : trimInsets
    const trimInset = perPage[Math.min(index, perPage.length - 1)] ?? 0
    index++
    const media = (dictValue(object.dict, 'MediaBox') ?? '')
      .replace(/[[\]]/g, ' ')
      .trim()
      .split(/\s+/)
      .map(Number)
    if (media.length !== 4 || media.some((v) => !Number.isFinite(v))) continue
    const box = (inset: number) =>
      `[${[media[0] + inset, media[1] + inset, media[2] - inset, media[3] - inset].map(formatNumber).join(' ')}]`
    let dict = setDictValue(object.dict, 'BleedBox', box(bleedInset))
    dict = setDictValue(dict, 'TrimBox', box(trimInset))
    file.objects.set(id, { ...object, dict })
  }
}

function writeIntent(file: PDFFile, options: PrintConversionOptions, pdfx: string | null) {
  const intent = PDF_OUTPUT_INTENTS[options.outputIntent]
  const profile = options.outputProfile
    ? addObject(file, { dict: '<< /N 4 >>', stream: options.outputProfile })
    : null
  const intentId = addObject(file, {
    dict: `<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier ${pdfString(intent.identifier)} /OutputCondition ${pdfString(intent.info)} /Info ${pdfString(intent.info)} /RegistryName (http://www.color.org)${profile ? ` /DestOutputProfile ${profile} 0 R` : ''} >>`
  })
  const info = file.info === null ? null : file.objects.get(file.info)
  const created = dictValue(info?.dict ?? '', 'CreationDate') ?? '(D:19700101000000Z)'
  const title = options.title ?? 'Untitled'
  if (info && file.info !== null) {
    let dict = setDictValue(info.dict, 'Title', pdfString(title))
    dict = setDictValue(dict, 'ModDate', created)
    dict = setDictValue(dict, 'Trapped', '/False')
    if (pdfx) dict = setDictValue(dict, 'GTS_PDFXVersion', pdfString(pdfx))
    file.objects.set(file.info, { dict })
  }
  const meta = addObject(file, {
    dict: '<< /Type /Metadata /Subtype /XML >>',
    stream: metadata(title, created.replace(/^\(|\)$/g, ''), pdfx)
  })
  const catalog = file.objects.get(file.root)
  if (catalog) {
    let dict = setDictValue(catalog.dict, 'OutputIntents', `[${intentId} 0 R]`)
    dict = setDictValue(dict, 'Metadata', `${meta} 0 R`)
    file.objects.set(file.root, { dict })
  }
}

/**
 * A jsPDF-written PDF made ready for press: its colours, gradients and images in DeviceCMYK,
 * spot inks as Separations, trim and bleed boxes on every page, and the press condition as its
 * output intent. It declares PDF/X only when nothing in it rules PDF/X out.
 */
export function convertToPrintPDF(
  bytes: Uint8Array,
  options: PrintConversionOptions
): PrintConversionResult {
  const file = parsePDF(bytes)
  const issues = new IssueSet()
  const toCMYK = options.toCMYK ?? rgbToCMYK
  const toVectorCMYK = vectorCMYK(toCMYK)
  const usage = convertContents(file, options.spots, issues, toVectorCMYK)
  convertShadings(file, issues, toCMYK)
  convertImages(file, issues, toCMYK, options.decodeImage)
  const spaces = addSpotSpaces(file, options.spots, usage.spots, toCMYK)
  updateResources(file, usage, spaces)
  checkFonts(file, usage, issues)
  const standard = options.standard ?? 'PDF/X-1a:2003'
  if (standard === 'PDF/X-1a:2003' && hasTransparency(file)) {
    issues.add(printIssue('transparency'))
  }
  for (const object of file.objects.values()) {
    if (/\/DeviceRGB\b/.test(object.dict)) issues.add(printIssue('rgb-remaining'))
  }
  setPageBoxes(file, options.bleedInset, options.trimInset)
  const pdfx = issues.size === 0 ? standard : null
  writeIntent(file, options, pdfx)
  return {
    data: writePDF(file, standard === 'PDF/X-4' ? '1.6' : '1.4'),
    pdfx,
    issues: issues.list()
  }
}
