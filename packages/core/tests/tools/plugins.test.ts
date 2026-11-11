import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { FIXTURES } from '#core-tests/helpers/paths'

import { FigmaAPI } from '@lawha/core/figma-api'
import { SceneGraph } from '@lawha/scene-graph'

import { runFigmaPlugin } from '#core/tools/plugins'

const SAMPLE = join(FIXTURES, 'plugins/rectangles')
const files = Object.fromEntries(
  readdirSync(SAMPLE).map((name) => [name, readFileSync(join(SAMPLE, name), 'utf8')])
)

test('run_figma_plugin drives the sample plugin with scripted window messages', async () => {
  const figma = new FigmaAPI(new SceneGraph())
  const result = await runFigmaPlugin.execute(figma, {
    files,
    command: 'open',
    ui_messages: [{ type: 'create-rectangles', count: 2 }, { type: 'cancel' }]
  })
  expect(result).toEqual({
    exit: { message: undefined },
    closedByPlugin: true,
    ui: { width: 240, height: 140, title: 'Rectangle Creator' },
    postedToUI: [{ type: 'created', count: 2 }],
    notifications: []
  })
  expect(figma.currentPage.children.map((n) => n.name)).toEqual(['Rectangle 1', 'Rectangle 2'])
})

test('run_figma_plugin names a missing file', async () => {
  const figma = new FigmaAPI(new SceneGraph())
  expect(
    await runFigmaPlugin.execute(figma, { files: { 'manifest.json': files['manifest.json'] } })
  ).toEqual({ error: 'code.js is missing' })
})
