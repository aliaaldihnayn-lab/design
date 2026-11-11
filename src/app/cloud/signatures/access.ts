import { computed } from 'vue'

import { createCloudAPIClient, type CloudAPIClient } from '@lawha/cloud/client'

import { cloudAPIClient, cloudFetch, discoverCloudServer } from '../sessions/connection'
import { homeCloudSession } from '../sessions/home'

// Sending documents for signature goes through the Home server, while someone is signed in
// there; a signer's page talks to the server that serves it, without signing in.
export const cloudSignaturesAvailable = computed(() => homeCloudSession.value !== null)

/** The Home server's API for signature requests, or null while nobody is signed in there. */
export function cloudSignatureClient(): CloudAPIClient | null {
  const home = homeCloudSession.value
  return home ? cloudAPIClient(home.server, home.discovery) : null
}

/** The API of the server this page came from, for a signer opening their link. */
export async function signingPageClient(): Promise<CloudAPIClient> {
  const discovery = await discoverCloudServer(window.location.origin)
  return createCloudAPIClient(discovery.apiURL, { fetch: cloudFetch })
}
