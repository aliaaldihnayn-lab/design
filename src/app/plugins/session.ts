import { shallowRef } from 'vue'

import type { FigmaAPI } from '@lawha/core/figma-api'
import {
  startPlugin,
  type PluginBundle,
  type PluginSession,
  type PluginUIOptions
} from '@lawha/core/figma-api/plugins'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import type { EditorStore } from '@/app/editor/active-store'
import { pluginClientStorage } from '@/app/plugins/library'

/** A plugin running now and its window. Plugins run side by side, each in its own interpreter. */
export interface RunningPlugin {
  /** Stable for the run, for keying its window. */
  key: number
  bundle: PluginBundle
  session: PluginSession
  /** Set once the plugin calls `figma.showUI`. */
  window: { html: string; options: PluginUIOptions; visible: boolean } | null
  /** Messages to deliver to the window as `{ pluginMessage }`, in order. */
  outbox: unknown[]
}

/** Running plugins, in the order they started; one instance per plugin id, as in Figma. */
export const runningPlugins = shallowRef<RunningPlugin[]>([])

let nextKey = 1

/** Each plugin window's receiver for what its plugin sends it, by session. */
const receivers = new WeakMap<PluginSession, (message: unknown) => void>()

/** Connects a plugin's window frame, delivering the messages that waited for it. */
export function connectPluginWindow(
  session: PluginSession,
  receive: ((message: unknown) => void) | null
): void {
  if (!receive) {
    receivers.delete(session)
    return
  }
  receivers.set(session, receive)
  const current = runningPlugins.value.find((plugin) => plugin.session === session)
  if (!current) return
  for (const message of current.outbox.splice(0)) receive(message)
}

function update(session: PluginSession, patch: (plugin: RunningPlugin) => Partial<RunningPlugin>) {
  runningPlugins.value = runningPlugins.value.map((plugin) =>
    plugin.session === session ? { ...plugin, ...patch(plugin) } : plugin
  )
}

function current(session: PluginSession): RunningPlugin | undefined {
  return runningPlugins.value.find((plugin) => plugin.session === session)
}

function selectionFromStore(figma: FigmaAPI, store: EditorStore): void {
  figma.currentPage.selection = [...store.state.selectedIds]
    .map((id) => figma.getNodeById(id))
    .filter((node): node is NonNullable<typeof node> => node !== null)
}

export interface PluginRunReport {
  notify: (message: string, error: boolean) => void
  failed: (name: string, error: string) => void
}

/**
 * Starts a plugin on the active document, closing any plugin already running. Each turn of
 * plugin code is one undo step, sees the selection on screen, and leaves its selection there.
 */
export function runPlugin(
  store: EditorStore,
  bundle: PluginBundle,
  command: string,
  report: PluginRunReport
): PluginSession {
  // Running a plugin again restarts it; other plugins keep running.
  for (const plugin of runningPlugins.value)
    if (plugin.bundle.manifest.id === bundle.manifest.id) plugin.session.close()
  const figma = makeFigmaFromStore(store)
  const name = bundle.manifest.name
  // The session is assigned before the plugin's code runs, which starts after `startPlugin`.
  let self: PluginSession | null = null
  const withWindow = (
    patch: (window: NonNullable<RunningPlugin['window']>) => RunningPlugin['window']
  ) => {
    if (!self) return
    update(self, (plugin) => ({ window: plugin.window ? patch(plugin.window) : null }))
  }
  const session = startPlugin({
    figma,
    bundle,
    command,
    host: {
      showUI(html, options) {
        if (self)
          update(self, () => ({ window: { html, options, visible: options.visible }, outbox: [] }))
      },
      postToUI(message) {
        if (!self) return
        const receive = receivers.get(self)
        if (receive) receive(message)
        else current(self)?.outbox.push(message)
      },
      setUIVisible(visible) {
        withWindow((window) => ({ ...window, visible }))
      },
      resizeUI(width, height) {
        withWindow((window) => ({ ...window, options: { ...window.options, width, height } }))
      },
      repositionUI(x, y) {
        withWindow((window) => ({ ...window, options: { ...window.options, position: { x, y } } }))
      },
      closeUI() {
        if (self) update(self, () => ({ window: null }))
      },
      notify(message, options) {
        report.notify(message, options.error === true)
      },
      clientStorage: pluginClientStorage(bundle.manifest.id),
      fetch: (input, init) => fetch(input, init),
      turn: (run) =>
        store.recordEditAsync(
          { label: `Plugin: ${name}`, pageId: store.state.currentPageId },
          async () => {
            selectionFromStore(figma, store)
            try {
              return await run()
            } finally {
              const ids = figma.currentPage.selection.map((node) => node.id)
              store.select(ids.filter((id) => store.graph.getNode(id)))
              store.requestRender()
            }
          }
        )
    }
  })
  self = session
  runningPlugins.value = [
    ...runningPlugins.value,
    { key: nextKey++, bundle, session, window: null, outbox: [] }
  ]
  void session.done.then((exit) => {
    receivers.delete(session)
    runningPlugins.value = runningPlugins.value.filter((plugin) => plugin.session !== session)
    if (exit.error) report.failed(name, exit.error)
    return undefined
  })
  return session
}

/** Closes one running plugin, as its window's close button does. */
export function closeRunningPlugin(session: PluginSession): void {
  session.close()
}
