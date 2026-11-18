import { afterEach, describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import { createEditor } from '@lawha/core'
import { FigmaAPI } from '@lawha/core/figma-api'
import {
  createDesignHistoryRecorder,
  designRecords,
  DocumentHistory,
  restoreDesignVersion,
  writerRecords
} from '@lawha/core/history'
import { ALL_TOOLS, isToolExposed, setVersionHistoryHost } from '@lawha/core/tools'
import { createWriterDocument, type WriterNode } from '@lawha/core/writer'

const ana = { id: 'ana', name: 'Ana', avatarUrl: null, color: null }

function tool(name: string) {
  const found = ALL_TOOLS.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`No tool ${name}`)
  return (args: Record<string, unknown>) =>
    found.execute(new FigmaAPI(createEditor().graph), v.parse(found.input, args))
}

/** A design with a history, offered to the tools as the app offers the active tab's. */
function openDesign() {
  const editor = createEditor()
  const card = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
    name: 'Card',
    x: 0
  })
  const history = new DocumentHistory({ documentKind: 'design' })
  createDesignHistoryRecorder({ source: editor, history, author: () => ana })
  const unregister = setVersionHistoryHost({
    target: (kind) =>
      kind === 'design'
        ? {
            history,
            currentRecords: () => designRecords(editor.graph),
            save: async (title, description) =>
              history.saveVersion({
                author: ana,
                records: designRecords(editor.graph),
                kind: 'named',
                title,
                description
              }),
            restore: async (versionId) =>
              restoreDesignVersion({ history, host: editor, versionId, author: ana })
          }
        : null
  })
  return { editor, card, history, unregister }
}

let cleanup: (() => void) | null = null
afterEach(() => cleanup?.())

describe('version history tools', () => {
  test('are exposed to AI, MCP and WebMCP', () => {
    for (const name of ['list_versions', 'save_version', 'restore_version', 'diff_versions']) {
      const found = ALL_TOOLS.find((candidate) => candidate.name === name)
      expect(found && isToolExposed(found, 'ai') && isToolExposed(found, 'mcp')).toBe(true)
      expect(found && isToolExposed(found, 'webmcp')).toBe(true)
    }
  })

  test('say when there is no history to work on', () => {
    cleanup = setVersionHistoryHost(null)
    expect(() => tool('list_versions')({})).toThrow('Version history is not available')
    expect(() => tool('list_versions')({ kind: 'writer' })).toThrow('document editor')
  })

  test('save, list, diff, and restore versions of a design', async () => {
    const { editor, card, unregister } = openDesign()
    cleanup = unregister
    const saved = (await tool('save_version')({ title: 'Start', description: 'Before' })) as {
      saved: { id: string; title: string }
    }
    expect(saved.saved.title).toBe('Start')
    editor.recordEdit({ label: 'Move' }, () => editor.graph.updateNode(card.id, { x: 90 }))
    editor.recordEdit({ label: 'Rectangle' }, () =>
      editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { name: 'Badge' })
    )

    const listed = (await tool('list_versions')({})) as {
      versions: { id: string; title: string | null }[]
      recentEdits: { action: string; names: string[] }[]
    }
    expect(listed.versions[0]).toMatchObject({ id: saved.saved.id, title: 'Start' })
    expect(listed.recentEdits.map((edit) => edit.action)).toEqual(['create', 'move'])

    const diff = (await tool('diff_versions')({ from: saved.saved.id })) as {
      added: { name: string | null }[]
      changed: { id: string; name: string | null }[]
    }
    expect(diff.added.map((layer) => layer.name)).toEqual(['Badge'])
    expect(diff.changed).toContainEqual({ id: card.id, name: 'Card' })

    await tool('restore_version')({ versionId: saved.saved.id })
    expect(editor.graph.getNode(card.id)?.x).toBe(0)
    const after = (await tool('list_versions')({})) as { versions: { kind: string }[] }
    expect(after.versions[0]?.kind).toBe('restore')

    expect(() => tool('diff_versions')({ from: 'missing' })).toThrow('list_versions')
  })

  test('diff versions of a document paragraph by paragraph', async () => {
    const paragraph = (text: string): WriterNode => ({
      type: 'paragraph',
      content: [{ type: 'text', text }]
    })
    const history = new DocumentHistory({ documentKind: 'writer' })
    const first = history.saveVersion({
      author: ana,
      records: writerRecords(
        createWriterDocument({ body: { type: 'doc', content: [paragraph('The quick fox')] } })
      )
    })
    const now = createWriterDocument({
      body: { type: 'doc', content: [paragraph('The slow fox'), paragraph('New')] }
    })
    cleanup = setVersionHistoryHost({
      target: (kind) =>
        kind === 'writer'
          ? {
              history,
              currentRecords: () => writerRecords(now),
              save: async () => null,
              restore: async () => null
            }
          : null
    })
    if (!first) throw new Error('expected a version')
    const diff = await tool('diff_versions')({ kind: 'writer', from: first.id })
    expect(diff).toHaveProperty('paragraphs', [
      {
        change: 'changed',
        before: 'The quick fox',
        after: 'The slow fox',
        added: ['slow'],
        removed: ['quick']
      },
      { change: 'added', text: 'New' }
    ])
  })
})
