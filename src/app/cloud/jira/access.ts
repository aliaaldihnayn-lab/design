import { computed } from 'vue'

import type { CloudAPIClient } from '@lawha/cloud/client'

import { homeCloudServer } from '../servers/store'
import { cloudAPIClient, cloudConnection } from '../sessions/connection'

/**
 * On the web, Jira is reached through the Home server, which keeps the site's API token and
 * forwards the stories' requests, since browsers cannot call Jira with a token themselves.
 */
const homeJira = computed(() => {
  const server = homeCloudServer.value
  if (!server) return null
  const { state, discovery } = cloudConnection(server.id)
  return state === 'signed-in' && discovery ? { server, discovery } : null
})

export const cloudJiraAvailable = computed(() => homeJira.value !== null)

/** The Home server's API for the Jira connection, or null while nobody is signed in there. */
export function cloudJiraClient(): CloudAPIClient | null {
  const home = homeJira.value
  return home ? cloudAPIClient(home.server, home.discovery) : null
}
