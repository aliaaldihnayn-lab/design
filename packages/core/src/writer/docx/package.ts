import { nodeText, numberAttr, type PageSetup, type WriterDocument } from '#core/writer/model'

import { el, NS, XML_HEADER } from './xml'

export interface Relationship {
  id: string
  type: string
  target: string
  external?: boolean
}

export interface ListDefinition {
  numId: number
  abstractId: number
  ordered: boolean
  start: number
}

/** How a package being patched constrains new numbers and names, so none collide. */
export interface PackageOptions {
  /** New lists number after these `w:numId` and `w:abstractNumId` values. */
  numIdBase?: number
  abstractIdBase?: number
  /** New media file names start with this, such as `lawha-image`. */
  mediaPrefix?: string
  /**
   * Comments and footnotes keep the numbers their ids (`c3`, `fn2`) came from, which the
   * package's unchanged paragraphs still refer to; new ones number after them.
   */
  keepNumbers?: boolean
  /** Part paths already in the package, which new header and footer parts must not reuse. */
  existingParts?: ReadonlySet<string>
}

const keptNumber = (id: string, prefix: string) => {
  const match = new RegExp(`^${prefix}(\\d+)$`).exec(id)
  return match ? Number(match[1]) : null
}

/** The package: shared parts and numbering every part writer adds to. */
export class PackageWriter {
  readonly files: Record<string, Uint8Array> = {}
  readonly lists: ListDefinition[] = []
  private readonly media = new Map<string, string>()
  private readonly comments = new Map<string, number>()
  private readonly footnotes = new Map<string, number>()
  private drawings = 0
  private readonly regions = { header: 0, footer: 0 }
  private revisions = 0

  constructor(
    readonly model: WriterDocument,
    readonly options: PackageOptions = {}
  ) {
    if (options.keepNumbers) {
      numberKept(model.comments, 'c', 0, this.comments)
      numberKept(model.footnotes, 'fn', 1, this.footnotes)
    } else {
      model.comments.forEach((comment, index) => this.comments.set(comment.id, index))
      model.footnotes.forEach((note, index) => this.footnotes.set(note.id, index + 1))
    }
  }

  /** A file name in `word/` for a new header or footer part. */
  regionName(kind: 'header' | 'footer'): string {
    const prefix = this.options.existingParts ? 'lawha-' : ''
    let name: string
    do name = `${prefix}${kind}${++this.regions[kind]}.xml`
    while (this.options.existingParts?.has(`word/${name}`))
    return name
  }

  addList(ordered: boolean, start: number): number {
    const numId = (this.options.numIdBase ?? 0) + this.lists.length + 1
    const abstractId = (this.options.abstractIdBase ?? -1) + this.lists.length + 1
    this.lists.push({ numId, abstractId, ordered, start })
    return numId
  }

  addMedia(bytes: Uint8Array, extension: string): string {
    const key = `${bytes.length}:${Array.from(bytes.subarray(0, 64)).join(',')}`
    const existing = this.media.get(key)
    if (existing) return existing
    const name = `media/${this.options.mediaPrefix ?? 'image'}${this.media.size + 1}.${extension}`
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

/** Ids that came from Word keep their numbers; the rest number after the highest, from `first`. */
function numberKept(
  entries: ReadonlyArray<{ id: string }>,
  prefix: string,
  first: number,
  into: Map<string, number>
): void {
  const kept = entries.map((entry) => keptNumber(entry.id, prefix))
  let next = Math.max(first - 1, ...kept.map((number) => number ?? -1)) + 1
  entries.forEach((entry, index) => {
    const number = kept[index]
    const taken = new Set(into.values())
    if (number !== null && number >= first && !taken.has(number)) {
      into.set(entry.id, number)
    } else {
      into.set(entry.id, next)
      next += 1
    }
  })
}

/** A section break's page, as the model stores it on the node. */

/** `<w:sectPr>` for a page setup, after the header and footer references given. */
export function sectionPropertiesXML(page: PageSetup, references: string): string {
  const landscape = page.width > page.height
  return (
    `<w:sectPr>${references}` +
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
  )
}

export function relsXML(rels: readonly Relationship[]): string {
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

export function textWidthOf(model: WriterDocument): number {
  return model.page.width - model.page.margins.left - model.page.margins.right
}
