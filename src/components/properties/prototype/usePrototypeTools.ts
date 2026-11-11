import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useToolRunner } from '../useToolRunner'

/** Runs the prototype panel's edits as the tools AI and MCP call. */
export function usePrototypeTools() {
  const t = usePrototypeMessages()
  return useToolRunner({
    source: () => t.value.section,
    failed: (error) => t.value.failed({ error })
  })
}
