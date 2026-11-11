import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { FIXTURES } from '#core-tests/helpers/paths'

import { DocxReadError, nodeText, readDocx, type WriterNode } from '@lawha/core/writer'

/** Written by LibreOffice from HTML: another producer's Word file, not Lawha's own. */
const fixture = () => readFileSync(join(FIXTURES, 'writer/libreoffice-arabic.docx'))

const blocks = () => readDocx(fixture()).body.content ?? []
const find = (type: string) => blocks().filter((node) => node.type === type)
const marksOf = (node: WriterNode, text: string) =>
  node.content?.find((child) => child.text === text)?.marks?.map((mark) => mark.type)

describe('reading Word files from other producers', () => {
  test('reads Arabic headings and paragraphs with their direction and formatting', () => {
    const [heading] = find('heading')
    expect(heading.attrs).toMatchObject({ level: 1, dir: 'rtl', textAlign: 'center' })
    expect(nodeText(heading)).toBe('عقد خدمات')
    const arabic = find('paragraph').find((node) => nodeText(node).startsWith('هذا'))
    expect(arabic?.attrs?.dir).toBe('rtl')
    // LibreOffice marks Arabic bold and italic only on the complex-script properties.
    expect(arabic && marksOf(arabic, 'نص عريض')).toEqual(['bold'])
    expect(arabic && marksOf(arabic, 'مائل')).toEqual(['italic'])
    expect(arabic && marksOf(arabic, 'مسطر')).toEqual(['underline'])
  })

  test('reads links, lists and merged table cells', () => {
    const english = find('paragraph').find((node) => nodeText(node).startsWith('English'))
    const link = english?.content?.find((child) => child.text === 'a link')
    expect(link?.marks).toContainEqual({ type: 'link', attrs: { href: 'https://example.com/' } })
    expect(find('bulletList')[0].content).toHaveLength(2)
    expect(nodeText(find('orderedList')[0])).toBe('one\ntwo')
    const [table] = find('table')
    expect(table.content?.[0].content?.[0].attrs?.colspan).toBe(2)
    expect(table.content?.[1].content).toHaveLength(2)
  })

  test('tells a non-Word file and a password-protected one apart', () => {
    expect(() => readDocx(new TextEncoder().encode('hello'))).toThrow(DocxReadError)
    const compound = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(() => readDocx(compound)).toThrow('encrypted')
  })
})
