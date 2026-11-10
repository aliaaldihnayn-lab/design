import { createGlobalState, useIntervalFn } from '@vueuse/core'
import { computed, ref, shallowRef, watch } from 'vue'

import {
  applyJiraUpdates,
  getJiraConnection,
  pullFromJira,
  pushToJira,
  type JiraScope,
  type JiraSyncResult
} from '@lawha/core/stories'
import { readStoryJiraProject } from '@lawha/scene-graph/stories'

import { useActiveEditorStoreRef } from '@/app/editor/active-store'
import { jiraConnected, jiraPreferences } from '@/app/integrations/jira/connection'

/** How often linked stories read their status back from Jira while the document is open. */
export const JIRA_PULL_INTERVAL_MS = 5 * 60 * 1000

/** Counts of what one sync did, for the panel. */
export interface JiraSyncSummary {
  created: number
  updated: number
  pulled: number
  failed: number
  /** The first failure's message, from Jira when it gave one. */
  firstError?: string
}

export function summarizeJiraSync(result: JiraSyncResult): JiraSyncSummary {
  const count = (action: string) => result.items.filter((item) => item.action === action).length
  return {
    created: count('created'),
    updated: count('updated'),
    pulled: count('pulled'),
    failed: count('failed'),
    firstError: result.items.find((item) => item.action === 'failed')?.error
  }
}

/**
 * Pushing the active document's stories to Jira and reading their status back, on demand and
 * every few minutes. Links and statuses are written into the document without an undo step, as
 * comments are: undoing them would forget issues that stay in Jira, and pushing again would
 * create them twice.
 */
export const useJiraSync = createGlobalState(() => {
  const storeRef = useActiveEditorStoreRef()
  const busy = ref(false)
  const lastSummary = shallowRef<JiraSyncSummary | null>(null)
  const lastError = ref<string | null>(null)

  /** The document's own project, or the one chosen in Settings. */
  const projectKey = computed(() => {
    void storeRef.value.state.sceneVersion
    return (
      readStoryJiraProject(storeRef.value.graph)?.projectKey ?? jiraPreferences.value.projectKey
    )
  })

  const ready = computed(() => jiraConnected.value === true && !!projectKey.value)

  async function run(work: () => Promise<JiraSyncResult>): Promise<JiraSyncSummary | null> {
    if (busy.value) return null
    busy.value = true
    lastError.value = null
    const store = storeRef.value
    try {
      const result = await work()
      applyJiraUpdates(store.graph, result.updates)
      if (result.updates.length > 0) store.requestRender()
      const summary = summarizeJiraSync(result)
      lastSummary.value = summary
      return summary
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      busy.value = false
    }
  }

  /** Creates or updates the issues for the stories in scope, then reads their status. */
  function push(scope: JiraScope = {}) {
    const connection = getJiraConnection()
    const key = projectKey.value
    if (!connection || !key) return Promise.resolve(null)
    const graph = storeRef.value.graph
    return run(() =>
      pushToJira(graph, connection.client, { ...scope, site: connection.site, projectKey: key })
    )
  }

  /** Reads the status and assignee of the linked stories in scope. */
  function pull(scope: JiraScope = {}) {
    const connection = getJiraConnection()
    if (!connection) return Promise.resolve(null)
    const graph = storeRef.value.graph
    return run(() => pullFromJira(graph, connection.client, scope))
  }

  const pulling = useIntervalFn(
    () => {
      if (!document.hidden) void pull({ rootIds: [storeRef.value.state.currentPageId] })
    },
    JIRA_PULL_INTERVAL_MS,
    { immediate: false }
  )
  watch(
    () => jiraConnected.value === true,
    (connected) => (connected ? pulling.resume() : pulling.pause()),
    { immediate: true }
  )

  return { busy, ready, projectKey, lastSummary, lastError, push, pull }
})
