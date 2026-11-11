import { afterEach, describe, expect, test } from 'bun:test'

import { nextTick } from 'vue'

import { createWriterDocument, type WriterNode } from '@lawha/core/writer'

import { createMemoryHistoryPersistence } from '@/app/history/persistence'
import { createWriterHistory, writerHistoryKey, type WriterHistory } from '@/app/history/writer'
import {
  loadWriterDocument,
  markWriterSaved,
  setWriterBody,
  writerDocument
} from '@/app/writer/session'

const paragraph = (text: string): WriterNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }]
})
const body = (...texts: string[]): WriterNode => ({ type: 'doc', content: texts.map(paragraph) })
const author = () => ({ id: 'ana', name: 'Ana', avatarUrl: null, color: null })
const settle = async () => {
  await nextTick()
  await new Promise((resolve) => {
    setTimeout(resolve, 30)
  })
}

const started: WriterHistory[] = []
afterEach(() => {
  for (const history of started.splice(0)) history.dispose()
})

function track(history: WriterHistory): WriterHistory {
  started.push(history)
  return history
}

function start(persistence = createMemoryHistoryPersistence()) {
  loadWriterDocument(createWriterDocument({ body: body('Title', 'Body') }), 'Report', {
    kind: 'file',
    handle: null,
    path: '/docs/report.docx'
  })
  const history = track(
    createWriterHistory({ persistence, author, changeDelayMs: 5, idleMs: 60_000 })
  )
  return { history, persistence }
}

describe('document editor history', () => {
  test('keeps the document as opened and records each pause in typing as an edit', async () => {
    const { history } = start()
    setWriterBody(body('Title', 'Body text'))
    await settle()
    const changes = history.controller.history.value.listChanges()
    expect(changes).toHaveLength(1)
    expect(changes[0]?.summary).toMatchObject({ action: 'edit-text', names: ['Body text'] })
    expect(history.controller.history.value.listVersions()).toHaveLength(1)
  })

  test('saves named versions under the file and reads them back', async () => {
    const persistence = createMemoryHistoryPersistence()
    const first = start(persistence).history
    await first.saveNamed('Draft', 'Before review')
    expect(persistence.keys()).toEqual(['writer:path:/docs/report.docx'])
    expect(await writerHistoryKey({ kind: 'file', handle: null, path: '/docs/report.docx' })).toBe(
      'writer:path:/docs/report.docx'
    )
    first.dispose()
    const history = track(createWriterHistory({ persistence, author, changeDelayMs: 5 }))
    await history.controller.refresh()
    const titles = history.controller.history.value.listVersions().map((version) => version.title)
    expect(titles).toContain('Draft')
  })

  test('restores a version as an edit of its own, keeping the text before it', async () => {
    const { history } = start()
    await history.saveNamed('Original')
    const original = history.controller.history.value.latestVersion
    if (!original) throw new Error('expected a version')
    setWriterBody(body('Title', 'Rewritten', 'Extra'))
    await settle()

    await history.restore(original.id)
    const texts = (writerDocument.value.body.content ?? []).map((block) => block.content?.[0]?.text)
    expect(texts).toEqual(['Title', 'Body'])
    const timeline = history.controller.history.value
    expect(timeline.latestChange?.summary.action).toBe('restore')
    expect(timeline.latestVersion).toMatchObject({ kind: 'restore', restoredFromId: original.id })
    // The text before the restore is a version to go back to.
    const kept = timeline
      .listVersions()
      .map((version) => history.versionDocument(version.id).body.content?.length)
    expect(kept).toContain(3)
  })

  test('follows the document to where it is saved', async () => {
    const persistence = createMemoryHistoryPersistence()
    loadWriterDocument(createWriterDocument({ body: body('New') }), '', null)
    track(createWriterHistory({ persistence, author, changeDelayMs: 5 }))
    setWriterBody(body('New text'))
    await settle()
    expect(persistence.keys()).toEqual([])
    markWriterSaved({ kind: 'file', handle: null, path: '/docs/new.docx' })
    await settle()
    expect(persistence.keys()).toEqual(['writer:path:/docs/new.docx'])
  })
})
