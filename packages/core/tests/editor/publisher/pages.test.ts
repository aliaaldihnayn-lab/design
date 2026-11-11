import { describe, expect, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import type { SceneNode } from '@lawha/scene-graph'

import { publicationPages } from '#core/publisher'

function publication(count = 3) {
  const editor = createEditor()
  const canvas = editor.state.currentPageId
  const pages = Array.from({ length: count }, (_, index) =>
    editor.graph.createNode('FRAME', canvas, {
      name: `Page ${index + 1}`,
      x: index * 400,
      y: 0,
      width: 300,
      height: 400
    })
  )
  const order = () => publicationPages(editor.graph, canvas).map((page) => page.name)
  const node = (page: SceneNode) => editor.graph.getNode(page.id)
  return { editor, canvas, pages, order, node }
}

describe('the Pages panel', () => {
  test('lists the pages in reading order with their numbers and masters', () => {
    const { editor, pages } = publication()
    const masterId = editor.createMasterPage()
    editor.applyMasterPage(masterId, [pages[1].id])
    expect(editor.publicationPageList()).toMatchObject([
      { id: pages[0].id, number: '1', masterId: null, side: 'single' },
      { id: pages[1].id, number: '2', masterId, masterName: 'Master A' },
      { id: pages[2].id, number: '3', masterId: null }
    ])
  })

  test('moving a page reorders the pages by laying them out again, as one undo step', () => {
    const { editor, pages, order } = publication()
    expect(editor.movePublicationPage(pages[2].id, 0)).toBe(true)
    expect(order()).toEqual(['Page 3', 'Page 1', 'Page 2'])
    expect(editor.graph.getNode(pages[2].id)?.x).toBe(0)
    editor.undo.undo()
    expect(order()).toEqual(['Page 1', 'Page 2', 'Page 3'])
  })

  test('adds a page after another, with its size and master', () => {
    const { editor, pages, order } = publication(2)
    const masterId = editor.createMasterPage()
    editor.applyMasterPage(masterId, [pages[0].id])
    const added = editor.addPublicationPage(pages[0].id, 'New')
    expect(order()).toEqual(['Page 1', 'New', 'Page 2'])
    expect(editor.graph.getNode(added)).toMatchObject({ width: 300, height: 400 })
    expect(editor.publicationPageList()[1]).toMatchObject({ masterId })
  })

  test('duplicates a page right after it and deletes a page, closing the gap', () => {
    const { editor, pages, order } = publication(2)
    editor.graph.createNode('RECTANGLE', pages[0].id, { width: 10, height: 10 })
    const copy = editor.duplicatePublicationPage(pages[0].id)
    expect(order()).toEqual(['Page 1', 'Page 1', 'Page 2'])
    expect(editor.graph.getNode(copy ?? '')?.childIds).toHaveLength(1)
    expect(editor.deletePublicationPage(pages[0].id)).toBe(true)
    expect(order()).toEqual(['Page 1', 'Page 2'])
    expect(editor.publicationPageList()[0].id).toBe(copy ?? '')
    expect(editor.graph.getNode(copy ?? '')?.x).toBe(0)
  })

  test('the last page cannot be deleted', () => {
    const { editor, pages } = publication(1)
    expect(editor.deletePublicationPage(pages[0].id)).toBe(false)
  })

  test('applies and takes off a master from the panel', () => {
    const { editor, pages } = publication(1)
    const masterId = editor.createMasterPage()
    expect(editor.setPublicationPageMaster(pages[0].id, masterId)).toBe(true)
    expect(editor.publicationPageList()[0].masterId).toBe(masterId)
    expect(editor.setPublicationPageMaster(pages[0].id, null)).toBe(true)
    expect(editor.publicationPageList()[0].masterId).toBeNull()
  })
})

describe('page numbering', () => {
  test('starts where it is told and writes Arabic-Indic or Roman digits', async () => {
    const { editor, pages } = publication(12)
    const masterId = editor.createMasterPage()
    editor.select([masterId])
    editor.insertPageNumber('{page} / {pages}')
    editor.applyMasterPage(
      masterId,
      pages.map((page) => page.id)
    )
    editor.setPublicationSettings({ numberStart: 5, numberFormat: 'arabic-indic' })
    expect(
      editor
        .publicationPageList()
        .map((page) => page.number)
        .slice(0, 3)
    ).toEqual(['٥', '٦', '٧'])
    const numberOn = (page: SceneNode) => {
      const instance = editor.graph.getNode(editor.graph.getNode(page.id)?.childIds[0] ?? '')
      return [...editor.graph.getAllNodes()].find(
        (node) => node.type === 'TEXT' && node.parentId === instance?.id
      )?.text
    }
    expect(numberOn(pages[0])).toBe('٥ / ١٢')
    expect(numberOn(pages[11])).toBe('١٦ / ١٢')
    editor.setPublicationSettings({ numberStart: 1, numberFormat: 'roman-upper' })
    expect(numberOn(pages[3])).toBe('IV / XII')
  })
})

describe('right-to-left books and spreads', () => {
  test('right to left, pages read from the right and the first page keeps its place', () => {
    const { editor, pages, order, node } = publication()
    editor.setPublicationSettings({ direction: 'rtl' })
    expect(order()).toEqual(['Page 1', 'Page 2', 'Page 3'])
    // Page 1 stays where it was; the others now run to its left.
    expect(node(pages[0])?.x).toBe(0)
    expect(node(pages[1])?.x).toBe(-400)
    expect(node(pages[2])?.x).toBe(-800)
  })

  test('spreads pair the pages after the first, which opens on its own', () => {
    const { editor, pages, node } = publication(5)
    editor.setPublicationSettings({ spreads: true })
    expect(editor.publicationPageList().map(({ spread, side }) => [spread, side])).toEqual([
      [0, 'right'],
      [1, 'left'],
      [1, 'right'],
      [2, 'left'],
      [2, 'right']
    ])
    // Facing pages meet at the spine; spreads stack in rows.
    expect(node(pages[1])?.x).toBe(-300)
    expect(node(pages[2])?.x).toBe(0)
    expect(node(pages[1])?.y).toBe(node(pages[2])?.y)
    expect(node(pages[3])?.y).toBeGreaterThan(node(pages[1])?.y ?? 0)
  })

  test('an Arabic book opens the other way: page 2 on the right of its spread', () => {
    const { editor, pages, order, node } = publication(3)
    editor.setPublicationSettings({ direction: 'rtl', spreads: true })
    expect(editor.publicationPageList().map(({ side }) => side)).toEqual(['left', 'right', 'left'])
    expect(order()).toEqual(['Page 1', 'Page 2', 'Page 3'])
    const spine = (node(pages[0])?.x ?? 0) + 300
    expect(node(pages[1])?.x).toBe(spine)
    expect(node(pages[2])?.x).toBe(spine - 300)
  })
})

describe('master pages from frames', () => {
  test('a page frame converts into a master that can be applied, and detaching keeps its layers', () => {
    const { editor, pages, order } = publication(3)
    editor.graph.createNode('RECTANGLE', pages[2].id, { name: 'Header', width: 300, height: 40 })
    const masterId = editor.convertToMasterPage(pages[2].id)
    expect(masterId).toBe(pages[2].id)
    expect(editor.listMasterPages()).toEqual([{ id: pages[2].id, name: 'Page 3' }])
    expect(order()).toEqual(['Page 1', 'Page 2'])

    editor.applyMasterPage(masterId ?? '', [pages[0].id])
    expect(editor.detachFromMasterPage([pages[0].id])).toBe(1)
    const page = editor.graph.getNode(pages[0].id)
    const detached = editor.graph.getNode(page?.childIds[0] ?? '')
    expect(detached).toMatchObject({ type: 'FRAME', locked: false })
    expect(editor.graph.getNode(detached?.childIds[0] ?? '')?.name).toBe('Header')
    expect(editor.publicationPageList()[0].masterId).toBeNull()
    editor.undo.undo()
    expect(editor.publicationPageList()[0].masterId).toBe(masterId)
  })
})
