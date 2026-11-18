import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

/** Building a design system from the design. */
export const designSystemMessageDefaults = {
  section: 'Design system',
  extras: params('Added a Dark mode, {styles} text styles and {components} component sets'),
  build: 'Build design system',
  buildPage: 'From this page',
  buildSelection: 'From the selection',
  buildHint:
    'Turn the colours, type, spacing and radii in use into variables with Light and Dark modes and text styles, link them to the layers, and document them with starter components on a Design System page',
  done: params('{tokens} tokens created, {bound} layers linked'),
  duplicates: params('{count} near-duplicate colours found: their layers keep their own colour'),
  failed: params('Could not build the design system: {error}'),
  components: 'Add component sets',
  componentsHint:
    "Add Button, Input and Badge component sets to this page, bound to the design system's variables when there is one",
  componentsDone: params('Added {count} component sets')
} as const

export const designSystemMessages = i18n('designSystem', designSystemMessageDefaults)
