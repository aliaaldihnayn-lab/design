import { afterEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { StorageUnavailableError } from '@/app/integrations/storage/errors'
import { createGoogleDriveStorageAdapter } from '@/app/integrations/storage/google-drive/adapter'

import { fetchStub } from '#tests/helpers/fetch'
import { testPath } from '#tests/helpers/paths'

/**
 * Drive API v3 answers in the shapes Drive sends them (`tests/fixtures/google-drive`): `files.list`
 * pages joined by `nextPageToken`, and Drive's JSON error bodies. IDs and tokens are made up.
 */
const answer = async (name: string, status = 200) =>
  new Response(await readFile(testPath(`fixtures/google-drive/${name}.json`), 'utf8'), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' }
  })

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function adapterAnswering(route: (url: URL) => Promise<Response>) {
  let forgotten = 0
  globalThis.fetch = fetchStub(async (input, init) => route(new URL(new Request(input, init).url)))
  const adapter = createGoogleDriveStorageAdapter(
    { preferences: {}, resolveCredential: () => Promise.resolve(null), profileId: 'default' },
    { token: () => Promise.resolve('token'), forget: () => void forgotten++ }
  )
  return { adapter, forgotten: () => forgotten }
}

/** Search answers: the folder lookup, then the folder's pages, or one file by its Lawha id. */
function search(url: URL): Promise<Response> | null {
  if (url.pathname !== '/drive/v3/files') return null
  const q = url.searchParams.get('q') ?? ''
  if (q.includes('application/vnd.google-apps.folder')) return answer('folder')
  if (url.searchParams.get('pageToken')) return answer('list-page-2')
  return answer('list-page-1')
}

describe('Google Drive storage against Drive answers', () => {
  test('lists every page of the folder and only the files Lawha saved', async () => {
    const { adapter } = adapterAnswering(
      (url) => search(url) ?? Promise.resolve(new Response('', { status: 500 }))
    )
    expect(await adapter.listDocuments()).toEqual([
      {
        id: 'doc-landing',
        name: 'Landing page',
        updatedAt: '2026-11-21T17:03:05.000Z',
        metadataAuthoritative: true,
        revision: '7',
        thumbnailURL: null
      },
      {
        id: 'doc-invite',
        name: 'بطاقة الدعوة',
        updatedAt: '2026-11-20T09:15:42.311Z',
        metadataAuthoritative: true,
        revision: '14',
        thumbnailURL: 'https://lh3.googleusercontent.com/drive-storage/AJQWtBN-example=s220'
      }
    ])
  })

  test('a file gone before its download fails instead of opening the error as a document', async () => {
    const { adapter } = adapterAnswering(
      (url) =>
        search(url) ??
        (url.searchParams.get('alt') === 'media'
          ? answer('not-found', 404)
          : Promise.resolve(new Response('', { status: 500 })))
    )
    expect(adapter.getDocument('doc-invite')).rejects.toThrow()
  })

  test('a refused token asks for a new sign-in', async () => {
    const { adapter, forgotten } = adapterAnswering(() => answer('unauthorized', 401))
    expect(adapter.listDocuments()).rejects.toBeInstanceOf(StorageUnavailableError)
    await adapter.listDocuments().catch(() => undefined)
    expect(forgotten()).toBeGreaterThan(0)
  })
})
