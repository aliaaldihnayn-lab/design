import { computed } from 'vue'

import { createCloudAPIClient, type CloudAPIClient } from '@lawha/cloud/client'

import { homeCloudServer } from '../servers/store'
import {
  cloudAPIClient,
  cloudConnection,
  cloudFetch,
  discoverCloudServer
} from '../sessions/connection'

/**
 * Sending documents for signature goes through the Home server, while someone is signed in
 * there; a signer's page talks to the server that serves it, without signing in.
 */
const homeSignatures = computed(() => {
  const server = homeCloudServer.value
  if (!server) return null
  const { state, discovery } = cloudConnection(server.id)
  return state === 'signed-in' && discovery ? { server, discovery } : null
})

export const cloudSignaturesAvailable = computed(() => homeSignatures.value !== null)

/** The Home server's API for signature requests, or null while nobody is signed in there. */
export function cloudSignatureClient(): CloudAPIClient | null {
  const home = homeSignatures.value
  return home ? cloudAPIClient(home.server, home.discovery) : null
}

/** The API of the server this page came from, for a signer opening their link. */
export async function signingPageClient(): Promise<CloudAPIClient> {
  const discovery = await discoverCloudServer(window.location.origin)
  return createCloudAPIClient(discovery.apiURL, { fetch: cloudFetch })
}
