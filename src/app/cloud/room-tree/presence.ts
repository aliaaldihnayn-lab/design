import { useDocumentVisibility, useIntervalFn, useTimeoutFn } from '@vueuse/core'
import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'

import { ROOM_PRESENCE_INTERVAL_MS, type RoomPresence } from '@lawha/cloud/contract'

import { findCloudServer } from '../servers/store'
import { cloudAPIClient, cloudConnection } from '../sessions/connection'
import { connectRoomPresence } from './live'

/** How long a room waits on check-ins before trying the live channel again after it failed. */
export const ROOM_PRESENCE_RECONNECT_MS = 60_000

export type CloudRoomPresenceOptions = {
  createSocket?: (url: string) => WebSocket
}

/**
 * Who is in a room now. The page holds the relay's live presence channel of the room open, so
 * arrivals and departures show as they happen; while that channel is unavailable it checks in
 * every `ROOM_PRESENCE_INTERVAL_MS` instead, and tries the channel again a while later.
 */
export function useCloudRoomPresence(
  serverId: Ref<string>,
  roomId: Ref<string | null>,
  options: CloudRoomPresenceOptions = {}
) {
  const people = shallowRef<RoomPresence['people']>([])
  /** Whether the live channel carries the room now, rather than check-ins. */
  const live = shallowRef(false)
  const visibility = useDocumentVisibility()
  let channel: ReturnType<typeof connectRoomPresence> | null = null
  /** Read through functions, since both change while a request is in flight. */
  const isLive = () => live.value
  const hasChannel = () => channel !== null

  function client() {
    const server = findCloudServer(serverId.value)
    const discovery = server ? cloudConnection(server.id).discovery : null
    return server && discovery ? cloudAPIClient(server, discovery) : null
  }

  async function checkIn(): Promise<void> {
    const id = roomId.value
    const api = client()
    if (!id || !api || live.value || visibility.value === 'hidden') return
    try {
      const presence = await api.roomHeartbeat(id)
      if (roomId.value === id && !isLive()) people.value = presence.people
    } catch {
      // Presence is a detail; the room still shows without it.
      if (roomId.value === id && !isLive()) people.value = []
    }
  }

  const polling = useIntervalFn(() => void checkIn(), ROOM_PRESENCE_INTERVAL_MS, {
    immediate: false
  })

  function poll() {
    live.value = false
    polling.resume()
    void checkIn()
  }

  const retry = useTimeoutFn(() => void openChannel(), ROOM_PRESENCE_RECONNECT_MS, {
    immediate: false
  })

  async function openChannel(): Promise<void> {
    const id = roomId.value
    const api = client()
    if (!id || !api || channel) return
    let ticket
    try {
      ticket = await api.roomPresenceTicket(id)
    } catch {
      // No relay, or it refused: check-ins carry the room.
      if (roomId.value === id) retry.start()
      return
    }
    if (roomId.value !== id || hasChannel()) return
    const opened = connectRoomPresence({
      ticket,
      createSocket: options.createSocket,
      onPresence(presence) {
        if (channel !== opened) return
        live.value = true
        polling.pause()
        people.value = presence.people
      },
      onClosed(reason) {
        if (channel !== opened) return
        channel = null
        poll()
        if (reason === 'expired') void openChannel()
        else retry.start()
      }
    })
    channel = opened
  }

  function closeChannel() {
    retry.stop()
    const current = channel
    channel = null
    current?.close()
  }

  function leave(id: string | null): void {
    const api = client()
    if (id && api) void api.leaveRoomPresence(id).catch(() => undefined)
  }

  watch(
    roomId,
    (next, previous) => {
      closeChannel()
      if (previous) leave(previous)
      people.value = []
      live.value = false
      if (next) {
        poll()
        void openChannel()
      } else polling.pause()
    },
    { immediate: true }
  )
  watch(visibility, (state) => {
    if (state === 'visible') void checkIn()
  })
  onScopeDispose(() => {
    polling.pause()
    closeChannel()
    leave(roomId.value)
  })

  return { people, live }
}
