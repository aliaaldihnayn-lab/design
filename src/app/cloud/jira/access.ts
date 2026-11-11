import { computed } from 'vue'

import type { CloudAPIClient } from '@lawha/cloud/client'

import { cloudAPIClient } from '../sessions/connection'
import { homeCloudSession } from '../sessions/home'

// On the web, Jira is reached through the Home server, which keeps the site's API token and
// forwards the stories' requests, since browsers cannot call Jira with a token themselves.
export const cloudJiraAvailable = computed(() => homeCloudSession.value !== null)

/** The Home server's API for the Jira connection, or null while nobody is signed in there. */
export function cloudJiraClient(): CloudAPIClient | null {
  const home = homeCloudSession.value
  return home ? cloudAPIClient(home.server, home.discovery) : null
}
