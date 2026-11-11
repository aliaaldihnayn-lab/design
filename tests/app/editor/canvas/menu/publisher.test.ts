import { describe, expect, test } from 'bun:test'

import { createEditor } from '@lawha/core'

import { publisherMenuEntries } from '@/app/editor/canvas/menu/publisher'

function testIds(editor: ReturnType<typeof createEditor>) {
  return publisherMenuEntries(editor).flatMap((entry) =>
    'testId' in entry && entry.testId ? [entry.testId] : []
  )
}

describe('publisher canvas menu', () => {
  test('a frame converts into a master page, and a page with a master detaches from it', () => {
    const editor = createEditor()
    const canvas = editor.state.currentPageId
    const page = editor.graph.createNode('FRAME', canvas, { width: 300, height: 400 })
    const frame = editor.graph.createNode('FRAME', canvas, { x: 400, width: 300, height: 400 })
    editor.select([frame.id])
    const convert = publisherMenuEntries(editor).find(
      (entry) => 'testId' in entry && entry.testId === 'context-convert-to-master-page'
    )
    if (!convert || !('action' in convert)) throw new Error('No convert entry')
    convert.action?.()
    expect(editor.graph.getNode(frame.id)?.type).toBe('COMPONENT')

    editor.applyMasterPage(frame.id, [page.id])
    editor.select([page.id])
    expect(testIds(editor)).toContain('context-detach-from-master')
    const detach = publisherMenuEntries(editor).find(
      (entry) => 'testId' in entry && entry.testId === 'context-detach-from-master'
    )
    if (!detach || !('action' in detach)) throw new Error('No detach entry')
    detach.action?.()
    const child = editor.graph.getNode(editor.graph.getNode(page.id)?.childIds[0] ?? '')
    expect(child?.type).toBe('FRAME')
    expect(testIds(editor)).not.toContain('context-detach-from-master')
  })
})
