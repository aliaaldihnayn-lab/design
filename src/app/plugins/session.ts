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

/** The plugin running now and its window; one plugin runs at a time, as in Figma. */
export interface RunningPlugin {
  bundle: PluginBundle
  session: PluginSession
  /** Set once the plugin calls `figma.showUI`. */
  window: { html: string; options: PluginUIOptions; visible: boolean } | null
  /** Messages to deliver to the window as `{ pluginMessage }`, in order. */
  outbox: unknown[]
}

export const runningPlugin = shallowRef<RunningPlugin | null>(null)

/** Callbacks the window component registers to receive what the plugin sends it. */
let deliver: ((message: unknown) => void) | null = null

export function connectPluginWindow(receive: ((message: unknown) => void) | null): void {
  deliver = receive
  const current = runningPlugin.value
  if (!receive || !current) return
  for (const message of current.outbox.splice(0)) receive(message)
}

function update(patch: Partial<RunningPlugin>): void {
  if (runningPlugin.value) runningPlugin.value = { ...runningPlugin.value, ...patch }
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
  runningPlugin.value?.session.close()
  const figma = makeFigmaFromStore(store)
  const name = bundle.manifest.name
  const session = startPlugin({
    figma,
    bundle,
    command,
    host: {
      showUI(html, options) {
        update({ window: { html, options, visible: options.visible }, outbox: [] })
      },
      postToUI(message) {
        if (deliver) deliver(message)
        else runningPlugin.value?.outbox.push(message)
      },
      setUIVisible(visible) {
        const window = runningPlugin.value?.window
        if (window) update({ window: { ...window, visible } })
      },
      resizeUI(width, height) {
        const window = runningPlugin.value?.window
        if (window) update({ window: { ...window, options: { ...window.options, width, height } } })
      },
      repositionUI(x, y) {
        const window = runningPlugin.value?.window
        if (window)
          update({ window: { ...window, options: { ...window.options, position: { x, y } } } })
      },
      closeUI() {
        update({ window: null })
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
  runningPlugin.value = { bundle, session, window: null, outbox: [] }
  void session.done.then((exit) => {
    if (runningPlugin.value?.session === session) runningPlugin.value = null
    if (exit.error) report.failed(name, exit.error)
    return undefined
  })
  return session
}

export function closeRunningPlugin(): void {
  runningPlugin.value?.session.close()
}
