import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFAcroForm,
  type PDFRef
} from '@cantoo/pdf-lib'

/**
 * Signature fields: the boxes on a PDF's pages that a signature goes into. A sender places one
 * per signer, on any page, before anyone signs; each signer then signs into theirs, and every
 * earlier signature stays valid because each signing is an incremental update.
 */

/** A signature field: where its box is, and whether it has been signed. */
export interface SignatureField {
  name: string
  /** Zero-based page index. */
  page: number
  /** x, y, width, height in PDF points from the page's bottom-left corner. */
  rect: [number, number, number, number]
  signed: boolean
}

/** A field to place: on a page, in a rectangle, under a name unique in the file. */
export interface SignatureFieldPlacement {
  name: string
  page: number
  rect: [number, number, number, number]
}

interface FoundField {
  field: SignatureField
  widget: PDFDict
}

function text(value: unknown): string | null {
  if (value instanceof PDFHexString || value instanceof PDFString) return value.decodeText()
  return null
}

function rectOf(widget: PDFDict): [number, number, number, number] {
  const rect = widget.lookupMaybe(PDFName.of('Rect'), PDFArray)
  const numbers = rect
    ? rect.asArray().map((entry) => (entry instanceof PDFNumber ? entry.asNumber() : 0))
    : [0, 0, 0, 0]
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = numbers
  return [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]
}

/** Every signature field's widget, with its page. */
function signatureWidgets(target: PDFDocument): FoundField[] {
  const pages = target.getPages()
  const found: FoundField[] = []
  pages.forEach((page, index) => {
    const annots = page.node.Annots()
    for (const entry of annots?.asArray() ?? []) {
      const widget = target.context.lookupMaybe(entry, PDFDict)
      if (!widget) continue
      const parent = widget.lookupMaybe(PDFName.of('Parent'), PDFDict)
      const type = widget.get(PDFName.of('FT')) ?? parent?.get(PDFName.of('FT'))
      if (!(type instanceof PDFName) || type.asString() !== '/Sig') continue
      const name = text(widget.get(PDFName.of('T'))) ?? text(parent?.get(PDFName.of('T'))) ?? ''
      const value = widget.get(PDFName.of('V')) ?? parent?.get(PDFName.of('V'))
      found.push({
        field: { name, page: index, rect: rectOf(widget), signed: value !== undefined },
        widget
      })
    }
  })
  return found
}

/** The snapshot an incremental update records changed objects in. */
export function snapshotOf(target: PDFDocument) {
  const snapshot = target.context.snapshot
  if (!snapshot) throw new Error('The PDF was not opened for an incremental update')
  return snapshot
}

export function findField(target: PDFDocument, name: string): FoundField | null {
  return signatureWidgets(target).find((entry) => entry.field.name === name) ?? null
}

/** The document's AcroForm, marked as changed by the update being written. */
export function markAcroForm(target: PDFDocument): PDFAcroForm {
  const acroForm = target.catalog.getOrCreateAcroForm()
  acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3))
  snapshotOf(target).markObjForSave(acroForm.dict)
  snapshotOf(target).markObjForSave(target.catalog)
  return acroForm
}

export function uniqueFieldName(target: PDFDocument, base = 'Signature'): string {
  const taken = new Set(signatureWidgets(target).map((entry) => entry.field.name))
  let number = taken.size + 1
  while (taken.has(`${base}${number}`)) number += 1
  return `${base}${number}`
}

/** The PDF's signature fields, in page order. */
export async function signatureFields(pdf: Uint8Array): Promise<SignatureField[]> {
  const loaded = await PDFDocument.load(pdf, { updateMetadata: false })
  return signatureWidgets(loaded).map((entry) => entry.field)
}

/**
 * Adds empty signature fields, each on its own page and rectangle, as an incremental update;
 * a name already in the file is refused, so each signer's field stays theirs.
 */
export async function addSignatureFields(
  pdf: Uint8Array,
  placements: readonly SignatureFieldPlacement[]
): Promise<Uint8Array> {
  const loaded = await PDFDocument.load(pdf, { updateMetadata: false, forIncrementalUpdate: true })
  const pages = loaded.getPages()
  const taken = new Set(signatureWidgets(loaded).map((entry) => entry.field.name))
  const acroForm = markAcroForm(loaded)
  for (const placement of placements) {
    if (taken.has(placement.name)) throw new Error(`A field named ${placement.name} exists`)
    const page = pages.at(placement.page)
    if (!page) throw new Error(`The PDF has no page ${placement.page + 1}`)
    taken.add(placement.name)
    const [x, y, width, height] = placement.rect
    const widget = loaded.context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      Rect: [x, y, x + width, y + height],
      T: PDFHexString.fromText(placement.name),
      F: 4,
      P: page.ref
    })
    const ref: PDFRef = loaded.context.register(widget)
    page.node.addAnnot(ref)
    snapshotOf(loaded).markRefForSave(page.ref)
    acroForm.addField(ref)
  }
  return loaded.commit({ useObjectStreams: false })
}
