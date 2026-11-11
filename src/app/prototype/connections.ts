import { useStorage } from '@vueuse/core'

import { ALL_TOOLS, type ToolDef } from '@lawha/core/tools'

import { runEditorTool } from '@/app/ai/tools/runner'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import type { EditorStore } from '@/app/editor/active-store'

/** Whether the canvas draws prototype connections and offers a handle to drag new ones. */
export const showPrototypeConnections = useStorage('lawha:prototype-connections', false)

function tool(name: string): ToolDef {
  const def = ALL_TOOLS.find((item) => item.name === name)
  if (!def) throw new Error(`Missing tool ${name}`)
  return def
}

/**
 * Links a layer to a screen as a noodle dropped on it does in Figma: on click, navigate there.
 * Resolves to an error message when the link could not be made.
 */
export async function linkToScreen(
  store: EditorStore,
  source: string,
  destination: string,
  label: string
): Promise<string | null> {
  const result = await runEditorTool({
    store,
    figma: makeFigmaFromStore(store),
    def: tool('add_interaction'),
    args: {
      id: source,
      trigger: { type: 'click' },
      action: {
        type: 'navigate',
        destination,
        transition: { type: 'dissolve', direction: 'left', duration: 300, easing: 'ease-out' }
      }
    },
    source: label
  })
  return result && typeof result === 'object' && 'error' in result ? String(result.error) : null
}

/** A connection as the canvas names it: the layer it starts from and which interaction it is. */
export interface ConnectionRef {
  source: string
  interaction: number
}

async function editConnection(
  store: EditorStore,
  link: ConnectionRef,
  change: { change: 'remove' } | { change: 'retarget'; destination: string },
  label: string
): Promise<string | null> {
  const result = await runEditorTool({
    store,
    figma: makeFigmaFromStore(store),
    def: tool('edit_connection'),
    args: { id: link.source, interaction: link.interaction, ...change },
    source: label
  })
  return result && typeof result === 'object' && 'error' in result ? String(result.error) : null
}

/** Removes a connection, as deleting a selected noodle does. */
export function removeConnection(
  store: EditorStore,
  link: ConnectionRef,
  label: string
): Promise<string | null> {
  return editConnection(store, link, { change: 'remove' }, label)
}

/** Points a connection at another screen, keeping its trigger, action and transition. */
export function retargetConnection(
  store: EditorStore,
  link: ConnectionRef,
  destination: string,
  label: string
): Promise<string | null> {
  return editConnection(store, link, { change: 'retarget', destination }, label)
}
