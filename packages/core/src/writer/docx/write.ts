import { escapeText } from 'entities'
import { strToU8, zipSync } from 'fflate'

import {
  detectDirection,
  markAttr,
  nodeText,
  numberAttr,
  stringAttr,
  type WriterDocument,
  type WriterNode
} from '#core/writer/model'

import { imageFromDataURL, imageSize } from './images'
import {
  commentsExtendedXML,
  commentsXML,
  contentTypesXML,
  watermarkXML,
  corePropertiesXML,
  numberingXML,
  settingsXML,
  stylesXML
} from './parts'
import { runProperties } from './runs'
import { tableGrid, columnWidths } from './tables'
import { DOCUMENT_NAMESPACES, el, NS, REL, XML_HEADER } from './xml'

const EMU_PER_PX = 9525

interface Relationship {
  id: string
  type: string
  target: string
  external?: boolean
}

export interface ListDefinition {
  numId: number
  ordered: boolean
  start: number
}

/** State of one part being written: its relationships, and the package's shared parts. */
class PartWriter {
  rels: Relationship[] = []
  private openComments = new Set<string>()

  constructor(readonly pkg: PackageWriter) {}

  rel(type: string, target: string, external = false): string {
    const existing = this.rels.find((rel) => rel.type === type && rel.target === target)
    if (existing) return existing.id
    const id = `rId${this.rels.length + 1}`
    this.rels.push({ id, type, target, external })
    return id
  }

  blocks(nodes: readonly WriterNode[] | undefined, textWidth: number): string {
    const out = (nodes ?? []).map((node) => this.block(node, textWidth, 0)).join('')
    return out + this.closeComments([...this.openComments])
  }

