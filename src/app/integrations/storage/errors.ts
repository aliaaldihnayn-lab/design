import { storageErrorMessages } from '@lawha/vue/i18n'

type StorageErrorMessages = ReturnType<typeof storageErrorMessages.get>

/**
 * A storage error's message in the app's language, as people read it where a save, an open or
 * a listing failed: `storageErrorText((t) => t.s3FieldRequired({ field }))`.
 */
export function storageErrorText(pick: (messages: StorageErrorMessages) => string): string {
  return pick(storageErrorMessages.get())
}

/** A write based on a revision the provider has since replaced, as when someone else saved. */
export class StorageRevisionConflictError extends Error {
  override readonly name = 'StorageRevisionConflictError'

  constructor(
    /** The provider's current revision, when it reports one. */
    readonly currentRevision: string | null
  ) {
    super(storageErrorText((t) => t.revisionConflict))
  }
}

/**
 * The provider cannot be reached with what this device has now, such as a signed-out Cloud
 * account. Work waits until the person fixes it rather than counting as failed attempts.
 */
export class StorageUnavailableError extends Error {
  override readonly name = 'StorageUnavailableError'
}
