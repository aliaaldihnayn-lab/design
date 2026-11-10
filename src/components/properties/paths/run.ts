import { ref } from 'vue'

import { ALL_TOOLS, type ToolDef } from '@lawha/core/tools'
import { usePathMessages } from '@lawha/vue/i18n'

import { runEditorTool } from '@/app/ai/tools/runner'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

function toolDef(name: string): ToolDef {
  const def = ALL_TOOLS.find((tool) => tool.name === name)
  if (!def) throw new Error(`Missing tool ${name}`)
  return def
}

/** The layers a path tool reports making. */
function createdIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  if ('created' in result && Array.isArray(result.created))
    return result.created.flatMap((item: unknown) =>
      item && typeof item === 'object' && 'id' in item ? [String(item.id)] : []
    )
  if ('id' in result) return [String(result.id)]
  return []
}

/**
 * Runs the path tools from the panel as one undoable step each, as the AI runs them, selecting
 * what they make and reporting failures in a toast.
 */
export function usePathToolRun() {
  const store = useEditorStore()
  const paths = usePathMessages()
  const busy = ref(false)

  async function run(name: string, args: Record<string, unknown>) {
    if (busy.value) return
    busy.value = true
    try {
      const result = await runEditorTool({
        store,
        figma: makeFigmaFromStore(store),
        def: toolDef(name),
        args,
        source: paths.value.section
      })
      if (result && typeof result === 'object' && 'error' in result)
        throw new Error(String(result.error))
      const created = createdIds(result)
      if (created.length > 0) store.select(created)
      toast.info(paths.value.done({ count: created.length }))
    } catch (error) {
      toast.error(
        paths.value.failed({ error: error instanceof Error ? error.message : String(error) })
      )
    } finally {
      busy.value = false
    }
  }

  return { busy, run }
}
