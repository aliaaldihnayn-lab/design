import { describe, expect, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import {
  createDesignHistoryRecorder,
  designDiffFromKeys,
  designRecords,
  DocumentHistory,
  graphFromDesignRecords,
  restoreDesignVersion,
  type HistoryAuthor
} from '@lawha/core/history'

const ana: HistoryAuthor = { id: 'ana', name: 'Ana', avatarUrl: null, color: null }

function setup() {
  const editor = createEditor()
  const pageId = editor.state.currentPageId
  const card = editor.graph.createNode('RECTANGLE', pageId, {
    name: 'Card',
    x: 0,
    width: 100,
    height: 50
  })
  const title = editor.graph.createNode('TEXT', pageId, { name: 'Heading', text: 'Hello' })
  const history = new DocumentHistory({ documentKind: 'design' })
  const recorder = createDesignHistoryRecorder({ source: editor, history, author: () => ana })
  return { editor, pageId, card, title, history, recorder }
}

describe('design history', () => {
  test('records undo steps with what they did to which layers', () => {
    const { editor, card, title, history } = setup()
    editor.recordEdit({ label: 'Move' }, () => {
      editor.graph.updateNode(card.id, { x: 40 })
      editor.graph.updateNode(title.id, { y: 10 })
    })
    editor.recordEdit({ label: 'Edit text' }, () =>
      editor.graph.updateNode(title.id, { text: 'Bye' })
    )
    editor.undo.undo()

    const changes = history.listChanges().map((change) => change.summary)
    expect(changes[0]).toEqual({
      action: 'move',
      count: 2,
      names: ['Card', 'Heading'],
      label: 'Move'
    })
    expect(changes[1]).toMatchObject({ action: 'edit-text', count: 1, names: ['Heading'] })
    expect(changes[2]).toMatchObject({ action: 'undo', label: 'Edit text' })
    expect(history.listChanges().every((change) => change.author.id === 'ana')).toBe(true)
  })

  test('describes created and deleted layers', () => {
    const { editor, pageId, card, history } = setup()
    editor.recordEdit({ label: 'Delete' }, () => editor.graph.deleteNode(card.id))
    editor.recordEdit({ label: 'Rectangle' }, () =>
      editor.graph.createNode('RECTANGLE', pageId, { name: 'New box' })
    )
    const [deleted, created] = history.listChanges().map((change) => change.summary)
    expect(deleted).toMatchObject({ action: 'delete', count: 1, names: ['Card'] })
    expect(created).toMatchObject({ action: 'create', count: 1, names: ['New box'] })
  })

  test('keeps ids, fields, and images through records', () => {
    const { editor, card } = setup()
    editor.graph.images.set('abc', new Uint8Array([1, 2, 3]))
    const copy = graphFromDesignRecords(designRecords(editor.graph))
    expect(copy.getNode(card.id)).toEqual(editor.graph.getNode(card.id))
    expect(copy.getPages().map((page) => page.id)).toEqual(
      editor.graph.getPages().map((page) => page.id)
    )
    expect(copy.images.get('abc')).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('diffs a version against the document by layer', () => {
    const { editor, card, title, history, recorder } = setup()
    const version = recorder.checkpoint()
    if (!version) throw new Error('expected a version')
    editor.recordEdit({ label: 'Move' }, () => editor.graph.updateNode(card.id, { x: 99 }))
    editor.recordEdit({ label: 'Delete' }, () => editor.graph.deleteNode(title.id))
    const diff = designDiffFromKeys(
      history.diffWithCurrent(version.id, designRecords(editor.graph))
    )
    // The page's child list changed too, but pages are layers the diff reports as well.
    expect(diff.changed).toContain(card.id)
    expect(diff.removed).toEqual([title.id])
    expect(diff.added).toEqual([])
  })

  test('restores a version as an undoable change, keeping the state before it', () => {
    const { editor, card, title, history, recorder } = setup()
    const saved = recorder.saveNamed('Before edits', 'First draft')
    if (!saved) throw new Error('expected a version')
    editor.recordEdit({ label: 'Move' }, () => editor.graph.updateNode(card.id, { x: 99 }))
    editor.recordEdit({ label: 'Delete' }, () => editor.graph.deleteNode(title.id))
    const page = editor.graph.addPage('Second page')

    const restored = restoreDesignVersion({
      history,
      host: editor,
      versionId: saved.id,
      author: ana
    })

    expect(editor.graph.getNode(card.id)?.x).toBe(0)
    expect(editor.graph.getNode(title.id)?.name).toBe('Heading')
    expect(editor.graph.getNode(page.id)).toBeUndefined()
    expect(restored).toMatchObject({
      kind: 'restore',
      restoredFromId: saved.id,
      title: 'Before edits'
    })
    expect(history.latestChange?.summary.action).toBe('restore')
    // The document as it was before the restore is a version of its own.
    const kinds = history.listVersions().map((version) => version.kind)
    expect(kinds).toEqual(['named', 'auto', 'restore'])

    editor.undo.undo()
    expect(editor.graph.getNode(card.id)?.x).toBe(99)
    expect(editor.graph.getNode(title.id)).toBeUndefined()
  })

  test('keeps an automatic version every so many changes', () => {
    const editor = createEditor()
    const card = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { name: 'Card' })
    const history = new DocumentHistory({ documentKind: 'design' })
    createDesignHistoryRecorder({ source: editor, history, author: () => ana, autoVersionEvery: 2 })
    for (let x = 1; x <= 4; x++) {
      editor.recordEdit({ label: 'Move' }, () => editor.graph.updateNode(card.id, { x }))
    }
    expect(history.listVersions()).toHaveLength(2)
  })

  test('stops recording once disposed', () => {
    const { editor, card, history, recorder } = setup()
    recorder.dispose()
    editor.recordEdit({ label: 'Move' }, () => editor.graph.updateNode(card.id, { x: 5 }))
    expect(history.listChanges()).toHaveLength(0)
  })
})
