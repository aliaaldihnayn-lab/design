import type {
  JiraConnectionInput,
  JiraConnectionStatus,
  JiraForwardRequest,
  JiraForwardResponse
} from '#cloud/contract'
import type { CloudActor } from '#cloud/server/auth'
import type { CloudDatabase } from '#cloud/server/db'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { compactDecrypt, CompactEncrypt } from 'jose'
import { encode } from 'js-base64'
import type { Kysely } from 'kysely'
import * as v from 'valibot'

const TOKEN_SALT = utf8ToBytes('lawha-cloud-jira-api-token')
const TOKEN_HEADER = { alg: 'dir', enc: 'A256GCM' } as const
/** Jira answers the stories' requests in well under a second; a stuck site must not hold a worker. */
const FORWARD_TIMEOUT_MS = 20_000
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
  options: { secret: string; fetch?: JiraFetch }
): JiraConnectionService {
  const fetcher: JiraFetch = options.fetch ?? ((input, init) => fetch(input, init))

  async function send(
    site: string,
    email: string,
    apiToken: string,
    request: JiraForwardRequest
  ): Promise<JiraForwardResponse> {
    const response = await fetcher(`${site}${request.path}`, {
      method: request.method,
      // A redirect could lead anywhere; Jira's REST API does not redirect these calls.
      redirect: 'manual',
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${encode(`${email}:${apiToken}`)}`,
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body)
    })
    return { status: response.status, body: await readBody(response) }
  }

  return {
    async status(actor) {
      const row = await database
        .selectFrom('jiraConnection')
        .select(['site', 'email', 'updatedAt'])
        .where('userId', '=', actor.userId)
        .executeTakeFirst()
      return row ? { site: row.site, email: row.email, updatedAt: timestamp(row.updatedAt) } : null
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
          updatedAt: now
        })
        .onConflict((conflict) =>
          conflict
            .column('userId')
            .doUpdateSet({ site, email: input.email, apiTokenEncrypted, updatedAt: now })
        )
        .execute()
      return { connection: { site, email: input.email, updatedAt: now.toISOString() } }
    },

    async disconnect(actor) {
      await database.deleteFrom('jiraConnection').where('userId', '=', actor.userId).execute()
    },

    async forward(actor, request) {
      const row = await database
        .selectFrom('jiraConnection')
        .select(['site', 'email', 'apiTokenEncrypted'])
        .where('userId', '=', actor.userId)
        .executeTakeFirst()
      if (!row || !isJiraCloudSite(row.site)) return null
      const apiToken = await decryptToken(options.secret, actor.userId, row.apiTokenEncrypted)
      return send(row.site, row.email, apiToken, request)
    }
  }
}
