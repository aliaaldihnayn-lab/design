/** Stable names for the app's independent IndexedDB databases. */
export const APP_DATABASE_NAMES = {
  chats: 'lawha-chats',
  credentials: 'lawha-credentials',
  libraries: 'lawha-libraries',
  localCanvas: 'lawha-cloud-local',
  outbox: 'lawha-cloud-outbox',
  recovery: 'lawha-recovery',
  history: 'lawha-history',
  /** Files the browser opened, by handle and content, so what is kept about them follows them. */
  fileIdentities: 'lawha-file-identities',
  diagnostics: 'lawha-diagnostics',
  skills: 'lawha-skills',
  plugins: 'lawha-plugins',
  /** Written and deleted once per page, to learn whether the engine stores Blobs. */
  blobProbe: 'lawha-blob-probe'
} as const