  private block(node: WriterNode, textWidth: number, depth: number): string {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        return this.paragraph(node)
      case 'bulletList':
      case 'orderedList':
        return this.list(node, depth, textWidth)
      case 'table':
        return this.table(node, textWidth)
      case 'pageBreak':
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      case 'blockquote':
        return (node.content ?? []).map((child) => this.block(child, textWidth, depth)).join('')
      case 'tableOfContents':
        return this.tableOfContents()
      default:
        return node.content ? this.blocks(node.content, textWidth) : ''
    }
  }

  private paragraph(node: WriterNode, list?: { numId: number; level: number }): string {
    const attrs = node.attrs
    const props: string[] = []
    if (node.type === 'heading') {
      const level = Math.min(6, Math.max(1, numberAttr(attrs, 'level') ?? 1))
      props.push(el('w:pStyle', { 'w:val': `Heading${level}` }))
    }
    if (list) {
      props.push(
        `<w:numPr>${el('w:ilvl', { 'w:val': list.level })}${el('w:numId', { 'w:val': list.numId })}</w:numPr>`
      )
    }
    const rtl = paragraphDirection(node) === 'rtl'
    if (rtl) props.push('<w:bidi/>')
    const jc = wordJustification(stringAttr(attrs, 'textAlign'), rtl)
    if (jc) props.push(el('w:jc', { 'w:val': jc }))
    const pPr = props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''
    return `<w:p>${pPr}${this.inlines(node.content)}</w:p>`
  }

  private list(node: WriterNode, depth: number, textWidth: number): string {
    const ordered = node.type === 'orderedList'
    const numId = this.pkg.addList(ordered, numberAttr(node.attrs, 'start') ?? 1)
    const level = Math.min(depth, 8)
    return (node.content ?? [])
      .map((item) =>
        (item.content ?? [])
          .map((child, index) => {
            if (child.type === 'bulletList' || child.type === 'orderedList') {
              return this.list(child, depth + 1, textWidth)
            }
            if (index === 0 && (child.type === 'paragraph' || child.type === 'heading')) {
              return this.paragraph(child, { numId, level })
            }
            return this.block(child, textWidth, depth + 1)
          })
          .join('')
      )
      .join('')
  }

  private table(node: WriterNode, textWidth: number): string {
    const rows = node.content ?? []
    const grid = tableGrid(rows)
    const columns = grid.columns
    const widths = columnWidths(rows, columns, textWidth)
    const gridXML = widths.map((width) => el('w:gridCol', { 'w:w': width })).join('')
    const rowsXML = grid.rows
      .map((row, rowIndex) => {
        const header = (rows[rowIndex]?.content ?? []).some((cell) => cell.type === 'tableHeader')
        const cells = row
          .map((slot) => {
            if (slot.kind === 'covered') return ''
            const span = slot.cell ? (numberAttr(slot.cell.attrs, 'colspan') ?? 1) : slot.span
            const width = widths.slice(slot.column, slot.column + span).reduce((a, b) => a + b, 0)
            const props = [el('w:tcW', { 'w:w': width, 'w:type': 'dxa' })]
            if (span > 1) props.push(el('w:gridSpan', { 'w:val': span }))
            if (slot.kind === 'continue') props.push('<w:vMerge/>')
            else if ((numberAttr(slot.cell.attrs, 'rowspan') ?? 1) > 1) {
              props.push(el('w:vMerge', { 'w:val': 'restart' }))
            }
            const background =
              slot.kind === 'start' ? stringAttr(slot.cell.attrs, 'background') : null
            if (background)
              props.push(
                el('w:shd', {
                  'w:val': 'clear',
                  'w:color': 'auto',
                  'w:fill': background.replace('#', '')
                })
              )
            const body =
              slot.kind === 'start' && slot.cell.content?.length
                ? this.blocks(slot.cell.content, width)
                : '<w:p/>'
            return `<w:tc><w:tcPr>${props.join('')}</w:tcPr>${body}</w:tc>`
          })
          .join('')
        const trPr = header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''
        return `<w:tr>${trPr}${cells}</w:tr>`
      })
      .join('')
    const dir = stringAttr(node.attrs, 'dir')
    const rtl =
      dir === 'rtl' ||
      (dir !== 'ltr' &&
        rows.some((row) =>
          (row.content ?? []).some((cell) =>
            (cell.content ?? []).some((p) => paragraphDirection(p) === 'rtl')
          )
        ))
    const tblPr =
      '<w:tblPr><w:tblStyle w:val="TableGrid"/>' +
      (rtl ? '<w:bidiVisual/>' : '') +
      '<w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr>'
    return `<w:tbl>${tblPr}<w:tblGrid>${gridXML}</w:tblGrid>${rowsXML}</w:tbl>`
  }

  /** A TOC field whose result lists the current headings; Word refreshes it on open. */
  private tableOfContents(): string {
    const entries = this.pkg.tocEntries()
    const lines = entries.length ? entries : [{ level: 1, text: '' }]
    return lines
      .map((entry, index) => {
        const begin =
          index === 0
            ? '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
              '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>' +
              '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
            : ''
        const end = index === lines.length - 1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : ''
        const rtl = detectDirection(entry.text) === 'rtl' ? '<w:bidi/>' : ''
        return (
          `<w:p><w:pPr>${el('w:pStyle', { 'w:val': `TOC${entry.level}` })}${rtl}</w:pPr>${begin}` +
          `<w:r><w:t xml:space="preserve">${escapeText(entry.text)}</w:t></w:r>${end}</w:p>`
        )
      })
      .join('')
  }

  inlines(nodes: readonly WriterNode[] | undefined): string {
    let out = ''
    for (const node of nodes ?? []) {
      const ids = commentIds(node)
      const closing = [...this.openComments].filter((id) => !ids.includes(id))
      out += this.closeComments(closing)
      for (const id of ids) {
        if (this.openComments.has(id)) continue
        this.openComments.add(id)
        out += el('w:commentRangeStart', { 'w:id': this.pkg.commentNumber(id) })
      }
      out += this.inline(node)
    }
    return out
  }

  private closeComments(ids: readonly string[]): string {
    let out = ''
    for (const id of ids) {
      this.openComments.delete(id)
      const number = this.pkg.commentNumber(id)
      out +=
        el('w:commentRangeEnd', { 'w:id': number }) +
        `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>${el('w:commentReference', { 'w:id': number })}</w:r>`
    }
    return out
  }

  private inline(node: WriterNode): string {
    let run: string
    switch (node.type) {
      case 'text':
        run = this.textRun(node)
        break
      case 'hardBreak':
        run = '<w:r><w:br/></w:r>'
        break
      case 'image':
        run = this.image(node)
        break
      case 'pageNumber':
        run = `<w:fldSimple w:instr=" PAGE "><w:r>${runProperties(node)}<w:t>1</w:t></w:r></w:fldSimple>`
        break
      case 'pageCount':
        run = `<w:fldSimple w:instr=" NUMPAGES "><w:r>${runProperties(node)}<w:t>1</w:t></w:r></w:fldSimple>`
        break
      case 'footnote':
        run = this.footnoteReference(node)
        break
      case 'formField':
        run = this.formField(node)
        break
      default:
        run = this.inlines(node.content)
    }
    return this.wrapChanges(node, this.wrapLink(node, run))
  }

  private textRun(node: WriterNode): string {
    const deleted = node.marks?.some((mark) => mark.type === 'deletion') ?? false
    const tag = deleted ? 'w:delText' : 'w:t'
    const runs = (node.text ?? '')
      .split('\t')
      .map((part) => (part ? `<${tag} xml:space="preserve">${escapeText(part)}</${tag}>` : ''))
    const extra = node.marks?.some((mark) => mark.type === 'link')
      ? el('w:rStyle', { 'w:val': 'Hyperlink' })
      : ''
    return `<w:r>${runProperties(node, extra)}${runs.join('<w:tab/>')}</w:r>`
  }

  private wrapLink(node: WriterNode, run: string): string {
    const href = markAttr(node, 'link', 'href')
    if (typeof href !== 'string' || !href) return run
    if (href.startsWith('#'))
      return `<w:hyperlink w:anchor="${escapeText(href.slice(1))}">${run}</w:hyperlink>`
    return `<w:hyperlink r:id="${this.rel(REL.hyperlink, href, true)}" w:history="1">${run}</w:hyperlink>`
  }

  private wrapChanges(node: WriterNode, run: string): string {
    for (const type of ['insertion', 'deletion'] as const) {
      const mark = node.marks?.find((candidate) => candidate.type === type)
      if (!mark) continue
      const tag = type === 'insertion' ? 'w:ins' : 'w:del'
      run = el(
        tag,
        {
          'w:id': this.pkg.revisionNumber(),
          'w:author': stringAttr(mark.attrs, 'author') ?? 'Lawha',
          'w:date': stringAttr(mark.attrs, 'date') ?? undefined
        },
        run
      )
    }
    return run
  }

  private image(node: WriterNode): string {
    const src = stringAttr(node.attrs, 'src')
    const image = src ? imageFromDataURL(src) : null
    if (!image) return ''
    const target = this.pkg.addMedia(image.bytes, image.extension)
    const rid = this.rel(REL.image, target)
    const natural = imageSize(image.bytes) ?? { width: 300, height: 200 }
    const width = numberAttr(node.attrs, 'width') ?? natural.width
    const height = numberAttr(node.attrs, 'height') ?? (natural.height * width) / natural.width
    const cx = Math.round(width * EMU_PER_PX)
    const cy = Math.round(height * EMU_PER_PX)
    const id = this.pkg.drawingNumber()
    const alt = stringAttr(node.attrs, 'alt') ?? ''
    return (
      '<w:r><w:drawing>' +
      `<wp:inline distT="0" distB="0" distL="0" distR="0">${el('wp:extent', { cx, cy })}` +
      el('wp:docPr', { id, name: `Picture ${id}`, descr: alt }) +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic><pic:nvPicPr>${el('pic:cNvPr', { id, name: `Picture ${id}` })}<pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill>${el('a:blip', { 'r:embed': rid })}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/>${el('a:ext', { cx, cy })}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    )
  }

  private footnoteReference(node: WriterNode): string {
    const id = stringAttr(node.attrs, 'id')
    const number = id ? this.pkg.footnoteNumber(id) : null
    if (number === null) return ''
    return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr>${el('w:footnoteReference', { 'w:id': number })}</w:r>`
  }

  private formField(node: WriterNode): string {
    const kind = stringAttr(node.attrs, 'kind') ?? 'text'
    const name = stringAttr(node.attrs, 'name') ?? ''
    const value = stringAttr(node.attrs, 'value') ?? ''
    const id = this.pkg.drawingNumber()
    if (kind === 'checkbox') {
      const checked = node.attrs?.checked === true
      return (
        `<w:sdt><w:sdtPr>${el('w:alias', { 'w:val': name })}${el('w:tag', { 'w:val': `lawha:checkbox:${name}` })}${el('w:id', { 'w:val': id })}` +
        `<w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>` +
        `<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:hAnsi="MS Gothic" w:eastAsia="MS Gothic"/></w:rPr><w:t>${checked ? '☒' : '☐'}</w:t></w:r></w:sdtContent></w:sdt>`
      )
    }
    const typeTag =
      kind === 'date' ? '<w:date><w:dateFormat w:val="yyyy-MM-dd"/></w:date>' : '<w:text/>'
    const shown = value || name
    return (
      `<w:sdt><w:sdtPr>${el('w:alias', { 'w:val': name })}${el('w:tag', { 'w:val': `lawha:${kind}:${name}` })}${el('w:id', { 'w:val': id })}` +
      `${value ? '' : '<w:showingPlcHdr/>'}${typeTag}</w:sdtPr>` +
      `<w:sdtContent><w:r>${runProperties(node)}<w:t xml:space="preserve">${escapeText(shown)}</w:t></w:r></w:sdtContent></w:sdt>`
    )
  }
}

function commentIds(node: WriterNode): string[] {
  return (node.marks ?? []).flatMap((mark) => {
    const id = mark.type === 'comment' ? mark.attrs?.commentId : null
    return typeof id === 'string' ? [id] : []
  })
}

export function paragraphDirection(node: WriterNode): 'ltr' | 'rtl' {
  const dir = stringAttr(node.attrs, 'dir')
  if (dir === 'rtl' || dir === 'ltr') return dir
  return detectDirection(nodeText(node)) ?? 'ltr'
}

/** Word swaps left and right in a right-to-left paragraph: `left` is its start, the right edge. */
export function wordJustification(align: string | null, rtl: boolean): string | null {
  switch (align) {
    case 'center':
      return 'center'
    case 'justify':
      return 'both'
    case 'left':
      return rtl ? 'right' : 'left'
    case 'right':
      return rtl ? 'left' : 'right'
    default:
      return null
  }
}

/** The package: shared parts and numbering every part writer adds to. */
class PackageWriter {
  readonly files: Record<string, Uint8Array> = {}
  readonly lists: ListDefinition[] = []
  private readonly media = new Map<string, string>()
  private readonly comments = new Map<string, number>()
  private readonly footnotes = new Map<string, number>()
  private drawings = 0
  private revisions = 0

  constructor(readonly model: WriterDocument) {
    model.comments.forEach((comment, index) => this.comments.set(comment.id, index))
    model.footnotes.forEach((note, index) => this.footnotes.set(note.id, index + 1))
  }

  addList(ordered: boolean, start: number): number {
    const numId = this.lists.length + 1
    this.lists.push({ numId, ordered, start })
    return numId
  }

  addMedia(bytes: Uint8Array, extension: string): string {
    const key = `${bytes.length}:${Array.from(bytes.subarray(0, 64)).join(',')}`
    const existing = this.media.get(key)
    if (existing) return existing
    const name = `media/image${this.media.size + 1}.${extension}`
    this.media.set(key, name)
    this.files[`word/${name}`] = bytes
    return name
  }

  commentNumber(id: string): number {
    let number = this.comments.get(id)
    if (number === undefined) {
      number = this.comments.size
      this.comments.set(id, number)
    }
    return number
  }

  footnoteNumber(id: string): number | null {
    return this.footnotes.get(id) ?? null
  }

  drawingNumber(): number {
    this.drawings += 1
    return this.drawings
  }

  revisionNumber(): number {
    this.revisions += 1
    return 1000 + this.revisions
  }

  /** The headings a table of contents lists: levels one to three. */
  tocEntries(): Array<{ level: number; text: string }> {
    return (this.model.body.content ?? []).flatMap((node) => {
      const level = numberAttr(node.attrs, 'level') ?? 1
      return node.type === 'heading' && level <= 3 ? [{ level, text: nodeText(node) }] : []
    })
  }
}

function relsXML(rels: readonly Relationship[]): string {
  return (
    XML_HEADER +
    `<Relationships xmlns="${NS.pkgRels}">` +
    rels
      .map((rel) =>
        el('Relationship', {
          Id: rel.id,
          Type: rel.type,
          Target: rel.target,
          TargetMode: rel.external ? 'External' : undefined
        })
      )
      .join('') +
    '</Relationships>'
  )
}

function textWidthOf(model: WriterDocument): number {
  return model.page.width - model.page.margins.left - model.page.margins.right
}

/** Writes a header or footer part and returns its relationship id in the model. */
function writeHeaderFooter(
  pkg: PackageWriter,
  documentPart: PartWriter,
  kind: 'header' | 'footer',
  node: WriterNode,
  watermark: string
): string {
  const part = new PartWriter(pkg)
  const tag = kind === 'header' ? 'w:hdr' : 'w:ftr'
  const body = part.blocks(node.content, textWidthOf(pkg.model)) || '<w:p/>'
  const xml = `${XML_HEADER}<${tag} ${DOCUMENT_NAMESPACES}>${watermark}${body}</${tag}>`
  const name = `${kind}1.xml`
  pkg.files[`word/${name}`] = strToU8(xml)
  if (part.rels.length) pkg.files[`word/_rels/${name}.rels`] = strToU8(relsXML(part.rels))
  return documentPart.rel(kind === 'header' ? REL.header : REL.footer, name)
}

function footnotesXML(pkg: PackageWriter): string {
  const part = new PartWriter(pkg)
  const separator =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
  const notes = pkg.model.footnotes
    .map((note, index) => {
      const ref =
        '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>'
      const first = note.content.at(0)
      const rest = note.content.slice(1)
      const firstXML = first
        ? `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/>${paragraphDirection(first) === 'rtl' ? '<w:bidi/>' : ''}</w:pPr>${ref}${part.inlines(first.content)}</w:p>`
        : `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${ref}</w:p>`
      return `<w:footnote w:id="${index + 1}">${firstXML}${part.blocks(rest, textWidthOf(pkg.model))}</w:footnote>`
    })
    .join('')
  if (part.rels.length) pkg.files['word/_rels/footnotes.xml.rels'] = strToU8(relsXML(part.rels))
  return `${XML_HEADER}<w:footnotes ${DOCUMENT_NAMESPACES}>${separator}${notes}</w:footnotes>`
}

export interface WriteDocxOptions {
  /** Encrypts nothing itself; protection is a separate step on the written bytes. */
  creator?: string
}

/** A Word `.docx` package holding the model. */
export function writeDocx(model: WriterDocument, options: WriteDocxOptions = {}): Uint8Array {
  const pkg = new PackageWriter(model)
  const part = new PartWriter(pkg)
  const { page } = model
  const body = part.blocks(model.body.content, textWidthOf(model)) || '<w:p/>'

  const references: string[] = []
  if (model.header || model.watermark) {
    const watermark = model.watermark
      ? watermarkXML(model.watermark.text, model.watermark.color)
      : ''
    const id = writeHeaderFooter(
      pkg,
      part,
      'header',
      model.header ?? { type: 'doc', content: [] },
      watermark
    )
    references.push(el('w:headerReference', { 'w:type': 'default', 'r:id': id }))
  }
  if (model.footer) {
    const id = writeHeaderFooter(pkg, part, 'footer', model.footer, '')
    references.push(el('w:footerReference', { 'w:type': 'default', 'r:id': id }))
  }
  const landscape = page.width > page.height
  const sectPr =
    `<w:sectPr>${references.join('')}` +
    el('w:pgSz', {
      'w:w': page.width,
      'w:h': page.height,
      'w:orient': landscape ? 'landscape' : undefined
    }) +
    el('w:pgMar', {
      'w:top': page.margins.top,
      'w:right': page.margins.right,
      'w:bottom': page.margins.bottom,
      'w:left': page.margins.left,
      'w:header': page.margins.header,
      'w:footer': page.margins.footer,
      'w:gutter': 0
    }) +
    '</w:sectPr>'

  pkg.files['word/document.xml'] = strToU8(
    `${XML_HEADER}<w:document ${DOCUMENT_NAMESPACES}><w:body>${body}${sectPr}</w:body></w:document>`
  )
  part.rel(REL.styles, 'styles.xml')
  part.rel(REL.settings, 'settings.xml')
  pkg.files['word/styles.xml'] = strToU8(stylesXML())
  pkg.files['word/settings.xml'] = strToU8(settingsXML(model))
  if (pkg.lists.length) {
    part.rel(REL.numbering, 'numbering.xml')
    pkg.files['word/numbering.xml'] = strToU8(numberingXML(pkg.lists))
  }
  if (model.comments.length) {
    part.rel(REL.comments, 'comments.xml')
    pkg.files['word/comments.xml'] = strToU8(
      commentsXML(pkg.model.comments, (id) => pkg.commentNumber(id))
    )
    part.rel(REL.commentsExtended, 'commentsExtended.xml')
    pkg.files['word/commentsExtended.xml'] = strToU8(
      commentsExtendedXML(pkg.model.comments, (id) => pkg.commentNumber(id))
    )
  }
  if (model.footnotes.length) {
    part.rel(REL.footnotes, 'footnotes.xml')
    pkg.files['word/footnotes.xml'] = strToU8(footnotesXML(pkg))
  }
  pkg.files['word/_rels/document.xml.rels'] = strToU8(relsXML(part.rels))
  pkg.files['docProps/core.xml'] = strToU8(
    corePropertiesXML(model.title, options.creator ?? 'Lawha')
  )
  pkg.files['_rels/.rels'] = strToU8(
    relsXML([
      { id: 'rId1', type: REL.officeDocument, target: 'word/document.xml' },
      { id: 'rId2', type: REL.coreProperties, target: 'docProps/core.xml' }
    ])
  )
  pkg.files['[Content_Types].xml'] = strToU8(contentTypesXML(Object.keys(pkg.files)))
  return zipSync(pkg.files, { level: 6 })
}
