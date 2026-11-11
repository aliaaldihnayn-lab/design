import { afterEach, describe, expect, test } from 'bun:test'

import { createWriterDocument, nodeText, readDocx, writeDocx } from '@lawha/core/writer'

import {
  defineStorageProvider,
  resetStorageProviderRegistryForTests,
  StorageProviderRegistry,
  StorageRevisionConflictError,
  type StorageAdapter
} from '@/app/integrations/storage'
import { saveWriterDocument } from '@/app/writer/document'
import { updateWriterDocument, writerDocument, writerSource } from '@/app/writer/session'
import { openStoredWriterDocument, startStoredWriterDocument } from '@/app/writer/storage'

/** A provider keeping revisions in memory, refusing a save over a revision that moved on. */
function memoryProvider() {
  const revisions: Uint8Array[] = []
  const adapter: Pick<StorageAdapter, 'getDocument' | 'putDocument'> = {
    async getDocument() {
      const bytes = revisions.at(-1)
      if (!bytes) throw new Error('no revision')
      return { bytes, revision: String(revisions.length) }
    },
    async putDocument(_id, bytes, _metadata, _progress, options) {
      const current = revisions.length ? String(revisions.length) : null
      if ((options?.baseRevision ?? null) !== current) {
        throw new StorageRevisionConflictError(current)
      }
      revisions.push(bytes)
      return { revision: String(revisions.length) }
    }
  }
  const unused = () => Promise.reject(new Error('unused'))
  const provider = defineStorageProvider({
    id: 'memory',
    label: 'Memory',
    description: '',
    preferenceFields: [],
    credentialFields: [],
    createAdapter: () => ({
      ...adapter,
      testConnection: unused,
      listDocuments: unused,
      deleteDocument: unused,
      getUsage: unused
    })
  })
  resetStorageProviderRegistryForTests(new StorageProviderRegistry([provider]))
  return revisions
}

const binding = { providerId: 'memory', containerId: 'room', documentId: 'doc-1' }
const paragraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { dir: 'rtl' }, content: [{ type: 'text', text }] }]
})

afterEach(() => resetStorageProviderRegistryForTests())

describe('document editor files in storage', () => {
  test('a new file’s saves are revisions, each patched into the last', async () => {
    const revisions = memoryProvider()
    startStoredWriterDocument(binding, 'عقد')
    updateWriterDocument({ body: paragraph('النسخة الأولى') })
    expect(await saveWriterDocument()).toEqual({ status: 'done' })
    updateWriterDocument({ body: paragraph('النسخة الثانية') })
    expect(await saveWriterDocument()).toEqual({ status: 'done' })
    expect(revisions).toHaveLength(2)
    expect(nodeText(readDocx(revisions[1] ?? new Uint8Array()).body)).toBe('النسخة الثانية')
    expect(writerSource.value).toMatchObject({ kind: 'storage', revision: '2' })
  })

  test('opens the current revision and refuses a save over someone else’s', async () => {
    const revisions = memoryProvider()
    revisions.push(writeDocx(createWriterDocument({ body: paragraph('مشترك') })))
    expect(await openStoredWriterDocument(binding, 'Shared')).toEqual({ status: 'done' })
    expect(nodeText(writerDocument.value.body)).toBe('مشترك')
    // Someone else saves meanwhile.
    revisions.push(writeDocx(createWriterDocument({ body: paragraph('other') })))
    updateWriterDocument({ body: paragraph('mine') })
    expect(await saveWriterDocument()).toMatchObject({ status: 'failed', reason: 'conflict' })
    expect(revisions).toHaveLength(2)
  })
})
