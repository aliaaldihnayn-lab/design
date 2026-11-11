import { describe, expect, test } from 'bun:test'

import { strToU8, zipSync } from 'fflate'

import { createWriterDocument, writeDocx } from '@lawha/core/writer'

import { isWordPackage, splitCloudDocument } from '@/app/integrations/storage/cloud/images'

describe('Cloud files from the document editor', () => {
  test('a Word package is told apart from a design archive', () => {
    const docx = writeDocx(createWriterDocument())
    expect(isWordPackage(docx)).toBe(true)
    expect(isWordPackage(zipSync({ 'canvas.fig': strToU8('fig-kiwi') }))).toBe(false)
    expect(isWordPackage(strToU8('not a zip'))).toBe(false)
  })

  test('a Word package is stored whole, its media inside it', () => {
    const docx = writeDocx(createWriterDocument())
    expect(splitCloudDocument(docx)).toEqual({ lean: docx, images: [] })
  })
})
