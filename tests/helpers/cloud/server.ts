import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { defaultRelayURL } from '#cloud/contract'
import { attachCollaborationRelay, createPostgresCloudDatabase } from '#cloud/runtime/node'
import { developmentSiteFiles } from '#cloud/runtime/node/site'
import { createCloudServer } from '#cloud/runtime/site/server'
import {
  createBetterAuthAdapter,
  createCloudApp,
  createCloudAuthenticationRuntime,
  createCollaborationRelay,
  createCollaborationStateStore,
  createConfiguredCloudPolicy,
  createInvitationOutbox,
  createTransactionalEmailService,
  migrateCloudDatabase,
  parseCloudServerConfig,
  parseStaticEntitlementsTOML,
  relayDocumentLookups,
  type ObjectStore,
  type StoredObject
} from '#cloud/server'
import type { TransactionalEmailEnvelope } from '#cloud/server/email'
import { getRequestListener } from '@hono/node-server'

const OBJECTS_PATH = '/__test-objects/'

/** A captured email: who it went to, its subject, and every link in its text. */
export type CapturedEmail = { to: string; subject: string; text: string; links: string[] }

function emailLinks(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((match) => match[0])
}

/**
 * An object store kept in memory and served by the test server itself, so browsers upload and
 * download straight to it as they would to S3 through presigned URLs.
 */
function createServedObjectStore(origin: () => string) {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string; checksum: string }>()
  const url = (key: string) => `${origin()}${OBJECTS_PATH}${encodeURIComponent(key)}`
  const store: ObjectStore = {
    capabilities: { nativeSHA256: true, multipartUpload: false, conditionalWrites: false },
    checkReadiness: async () => ({ ok: true, checksumVerification: 'native' }),
    createDownload: async (input) => ({
      url: url(input.key),
      method: 'GET',
      headers: {},
      expiresAt: input.expiresAt.toISOString()
    }),
    createUpload: async (input) => ({
      kind: 'single',
      url: url(input.key),
      method: 'PUT',
      headers: { 'Content-Type': input.contentType, 'x-amz-checksum-sha256': input.checksum },
      expiresAt: input.expiresAt.toISOString()
    }),
    completeUpload: async () => undefined,
    abortUpload: async () => undefined,
    async head(key): Promise<StoredObject | null> {
      const object = objects.get(key)
      if (!object) return null
      return {
        byteSize: object.bytes.byteLength,
        checksum: object.checksum,
        checksumVerification: 'native',
        contentType: object.contentType
      }
    },
    async delete(key) {
      objects.delete(key)
    }
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'ETag'
  }

  /** Answers a request for an object; false when the request is not for one. */
  function serve(request: IncomingMessage, response: ServerResponse): boolean {
    const path = new URL(request.url ?? '/', 'http://objects').pathname
    if (!path.startsWith(OBJECTS_PATH)) return false
    const key = decodeURIComponent(path.slice(OBJECTS_PATH.length))
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders).end()
      return true
    }
    if (request.method === 'PUT') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const bytes = new Uint8Array(Buffer.concat(chunks))
        const checksum = createHash('sha256').update(bytes).digest('base64')
        const expected = request.headers['x-amz-checksum-sha256']
        if (typeof expected === 'string' && expected !== checksum) {
          response.writeHead(400, corsHeaders).end('BadDigest')
          return
        }
        objects.set(key, {
          bytes,
          checksum,
          contentType: request.headers['content-type'] ?? 'application/octet-stream'
        })
        response.writeHead(200, { ...corsHeaders, ETag: `"${checksum}"` }).end()
      })
      return true
    }
    const object = objects.get(key)
    if (!object) {
      response.writeHead(404, corsHeaders).end()
      return true
    }
    response.writeHead(200, { ...corsHeaders, 'Content-Type': object.contentType })
    response.end(request.method === 'HEAD' ? undefined : Buffer.from(object.bytes))
    return true
  }

  return { store, serve }
}

export type CloudTestServer = Awaited<ReturnType<typeof startCloudTestServer>>

/**
 * The PostgreSQL database browser tests run Cloud on, such as
 * `postgresql://lawha@127.0.0.1:5432/lawha_test`; every server empties it first. Better Auth
 * writes in transactions that also queue email, which a single-connection PGlite cannot serve, so
 * these tests need a real server.
 */
export const CLOUD_TEST_DATABASE_URL = process.env.LAWHA_TEST_DATABASE_URL

/**
 * The real Cloud server for browser tests: its API, Better Auth with email and password, the
 * collaboration relay, and the portal pages taken from the editor's development server, on a
 * emptied `CLOUD_TEST_DATABASE_URL` with every migration applied. Emails are captured instead
 * of sent, and object storage is served by the same process.
 */
