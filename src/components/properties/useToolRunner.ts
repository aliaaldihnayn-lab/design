import { ref, toValue, type MaybeRefOrGetter } from 'vue'

import { ALL_TOOLS, type ToolDef } from '@lawha/core/tools'

import { runEditorTool } from '@/app/ai/tools/runner'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

function toolDef(name: string): ToolDef {
  const def = ALL_TOOLS.find((tool) => tool.name === name)
  if (!def) throw new Error(`Missing tool ${name}`)
  return def
}

export interface ToolRunnerOptions {
  /** The panel's name, shown as the source of each edit. */
  source: MaybeRefOrGetter<string>
  /** The toast text for a failure. */
  failed: (error: string) => string
}

/**
 * Runs a panel's edits as the tools AI and MCP call, one at a time, so each is one undo step. A
 * failure shows as a toast and resolves to null.
 */
export function useToolRunner(options: ToolRunnerOptions) {
  const store = useEditorStore()
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
        source: toValue(options.source)
      })
      if (result && typeof result === 'object' && 'error' in result)
        throw new Error(String(result.error))
      return result
    } catch (error) {
      toast.error(options.failed(error instanceof Error ? error.message : String(error)))
      return null
    } finally {
      busy.value = false
    }
  }

  return { busy, run }
}
