import { ref } from 'vue'

import { ALL_TOOLS, type ToolDef } from '@lawha/core/tools'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { runEditorTool } from '@/app/ai/tools/runner'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

function toolDef(name: string): ToolDef {
  const def = ALL_TOOLS.find((tool) => tool.name === name)
  if (!def) throw new Error(`Missing tool ${name}`)
  return def
}

/**
 * Runs the prototype panel's edits as the tools AI and MCP call, so each is one undo step,
 * one at a time; a failure shows as a toast and resolves to null.
 */
export function usePrototypeTools() {
  const store = useEditorStore()
  const t = usePrototypeMessages()
  const busy = ref(false)

  async function run(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (busy.value) return null
    busy.value = true
    try {
      const result = await runEditorTool({
        store,
        figma: makeFigmaFromStore(store),
        def: toolDef(name),
        args,
        source: t.value.section
      })
      if (result && typeof result === 'object' && 'error' in result)
        throw new Error(String(result.error))
      return result
    } catch (error) {
      toast.error(t.value.failed({ error: error instanceof Error ? error.message : String(error) }))
      return null
    } finally {
      busy.value = false
    }
  }

  return { busy, run }
}
