import { useSessionStorage } from '@vueuse/core'
import { computed, ref, shallowRef, watch, type Ref } from 'vue'

import { CloudAPIError, type CloudAPIClient } from '@lawha/cloud/client'
import type {
  CreateRoomInput,
  RoomAccessMode,
  RoomAudit,
  RoomDetail,
  CloudDocumentKind,
  RoomFile,
  RoomMemberRole,
  RoomMembers,
  RoomSummary
} from '@lawha/cloud/contract'

import { createDocumentTab, openStorageDocumentInNewTab } from '@/app/tabs'
import { openStoredWriterDocument, startStoredWriterDocument } from '@/app/writer/storage'
import { IS_BROWSER } from '@/constants'

import { findCloudServer } from '../servers/store'
import { cloudAPIClient, cloudConnection } from '../sessions/connection'
import { CLOUD_STORAGE_PROVIDER_ID } from '../sessions/token'

/** Why a room change did not go through, in terms the room pages explain. */
export type RoomFailure = 'forbidden' | 'not-found' | 'invalid' | 'already-member' | 'unavailable'

export function roomFailureOf(error: unknown): RoomFailure {
  if (!(error instanceof CloudAPIError)) return 'unavailable'
  if (error.code === 'already_member') return 'already-member'
  if (error.status === 403) return 'forbidden'
  if (error.status === 404) return 'not-found'
  if (error.status === 422) return 'invalid'
  return 'unavailable'
}

/** The room Home shows, kept for the tab so a reload returns to it. */
export const selectedCloudRoom = IS_BROWSER
  ? useSessionStorage<string | null>('lawha:cloud-room', null)
  : ref<string | null>(null)

/** Shows a room on Home's Rooms page, such as one an invitation just let the person into. */
export function showCloudRoom(roomId: string): void {
  selectedCloudRoom.value = roomId
}

export type RoomPageState = 'idle' | 'loading' | 'ready' | 'no-access' | 'error'

function roomClient(serverId: string): CloudAPIClient | null {
  const server = findCloudServer(serverId)
  const discovery = server ? cloudConnection(server.id).discovery : null
  return server && discovery ? cloudAPIClient(server, discovery) : null
}

/**
 * The rooms of one server for Home: the tree the person may see, the room they opened with its
 * files and sub-rooms, and every change they can make. The server checks each change; a refusal
 * comes back as a `RoomFailure`.
 */
