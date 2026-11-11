import { describe, expect, test } from 'bun:test'

import {
  createFileIdentityStore,
  createMemoryFileIdentityRows,
  fileFingerprint
} from '@/app/storage/file-identity'

import { asDouble } from '#tests/helpers/doubles'

/** A browser file handle whose content can change, equal to handles of the same `entry`. */
function fileHandle(name: string, file: { entry: string; content: string; gone?: boolean }) {
  const handle = {
    kind: 'file' as const,
    name,
    entry: file.entry,
    getFile: async () => {
      if (file.gone) throw new DOMException('Moved', 'NotFoundError')
      return new File([file.content], name)
    },
    isSameEntry: async (other: unknown) =>
      typeof other === 'object' && other !== null && 'entry' in other && other.entry === file.entry
  }
  return asDouble<FileSystemFileHandle>(handle)
}

describe('browser file identity', () => {
  test('knows a file again through a handle to the same entry, whatever it holds now', async () => {
    const identities = createFileIdentityStore(createMemoryFileIdentityRows())
    const file = { entry: 'a', content: 'one' }
    const id = await identities.resolve(fileHandle('Design.fig', file))
    file.content = 'edited elsewhere'
    const fresh = createFileIdentityStore(createMemoryFileIdentityRows())
    expect(await fresh.resolve(fileHandle('Design.fig', file))).not.toBe(id)
    // The same device's rows recognise the entry.
    expect(await identities.resolve(fileHandle('Design.fig', file))).toBe(id)
  })

  test('keeps files of the same name apart and finds a moved file by its content', async () => {
    const rows = createMemoryFileIdentityRows()
    const identities = createFileIdentityStore(rows)
    const original = { entry: 'a', content: 'A', gone: false }
    const a = await identities.resolve(fileHandle('Untitled.fig', original))
    const b = await identities.resolve(fileHandle('Untitled.fig', { entry: 'b', content: 'B' }))
    expect(a).not.toBe(b)
    original.gone = true
    const moved = await createFileIdentityStore(rows).resolve(
      fileHandle('Moved.fig', { entry: 'c', content: 'A' })
    )
    expect(moved).toBe(a)
  })

  test('remembers what a save wrote, so the file is found by its new content', async () => {
    const rows = createMemoryFileIdentityRows()
    const identities = createFileIdentityStore(rows)
    const file = { entry: 'a', content: 'before' }
    const handle = fileHandle('Design.fig', file)
    const id = await identities.resolve(handle)
    file.content = 'after'
    await identities.remember(handle, new TextEncoder().encode('after'))
    expect(rows.rows[0]?.fingerprint).toBe(await fileFingerprint(new TextEncoder().encode('after')))
    const dropped = await createFileIdentityStore(rows).resolve(
      fileHandle('Design.fig', { entry: 'z', content: 'after' })
    )
    expect(dropped).toBe(id)
  })

  test('gives a copy beside its original a history of its own', async () => {
    const rows = createMemoryFileIdentityRows()
    const identities = createFileIdentityStore(rows)
    const one = await identities.resolve(fileHandle('One.fig', { entry: 'a', content: 'same' }))
    const two = await identities.resolve(fileHandle('Two.fig', { entry: 'b', content: 'same' }))
    expect(two).not.toBe(one)
    const again = await createFileIdentityStore(rows).resolve(
      fileHandle('Two.fig', { entry: 'c', content: 'same' })
    )
    expect(again).toBe(two)
  })
})
