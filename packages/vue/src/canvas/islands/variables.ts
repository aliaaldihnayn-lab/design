import { inject, provide, shallowRef, type InjectionKey, type ShallowRef } from 'vue'

import type { PlayVariables } from '@lawha/core/prototype'

/**
 * The prototype variables a running view has set, shared by every island in it, so a control
 * in one frame can drive a label or a button in another.
 */
const PLAY_VARIABLES: InjectionKey<ShallowRef<PlayVariables>> = Symbol('lawha-play-variables')

/** Starts a running view's variables, for its islands to share; reset them by assigning. */
export function providePlayVariables(): ShallowRef<PlayVariables> {
  const variables = shallowRef<PlayVariables>(new Map())
  provide(PLAY_VARIABLES, variables)
  return variables
}

/** The running view's variables, or an island's own when it runs alone. */
export function usePlayVariables(): ShallowRef<PlayVariables> {
  return inject(PLAY_VARIABLES, () => shallowRef<PlayVariables>(new Map()), true)
}
