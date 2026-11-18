import { useSessionStorage } from '@vueuse/core'
import * as v from 'valibot'

import { storageErrorText, StorageUnavailableError } from '../errors'

/**
 * Google sign-in for Drive storage through Google Identity Services' token client: a popup asks
 * the person once, then the access token (one hour) is kept for this browser session. The scope
 * is `drive.file`, so Lawha sees only the files it created, never the rest of the person's Drive.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
/**
 * Reading and writing Google Docs through the Docs API, asked for only when a person opens a
 * Google Doc in the document editor. It is a sensitive scope: the owner adds it to the OAuth
 * client's Data Access list in Google Auth Platform (HANDOFF.md).
 */
export const GOOGLE_DOCS_SCOPE = 'https://www.googleapis.com/auth/documents'
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client'
const TOKEN_STORAGE_KEY = 'lawha:google-drive-token'
/** Renew a little before Google's expiry, so a long upload does not start on a dying token. */
const EXPIRY_MARGIN_MS = 60_000

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }): TokenClient
  revoke(token: string, done?: () => void): void
}

interface GoogleIdentity {
  accounts: { oauth2: GoogleOAuth2 }
}

const storedTokenSchema = v.object({
  clientId: v.string(),
  /** The scopes the token was granted for; tokens from before scopes were kept are Drive's. */
  scope: v.optional(v.string(), DRIVE_SCOPE),
  token: v.string(),
  expiresAt: v.number()
})

let scriptLoading: Promise<GoogleIdentity> | null = null

function googleIdentity(): GoogleIdentity | null {
  const google: unknown = Reflect.get(window, 'google')
  if (typeof google !== 'object' || google === null || !('accounts' in google)) return null
  return google as GoogleIdentity
}

/** Loads Google Identity Services once; it is only fetched when Drive storage is used. */
function loadIdentityServices(): Promise<GoogleIdentity> {
  const ready = googleIdentity()
  if (ready) return Promise.resolve(ready)
  scriptLoading ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SCRIPT
    script.async = true
    script.onload = () => {
      const loaded = googleIdentity()
      if (loaded) resolve(loaded)
      else reject(new Error(storageErrorText((t) => t.googleSignInDidNotLoad)))
    }
    script.onerror = () => reject(new Error(storageErrorText((t) => t.googleSignInUnreachable)))
    document.head.append(script)
  })
  scriptLoading.catch(() => {
    scriptLoading = null
  })
  return scriptLoading
}

/** The token for this browser session only; it is gone when the tab closes. */
const storedToken = useSessionStorage<string | null>(TOKEN_STORAGE_KEY, null)
/** The Google Docs token is kept apart, so Drive storage never holds the wider scope. */
const storedDocsToken = useSessionStorage<string | null>(`${TOKEN_STORAGE_KEY}:docs`, null)

const tokenStore = (scope: string) => (scope === DRIVE_SCOPE ? storedToken : storedDocsToken)

function readStoredToken(clientId: string, scope: string): string | null {
  const raw = tokenStore(scope).value
  if (!raw) return null
  const parsed = v.safeParse(v.pipe(v.string(), v.parseJson(), storedTokenSchema), raw)
  if (!parsed.success || parsed.output.clientId !== clientId || parsed.output.scope !== scope) {
    return null
  }
  return parsed.output.expiresAt - EXPIRY_MARGIN_MS > Date.now() ? parsed.output.token : null
}

function storeToken(clientId: string, scope: string, token: string, expiresInSeconds: number) {
  tokenStore(scope).value = JSON.stringify({
    clientId,
    scope,
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000
  })
}

export function forgetDriveToken(scope = DRIVE_SCOPE): void {
  tokenStore(scope).value = null
}

/**
 * A Drive access token. With `interactive`, Google's popup asks the person when there is no
 * valid token (call it from a click, or browsers block the popup); without, background work
 * waits until the person reconnects.
 */
export async function driveAccessToken(
  clientId: string,
  interactive: boolean,
  scope: string = DRIVE_SCOPE
): Promise<string> {
  const stored = readStoredToken(clientId, scope)
  if (stored) return stored
  if (!interactive) {
    throw new StorageUnavailableError(storageErrorText((t) => t.googleDriveSignInAgain))
  }
  const google = await loadIdentityServices()
  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? 'Google sign-in failed'))
          return
        }
        storeToken(clientId, scope, response.access_token, response.expires_in ?? 3600)
        resolve(response.access_token)
      },
      error_callback: (error) => {
        reject(new Error(error.message ?? error.type ?? 'Google sign-in was closed'))
      }
    })
    client.requestAccessToken({ prompt: '' })
  })
}
