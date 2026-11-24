import { expect, test } from 'bun:test'

import { createEditor } from '@lawha/core'

test("a copy's plain text gives text layers' words and other layers' names", async () => {
  const editor = createEditor()
  try {
    const pageId = editor.state.currentPageId
    const text = editor.graph.createNode('TEXT', pageId, {
      name: 'Heading',
      text: 'مرحبا بالعالم',
      width: 100,
      height: 20
    })
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Card',
      x: 200,
      width: 100,
      height: 100
    })
    editor.select([text.id, frame.id])
    const { plainText } = await editor.prepareCopy()
    expect(plainText).toBe('مرحبا بالعالم\nCard')
  } finally {
    editor.dispose()
  }
})
