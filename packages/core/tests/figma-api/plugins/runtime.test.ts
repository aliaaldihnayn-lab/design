import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { FIXTURES } from '#core-tests/helpers/paths'

import { FigmaAPI } from '@lawha/core/figma-api'
import {
  bundleFromFiles,
  networkAllowed,
  parsePluginManifest,
  pluginCommands,
  startPlugin,
  type PluginBundle,
  type PluginHost,
  type PluginUIOptions
} from '@lawha/core/figma-api/plugins'
import { SceneGraph } from '@lawha/scene-graph'

const SAMPLE = join(FIXTURES, 'plugins/rectangles')

function sampleBundle(): PluginBundle {
  const files = Object.fromEntries(
    readdirSync(SAMPLE).map((name) => [
      `rectangles/${name}`,
      readFileSync(join(SAMPLE, name), 'utf8')
    ])
  )
  const read = bundleFromFiles(files)
  if (!read.ok) throw new Error(read.error)
  return read.bundle
}

/** A host that records what the plugin asked of its window. */
function recordingHost() {
  const log = {
    shown: [] as { html: string; options: PluginUIOptions }[],
    toUI: [] as unknown[],
    notes: [] as { message: string; error?: boolean }[],
    closedUI: 0,
    turns: 0,
    errors: [] as unknown[]
  }
  const host: PluginHost = {
    showUI: (html, options) => log.shown.push({ html, options }),
    postToUI: (message) => log.toUI.push(message),
    setUIVisible: () => undefined,
    resizeUI: () => undefined,
    closeUI: () => {
      log.closedUI++
    },
    notify: (message, options) => log.notes.push({ message, error: options.error }),
    turn: async (run) => {
      log.turns++
      return run()
    },
    console: { ...console, error: (error: unknown) => log.errors.push(error) }
  }
  return { host, log }
}

function bundle(code: string, manifest: Partial<PluginBundle['manifest']> = {}): PluginBundle {
  return {
    manifest: {
      name: 'Test',
      id: 'test',
      api: '1.0.0',
      main: 'code.js',
      ui: 'ui.html',
      editorType: ['figma'],
      ...manifest
    },
    code,
    ui: { ui: '<p>hi</p>' }
  }
}

describe('manifest', () => {
  test('reads the sample plugin folder and its menu commands', () => {
    const sample = sampleBundle()
    expect(sample.manifest.name).toBe('Rectangle Creator')
    expect(sample.ui.ui).toContain('create-rectangles')
    expect(pluginCommands(sample.manifest)).toEqual([
      { name: 'Create Rectangles…', command: 'open', path: [] },
      { name: 'Three Squares', command: 'three', path: ['Quick'] }
    ])
  })

  test('names what is wrong or missing', () => {
    expect(parsePluginManifest('{"name":"x"}')).toMatchObject({ ok: false })
    expect(parsePluginManifest('not json').ok).toBe(false)
    expect(bundleFromFiles({ 'code.js': '' })).toEqual({
      ok: false,
      error: 'manifest.json is missing'
    })
    expect(
      bundleFromFiles({
        'manifest.json': '{"name":"a","id":"a","main":"code.js","ui":"ui.html"}',
        'code.js': ''
      })
    ).toEqual({ ok: false, error: 'ui.html is missing' })
  })
})

