import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

/** What storage providers report when a document cannot be read, written or listed. */
export const storageErrorMessageDefaults = {
  revisionConflict: 'The stored document changed since this copy was opened.',
  providerNotConfigured: params('{provider} is not configured.'),
  providerCredentialsUnavailable: params('{provider} credentials are unavailable.'),
  documentNotFound: params('Document {id} was not found.'),
  googleSignInDidNotLoad: 'Google sign-in did not load.',
  googleSignInUnreachable: 'Could not reach Google sign-in.',
  googleDriveSignInAgain: 'Sign in to Google Drive again to keep syncing.',
  googleDriveExpired: 'Your Google Drive sign-in expired. Reconnect it in Settings.',
  googleDriveAnswered: params('Google Drive answered with error {status}.'),
  googleDriveUnexpected: 'Google Drive sent an unexpected answer.',
  googleDriveMissing: params('Document {id} is not in Google Drive.'),
  googleDocsUnexpected: 'Google Docs sent an unexpected answer.',
  cloudServerRemoved: 'This Cloud server was removed from the app.',
  cloudSignIn: params('Sign in to {host} to sync.'),
  cloudWorkspaceMissing: 'This Cloud storage location names no workspace.',
  cloudUploadIncomplete: 'The Cloud server’s answer to the upload was incomplete.',
  cloudDownloadFailed: params('Downloading the Cloud document failed with error {status}.'),
  cloudDownloadMismatch: 'The downloaded Cloud document does not match what the server stored.',
  cloudRangeTooLong: params('The Cloud server sent more than the {length} bytes asked for.'),
  cloudRangeShort: params('The Cloud server sent {received} of the {length} bytes asked for.'),
  cloudImageMissing: 'The server asked for an image this save does not have.',
  s3FieldRequired: params('The S3 {field} is required.'),
  s3CredentialsRequired: 'S3 credentials are required.',
  s3EndpointRequired: 'The S3 endpoint is required.',
  s3CannotWrite: 'Cannot write to this bucket. Check its access permissions and name.',
  s3InvalidRange: 'The requested byte range is not valid.',
  s3ThumbnailRangeIgnored: 'The storage provider did not send just the thumbnail’s bytes.',
  s3ListingTooLarge: 'The bucket holds more than 50,000 objects, more than Lawha lists.',
  libraryRevisionConflict: 'The library changed since it was opened. Open it again and retry.'
} as const

export const storageErrorMessages = i18n('storageErrors', storageErrorMessageDefaults)
