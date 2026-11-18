import { usePathMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

import { useToolRunner } from '../useToolRunner'

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
  const runner = useToolRunner({
    source: () => paths.value.section,
    failed: (error) => paths.value.failed({ error })
  })

  /**
   * Runs a path tool; `quiet` edits a live effect in place, which selects nothing new and needs
   * no toast unless it fails.
   */
  async function run(name: string, args: Record<string, unknown>, { quiet = false } = {}) {
    const result = await runner.run(name, args)
    if (result === null || quiet) return
    const created = createdIds(result)
    if (created.length > 0) store.select(created)
    toast.info(paths.value.done({ count: created.length }))
  }

  return { busy: runner.busy, run }
}
