import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'

import { writerDirty, writerDocument, writerRevision } from '@/app/writer/session'

describe('the document editor as the AI tools see it', () => {
  test('a tool edit replaces the open document, marks it unsaved, and refreshes the editor', () => {
    const write = ALL_TOOLS.find((tool) => tool.name === 'write_document')
    if (!write) throw new Error('write_document is not registered')
    const revision = writerRevision.value
    writerDirty.value = false
    write.execute(new FigmaAPI(new SceneGraph()), {
      blocks: [{ type: 'paragraph', text: 'من الذكاء الاصطناعي' }]
    })
    expect(writerDocument.value.body.content?.[0].content?.[0].text).toBe('من الذكاء الاصطناعي')
    expect(writerDirty.value).toBe(true)
    expect(writerRevision.value).toBe(revision + 1)
  })
})
