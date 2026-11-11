import * as v from 'valibot'

import { bundleFromFiles, startPlugin } from '#core/figma-api/plugins'
import { defineTool } from '#core/tools/schema'

export const runFigmaPlugin = defineTool({
  name: 'run_figma_plugin',
  description:
    'Run a Figma plugin (its manifest.json, main code and ui HTML, keyed by path) against the document, as Figma runs it: `figma.command` is the given menu command, and each message in `ui_messages` is delivered to `figma.ui.onmessage` in order, as if the plugin window had sent it. Returns how the plugin closed, whether it opened a UI, what it posted to its UI, and its notifications. A plugin that is still running after the messages is closed.',
  execution: { kind: 'async', mutation: 'document' },
  capabilities: ['document:read', 'document:write', 'code:execute'],
  availability: 'eval',
  input: v.strictObject({
    files: v.pipe(
      v.record(v.string(), v.string()),
      v.description('The plugin folder: paths (manifest.json, code.js, ui.html…) to file text')
    ),
    command: v.optional(v.pipe(v.string(), v.description('Menu command, as figma.command')), ''),
    ui_messages: v.optional(
      v.pipe(v.array(v.unknown()), v.description('Messages the plugin window sends, in order')),
      []
    )
  }),
  execute: async (figma, { files, command, ui_messages }) => {
    const read = bundleFromFiles(files)
    if (!read.ok) return { error: read.error }
    const toUI: unknown[] = []
    const notifications: string[] = []
    let ui: { width: number; height: number; title: string } | null = null
    const session = startPlugin({
      figma,
      bundle: read.bundle,
      command,
      host: {
        showUI: (_html, options) => {
          ui = { width: options.width, height: options.height, title: options.title }
        },
        postToUI: (message) => toUI.push(message),
        setUIVisible: () => undefined,
        resizeUI: () => undefined,
        closeUI: () => undefined,
        notify: (message) => notifications.push(message)
      }
    })
    // Let the code and its run event finish before the window "sends" anything.
    await session.ready
    for (const message of ui_messages) {
      if (!session.running) break
      await session.receiveFromUI(message)
    }
    const stillRunning = session.running
    if (stillRunning) session.close()
    const exit = await session.done
    return { exit, closedByPlugin: !stillRunning, ui, postedToUI: toUI, notifications }
  }
})
