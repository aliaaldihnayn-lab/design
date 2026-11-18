import { open, save } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { basename } from 'pathe'

import { downloadBlob } from '@/app/document/io/browser'
import { isFileWriteRefused, pickBrowserSaveFile } from '@/app/document/io/capability'
import { IS_BROWSER, IS_TAURI } from '@/constants'

/**
 * Opening and saving files for the document editor: the native dialogs on desktop, File System
 * Access in browsers that have it (so Save writes back to the same file), and a download where
 * neither is available.
 */
export interface PickedFile {
  name: string
  bytes: Uint8Array
  handle: FileSystemFileHandle | null
  path: string | null
}

export interface FileKind {
  description: string
  mime: string
  extension: string
}

export const DOCX: FileKind = {
  description: 'Word document',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extension: 'docx'
}

export const PDF: FileKind = { description: 'PDF', mime: 'application/pdf', extension: 'pdf' }

/** Picks a file through an `<input type=file>`, for browsers without the open picker. */
function pickWithInput(kind: FileKind): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `.${kind.extension},${kind.mime}`
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Asks for a file of `kind`; null when the person cancels. */
export async function pickFile(kind: FileKind): Promise<PickedFile | null> {
  if (IS_TAURI) {
    const path = await open({
      filters: [{ name: kind.description, extensions: [kind.extension] }],
      multiple: false
    })
    if (typeof path !== 'string') return null
    return { name: basename(path), bytes: await readFile(path), handle: null, path }
  }
  if (IS_BROWSER && typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: kind.description, accept: { [kind.mime]: [`.${kind.extension}`] } }]
      })
      const file = await handle.getFile()
      return {
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        handle,
        path: null
      }
    } catch (error) {
      if (isAbort(error)) return null
      throw error
    }
  }
  const file = await pickWithInput(kind)
  if (!file) return null
  return {
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    handle: null,
    path: null
  }
}

export interface SavedFile {
  name: string
  handle: FileSystemFileHandle | null
  path: string | null
  /** False when the browser downloaded a copy instead, so a later Save asks again. */
  inPlace: boolean
}

async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(new Blob([bytes.slice().buffer]))
  await writable.close()
}

/** Writes over the file it came from; false when there is no such file to write to. */
export async function saveInPlace(
  target: { handle: FileSystemFileHandle | null; path: string | null },
  bytes: Uint8Array
): Promise<boolean> {
  if (IS_TAURI && target.path) {
    await writeFile(target.path, bytes)
    return true
  }
  if (target.handle) {
    await writeHandle(target.handle, bytes)
    return true
  }
  return false
}

/** Asks where to save, writes the file there, and says where it went; null when cancelled. */
export async function saveFileAs(
  bytes: Uint8Array,
  suggestedName: string,
  kind: FileKind
): Promise<SavedFile | null> {
  const name = suggestedName.endsWith(`.${kind.extension}`)
    ? suggestedName
    : `${suggestedName}.${kind.extension}`
  if (IS_TAURI) {
    const path = await save({
      defaultPath: name,
      filters: [{ name: kind.description, extensions: [kind.extension] }]
    })
    if (!path) return null
    await writeFile(path, bytes)
    return { name: basename(path), handle: null, path, inPlace: true }
  }
  try {
    const handle = await pickBrowserSaveFile({
      suggestedName: name,
      types: [{ description: kind.description, accept: { [kind.mime]: [`.${kind.extension}`] } }]
    })
    if (handle) {
      await writeHandle(handle, bytes)
      return { name: handle.name, handle, path: null, inPlace: true }
    }
  } catch (error) {
    if (isAbort(error)) return null
    if (!isFileWriteRefused(error)) throw error
  }
  downloadBlob(bytes, name, kind.mime)
  return { name, handle: null, path: null, inPlace: false }
}
