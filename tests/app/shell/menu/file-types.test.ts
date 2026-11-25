import { describe, expect, test } from 'bun:test'

import {
  designFilePickerTypes,
  isSupportedDesignFile,
  READABLE_DOCUMENT_EXTENSIONS
} from '@/app/shell/menu/file-types'

describe('the Open dialog file types', () => {
  test('the browser picker accepts every extension the desktop dialog does', () => {
    const [type] = designFilePickerTypes()
    const accepted = Object.values(type.accept)
      .flat()
      .map((extension) => extension.slice(1))
    expect(accepted.toSorted()).toEqual(READABLE_DOCUMENT_EXTENSIONS.toSorted())
  })

  test('opens the formats people bring from other tools', () => {
    for (const name of [
      'a.fig',
      'b.pdf',
      'c.ai',
      'd.psd',
      'e.pptx',
      'f.drawio',
      'g.pen',
      'h.html'
    ]) {
      expect(isSupportedDesignFile(name)).toBe(true)
      expect(READABLE_DOCUMENT_EXTENSIONS).toContain(name.split('.')[1])
    }
    expect(isSupportedDesignFile('notes.txt')).toBe(false)
  })

  test('lists each extension once, under a MIME type', () => {
    const [type] = designFilePickerTypes()
    const accepted = Object.values(type.accept).flat()
    expect(new Set(accepted).size).toBe(accepted.length)
    for (const [mime, extensions] of Object.entries(type.accept)) {
      expect(mime).toMatch(/^[a-z]+\/[\w.+-]+$/)
      for (const extension of extensions) expect(extension).toMatch(/^\.[a-z0-9]{1,16}$/)
    }
  })
})
