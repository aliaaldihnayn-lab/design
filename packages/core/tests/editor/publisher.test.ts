import { describe, expect, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import type { SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'

import { getTextMeasurer, setTextMeasurer, withTextMeasurer } from '#core/layout/text-measurement'

/** Ten pixels a character on lines as wide as the frame, twenty pixels a line. */
function measure(node: SceneNode, maxWidth?: number) {
  const perLine = Math.max(1, Math.floor((maxWidth ?? 1000) / 10))
  const lines = node.text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0)
  return { width: maxWidth ?? node.text.length * 10, height: lines * 20 }
}

function publication() {
  const editor = createEditor()
  const canvas = editor.state.currentPageId
  const page = (x: number) =>
    editor.graph.createNode('FRAME', canvas, {
      name: `Page ${x}`,
      x,
      y: 0,
      width: 300,
      height: 400
    })
  const pages = [page(0), page(400), page(800)]
  return { editor, canvas, pages }
}

const flush = () =>
  new Promise<void>((resolve) => {
    queueMicrotask(resolve)
  })

describe('master pages', () => {
  test('a master applied to pages shows behind them and its page number counts each page', async () => {
    const { editor, pages } = publication()
    editor.select([pages[0].id])
    const masterId = editor.createMasterPage()
    const master = editor.graph.getNode(masterId)
    expect(master).toMatchObject({ type: 'COMPONENT', name: 'Master A', width: 300, height: 400 })
    expect(master && master.y + master.height).toBeLessThan(0)

    editor.select([masterId])
    const numberId = editor.insertPageNumber('Page {page} of {pages}')
    expect(editor.graph.getNode(numberId ?? '')?.text).toBe('Page # of 3')

    expect(
      editor.applyMasterPage(
        masterId,
        pages.map((page) => page.id)
      )
    ).toBe(3)
    const texts = pages.map((page) => {
      const instance = editor.graph.getNode(page.childIds[0] ?? '')
      expect(instance).toMatchObject({ type: 'INSTANCE', componentId: masterId, locked: true })
      const text = [...editor.graph.getAllNodes()].find(
        (node) => node.type === 'TEXT' && node.parentId === instance?.id
      )
      return text?.text
    })
    expect(texts).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3'])

    // Moving the first page to the end renumbers the pages.
    editor.graph.updateNode(pages[0].id, { x: 1200 })
    await flush()
    const first = editor.graph.getNode(pages[0].id)
    const moved = [...editor.graph.getAllNodes()].find(
      (node) => node.type === 'TEXT' && node.parentId === first?.childIds[0]
    )
    expect(moved?.text).toBe('Page 3 of 3')
  })

  test('applying is one undo step, and a page takes one master at a time', () => {
    const { editor, pages } = publication()
    const masterId = editor.createMasterPage()
    editor.applyMasterPage(masterId, [pages[1].id])
    editor.applyMasterPage(masterId, [pages[1].id])
    expect(editor.graph.getNode(pages[1].id)?.childIds).toHaveLength(1)
    editor.undo.undo()
    editor.undo.undo()
    expect(editor.graph.getNode(pages[1].id)?.childIds).toHaveLength(0)
  })
})

describe('threaded text frames', () => {
  test('text overflowing the first frame runs on into the next and flows back', async () => {
    const { editor, canvas } = publication()
    const frame = (x: number, text: string) =>
      editor.graph.createNode('TEXT', canvas, {
        x,
        y: 600,
        width: 100,
        height: 40,
        text,
        textAutoResize: 'NONE'
      })
    // Ten characters a line, two lines a frame.
    const a = frame(0, 'aaaa bbbb cccc dddd eeee')
    const b = frame(200, '')
    const previous = getTextMeasurer()
    setTextMeasurer(measure)
    try {
      expect(editor.linkTextFrames(a.id, b.id)).toBe(a.id)
      expect(editor.graph.getNode(a.id)?.text).toBe('aaaa bbbb cccc dddd')
      expect(editor.graph.getNode(b.id)?.text).toBe('eeee')
      const thread = readPluginData(
        editor.graph.getNode(b.id)?.pluginData,
        LAWHA_PLUGIN_DATA.textThread
      )
      expect(thread).toEqual({ story: a.id, order: 1, lead: ' ' })

      // Deleting words in the first frame pulls the overflow back.
      editor.graph.updateNode(a.id, { text: 'aaaa bbbb' })
      await flush()
      expect(editor.graph.getNode(a.id)?.text).toBe('aaaa bbbb eeee')
      expect(editor.graph.getNode(b.id)?.text).toBe('')
    } finally {
      setTextMeasurer(previous)
    }
  })

  test('unlinking keeps the whole story in the frames left', () => {
    const { editor, canvas } = publication()
    const a = editor.graph.createNode('TEXT', canvas, {
      width: 100,
      height: 40,
      text: 'one two three four five six'
    })
    const b = editor.graph.createNode('TEXT', canvas, { x: 200, width: 100, height: 40, text: '' })
    withTextMeasurer(measure, () => {
      editor.linkTextFrames(a.id, b.id)
      editor.select([b.id])
      expect(editor.unlinkTextFrame()).toBe(1)
    })
    expect(editor.graph.getNode(a.id)?.text).toBe('one two three four five six')
    expect(editor.graph.getNode(b.id)?.text).toBe('')
    expect(
      readPluginData(editor.graph.getNode(a.id)?.pluginData, LAWHA_PLUGIN_DATA.textThread)
    ).toBeUndefined()
  })
})
