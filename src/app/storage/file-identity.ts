import type { DBSchema } from 'idb'

import { APP_DATABASE_NAMES, connectAppDatabase, defineAppDatabase } from './idb'

/**
 * A file the browser opened, as this device remembers it: the handle it was opened through,
 * which `isSameEntry` recognises when the file is opened again, and a fingerprint of what it held
 * when last read or saved, which finds it again through a new handle, as after a drop or a move.
 */
export interface FileIdentityRow {
  id: string
  handle: FileSystemFileHandle
  /** SHA-256 of the file's bytes, in hex; null until they were read. */
  fingerprint: string | null
  name: string
  updatedAt: string
}

/** Where the rows are kept: IndexedDB in the app, memory in tests. */
export interface FileIdentityRows {
  list(): Promise<FileIdentityRow[]>
  put(row: FileIdentityRow): Promise<void>
}

interface FileIdentityDatabase extends DBSchema {
  files: { key: string; value: FileIdentityRow }
}

const fileIdentityDatabase = defineAppDatabase<FileIdentityDatabase>({
  name: APP_DATABASE_NAMES.fileIdentities,
  version: 1,
  callbacks: {
    upgrade(database) {
      if (!database.objectStoreNames.contains('files')) {
        database.createObjectStore('files', { keyPath: 'id' })
      }
    }
  }
})

export function createIdbFileIdentityRows(): FileIdentityRows {
  const database = connectAppDatabase(fileIdentityDatabase)
  return {
    async list() {
      return (await database.open()).getAll('files')
    },
    async put(row) {
      await (await database.open()).put('files', row)
    }
  }
}

export function createMemoryFileIdentityRows(): FileIdentityRows & { rows: FileIdentityRow[] } {
  const rows: FileIdentityRow[] = []
  return {
    rows,
    async list() {
      return rows.map((row) => ({ ...row }))
    },
    async put(row) {
      const index = rows.findIndex((existing) => existing.id === row.id)
      if (index === -1) rows.push({ ...row })
      else rows[index] = { ...row }
    }
  }
}

/** The SHA-256 of a file's bytes, in hex. */
export async function fileFingerprint(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sameEntry(saved: FileSystemFileHandle, handle: FileSystemFileHandle) {
  try {
    return await saved.isSameEntry(handle)
  } catch {
    // A handle from an earlier session can fail to compare; the fingerprint still matches it.
    return false
  }
}

async function readable(handle: FileSystemFileHandle) {
  try {
    await handle.getFile()
    return true
  } catch {
    return false
  }
}

/** Runs `task` alone across this origin's tabs where the Web Locks API exists. */
function exclusively<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return task()
  return navigator.locks.request('lawha-file-identity', task)
}

export type FileIdentityStore = ReturnType<typeof createFileIdentityStore>

/**
 * Stable identities for files the browser opened, so what this device keeps about a file, such
 * as its version history, follows the file rather than its name: two files called `Untitled.fig`
 * stay apart, and a file opened again, renamed, or dropped in through a new handle is found by its
 * handle or, failing that, by its content.
 */
export function createFileIdentityStore(rows: FileIdentityRows = createIdbFileIdentityRows()) {
  const known = new WeakMap<FileSystemFileHandle, string>()

  async function readFingerprint(handle: FileSystemFileHandle): Promise<string | null> {
    try {
      return await fileFingerprint(await (await handle.getFile()).arrayBuffer())
    } catch {
      return null
    }
  }

  async function find(
    handle: FileSystemFileHandle,
    fingerprint: string | null
  ): Promise<FileIdentityRow | null> {
    const saved = await rows.list()
    for (const row of saved) if (await sameEntry(row.handle, handle)) return row
    if (!fingerprint) return null
    const matches = saved.filter((row) => row.fingerprint === fingerprint)
    const sameName = matches.find((row) => row.name === handle.name)
    if (sameName) return sameName
    // Under another name, only a file that is no longer where it was moved; one still there has a
    // copy beside it, which keeps a history of its own.
    for (const row of matches) if (!(await readable(row.handle))) return row
    return null
  }

  return {
    /**
     * The file's identity, made the first time this device sees it. `fingerprint` is of the
     * bytes the file was opened with; without it they are read through the handle.
     */
    async resolve(handle: FileSystemFileHandle, fingerprint?: string): Promise<string> {
      const cached = known.get(handle)
      if (cached) return cached
      return exclusively(async () => {
        const content = fingerprint ?? (await readFingerprint(handle))
        const found = await find(handle, content)
        const row: FileIdentityRow = {
          id: found?.id ?? crypto.randomUUID(),
          handle,
          fingerprint: content ?? found?.fingerprint ?? null,
          name: handle.name,
          updatedAt: new Date().toISOString()
        }
        await rows.put(row)
        known.set(handle, row.id)
        return row.id
      })
    },

    /** Records what the file holds now, after it was saved, so it is found by content again. */
    async remember(handle: FileSystemFileHandle, bytes: BufferSource): Promise<void> {
      const fingerprint = await fileFingerprint(bytes)
      const id = known.get(handle)
      await exclusively(async () => {
        const saved = await rows.list()
        let row = id ? saved.find((existing) => existing.id === id) : undefined
        if (!row) {
          for (const existing of saved) {
            if (await sameEntry(existing.handle, handle)) {
              row = existing
              break
            }
          }
        }
        if (!row) return
        await rows.put({
          ...row,
          handle,
          fingerprint,
          name: handle.name,
          updatedAt: new Date().toISOString()
        })
      })
    }
  }
}

let defaultStore: FileIdentityStore | null = null

/** The app's file identities, kept in IndexedDB. */
export function browserFileIdentities(): FileIdentityStore {
  defaultStore ??= createFileIdentityStore()
  return defaultStore
}
