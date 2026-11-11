import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'

type ToolResult = { [key: string]: unknown }

function isToolResult(value: unknown): value is ToolResult {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tool(name: string) {
  const found = ALL_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`${name} missing`)
  return (figma: FigmaAPI, args: Record<string, unknown>): ToolResult => {
    const result: unknown = found.execute(figma, args)
    if (!isToolResult(result)) throw new Error('No result')
    return result
  }
}

describe('publisher tools for agents', () => {
  test('a master with a page number numbers the pages it is applied to', () => {
    const graph = new SceneGraph()
    const canvas = graph.getPages()[0].id
    const pages = [0, 400].map((x) =>
      graph.createNode('FRAME', canvas, { x, y: 0, width: 300, height: 400 })
    )
    const figma = new FigmaAPI(graph)
    const master = tool('create_master_page')(figma, { page_id: pages[0].id })
    expect(master.name).toBe('Master A')
    const number = graph.createNode('TEXT', String(master.id), { width: 60, height: 20, text: '' })
    expect(
      tool('set_page_number')(figma, { id: number.id, template: '{page}/{pages}' })
    ).toMatchObject({ text: '#/2' })
    expect(
      tool('apply_master_page')(figma, { master_id: master.id, page_ids: pages.map((p) => p.id) })
    ).toEqual({ pages: pages.map((p) => p.id) })
    const shown = pages.map((page) => {
      const instance = graph.getNode(graph.getNode(page.id)?.childIds[0] ?? '')
      return graph.getNode(instance?.childIds[0] ?? '')?.text
    })
    expect(shown).toEqual(['1/2', '2/2'])
    tool('apply_master_page')(figma, { page_ids: [pages[1].id], remove: true })
    expect(graph.getNode(pages[1].id)?.childIds).toHaveLength(0)
  })

  test('link_text_frames threads frames and refuses other layers', () => {
    const graph = new SceneGraph()
    const canvas = graph.getPages()[0].id
    const a = graph.createNode('TEXT', canvas, {
      width: 60,
      height: 20,
      text: 'a b c d e f g h i j'
    })
    const b = graph.createNode('TEXT', canvas, { x: 100, width: 60, height: 400, text: '' })
    const rect = graph.createNode('RECTANGLE', canvas, { width: 10, height: 10 })
    const figma = new FigmaAPI(graph)
    expect(tool('link_text_frames')(figma, { ids: [a.id, rect.id] })).toHaveProperty('error')
    const result = tool('link_text_frames')(figma, { ids: [a.id, b.id] })
    expect(result.story).toBe(a.id)
    const first = graph.getNode(a.id)?.text ?? ''
    const second = graph.getNode(b.id)?.text ?? ''
    expect(first.length).toBeGreaterThan(0)
    expect(second.length).toBeGreaterThan(0)
    expect(`${first} ${second}`).toBe('a b c d e f g h i j')
    expect(tool('link_text_frames')(figma, { ids: [b.id], unlink: true })).toEqual({ unlinked: 1 })
    expect(graph.getNode(a.id)?.text).toBe('a b c d e f g h i j')
  })
})

describe('publication layout tools', () => {
  test('number pages in Arabic-Indic digits, right to left, in a new order', () => {
    const graph = new SceneGraph()
    const canvas = graph.getPages()[0].id
    const pages = [0, 400, 800].map((x, i) =>
      graph.createNode('FRAME', canvas, { name: `P${i + 1}`, x, y: 0, width: 300, height: 400 })
    )
    const figma = new FigmaAPI(graph)
    const result = tool('set_publication_layout')(figma, {
      number_start: 3,
      number_format: 'arabic-indic',
      direction: 'rtl',
      page_order: [pages[2].id, pages[0].id]
    })
    expect(result.pages).toEqual([
      { id: pages[2].id, name: 'P3', number: '٣' },
      { id: pages[0].id, name: 'P1', number: '٤' },
      { id: pages[1].id, name: 'P2', number: '٥' }
    ])
    // Right to left: the first page is furthest right.
    const x = (id: string) => graph.getNode(id)?.x ?? 0
    expect(x(pages[2].id)).toBeGreaterThan(x(pages[0].id))
    expect(x(pages[0].id)).toBeGreaterThan(x(pages[1].id))
  })
})
