import { blocksFromSpecs, type BlockSpec } from './edit'
import { createWriterDocument, type WriterDocument, type WriterNode } from './model'

/**
 * Starting points for common documents, in Arabic and English: a contract, an invoice, and a
 * formal letter, with fillable fields where a name, a date, or a choice goes.
 */
export const WRITER_TEMPLATE_IDS = [
  'contract-ar',
  'contract-en',
  'invoice-ar',
  'invoice-en',
  'letter-ar',
  'letter-en'
] as const

export type WriterTemplateId = (typeof WRITER_TEMPLATE_IDS)[number]

const field = (kind: 'text' | 'date' | 'checkbox', name: string): WriterNode => ({
  type: 'formField',
  attrs: { kind, name, value: '', checked: false }
})

/** A paragraph of text with fields between its parts. */
function line(dir: 'rtl' | 'ltr', ...parts: Array<string | WriterNode>): WriterNode {
  return {
    type: 'paragraph',
    attrs: { dir },
    content: parts.map((part) => (typeof part === 'string' ? { type: 'text', text: part } : part))
  }
}

const title = (text: string, dir: 'rtl' | 'ltr'): BlockSpec => ({
  type: 'heading',
  level: 1,
  text,
  dir,
  align: 'center'
})
const heading = (text: string, dir: 'rtl' | 'ltr'): BlockSpec => ({
  type: 'heading',
  level: 2,
  text,
  dir
})
const paragraph = (text: string, dir: 'rtl' | 'ltr'): BlockSpec => ({
  type: 'paragraph',
  text,
  dir
})
const numbered = (text: string, dir: 'rtl' | 'ltr'): BlockSpec => ({ type: 'numbered', text, dir })

const footer = (text: string, dir: 'rtl' | 'ltr'): WriterNode => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { dir, textAlign: 'center' },
      content: [{ type: 'text', text }, { type: 'pageNumber' }]
    }
  ]
})

function contract(dir: 'rtl' | 'ltr'): WriterDocument {
  const ar = dir === 'rtl'
  const body: WriterNode[] = [
    ...blocksFromSpecs([title(ar ? 'عقد تقديم خدمات' : 'Service Agreement', dir)]),
    line(
      dir,
      ar ? 'أُبرم هذا العقد بتاريخ ' : 'This agreement is made on ',
      field('date', ar ? 'تاريخ العقد' : 'Agreement date'),
      ar ? ' بين:' : ' between:'
    ),
    line(
      dir,
      ar ? 'الطرف الأول: ' : 'First party: ',
      field('text', ar ? 'اسم الطرف الأول' : 'First party name')
    ),
    line(
      dir,
      ar ? 'الطرف الثاني: ' : 'Second party: ',
      field('text', ar ? 'اسم الطرف الثاني' : 'Second party name')
    ),
    ...blocksFromSpecs([
      heading(ar ? 'البنود' : 'Terms', dir),
      numbered(
        ar
          ? 'يلتزم الطرف الأول بتقديم الخدمات المتفق عليها في الملحق (أ).'
          : 'The first party provides the services listed in Schedule A.',
        dir
      ),
      numbered(
        ar
          ? 'يدفع الطرف الثاني المقابل المالي خلال ثلاثين يومًا من تاريخ الفاتورة.'
          : 'The second party pays each invoice within thirty days.',
        dir
      ),
      numbered(
        ar
          ? 'مدة العقد سنة واحدة تتجدد تلقائيًا ما لم يُخطر أحد الطرفين الآخر كتابيًا.'
          : 'The term is one year and renews unless either party gives written notice.',
        dir
      ),
      numbered(
        ar
          ? 'يخضع هذا العقد لأنظمة المملكة العربية السعودية.'
          : 'This agreement is governed by the laws of the Kingdom of Saudi Arabia.',
        dir
      )
    ]),
    line(
      dir,
      field('checkbox', ar ? 'الموافقة' : 'Agreement'),
      ar ? ' أقرّ بأنني قرأت البنود ووافقت عليها.' : ' I have read and agree to these terms.'
    ),
    ...blocksFromSpecs([
      heading(ar ? 'التوقيعات' : 'Signatures', dir),
      {
        type: 'table',
        dir,
        header: true,
        rows: ar
          ? [
              ['الطرف الأول', 'الطرف الثاني'],
              ['التوقيع:', 'التوقيع:'],
              ['التاريخ:', 'التاريخ:']
            ]
          : [
              ['First party', 'Second party'],
              ['Signature:', 'Signature:'],
              ['Date:', 'Date:']
            ]
      }
    ])
  ]
  return createWriterDocument({
    title: ar ? 'عقد تقديم خدمات' : 'Service Agreement',
    body: { type: 'doc', content: body },
    footer: footer(ar ? 'صفحة ' : 'Page ', dir)
  })
}

