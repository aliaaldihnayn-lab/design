import { afterEach, describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import { FigmaAPI } from '@lawha/core/figma-api'
import { ALL_TOOLS, isToolExposed, setWriterHost } from '@lawha/core/tools'
import { createWriterDocument, nodeText, PAGE_SIZES, type WriterDocument } from '@lawha/core/writer'
import { SceneGraph } from '@lawha/scene-graph'

const figma = new FigmaAPI(new SceneGraph())

function tool(name: string) {
  const found = ALL_TOOLS.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`No tool ${name}`)
  return (args: Record<string, unknown>) => found.execute(figma, args)
}

/** The document editor as the tools see it, holding one document. */
function openDocument(initial = createWriterDocument()) {
  const state = { document: initial, writes: 0 }
  const unregister = setWriterHost({
    read: () => state.document,
    write: (next: WriterDocument) => {
      state.document = next
      state.writes += 1
    }
  })
  return { state, unregister }
}

let cleanup: (() => void) | null = null
afterEach(() => cleanup?.())

describe('document tools', () => {
  test('are exposed to AI, MCP and WebMCP', () => {
    for (const name of ['read_document', 'write_document', 'edit_document']) {
      const found = ALL_TOOLS.find((candidate) => candidate.name === name)
      expect(found && isToolExposed(found, 'ai') && isToolExposed(found, 'mcp')).toBe(true)
    }
  })

  test('say when no document is open', () => {
    cleanup = setWriterHost(null)
    expect(() => tool('read_document')({})).toThrow('No document is open')
  })

  test('write a document with Arabic headings, lists, a table, header and footer', () => {
    const { state, unregister } = openDocument()
    cleanup = unregister
    tool('write_document')({
      title: 'عقد',
      blocks: [
        { type: 'heading', text: 'عقد عمل', level: 1, align: 'center' },
        { type: 'paragraph', text: 'يتفق الطرفان على ما يلي:' },
        { type: 'numbered', text: 'مدة العقد سنة' },
        { type: 'numbered', text: 'الراتب شهري' },
        {
          type: 'table',
          rows: [
            ['البند', 'القيمة'],
            ['الراتب', '5000']
          ],
          header: true
        }
      ],
      footer: 'صفحة {page} من {pages}',
      page: { size: 'a4', orientation: 'portrait', marginsMM: { top: 30 } }
    })
    const [heading, paragraph, list, table] = state.document.body.content ?? []
    expect(heading).toMatchObject({
      type: 'heading',
      attrs: { level: 1, dir: 'rtl', textAlign: 'center' }
    })
    expect(paragraph.attrs?.dir).toBe('rtl')
    expect(list.type).toBe('orderedList')
    expect(list.content).toHaveLength(2)
    expect(table.content?.[0].content?.[0].type).toBe('tableHeader')
    expect(state.document.footer?.content?.[0].content?.map((node) => node.type)).toEqual([
      'text',
      'pageNumber',
      'text',
      'pageCount'
    ])
    expect(state.document.page.width).toBe(PAGE_SIZES.a4.width)
    expect(state.document.page.margins.top).toBe(1701)
  })

  test('read and edit by block index, replace text, comment on a phrase', () => {
    const { state, unregister } = openDocument()
    cleanup = unregister
    tool('write_document')({
      blocks: [
        { type: 'paragraph', text: 'الطرف الأول' },
        { type: 'paragraph', text: 'Second paragraph' }
      ]
    })
    const outline = v.parse(
      v.object({ blocks: v.array(v.object({ index: v.number(), text: v.string() })) }),
      tool('read_document')({})
    )
    expect(outline.blocks.map((block) => block.text)).toEqual(['الطرف الأول', 'Second paragraph'])
    const result = tool('edit_document')({
      operations: [
        { op: 'insert', at: 1, blocks: [{ type: 'heading', text: 'البنود', level: 2 }] },
        { op: 'replace_text', find: 'الأول', replace: 'الثاني' },
        { op: 'comment', at: 0, quote: 'الثاني', text: 'تأكد من الاسم' },
        { op: 'delete', at: 2 },
        { op: 'page', orientation: 'landscape' },
        { op: 'track_changes', enabled: true }
      ]
    })
    expect(result).toEqual({ blocks: 2, notes: ['replace_text: replaced 1'] })
    expect((state.document.body.content ?? []).map(nodeText)).toEqual(['الطرف الثاني', 'البنود'])
    const commented = state.document.body.content?.[0].content?.find(
      (node) => node.text === 'الثاني'
    )
    expect(commented?.marks?.[0]).toMatchObject({ type: 'comment' })
    expect(state.document.comments[0]).toMatchObject({ author: 'AI', text: 'تأكد من الاسم' })
    expect(state.document.page.width > state.document.page.height).toBe(true)
    expect(state.document.trackChanges).toBe(true)
  })

  test('reject an index outside the document without changing it', () => {
    const { state, unregister } = openDocument()
    cleanup = unregister
    const before = state.document
    expect(() => tool('edit_document')({ operations: [{ op: 'delete', at: 5 }] })).toThrow(
      'does not exist'
    )
    expect(state.document).toBe(before)
  })
})
