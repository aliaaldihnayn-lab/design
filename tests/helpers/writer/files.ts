import { expect, type Page } from '@playwright/test'

/**
 * Driver: opens Word bytes through the document editor's Open button, as a file the browser's
 * picker returns, and collects what Save writes back to it in the test runner.
 */
export async function openWordFile(
  page: Page,
  bytes: Uint8Array,
  name = 'document.docx'
): Promise<{ saves: Uint8Array[] }> {
  const saves: Uint8Array[] = []
  await page.exposeFunction('lawhaTestWriterSave', (data: number[]) => {
    saves.push(new Uint8Array(data))
  })
  await page.evaluate(
    ({ data, name }) => {
      const save = Reflect.get(window, 'lawhaTestWriterSave') as (data: number[]) => void
      const handle = {
        kind: 'file',
        name,
        getFile: async () => new File([new Uint8Array(data)], name),
        createWritable: async (): Promise<
          Pick<FileSystemWritableFileStream, 'write' | 'close'>
        > => ({
          write: async (chunk: FileSystemWriteChunkType) => {
            if (chunk instanceof Blob) save(Array.from(new Uint8Array(await chunk.arrayBuffer())))
            else if (chunk instanceof Uint8Array) save(Array.from(chunk))
          },
          close: async () => undefined
        })
      } as FileSystemFileHandle
      window.showOpenFilePicker = async () => [handle]
      window.showSaveFilePicker = async () => handle
    },
    { data: Array.from(bytes), name }
  )
  await page.getByTestId('writer-open').click()
  await expect(page.getByTestId('writer-status')).toBeVisible()
  return { saves }
}

/** Probe: the bytes of the next save, once it lands. */
export async function nextSave(files: { saves: Uint8Array[] }, after = files.saves.length) {
  await expect.poll(() => files.saves.length, { timeout: 30_000 }).toBeGreaterThan(after)
  return files.saves[files.saves.length - 1]
}
