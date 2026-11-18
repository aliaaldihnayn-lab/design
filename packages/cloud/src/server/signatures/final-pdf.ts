import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from '@cantoo/pdf-lib'

import { drawLine, embedArabicFont, type ScriptFonts } from './text'

/**
 * The completed document: the PDF exactly as sent, followed by a signature page with each
 * signer's signature, and an audit trail with the original's SHA-256, so a reader can check the
 * signed pages are the ones that were sent.
 */

export interface FinalSigner {
  name: string
  email: string
  signedAt: Date
  ipAddress: string | null
  signaturePng: Uint8Array
}

export interface FinalEvent {
  at: Date
  kind: string
  who: string
  ipAddress: string | null
}

export interface FinalPDFInput {
  original: Uint8Array
  title: string
  envelopeId: string
  originalSHA256: string
  signers: readonly FinalSigner[]
  events: readonly FinalEvent[]
  /** A TrueType font for names in Arabic and other scripts the standard fonts lack. */
  scriptFont?: Uint8Array | null
}

const PAGE: [number, number] = [595.28, 841.89]
const MARGIN = 48
const INK = rgb(0.1, 0.14, 0.49)

class Writer {
  page: PDFPage
  y: number

  constructor(
    private readonly pdf: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
    private readonly arabic: ScriptFonts['arabic']
  ) {
    this.page = pdf.addPage(PAGE)
    this.y = PAGE[1] - MARGIN
  }

  ensure(height: number) {
    if (this.y - height >= MARGIN) return
    this.page = this.pdf.addPage(PAGE)
    this.y = PAGE[1] - MARGIN
  }

  line(
    text: string,
    options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}
  ) {
    const size = options.size ?? 10
    this.ensure(size + 6)
    drawLine(this.page, text, {
      x: MARGIN,
      y: this.y - size,
      size,
      color: options.color ?? rgb(0, 0, 0),
      fonts: { latin: options.bold ? this.bold : this.font, arabic: this.arabic }
    })
    this.y -= size + 6
  }
}

export async function finalSignedPDF(input: FinalPDFInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.original, { updateMetadata: false })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const writer = new Writer(pdf, font, bold, await embedArabicFont(pdf, input.scriptFont))
  writer.line('Signatures', { size: 18, bold: true, color: INK })
  writer.line(input.title || 'Document', { size: 12 })
  writer.y -= 8
  for (const signer of input.signers) {
    writer.ensure(110)
    const image = await pdf.embedPng(signer.signaturePng)
    const scale = Math.min(200 / image.width, 60 / image.height, 1)
    writer.page.drawImage(image, {
      x: MARGIN,
      y: writer.y - image.height * scale,
      width: image.width * scale,
      height: image.height * scale
    })
    writer.y -= image.height * scale + 6
    writer.page.drawLine({
      start: { x: MARGIN, y: writer.y },
      end: { x: MARGIN + 220, y: writer.y },
      thickness: 0.5,
      color: INK
    })
    writer.y -= 4
    writer.line(signer.name || signer.email, { bold: true })
    writer.line(
      `${signer.email} - signed ${signer.signedAt.toISOString()}${signer.ipAddress ? ` from ${signer.ipAddress}` : ''}`,
      {
        size: 8
      }
    )
    writer.y -= 10
  }
  writer.ensure(80)
  writer.line('Audit trail', { size: 14, bold: true, color: INK })
  writer.line(`Envelope ${input.envelopeId}`, { size: 8 })
  writer.line(`SHA-256 of the document as sent: ${input.originalSHA256}`, { size: 8 })
  for (const event of input.events) {
    writer.line(
      `${event.at.toISOString()}  ${event.kind.padEnd(9)}  ${event.who}${event.ipAddress ? `  ${event.ipAddress}` : ''}`,
      { size: 8 }
    )
  }
  return pdf.save()
}
