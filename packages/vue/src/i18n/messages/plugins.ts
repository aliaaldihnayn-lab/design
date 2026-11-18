import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

/** Running Figma plugins. */
export const pluginsMessageDefaults = {
  imported: params('{name} is installed'),
  importFailed: params('Could not import the plugin: {error}'),
  failed: params('{name} stopped: {error}'),
  removed: params('{name} was removed'),
  close: 'Close plugin'
} as const

export const pluginsMessages = i18n('plugins', pluginsMessageDefaults)
