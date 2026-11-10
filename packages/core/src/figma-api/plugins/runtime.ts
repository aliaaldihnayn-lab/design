import type { Vector } from '@lawha/scene-graph/primitives'

import type { FigmaAPI } from '#core/figma-api'
import { compileScript } from '#core/tools/analyze/eval/wrap'

import { type PluginBundle, uiFiles } from './manifest'

/** How a plugin asked its UI to appear, with Figma's defaults filled in. */
export interface PluginUIOptions {
  visible: boolean
  title: string
  width: number
  height: number
  position?: Vector
  themeColors: boolean
}

/** Figma's `figma.clientStorage`: data a plugin keeps between runs. */
export interface PluginClientStorage {
  getAsync(key: string): Promise<unknown>
  setAsync(key: string, value: unknown): Promise<void>
  deleteAsync(key: string): Promise<void>
  keysAsync(): Promise<string[]>
}

/** What a front end gives a running plugin: its window, notifications, and storage. */
export interface PluginHost {
  /** Opens the plugin's window with `html`; one window per plugin, as in Figma. */
  showUI(html: string, options: PluginUIOptions): void
  /** Delivers `figma.ui.postMessage` to the window as `{ pluginMessage }`. */
  postToUI(message: unknown): void
  setUIVisible(visible: boolean): void
  resizeUI(width: number, height: number): void
  repositionUI?(x: number, y: number): void
  closeUI(): void
  notify(message: string, options: { timeout?: number; error?: boolean }): void
  /**
   * Runs one turn of plugin code: the start, a message from its window, or an event. A host
   * records the edits the turn makes as one undo step and redraws after it.
   */
  turn?<T>(run: () => Promise<T>): Promise<T>
  /** The plugin's `fetch`, filtered by the manifest's `networkAccess`; none when unset. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  clientStorage?: PluginClientStorage
  console?: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>
}

/** How a plugin ended: the message it closed with, or the error that stopped it. */
export interface PluginExit {
  message?: string
  error?: string
}

export type PluginEventType =
  | 'run'
  | 'close'
  | 'selectionchange'
  | 'currentpagechange'
  | 'documentchange'
  | 'drop'

export interface PluginSession {
  readonly pluginId: string
  /** Settles once, when the plugin closes itself, is closed, or fails to start. */
  readonly done: Promise<PluginExit>
  readonly running: boolean
  /** A message the window sent with `parent.postMessage({ pluginMessage }, '*')`. */
  receiveFromUI(message: unknown, origin?: string): Promise<void>
  /** Fires a Figma event the plugin may listen for with `figma.on`. */
  emit(type: Exclude<PluginEventType, 'run' | 'close'>, event?: unknown): Promise<void>
  /** Closes the plugin as the window's close button does. */
  close(message?: string): void
}

export interface StartPluginOptions {
  figma: FigmaAPI
  bundle: PluginBundle
  host: PluginHost
  /** The menu command the plugin was started with, as `figma.command`; '' for none. */
  command?: string
  parameters?: Record<string, unknown>
}

/**
 * Host globals a plugin's code does not see. Figma runs plugin code in a realm with no DOM or
 * network beyond its own `fetch`; this names them away, which keeps honest plugins inside the
 * API but is not a security boundary: code that reaches the global object (for example through
 * the `Function` constructor) still can.
 */
const HIDDEN_GLOBALS = [
  'window',
  'self',
  'globalThis',
  'document',
  'parent',
  'top',
  'frames',
  'opener',
  'location',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'importScripts',
  'process',
  'require',
  'Bun',
  'Deno'
] as const

const DEFAULT_UI: PluginUIOptions = {
  visible: true,
  title: '',
  width: 300,
  height: 200,
  themeColors: false
}

type Listener = (...args: unknown[]) => unknown

/** Whether the manifest's `networkAccess.allowedDomains` lets the plugin fetch `url`. */
export function networkAllowed(
  allowedDomains: readonly string[] | undefined,
  url: string
): boolean {
  // Figma lets a plugin without `networkAccess` reach any domain.
  if (allowedDomains === undefined) return true
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return false
  }
  return allowedDomains.some((pattern) => {
    if (pattern === '*') return true
    if (pattern === 'none') return false
    const withScheme = /^[a-z]+:\/\//i.test(pattern) ? pattern : `https://${pattern}`
    let allowed: URL
    try {
      allowed = new URL(withScheme.replace('://*.', '://wildcard.'))
    } catch {
      return false
    }
    const wildcard = withScheme.includes('://*.')
    const host = wildcard ? allowed.hostname.slice('wildcard.'.length) : allowed.hostname
    const hostMatches = wildcard
      ? target.hostname === host || target.hostname.endsWith(`.${host}`)
      : target.hostname === host
    if (!hostMatches) return false
    if (/^[a-z]+:\/\//i.test(pattern) && allowed.protocol !== target.protocol) return false
    if (allowed.port && allowed.port !== target.port) return false
    return allowed.pathname === '/' || target.pathname.startsWith(allowed.pathname)
  })
}

/** In-memory `clientStorage`, for hosts that keep nothing between runs. */
export function memoryClientStorage(): PluginClientStorage {
  const data = new Map<string, unknown>()
  return {
    getAsync: async (key) => (data.has(key) ? structuredClone(data.get(key)) : undefined),
    setAsync: async (key, value) => {
      data.set(key, structuredClone(value))
    },
    deleteAsync: async (key) => {
      data.delete(key)
    },
    keysAsync: async () => [...data.keys()]
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs a Figma plugin's `main` code against `figma`, with `figma.showUI`, `figma.ui`,
 * `figma.on`, `figma.closePlugin`, `figma.notify` and `figma.clientStorage` wired to `host`.
 * The plugin keeps running after its code returns, until it calls `figma.closePlugin()` or the
 * host closes it, as in Figma.
 */
export function startPlugin(options: StartPluginOptions): PluginSession {
  const { figma, bundle, host } = options
  const { manifest } = bundle
  const listeners = new Map<string, Set<Listener>>()
  const once = new WeakSet<Listener>()
  let uiShown = false
  let onmessage: Listener | undefined
  let running = true
  let resolveDone: (exit: PluginExit) => void = () => undefined
  const done = new Promise<PluginExit>((resolve) => {
    resolveDone = resolve
  })
  const log = host.console ?? console

  const turn = <T>(run: () => Promise<T>): Promise<T> => (host.turn ? host.turn(run) : run())

  const finish = (exit: PluginExit) => {
    if (!running) return
    running = false
    for (const listener of listeners.get('close') ?? []) {
      try {
        void listener()
      } catch (error) {
        log.error(error)
      }
    }
    listeners.clear()
    if (uiShown) host.closeUI()
    uiShown = false
    resolveDone(exit)
  }

  const reportHandlerError = (error: unknown) => {
    log.error(error)
    host.notify(`${manifest.name}: ${errorText(error)}`, { error: true })
  }

  const dispatch = async (type: string, args: unknown[]) => {
    const handlers = [...(listeners.get(type) ?? [])]
    if (handlers.length === 0) return
    await turn(async () => {
      for (const handler of handlers) {
        if (once.has(handler)) listeners.get(type)?.delete(handler)
        try {
          await handler(...args)
        } catch (error) {
          reportHandlerError(error)
        }
      }
    })
  }

  const requireRunning = (member: string) => {
    if (!running) throw new Error(`in ${member}: The plugin has closed`)
  }

  const ui = {
    show() {
      requireRunning('figma.ui.show')
      if (uiShown) host.setUIVisible(true)
    },
    hide() {
      if (uiShown) host.setUIVisible(false)
    },
    resize(width: number, height: number) {
      if (!Number.isFinite(width) || !Number.isFinite(height))
        throw new Error('in resize: width and height must be numbers')
      if (uiShown) host.resizeUI(Math.max(70, width), Math.max(0, height))
    },
    reposition(x: number, y: number) {
      if (uiShown) host.repositionUI?.(x, y)
    },
    close() {
      if (uiShown) host.closeUI()
      uiShown = false
    },
    postMessage(message: unknown) {
      requireRunning('figma.ui.postMessage')
      if (!uiShown) throw new Error('in postMessage: The plugin has no UI; call figma.showUI first')
      host.postToUI(structuredClone(message))
    },
    get onmessage() {
      return onmessage
    },
    set onmessage(handler: Listener | undefined) {
      onmessage = typeof handler === 'function' ? handler : undefined
    },
    on(type: string, handler: Listener) {
      if (type === 'message') addListener('ui:message', handler)
    },
    once(type: string, handler: Listener) {
      if (type === 'message') {
        once.add(handler)
        addListener('ui:message', handler)
      }
    },
    off(type: string, handler: Listener) {
      if (type === 'message') listeners.get('ui:message')?.delete(handler)
    }
  }

  function addListener(type: string, handler: Listener) {
    if (typeof handler !== 'function') throw new TypeError(`in on: callback must be a function`)
    let set = listeners.get(type)
    if (!set) listeners.set(type, (set = new Set()))
    set.add(handler)
  }

  const clientStorage = host.clientStorage ?? memoryClientStorage()

  const overrides: Record<string, unknown> = {
    pluginId: manifest.id,
    command: options.command ?? '',
    editorType: 'figma',
    mode: 'default',
    apiVersion: manifest.api,
    ui,
    clientStorage,
    showUI(html: string, uiOptions: Partial<PluginUIOptions> = {}) {
      requireRunning('figma.showUI')
      if (typeof html !== 'string') throw new TypeError('in showUI: html must be a string')
      const resolved: PluginUIOptions = {
        ...DEFAULT_UI,
        title: manifest.name,
        ...uiOptions
      }
      uiShown = true
      host.showUI(html, resolved)
    },
    closePlugin(message?: string) {
      if (message) host.notify(String(message), {})
      finish({ message: message === undefined ? undefined : String(message) })
    },
    notify(message: string, notifyOptions: { timeout?: number; error?: boolean } = {}) {
      host.notify(String(message), notifyOptions)
      return { cancel: () => undefined }
    },
    on(type: string, handler: Listener) {
      addListener(type, handler)
    },
    once(type: string, handler: Listener) {
      once.add(handler)
      addListener(type, handler)
    },
    off(type: string, handler: Listener) {
      listeners.get(type)?.delete(handler)
    }
  }

  const bound = new Map<PropertyKey, unknown>()
  const pluginFigma = new Proxy(figma, {
    get(target, key) {
      if (typeof key === 'string' && Object.hasOwn(overrides, key)) return overrides[key]
      const value: unknown = Reflect.get(target, key, target)
      if (typeof value !== 'function') return value
      let fn = bound.get(key)
      if (fn === undefined || (fn as { original?: unknown }).original !== value) {
        const wrapped = Object.assign((...args: unknown[]) => Reflect.apply(value, target, args), {
          original: value
        })
        bound.set(key, wrapped)
        fn = wrapped
      }
      return fn
    },
    set(target, key, value) {
      if (typeof key === 'string' && Object.hasOwn(overrides, key)) return false
      return Reflect.set(target, key, value, target)
    },
    has(target, key) {
      return (typeof key === 'string' && Object.hasOwn(overrides, key)) || Reflect.has(target, key)
    }
  })

  const files = uiFiles(manifest)
  const uiText = (name: string): string => (Object.hasOwn(bundle.ui, name) ? bundle.ui[name] : '')
  const isRunning = () => running
  const uiByName = Object.fromEntries(Object.keys(files).map((name) => [name, uiText(name)]))
  const html = typeof manifest.ui === 'string' ? uiText('ui') : undefined
  const allowed = manifest.networkAccess?.allowedDomains
  const pluginFetch = async (input: unknown, init?: RequestInit) => {
    let url = ''
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.href
    if (!host.fetch) throw new Error('in fetch: This host gives plugins no network access')
    if (!networkAllowed(allowed, url))
      throw new Error(`in fetch: ${url} is not in the manifest's networkAccess.allowedDomains`)
    return host.fetch(url, init)
  }

  const globals: Record<string, unknown> = Object.fromEntries(
    HIDDEN_GLOBALS.map((name) => [name, undefined])
  )
  globals.__html__ = html
  globals.__uiFiles__ = typeof manifest.ui === 'object' ? uiByName : undefined
  globals.console = log
  globals.fetch = pluginFetch

  let compiled: ((figma: FigmaAPI) => Promise<unknown>) | null = null
  try {
    compiled = compileScript(bundle.code, globals)
  } catch (error) {
    finish({ error: errorText(error) })
  }

  if (compiled) {
    const run = compiled
    void (async () => {
      // The code starts after `startPlugin` returns, so the host holds the session before the
      // plugin's first call reaches it.
      await Promise.resolve()
      try {
        await turn(() => run(pluginFigma))
      } catch (error) {
        log.error(error)
        finish({ error: errorText(error) })
        return
      }
      if (isRunning())
        await dispatch('run', [{ command: options.command ?? '', parameters: options.parameters }])
    })()
  }

  return {
    pluginId: manifest.id,
    done,
    get running() {
      return running
    },
    async receiveFromUI(message, origin = 'null') {
      if (!running) return
      const handlers = [...(onmessage ? [onmessage] : []), ...(listeners.get('ui:message') ?? [])]
      if (handlers.length === 0) return
      const data = structuredClone(message)
      await turn(async () => {
        for (const handler of handlers) {
          if (once.has(handler)) listeners.get('ui:message')?.delete(handler)
          try {
            await handler(data, { origin })
          } catch (error) {
            reportHandlerError(error)
          }
        }
      })
    },
    async emit(type, event) {
      if (!running) return
      await dispatch(type, event === undefined ? [] : [event])
    },
    close(message) {
      finish({ message })
    }
  }
}