describe('running a plugin', () => {
  test('the sample opens its UI, makes rectangles for a UI message, and answers the UI', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const { host, log } = recordingHost()
    const session = startPlugin({ figma, bundle: sampleBundle(), host, command: 'open' })
    await session.ready

    expect(log.shown).toHaveLength(1)
    expect(log.shown[0].html).toContain('<input id="count"')
    expect(log.shown[0].options).toMatchObject({
      width: 240,
      height: 140,
      visible: true,
      title: 'Rectangle Creator'
    })

    await session.receiveFromUI({ type: 'create-rectangles', count: 4 })
    expect(figma.currentPage.children.map((n) => n.name)).toEqual([
      'Rectangle 1',
      'Rectangle 2',
      'Rectangle 3',
      'Rectangle 4'
    ])
    expect(figma.currentPage.selection).toHaveLength(4)
    expect(log.toUI).toEqual([{ type: 'created', count: 4 }])
    expect(session.running).toBe(true)

    await session.receiveFromUI({ type: 'cancel' })
    expect(session.running).toBe(false)
    expect(await session.done).toEqual({ message: undefined })
    expect(log.closedUI).toBe(1)
  })

  test('a menu command runs without a UI and closes with its message', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const { host, log } = recordingHost()
    const session = startPlugin({ figma, bundle: sampleBundle(), host, command: 'three' })
    expect(await session.done).toEqual({ message: 'Created 3 rectangles' })
    expect(figma.currentPage.children).toHaveLength(3)
    expect(log.shown).toHaveLength(0)
    expect(log.notes).toEqual([{ message: 'Created 3 rectangles', error: undefined }])
  })

  test('the run event, figma.command, once, and close listeners fire as in Figma', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const { host, log } = recordingHost()
    const session = startPlugin({
      figma,
      host,
      command: 'go',
      bundle: bundle(`
        figma.on('run', ({ command }) => figma.notify('run:' + command + ':' + figma.command))
        figma.once('selectionchange', () => figma.notify('selection'))
        figma.on('close', () => figma.notify('close'))
      `),
      parameters: undefined
    })
    await session.ready
    await session.emit('selectionchange')
    await session.emit('selectionchange')
    session.close()
    expect(log.notes.map((note) => note.message)).toEqual(['run:go:go', 'selection', 'close'])
  })

  test('code that fails to start ends the session with its error', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const { host } = recordingHost()
    const session = startPlugin({ figma, host, bundle: bundle(`throw new Error('boom')`) })
    expect(await session.done).toEqual({ error: 'boom' })
  })

  test('an error in a message handler is reported and the plugin keeps running', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const { host, log } = recordingHost()
    const session = startPlugin({
      figma,
      host,
      bundle: bundle(
        `figma.showUI(__html__); figma.ui.onmessage = () => { throw new Error('bad') }`
      )
    })
    await session.ready
    await session.receiveFromUI({})
    expect(session.running).toBe(true)
    expect(log.notes).toEqual([{ message: 'Test: bad', error: true }])
  })

  test('each turn runs through the host, and messages are copies', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const { host, log } = recordingHost()
    const session = startPlugin({
      figma,
      host,
      bundle: bundle(`
        figma.showUI(__html__)
        figma.ui.onmessage = (msg) => { msg.changed = true; figma.ui.postMessage(msg) }
      `)
    })
    await session.ready
    const message = { value: 1 }
    await session.receiveFromUI(message)
    expect(message).toEqual({ value: 1 })
    expect(log.toUI).toEqual([{ value: 1, changed: true }])
    expect(log.turns).toBe(2)
  })

  test('host globals are hidden and fetch follows networkAccess', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const { host } = recordingHost()
    const fetched: string[] = []
    host.fetch = async (url) => {
      fetched.push(url)
      return new Response('ok')
    }
    const session = startPlugin({
      figma,
      host,
      bundle: bundle(
        `
        const seen = [typeof window, typeof document, typeof localStorage, typeof indexedDB]
        let blocked = ''
        try { await fetch('https://evil.test/x') } catch (e) { blocked = e.message }
        const ok = await (await fetch('https://api.example.com/v1/a')).text()
        figma.closePlugin(JSON.stringify({ seen, blocked, ok }))
      `,
        { networkAccess: { allowedDomains: ['*.example.com'] } }
      )
    })
    const exit = await session.done
    expect(JSON.parse(exit.message ?? '{}')).toEqual({
      seen: ['undefined', 'undefined', 'undefined', 'undefined'],
      blocked:
        "in fetch: https://evil.test/x is not in the manifest's networkAccess.allowedDomains",
      ok: 'ok'
    })
    expect(fetched).toEqual(['https://api.example.com/v1/a'])
  })

  test('figma.ui.postMessage before showUI and calls after close fail as in Figma', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const { host } = recordingHost()
    const session = startPlugin({
      figma,
      host,
      bundle: bundle(`
        let early = ''
        try { figma.ui.postMessage(1) } catch (e) { early = e.message }
        figma.closePlugin(early)
      `)
    })
    expect((await session.done).message).toContain('call figma.showUI first')
  })

  test('clientStorage keeps copies of values', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const { host } = recordingHost()
    const session = startPlugin({
      figma,
      host,
      bundle: bundle(`
        const value = { n: 1 }
        await figma.clientStorage.setAsync('k', value)
        value.n = 2
        const read = await figma.clientStorage.getAsync('k')
        figma.closePlugin(JSON.stringify([read, await figma.clientStorage.keysAsync()]))
      `)
    })
    expect(JSON.parse((await session.done).message ?? '')).toEqual([{ n: 1 }, ['k']])
  })
})

describe('networkAllowed', () => {
  test('matches Figma domain patterns', () => {
    expect(networkAllowed(undefined, 'https://a.b')).toBe(true)
    expect(networkAllowed(['none'], 'https://a.b')).toBe(false)
    expect(networkAllowed(['*'], 'https://a.b')).toBe(true)
    expect(networkAllowed(['example.com'], 'https://example.com/x')).toBe(true)
    expect(networkAllowed(['example.com'], 'https://sub.example.com/x')).toBe(false)
    expect(networkAllowed(['*.example.com'], 'https://sub.example.com/x')).toBe(true)
    expect(networkAllowed(['https://example.com/api/'], 'https://example.com/api/v1')).toBe(true)
    expect(networkAllowed(['https://example.com/api/'], 'https://example.com/other')).toBe(false)
    expect(networkAllowed(['https://example.com'], 'http://example.com')).toBe(false)
  })
})
