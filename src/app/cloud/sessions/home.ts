import { computed } from 'vue'

import { homeCloudServer } from '../servers/store'
import { cloudConnection } from './connection'

/**
 * The Home server while someone is signed in there. Features browsers cannot reach on their
 * own, such as Jira and signature requests, go through it.
 */
export const homeCloudSession = computed(() => {
  const server = homeCloudServer.value
  if (!server) return null
  const { state, discovery } = cloudConnection(server.id)
  return state === 'signed-in' && discovery ? { server, discovery } : null
})
