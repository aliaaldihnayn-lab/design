import * as v from 'valibot'

import { randomHex } from '@lawha/scene-graph/random'

import { defineTool } from '#core/tools/schema'
import {
  blocksFromSpecs,
  commentOnQuote,
  deleteBlocks,
  insertBlocks,
  outlineOf,
  replaceBlock,
  replaceText
} from '#core/writer/edit'
import {
  detectDirection,
  mmToTwips,
  PAGE_SIZES,
  type PageSetup,
  type WriterDocument,
  type WriterNode
} from '#core/writer/model'

import { requireWriterHost } from './host'
import {
  blockIndexInputSchema,
  blockSpecInputSchema,
  blockSpecsInputSchema,
  pageInputSchema
} from './schema'

/** A header or footer from text, where `{page}` and `{pages}` become page fields. */
export function regionFromText(text: string | null): WriterNode | null {
  if (!text?.trim()) return null
  const content = text.split(/(\{page\}|\{pages\})/).flatMap((part): WriterNode[] => {
    if (part === '{page}') return [{ type: 'pageNumber' }]
    if (part === '{pages}') return [{ type: 'pageCount' }]
    return part ? [{ type: 'text', text: part }] : []
  })
  const dir = detectDirection(text) ?? 'auto'
  return {
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { dir, textAlign: 'center' }, content }]
  }
}

function applyPage(page: PageSetup, input: v.InferOutput<typeof pageInputSchema>): PageSetup {
  let { width, height } = input.size ? PAGE_SIZES[input.size] : page
  const landscape = input.orientation ? input.orientation === 'landscape' : page.width > page.height
  if (landscape !== width > height) [width, height] = [height, width]
  const margins = { ...page.margins }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const mm = input.marginsMM?.[side]
    if (mm !== undefined) margins[side] = mmToTwips(mm)
  }
  return { width, height, margins }
}

export const readDocument = defineTool({
  name: 'read_document',
  description:
    'Read the document open in the document editor (Documents): title, page setup, header, footer, comments, word count, and its numbered top-level blocks (paragraphs, headings with level, lists with their items, tables, page breaks) with direction and alignment. Block indexes are what edit_document takes.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({}),
  execute: () => outlineOf(requireWriterHost().read())
})

export const writeDocument = defineTool({
  name: 'write_document',
  description:
    'Replace the whole document in the document editor with new content: headings, paragraphs, bulleted and numbered items, tables, and page breaks. Arabic text gets right-to-left paragraphs automatically. Header and footer take text where {page} and {pages} become page numbers. The person saves it to Word or Google Docs.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    title: v.optional(v.string()),
    blocks: blockSpecsInputSchema,
    header: v.optional(v.nullable(v.string())),
    footer: v.optional(v.nullable(v.string())),
    page: v.optional(pageInputSchema)
  }),
  execute: (_figma, args) => {
    const host = requireWriterHost()
    const current = host.read()
    const next: WriterDocument = {
      ...current,
      title: args.title ?? current.title,
      body: { type: 'doc', content: blocksFromSpecs(args.blocks) },
      header: args.header === undefined ? current.header : regionFromText(args.header),
      footer: args.footer === undefined ? current.footer : regionFromText(args.footer),
      page: args.page ? applyPage(current.page, args.page) : current.page
    }
    host.write(next)
    return { blocks: next.body.content?.length ?? 0 }
  }
})

const operationSchema = v.variant('op', [
  v.strictObject({
    op: v.literal('insert'),
    at: v.pipe(
      blockIndexInputSchema,
      v.description('Insert before this block; the block count appends')
    ),
    blocks: blockSpecsInputSchema
  }),
  v.strictObject({
    op: v.literal('delete'),
    at: blockIndexInputSchema,
    count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)))
  }),
  v.strictObject({
    op: v.literal('replace_block'),
    at: blockIndexInputSchema,
    block: blockSpecInputSchema
  }),
  v.strictObject({
    op: v.literal('replace_text'),
    find: v.pipe(v.string(), v.minLength(1)),
    replace: v.string(),
    matchCase: v.optional(v.boolean())
  }),
  v.strictObject({
    op: v.literal('comment'),
    at: blockIndexInputSchema,
    quote: v.pipe(
      v.string(),
      v.minLength(1),
      v.description('Exact text in the block to comment on')
    ),
    text: v.pipe(v.string(), v.minLength(1)),
    author: v.optional(v.string())
  }),
  v.strictObject({ op: v.literal('page'), ...pageInputSchema.entries }),
  v.strictObject({
    op: v.picklist(['header', 'footer']),
    text: v.pipe(
      v.nullable(v.string()),
      v.description('Text with {page} and {pages}; null removes it')
    )
  }),
  v.strictObject({ op: v.literal('track_changes'), enabled: v.boolean() })
])

type Operation = v.InferOutput<typeof operationSchema>

function applyOperation(
  model: WriterDocument,
  operation: Operation
): { model: WriterDocument; note?: string } {
  switch (operation.op) {
    case 'insert':
      return { model: insertBlocks(model, operation.at, blocksFromSpecs(operation.blocks)) }
    case 'delete':
      return { model: deleteBlocks(model, operation.at, operation.count) }
    case 'replace_block': {
      const [block] = blocksFromSpecs([operation.block])
      return { model: replaceBlock(model, operation.at, block) }
    }
    case 'replace_text': {
      const result = replaceText(model, operation.find, operation.replace, operation.matchCase)
      return { model: result.model, note: `replaced ${result.count}` }
    }
    case 'comment': {
      const id = `c-${randomHex(6)}`
      const commented = commentOnQuote(model, operation.at, operation.quote, id)
      const author = operation.author ?? 'AI'
      const comment = { id, author, date: new Date().toISOString(), text: operation.text }
      return { model: { ...commented, comments: [...commented.comments, comment] } }
    }
    case 'page':
      return { model: { ...model, page: applyPage(model.page, operation) } }
    case 'header':
    case 'footer':
      return { model: { ...model, [operation.op]: regionFromText(operation.text) } }
    default:
      return { model: { ...model, trackChanges: operation.enabled } }
  }
}

export const editDocument = defineTool({
  name: 'edit_document',
  description:
    'Edit the document open in the document editor with a list of operations applied in order: insert blocks before a block index, delete blocks, replace a block, replace text everywhere, comment on a quoted phrase in a block, change page size, orientation and margins (mm), set or remove the header or footer ({page}, {pages}), and turn track changes on or off. Read the document first for block indexes; indexes refer to the document as each operation finds it.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({ operations: v.pipe(v.array(operationSchema), v.minLength(1)) }),
  execute: (_figma, args) => {
    const host = requireWriterHost()
    let model = host.read()
    const notes: string[] = []
    for (const operation of args.operations) {
      const result = applyOperation(model, operation)
      model = result.model
      if (result.note) notes.push(`${operation.op}: ${result.note}`)
    }
    host.write(model)
    return { blocks: model.body.content?.length ?? 0, notes }
  }
})