export async function startCloudTestServer(options: { editorOrigin: string; databaseURL: string }) {
  let origin = ''
  const objects = createServedObjectStore(() => origin)
  let handle: ((request: IncomingMessage, response: ServerResponse) => void) | null = null
  const http = createServer((request, response) => {
    if (objects.serve(request, response)) return
    if (handle) handle(request, response)
    else response.writeHead(503).end()
  })
  await new Promise<void>((resolve) => {
    http.listen(0, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`

  const config = parseCloudServerConfig({
    deployment: 'self-hosted',
    publicURL: origin,
    trustedOrigins: [options.editorOrigin],
    databaseURL: 'postgresql://test:test@localhost/test',
    authSecret: 'browser-test-secret-at-least-32-characters-long',
    s3Endpoint: origin,
    s3Region: 'us-east-1',
    s3Bucket: 'lawha',
    s3AccessKeyId: 'lawha',
    s3SecretAccessKey: 'lawha-secret',
    emailPasswordEnabled: true,
    emailTransport: 'smtp',
    emailFrom: 'Lawha <noreply@lawha.test>',
    smtpHost: '127.0.0.1',
    smtpPort: 2525,
    // What the example deployment grants every workspace.
    staticEntitlements: parseStaticEntitlementsTOML({
      documents: { revision_history: true },
      sharing: { links: true, guest_view: true, guest_edit: true, guest_presence: true },
      collaboration: { enabled: true, maximum_participants: 100 }
    })
  })
  const database = createPostgresCloudDatabase({ connectionString: options.databaseURL })
  // Every migration runs in order on an empty schema, as on a new deployment.
  await database.schema.dropSchema('public').ifExists().cascade().execute()
  await database.schema.createSchema('public').execute()
  const migrationAuth = createBetterAuthAdapter(config, database)
  await migrateCloudDatabase(database, {
    run: migrationAuth.migrate,
    schemaVersion: migrationAuth.schemaVersion
  })

  const emails: CapturedEmail[] = []
  const transport = {
    id: 'test',
    async send(envelope: TransactionalEmailEnvelope) {
      emails.push({
        to: envelope.to,
        subject: envelope.subject,
        text: envelope.text,
        links: emailLinks(envelope.text)
      })
      return { transportMessageId: envelope.deliveryId, acceptedAt: new Date().toISOString() }
    }
  }
  const email = createTransactionalEmailService(database, {
    encryptionSecret: config.authSecret,
    from: config.emailFrom ?? '',
    transport
  })
  const { auth, enrollment } = createCloudAuthenticationRuntime(config, database, email)
  const policy = createConfiguredCloudPolicy(config, database)
  const relay = createCollaborationRelay({
    authSecret: config.authSecret,
    store: createCollaborationStateStore(database),
    maximumMessageBytes: config.technicalLimits.maximumCollaborationMessageBytes,
    maximumConnectionsPerRoom: config.technicalLimits.maximumConnectionsPerRoom,
    ...relayDocumentLookups(database, policy, config.deployment)
  })
  const app = createCloudApp({
    config,
    database,
    auth,
    objects: objects.store,
    invitationOutbox: createInvitationOutbox(email),
    transactionalEmail: email,
    enrollment,
    relayURL: defaultRelayURL(config.publicURL),
    onDocumentRestored: (documentId) => relay.startOver(documentId),
    onDocumentVersionsChanged: (documentId) => relay.announceVersions(documentId)
  })
  const cloudServer = createCloudServer(app, {
    site: developmentSiteFiles(options.editorOrigin),
    indexingPolicy: 'deny'
  })
  const listener = getRequestListener(async (request) => cloudServer.fetch(request))
  handle = (request, response) => {
    void listener(request, response)
  }
  const relayListener = attachCollaborationRelay(
    http,
    relay,
    config.technicalLimits.maximumCollaborationMessageBytes
  )

  /** Sends every queued email into `emails` and returns them. */
  async function deliverEmails(): Promise<CapturedEmail[]> {
    await email.deliverPending({
      batchSize: 50,
      leaseDurationMs: 30_000,
      maximumAttempts: 3
    })
    return emails
  }

  return {
    url: origin,
    app,
    database,
    emails,
    deliverEmails,
    /** The newest email to `address` once it has been sent. */
    async latestEmail(address: string): Promise<CapturedEmail | undefined> {
      await deliverEmails()
      return emails.findLast((message) => message.to.includes(address))
    },
    async close() {
      await relayListener.close()
      http.closeAllConnections()
      await new Promise<void>((resolve) => {
        http.close(() => resolve())
      })
      await database.destroy()
    }
  }
}