function invoice(dir: 'rtl' | 'ltr'): WriterDocument {
  const ar = dir === 'rtl'
  const body: WriterNode[] = [
    ...blocksFromSpecs([title(ar ? 'فاتورة ضريبية' : 'Tax Invoice', dir)]),
    line(
      dir,
      ar ? 'رقم الفاتورة: ' : 'Invoice number: ',
      field('text', ar ? 'رقم الفاتورة' : 'Invoice number')
    ),
    line(
      dir,
      ar ? 'تاريخ الإصدار: ' : 'Issue date: ',
      field('date', ar ? 'تاريخ الإصدار' : 'Issue date')
    ),
    line(dir, ar ? 'العميل: ' : 'Customer: ', field('text', ar ? 'اسم العميل' : 'Customer name')),
    ...blocksFromSpecs([
      {
        type: 'table',
        dir,
        header: true,
        rows: ar
          ? [
              ['الوصف', 'الكمية', 'سعر الوحدة', 'الإجمالي'],
              ['', '', '', ''],
              ['', '', '', ''],
              ['', '', 'ضريبة القيمة المضافة 15٪', ''],
              ['', '', 'الإجمالي المستحق', '']
            ]
          : [
              ['Description', 'Quantity', 'Unit price', 'Total'],
              ['', '', '', ''],
              ['', '', '', ''],
              ['', '', 'VAT 15%', ''],
              ['', '', 'Amount due', '']
            ]
      },
      paragraph(
        ar
          ? 'يُرجى السداد خلال ثلاثين يومًا من تاريخ الإصدار.'
          : 'Payment is due within thirty days of the issue date.',
        dir
      )
    ])
  ]
  return createWriterDocument({
    title: ar ? 'فاتورة ضريبية' : 'Tax Invoice',
    body: { type: 'doc', content: body }
  })
}

function letter(dir: 'rtl' | 'ltr'): WriterDocument {
  const ar = dir === 'rtl'
  const body: WriterNode[] = [
    line(dir, ar ? 'التاريخ: ' : 'Date: ', field('date', ar ? 'التاريخ' : 'Date')),
    line(
      dir,
      ar ? 'السادة/ ' : 'To: ',
      field('text', ar ? 'اسم المرسل إليه' : 'Recipient name'),
      ar ? ' المحترمين' : ''
    ),
    ...blocksFromSpecs([
      paragraph(ar ? 'السلام عليكم ورحمة الله وبركاته،' : 'Dear Sir or Madam,', dir),
      heading(ar ? 'الموضوع: ' : 'Subject: ', dir),
      paragraph(ar ? 'نود إفادتكم بأن...' : 'We are writing to inform you that...', dir),
      paragraph(ar ? 'وتفضلوا بقبول فائق الاحترام والتقدير،' : 'Yours faithfully,', dir)
    ]),
    line(dir, field('text', ar ? 'اسم المرسل' : 'Sender name'))
  ]
  return createWriterDocument({
    title: ar ? 'خطاب رسمي' : 'Formal Letter',
    body: { type: 'doc', content: body }
  })
}

export function writerTemplate(id: WriterTemplateId): WriterDocument {
  const dir = id.endsWith('-ar') ? 'rtl' : 'ltr'
  if (id.startsWith('contract')) return contract(dir)
  if (id.startsWith('invoice')) return invoice(dir)
  return letter(dir)
}