export function useCloudRooms(serverId: Ref<string>) {
  const rooms = shallowRef<RoomSummary[]>([])
  const treeState = ref<'loading' | 'ready' | 'error'>('loading')
  const showArchived = ref(false)
  const detail = shallowRef<RoomDetail | null>(null)
  const pageState = ref<RoomPageState>('idle')
  const members = shallowRef<RoomMembers | null>(null)
  const audit = shallowRef<RoomAudit | null>(null)
  const busy = ref(false)
  const failure = ref<RoomFailure | null>(null)
  /** The link of the invitation just sent, for when the server sends no email. */
  const invitationLink = ref<string | null>(null)

  const client = () => roomClient(serverId.value)

  async function refreshTree(): Promise<void> {
    const api = client()
    if (!api) return
    if (rooms.value.length === 0) treeState.value = 'loading'
    try {
      rooms.value = await api.listRooms({ archived: showArchived.value })
      treeState.value = 'ready'
    } catch {
      treeState.value = 'error'
    }
  }

  async function loadRoom(roomId: string | null): Promise<void> {
    const api = client()
    if (!roomId || !api) {
      detail.value = null
      pageState.value = 'idle'
      return
    }
    if (detail.value?.room.id !== roomId) {
      detail.value = null
      pageState.value = 'loading'
    }
    try {
      const loaded = await api.getRoom(roomId)
      // A slower earlier read never replaces the room opened since.
      if (selectedCloudRoom.value !== roomId) return
      detail.value = loaded
      pageState.value = 'ready'
    } catch (error) {
      if (selectedCloudRoom.value !== roomId) return
      detail.value = null
      pageState.value = roomFailureOf(error) === 'not-found' ? 'no-access' : 'error'
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshTree(), loadRoom(selectedCloudRoom.value)])
  }

  watch(serverId, () => {
    rooms.value = []
    void refresh()
  })
  watch(showArchived, () => void refreshTree())
  watch(selectedCloudRoom, (roomId) => {
    members.value = null
    audit.value = null
    void loadRoom(roomId)
  })

  /** Runs a change, then reads the tree and the open room again. */
  async function change<T>(action: (api: CloudAPIClient) => Promise<T>): Promise<T | null> {
    const api = client()
    if (!api || busy.value) return null
    busy.value = true
    failure.value = null
    try {
      const result = await action(api)
      await refresh()
      return result
    } catch (error) {
      failure.value = roomFailureOf(error)
      return null
    } finally {
      busy.value = false
    }
  }

  async function loadMembers(): Promise<void> {
    const roomId = selectedCloudRoom.value
    const api = client()
    if (!roomId || !api) return
    try {
      members.value = await api.listRoomMembers(roomId)
      audit.value = detail.value?.room.role === 'owner' ? await api.getRoomAudit(roomId) : null
    } catch (error) {
      failure.value = roomFailureOf(error)
    }
  }

  /** A membership change, followed by the member list and audit trail again. */
  async function changeMembers(action: (api: CloudAPIClient, roomId: string) => Promise<unknown>) {
    const roomId = selectedCloudRoom.value
    if (!roomId) return false
    const done = await change((api) => action(api, roomId).then(() => true))
    if (done) await loadMembers()
    return done === true
  }

  function locationOf(workspaceId: string) {
    return {
      providerId: CLOUD_STORAGE_PROVIDER_ID,
      profileId: serverId.value,
      containerId: workspaceId
    }
  }

  return {
    rooms,
    treeState,
    showArchived,
    detail,
    pageState,
    members,
    audit,
    busy,
    failure,
    invitationLink,
    selected: computed(() => selectedCloudRoom.value),
    refresh,
    select(roomId: string | null) {
      failure.value = null
      selectedCloudRoom.value = roomId
    },
    clearFailure() {
      failure.value = null
    },

    async create(input: CreateRoomInput): Promise<boolean> {
      const room = await change((api) => api.createRoom(input))
      if (room) selectedCloudRoom.value = room.id
      return room !== null
    },
    async rename(roomId: string, name: string) {
      return (await change((api) => api.updateRoom(roomId, { name }))) !== null
    },
    async setAccess(roomId: string, accessMode: RoomAccessMode) {
      const done = (await change((api) => api.updateRoom(roomId, { accessMode }))) !== null
      if (done) await loadMembers()
      return done
    },
    async setArchived(roomId: string, archived: boolean) {
      const done = (await change((api) => api.updateRoom(roomId, { archived }))) !== null
      if (done && archived && selectedCloudRoom.value === roomId) selectedCloudRoom.value = null
      return done
    },
    async move(roomId: string, parentId: string | null) {
      return (await change((api) => api.moveRoom(roomId, parentId))) !== null
    },
    async moveFile(documentId: string, roomId: string) {
      return (await change((api) => api.addRoomFile(roomId, documentId))) !== null
    },
    async removeFile(roomId: string, documentId: string) {
      return (
        (await change((api) => api.removeRoomFile(roomId, documentId).then(() => true))) !== null
      )
    },

    /**
     * Opens a room's file with Cloud's own document loading, in a tab of its own; a text
     * document opens in the document editor, and `'writer'` says the caller should show it.
     */
    async openFile(file: RoomFile): Promise<'canvas' | 'writer'> {
      const { document } = file
      if (document.kind === 'writer') {
        const outcome = await openStoredWriterDocument(
          { ...locationOf(document.workspaceId), documentId: document.id },
          document.name
        )
        if (outcome.status === 'failed') failure.value = 'unavailable'
        return 'writer'
      }
      // Opening reports its own failure.
      void openStorageDocumentInNewTab(
        {
          id: document.id,
          name: document.name,
          updatedAt: document.updatedAt,
          revision: document.currentRevisionId
        },
        locationOf(document.workspaceId)
      ).catch(() => undefined)
      return 'canvas'
    },

    /**
     * Makes a design or a board in the room on the server, then opens it in a new tab bound to
     * that document, so its first save lands in the room even for someone outside the workspace.
     */
    async createFile(roomId: string, kind: CloudDocumentKind, name: string): Promise<boolean> {
      const document = await change((api) => api.createRoomDocument(roomId, { name, kind }))
      if (!document) return false
      if (kind === 'writer') {
        // Its first save makes the file's first revision, a Word document, in the room.
        startStoredWriterDocument(
          { ...locationOf(document.workspaceId), documentId: document.id },
          document.name
        )
        return true
      }
      const { store } = createDocumentTab(kind)
      store.setStorageDocumentSource(
        { ...locationOf(document.workspaceId), documentId: document.id },
        document.name
      )
      // Saved at once, so the room's file has a revision to open from the start.
      void store.saveFigFile()
      return true
    },

    loadMembers,
    async invite(email: string, role: RoomMemberRole) {
      invitationLink.value = null
      return changeMembers(async (api, roomId) => {
        invitationLink.value = (await api.inviteToRoom(roomId, { email, role })).acceptanceURL
      })
    },
    revoke: (invitationId: string) =>
      changeMembers((api, roomId) => api.revokeRoomInvitation(roomId, invitationId)),
    changeRole: (userId: string, role: RoomMemberRole) =>
      changeMembers((api, roomId) => api.updateRoomMember(roomId, userId, role)),
    removeMember: (userId: string) =>
      changeMembers((api, roomId) => api.removeRoomMember(roomId, userId)),
    transfer: (userId: string) => changeMembers((api, roomId) => api.transferRoom(roomId, userId)),
    async leave(roomId: string) {
      const done = (await change((api) => api.leaveRoom(roomId).then(() => true))) !== null
      if (done) selectedCloudRoom.value = null
      return done
    }
  }
}

export type CloudRooms = ReturnType<typeof useCloudRooms>
