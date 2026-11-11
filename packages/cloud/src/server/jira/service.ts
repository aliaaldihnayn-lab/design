import type {
  JiraConnectionInput,
  JiraConnectionStatus,
  JiraForwardRequest,
  JiraForwardResponse,
  JiraOAuthToken
} from '#cloud/contract'
import type { CloudActor } from '#cloud/server/auth'
import type { CloudDatabase } from '#cloud/server/db'
import { hashCapability } from '#cloud/server/sharing/crypto'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { compactDecrypt, CompactEncrypt } from 'jose'
import { encode } from 'js-base64'
import type { Kysely } from 'kysely'
import * as v from 'valibot'

import { randomHex } from '@lawha/scene-graph/random'

import {
  ATLASSIAN_JIRA_API_URL,
  atlassianAuthorizeURL,
  discoverJiraSite,
  exchangeAuthorizationCode,
  refreshAccessToken,
  type AtlassianOAuthApp,
  type AtlassianTokens
} from './oauth'

const TOKEN_SALT = utf8ToBytes('lawha-cloud-jira-api-token')
const TOKEN_HEADER = { alg: 'dir', enc: 'A256GCM' } as const
/** Jira answers the stories' requests in well under a second; a stuck site must not hold a worker. */
const FORWARD_TIMEOUT_MS = 20_000
/** How long a person has to allow access at Atlassian before the authorization lapses. */
const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000
/** An access token this close to expiring is refreshed before it is used or handed out. */
const OAUTH_REFRESH_MARGIN_MS = 60 * 1000
const OAUTH_STATE_BYTES = 32
/** A page of 100 issues with four fields stays far below this. */
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const jsonSchema = v.pipe(v.string(), v.parseJson())

export type JiraFetch = (input: string, init: RequestInit) => Promise<Response>

export type JiraConnectOutcome =
  | { connection: JiraConnectionStatus }
  | { rejected: number }
  | 'unreachable'
  | 'site'

export interface JiraConnectionService {
  status(actor: CloudActor): Promise<JiraConnectionStatus | null>
  /** Checks the credentials against the site's `/rest/api/3/myself`, then keeps them. */
  connect(actor: CloudActor, input: JiraConnectionInput): Promise<JiraConnectOutcome>
  disconnect(actor: CloudActor): Promise<void>
  /** Sends one request to the person's site as them; null when no site is connected. */
  forward(actor: CloudActor, request: JiraForwardRequest): Promise<JiraForwardResponse | null>
  /** Whether people can connect through Atlassian's OAuth 2.0 (3LO) on this server. */
  readonly oauthAvailable: boolean
  /** The consent page that starts connecting through OAuth; null without an Atlassian app. */
  authorize(actor: CloudActor): Promise<string | null>
  /** Finishes an authorization Atlassian sent back; false for a lapsed or refused one. */
  completeAuthorization(state: string, code: string): Promise<boolean>
  /**
   * A current access token and the site's cloud ID, refreshed first when it is about to expire;
   * null without an OAuth connection or once Atlassian no longer honours it.
   */
  oauthToken(actor: CloudActor): Promise<JiraOAuthToken | null>
}

/**
 * Only Jira Cloud's own hosts: the server makes these requests, so a site address must never
 * point it at anything else on its network.
 */
export function isJiraCloudSite(site: string): boolean {
  let url: URL
  try {
    url = new URL(site)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  return (
    url.protocol === 'https:' &&
    (url.port === '' || url.port === '443') &&
    (/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(host) ||
      /^[a-z0-9][a-z0-9-]*\.jira\.com$/.test(host))
  )
}

function tokenKey(secret: string, userId: string): Uint8Array {
  return hkdf(sha256, utf8ToBytes(secret), TOKEN_SALT, encoder.encode(`jira:${userId}`), 32)
}

const tokenKind = (kind: string) => `jira:${kind}`

async function encryptToken(secret: string, userId: string, token: string): Promise<string> {
  return new CompactEncrypt(encoder.encode(token))
    .setProtectedHeader(TOKEN_HEADER)
    .encrypt(tokenKey(secret, userId))
}

async function decryptToken(secret: string, userId: string, value: string): Promise<string> {
  const { plaintext, protectedHeader } = await compactDecrypt(value, tokenKey(secret, userId))
  if (protectedHeader.alg !== TOKEN_HEADER.alg || protectedHeader.enc !== TOKEN_HEADER.enc) {
    throw new Error('Unsupported Jira token encryption')
  }
  return decoder.decode(plaintext)
}

async function readBody(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('Content-Length') ?? '0')
  if (declared > MAXIMUM_RESPONSE_BYTES) return null
  const text = await response.text()
  if (!text || encoder.encode(text).byteLength > MAXIMUM_RESPONSE_BYTES) return null
  const parsed = v.safeParse(jsonSchema, text)
  return parsed.success ? parsed.output : null
}

function timestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

export function createJiraConnectionService(
  database: Kysely<CloudDatabase>,
  options: { secret: string; fetch?: JiraFetch; oauth?: AtlassianOAuthApp }
): JiraConnectionService {
  const fetcher: JiraFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const oauth = options.oauth
  // OAuth tokens are encrypted under keys of their own, apart from the API token's.
  const sealed = (userId: string, kind: string) => `${userId}:${tokenKind(kind)}`

  async function keepTokens(userId: string, tokens: AtlassianTokens, refreshToken: string) {
    await database
      .updateTable('jiraConnection')
      .set({
        accessTokenEncrypted: await encryptToken(
          options.secret,
          sealed(userId, 'access'),
          tokens.accessToken
        ),
        refreshTokenEncrypted: await encryptToken(
          options.secret,
          sealed(userId, 'refresh'),
          tokens.refreshToken ?? refreshToken
        ),
        accessTokenExpiresAt: tokens.expiresAt,
        updatedAt: new Date()
      })
      .where('userId', '=', userId)
      .where('authKind', '=', 'oauth')
      .execute()
  }

  /** The OAuth connection's access token, refreshed when it is about to run out. */
  async function currentAccess(userId: string) {
    if (!oauth) return null
    const row = await database
      .selectFrom('jiraConnection')
      .select([
        'site',
        'cloudId',
        'accessTokenEncrypted',
        'refreshTokenEncrypted',
        'accessTokenExpiresAt'
      ])
      .where('userId', '=', userId)
      .where('authKind', '=', 'oauth')
      .executeTakeFirst()
    if (!row?.cloudId || !row.accessTokenEncrypted || !row.refreshTokenEncrypted) return null
    const expiresAt = row.accessTokenExpiresAt ? new Date(row.accessTokenExpiresAt) : new Date(0)
    if (expiresAt.getTime() - OAUTH_REFRESH_MARGIN_MS > Date.now()) {
      return {
        site: row.site,
        cloudId: row.cloudId,
        expiresAt,
        accessToken: await decryptToken(
          options.secret,
          sealed(userId, 'access'),
          row.accessTokenEncrypted
        )
      }
    }
    const refreshToken = await decryptToken(
      options.secret,
      sealed(userId, 'refresh'),
      row.refreshTokenEncrypted
    )
    const tokens = await refreshAccessToken(oauth, fetcher, refreshToken)
    if (!tokens) return null
    await keepTokens(userId, tokens, refreshToken)
    return {
      site: row.site,
      cloudId: row.cloudId,
      expiresAt: tokens.expiresAt,
      accessToken: tokens.accessToken
    }
  }

  async function send(
    site: string,
    email: string,
    apiToken: string,
    request: JiraForwardRequest
  ): Promise<JiraForwardResponse> {
    return forward(`${site}${request.path}`, `Basic ${encode(`${email}:${apiToken}`)}`, request)
  }

  /** One call to Jira; a redirect could lead anywhere, and Jira's REST API does not redirect these calls. */
  async function forward(
    url: string,
    authorization: string,
    request: JiraForwardRequest
  ): Promise<JiraForwardResponse> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: authorization
    }
    if (request.body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetcher(url, {
      method: request.method,
      redirect: 'manual',
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body)
    })
    return { status: response.status, body: await readBody(response) }
  }

  async function sendWithToken(
    cloudId: string,
    accessToken: string,
    request: JiraForwardRequest
  ): Promise<JiraForwardResponse> {
    return forward(
      `${ATLASSIAN_JIRA_API_URL}/${encodeURIComponent(cloudId)}${request.path}`,
      `Bearer ${accessToken}`,
      request
    )
  }

  return {
    async status(actor) {
      const row = await database
        .selectFrom('jiraConnection')
        .select(['site', 'email', 'authKind', 'updatedAt'])
        .where('userId', '=', actor.userId)
        .executeTakeFirst()
      return row
        ? {
            kind: row.authKind,
            site: row.site,
            email: row.email,
            updatedAt: timestamp(row.updatedAt)
          }
        : null
    },

    async connect(actor, input) {
      const site = new URL(input.site).origin
      if (!isJiraCloudSite(site)) return 'site'
      let check: JiraForwardResponse
      try {
        check = await send(site, input.email, input.apiToken, {
          method: 'GET',
          path: '/rest/api/3/myself'
        })
      } catch {
        return 'unreachable'
      }
      if (check.status !== 200) return { rejected: check.status }
      const apiTokenEncrypted = await encryptToken(options.secret, actor.userId, input.apiToken)
      const now = new Date()
      await database
        .insertInto('jiraConnection')
        .values({
          userId: actor.userId,
          site,
          email: input.email,
          apiTokenEncrypted,
          authKind: 'token',
          updatedAt: now
        })
        .onConflict((conflict) =>
          conflict.column('userId').doUpdateSet({
            site,
            email: input.email,
            apiTokenEncrypted,
            authKind: 'token',
            cloudId: null,
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
            accessTokenExpiresAt: null,
            updatedAt: now
          })
        )
        .execute()
      return {
        connection: { kind: 'token', site, email: input.email, updatedAt: now.toISOString() }
      }
    },

    async disconnect(actor) {
      await database.deleteFrom('jiraConnection').where('userId', '=', actor.userId).execute()
    },

    async forward(actor, request) {
      const row = await database
        .selectFrom('jiraConnection')
        .select(['site', 'email', 'apiTokenEncrypted', 'authKind'])
        .where('userId', '=', actor.userId)
        .executeTakeFirst()
      if (!row) return null
      if (row.authKind === 'oauth') {
        const access = await currentAccess(actor.userId)
        return access ? sendWithToken(access.cloudId, access.accessToken, request) : null
      }
      if (!row.apiTokenEncrypted || !isJiraCloudSite(row.site)) return null
      const apiToken = await decryptToken(options.secret, actor.userId, row.apiTokenEncrypted)
      return send(row.site, row.email, apiToken, request)
    },

    oauthAvailable: oauth !== undefined,

    async authorize(actor) {
      if (!oauth) return null
      const state = randomHex(OAUTH_STATE_BYTES)
      await database.deleteFrom('jiraOAuthState').where('expiresAt', '<', new Date()).execute()
      await database
        .insertInto('jiraOAuthState')
        .values({
          stateDigest: hashCapability(state),
          userId: actor.userId,
          expiresAt: new Date(Date.now() + OAUTH_STATE_LIFETIME_MS)
        })
        .execute()
      return atlassianAuthorizeURL(oauth, state)
    },

    async completeAuthorization(state, code) {
      if (!oauth) return false
      // Single use: whatever happens next, the state cannot be presented again.
      const pending = await database
        .deleteFrom('jiraOAuthState')
        .where('stateDigest', '=', hashCapability(state))
        .returning(['userId', 'expiresAt'])
        .executeTakeFirst()
      if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) return false
      const tokens = await exchangeAuthorizationCode(oauth, fetcher, code)
      if (!tokens?.refreshToken) return false
      const site = await discoverJiraSite(fetcher, tokens.accessToken)
      if (!site) return false
      const userId = pending.userId
      const now = new Date()
      const values = {
        site: new URL(site.url).origin,
        email: '',
        apiTokenEncrypted: null,
        authKind: 'oauth' as const,
        cloudId: site.id,
        accessTokenEncrypted: await encryptToken(
          options.secret,
          sealed(userId, 'access'),
          tokens.accessToken
        ),
        refreshTokenEncrypted: await encryptToken(
          options.secret,
          sealed(userId, 'refresh'),
          tokens.refreshToken
        ),
        accessTokenExpiresAt: tokens.expiresAt,
        updatedAt: now
      }
      await database
        .insertInto('jiraConnection')
        .values({ userId, ...values })
        .onConflict((conflict) => conflict.column('userId').doUpdateSet(values))
        .execute()
      return true
    },

    async oauthToken(actor) {
      const access = await currentAccess(actor.userId)
      if (!access) return null
      return {
        accessToken: access.accessToken,
        cloudId: access.cloudId,
        site: access.site,
        expiresAt: access.expiresAt.toISOString()
      }
    }
  }
}
