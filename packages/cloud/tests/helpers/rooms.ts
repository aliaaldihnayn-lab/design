import { createCloudTestDatabase } from '#cloud-tests/helpers/database'
import { createMemoryObjectStore } from '#cloud-tests/helpers/objects'
import { responseJSON } from '#cloud-tests/helpers/response'
import { createdRoomInvitationSchema, roomSummarySchema, roomTreeSchema } from '#cloud/contract'
import {
  createBetterAuthAdapter,
  createCloudApp,
  parseCloudServerConfig,
  type CloudActor
} from '#cloud/server'
import type { EnqueueTransactionalEmailInput, TransactionalEmailService } from '#cloud/server/email'
import * as v from 'valibot'

const config = parseCloudServerConfig({
  deployment: 'self-hosted',
  publicURL: 'https://cloud.example.com',
  trustedOrigins: ['https://app.example.com'],
  databaseURL: 'postgresql://test:test@localhost/test',
  authSecret: 'integration-test-secret-at-least-32-characters',
  s3Endpoint: 'http://localhost:9000',
  s3Region: 'us-east-1',
  s3Bucket: 'lawha',
  s3AccessKeyId: 'lawha',
  s3SecretAccessKey: 'lawha-secret'
})

export const people = {
  alice: { userId: crypto.randomUUID(), email: 'alice@example.com', name: 'Alice' },
  bob: { userId: crypto.randomUUID(), email: 'bob@example.com', name: 'Bob' },
  carol: { userId: crypto.randomUUID(), email: 'carol@example.com', name: 'Carol' },
  dave: { userId: crypto.randomUUID(), email: 'dave@example.com', name: 'Dave' }
} satisfies Record<string, CloudActor>

const roomResponseSchema = v.object({ room: roomSummarySchema })
export const documentResponseSchema = v.object({
  document: v.object({ id: v.string(), workspaceId: v.string() })
})

/**
 * A Cloud app on a fresh database whose requests act as whoever `as` names, with Alice's
 * workspace (Bob an editor in it) and helpers for rooms and invitations.
 */
export async function roomTestApp() {
  const runtime = await createCloudTestDatabase()
  await runtime.database
    .insertInto('user')
    .values(
      Object.values(people).map((person) => ({
        id: person.userId,
        name: person.name,
        email: person.email,
        emailVerified: true,
        image: null
      }))
    )
    .execute()
  const sent: Array<EnqueueTransactionalEmailInput<'room-invitation'>> = []
  const email: TransactionalEmailService = {
    enqueue: async (input) => {
      if (input.kind === 'room-invitation') {
        sent.push(input as EnqueueTransactionalEmailInput<'room-invitation'>)
      }
      return crypto.randomUUID()
    },
    deliverPending: async () => ({ claimed: 0, accepted: 0, retrying: 0, failed: 0, suppressed: 0 })
  }
  let actor: CloudActor = people.alice
  const app = createCloudApp({
    config,
    database: runtime.database,
    auth: createBetterAuthAdapter(config, runtime.database),
    objects: createMemoryObjectStore().store,
    transactionalEmail: email,
    resolveSession: async () => actor
  })
  const as = (person: CloudActor) => {
    return (path: string, init?: { method?: string; json?: unknown }) => {
      actor = person
      return app.request(path, {
        method: init?.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', Origin: config.publicURL },
        body: init?.json === undefined ? undefined : JSON.stringify(init.json)
      })
    }
  }
  /** Alice's workspace, where Bob is an editor; Carol and Dave are in no workspace. */
  const created = await responseJSON(
    await as(people.alice)('/api/workspaces', { method: 'POST', json: { name: 'Studio' } }),
    v.object({ workspace: v.object({ id: v.string() }) })
  )
  const workspaceId = created.workspace.id
  await runtime.database
    .insertInto('workspaceMember')
    .values({ workspaceId, userId: people.bob.userId, role: 'editor' })
    .execute()
  const createRoom = async (
    person: CloudActor,
    json: { name: string; parentId?: string; accessMode?: 'inherit' | 'restricted' }
  ) =>
    (
      await responseJSON(
        await as(person)('/api/rooms', {
          method: 'POST',
          json: json.parentId ? json : { ...json, workspaceId }
        }),
        roomResponseSchema
      )
    ).room
  const invite = async (person: CloudActor, roomId: string, json: object) =>
    responseJSON(
      await as(person)(`/api/rooms/${roomId}/invitations`, { method: 'POST', json }),
      createdRoomInvitationSchema
    )
  const accept = (person: CloudActor, url: string) => {
    const link = new URL(url)
    return as(person)(`/api/invitations/${link.pathname.split('/').at(-1)}/accept`, {
      method: 'POST',
      json: { token: link.hash.slice(1) }
    })
  }
  const treeOf = async (person: CloudActor) =>
    (await responseJSON(await as(person)('/api/rooms'), roomTreeSchema)).rooms
  return { runtime, as, sent, workspaceId, createRoom, invite, accept, treeOf }
}
