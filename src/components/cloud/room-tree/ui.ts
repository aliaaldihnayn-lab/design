import { tv } from 'tailwind-variants'

import roomsTheme from '@/theme/cloud/rooms'

export const cloudRooms = tv(roomsTheme)

/** Below this width the tree and the open room take turns instead of sitting side by side. */
export const CLOUD_ROOMS_SPLIT_WIDTH = 640
