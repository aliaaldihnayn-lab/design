/** A room as the room tools report it. */
export type RoomsHostRoom = {
  id: string
  name: string
  /** The room above, or null at the top of what the person can see. */
  parentId: string | null
  workspaceId: string
  role: 'owner' | 'editor' | 'viewer'
  /** Whether a sub-room lets in its parent's members, or only its own. */
  accessMode: 'inherit' | 'restricted'
  fileCount: number
  archived: boolean
}

/**
 * Lawha Cloud rooms the AI tools work on, as the signed-in person. The app registers the server
 * Home shows; a host without Cloud (the CLI, a build without Cloud) registers none, and the tools
 * say so. The server checks every call against the person's role in the room.
 */
export interface RoomsHost {
  list(options: { archived: boolean }): Promise<RoomsHostRoom[]>
  /** The workspaces where the person may make a top-level room. */
  workspaces(): Promise<Array<{ id: string; name: string }>>
  create(input: {
    name: string
    parentId?: string
    workspaceId?: string
    accessMode?: 'inherit' | 'restricted'
  }): Promise<RoomsHostRoom>
  /** Emails an invitation; the link stays with the server and the invited person. */
  invite(input: {
    roomId: string
    email: string
    role: 'editor' | 'viewer'
  }): Promise<{ invitationId: string; email: string; role: 'editor' | 'viewer' }>
  setAccess(input: { roomId: string; accessMode: 'inherit' | 'restricted' }): Promise<RoomsHostRoom>
}

let host: RoomsHost | null = null

/** Registers the Cloud rooms host; returns a function that puts back the one before. */
export function setRoomsHost(next: RoomsHost | null): () => void {
  const previous = host
  host = next
  return () => {
    if (host === next) host = previous
  }
}

export function requireRoomsHost(): RoomsHost {
  if (!host) throw new Error('Rooms need a Lawha Cloud server: sign in to one on Home first')
  return host
}
