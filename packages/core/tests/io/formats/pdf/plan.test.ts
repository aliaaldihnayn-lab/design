import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'

import { FigmaAPI } from '#core/figma-api'
import {
  MAX_PDF_PAGES,
  PDFPlanError,
  planPDFPages,
  publicationPDFPages
} from '#core/io/formats/pdf/plan'
import { arrangePages, createMasterPage, publicationPages } from '#core/publisher'

/** Page "Cards" (Front, Back, hidden Draft), page "Posters" (Poster), empty page "Blank". */
function document() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const cards = figma.currentPage
  cards.name = 'Cards'
  const front = figma.createFrame()
  front.name = 'Front'
  const back = figma.createFrame()
  back.name = 'Back'
  const draft = figma.createFrame()
  draft.name = 'Draft'
  draft.visible = false
  const posters = figma.createPage()
  posters.name = 'Posters'
  figma.currentPage = posters
  const poster = figma.createFrame()
  poster.name = 'Poster'
  const blank = figma.createPage()
  blank.name = 'Blank'
  figma.currentPage = cards
  return { graph, figma, cards, posters, blank, front, back, draft, poster }
}

describe('planPDFPages', () => {
  test('single puts every visible top-level node on one page, or just the ids given', () => {
    const { graph, cards, front, back } = document()
    const all = planPDFPages(graph, { mode: 'single', currentPageId: cards.id })
    expect(all).toEqual([{ pageId: cards.id, nodeIds: [front.id, back.id] }])

    const some = planPDFPages(graph, { mode: 'single', ids: [back.id], currentPageId: cards.id })
    expect(some).toEqual([{ pageId: cards.id, nodeIds: [back.id] }])
  })

  test('frames makes one page per frame, named after it', () => {
    const { graph, cards, front, back } = document()
    const specs = planPDFPages(graph, { mode: 'frames', currentPageId: cards.id })
    expect(specs.map((spec) => [spec.label, spec.nodeIds])).toEqual([
      ['Front', [front.id]],
      ['Back', [back.id]]
    ])
  })

  test('frames follows the order of the ids and finds the design page of each', () => {
    const { graph, cards, posters, front, poster } = document()
    const specs = planPDFPages(graph, {
      mode: 'frames',
      ids: [poster.id, front.id],
      currentPageId: cards.id
    })
    expect(specs.map((spec) => spec.pageId)).toEqual([posters.id, cards.id])
  })

  test('frames finds the design page of a nested node', () => {
    const { graph, figma, cards, front } = document()
    const inner = figma.createFrame()
    inner.name = 'Inner'
    front.appendChild(inner)
    const [spec] = planPDFPages(graph, { mode: 'frames', ids: [inner.id], currentPageId: cards.id })
    expect(spec).toEqual({ pageId: cards.id, nodeIds: [inner.id], label: 'Inner' })
  })

  test('pages makes one page per design page and skips empty ones', () => {
    const { graph, cards, front, back, poster } = document()
    const specs = planPDFPages(graph, { mode: 'pages', currentPageId: cards.id })
    expect(specs.map((spec) => [spec.label, spec.nodeIds])).toEqual([
      ['Cards', [front.id, back.id]],
      ['Posters', [poster.id]]
    ])
  })

  test('pages follows page_ids in the order given', () => {
    const { graph, cards, posters } = document()
    const specs = planPDFPages(graph, {
      mode: 'pages',
      pageIds: [posters.id, cards.id],
      currentPageId: cards.id
    })
    expect(specs.map((spec) => spec.label)).toEqual(['Posters', 'Cards'])
  })

  test('names a missing node or page', () => {
    const { graph, cards } = document()
    expect(() =>
      planPDFPages(graph, { mode: 'frames', ids: ['9:9'], currentPageId: cards.id })
    ).toThrow('Node "9:9" not found')
    expect(() =>
      planPDFPages(graph, { mode: 'pages', pageIds: ['9:9'], currentPageId: cards.id })
    ).toThrow('Page "9:9" not found')
  })

  test('rejects a request that exports nothing', () => {
    const { graph, blank, cards } = document()
    expect(() =>
      planPDFPages(graph, { mode: 'pages', pageIds: [blank.id], currentPageId: cards.id })
    ).toThrow(PDFPlanError)
    expect(() => planPDFPages(graph, { mode: 'single', currentPageId: blank.id })).toThrow(
      'No visible nodes to export'
    )
  })

  test('rejects more pages than a PDF may hold', () => {
    const { graph, figma, cards } = document()
    for (let i = 0; i < MAX_PDF_PAGES; i++) figma.createFrame()
    expect(() => planPDFPages(graph, { mode: 'frames', currentPageId: cards.id })).toThrow(
      /limit is 200/
    )
  })
})

describe('publication PDF pages', () => {
  /** Three pages reordered to read Three, Two, One against their layer order, and a master. */
  function publication() {
    const graph = new SceneGraph()
    const canvas = graph.getPages()[0].id
    const pages = ['One', 'Two', 'Three'].map((name) =>
      graph.createNode('FRAME', canvas, { name, width: 300, height: 400 })
    )
    arrangePages(graph, pages.toReversed(), { spreads: false, direction: 'ltr' }, { x: 0, y: 0 })
    const master = createMasterPage(graph, canvas, { width: 300, height: 400 })
    return { graph, canvas, pages, master }
  }

  test('a publication exports its pages in reading order, without its masters', () => {
    const { graph, canvas, master } = publication()
    const order = publicationPages(graph, canvas).map((page) => page.name)
    expect(order).toEqual(['Three', 'Two', 'One'])
    const everything = graph.getNode(canvas)?.childIds ?? []
    const specs = publicationPDFPages(graph, canvas, everything)
    expect(specs?.map((spec) => spec.label)).toEqual(order)
    expect(specs?.flatMap((spec) => spec.nodeIds)).not.toContain(master.id)
    expect(
      planPDFPages(graph, { mode: 'frames', currentPageId: canvas }).map((spec) => spec.label)
    ).toEqual(order)
  })

  test('pages chosen in any order still export in reading order', () => {
    const { graph, canvas, pages } = publication()
    const specs = publicationPDFPages(graph, canvas, [pages[0].id, pages[2].id])
    expect(specs?.map((spec) => spec.label)).toEqual(['Three', 'One'])
  })

  test('other layers and canvases that are not publications keep their export', () => {
    const { graph, canvas, pages } = publication()
    const note = graph.createNode('TEXT', canvas, { text: 'Note' })
    expect(publicationPDFPages(graph, canvas, [pages[0].id, note.id])).toBeNull()
    const { graph: plain, cards, front, back } = document()
    expect(publicationPDFPages(plain, cards.id, [back.id, front.id])).toBeNull()
  })
})
