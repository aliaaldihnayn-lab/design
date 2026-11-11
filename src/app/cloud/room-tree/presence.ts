import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'

import { ROOM_PRESENCE_INTERVAL_MS, type RoomPresence } from '@lawha/cloud/contract'

import { findCloudServer } from '../servers/store'
import { cloudAPIClient, cloudConnection } from '../sessions/connection'

/**
 * Who is in a room now. Cloud has no realtime channel outside a document's relay room, so the
 * page checks in every `ROOM_PRESENCE_INTERVAL_MS` while it is visible, reading who else did, and
 * says it left when the room closes.
 */
export function useCloudRoomPresence(serverId: Ref<string>, roomId: Ref<string | null>) {
  const people = shallowRef<RoomPresence['people']>([])
  const visibility = useDocumentVisibility()

  function client() {
    const server = findCloudServer(serverId.value)
    const discovery = server ? cloudConnection(server.id).discovery : null
    return server && discovery ? cloudAPIClient(server, discovery) : null
  }

  async function checkIn(): Promise<void> {
    const id = roomId.value
    const api = client()
    if (!id || !api || visibility.value === 'hidden') return
    try {
      const presence = await api.roomHeartbeat(id)
      if (roomId.value === id) people.value = presence.people
    } catch {
      // Presence is a detail; the room still shows without it.
      if (roomId.value === id) people.value = []
    }
  }

  function leave(id: string | null): void {
    const api = client()
    if (id && api) void api.leaveRoomPresence(id).catch(() => undefined)
  }

  const { pause, resume } = useIntervalFn(() => void checkIn(), ROOM_PRESENCE_INTERVAL_MS, {
    immediate: false
  })
  watch(
    roomId,
    (next, previous) => {
      if (previous) leave(previous)
      people.value = []
      if (next) {
        resume()
        void checkIn()
      } else pause()
    },
    { immediate: true }
  )
  watch(visibility, (state) => {
    if (state === 'visible') void checkIn()
  })
  onScopeDispose(() => {
    pause()
    leave(roomId.value)
  })

  return { people }
}
