import { IS_MOBILE_APP } from '@lawha/core/constants'

/**
 * The desktop app, read when called rather than at load as `IS_TAURI` is, so tests can stand in
 * for the native side. The mobile app runs the editor as the browser does (see `IS_TAURI`).
 */
export function isTauri(): boolean {
  return 'window' in globalThis && '__TAURI_INTERNALS__' in globalThis.window && !IS_MOBILE_APP
}
