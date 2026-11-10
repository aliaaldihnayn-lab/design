import * as v from 'valibot'

import { INSPECT_LANGUAGES, inspectCode, inspectLayer } from '#core/inspect'
import { defineTool } from '#core/tools/schema'

export const inspectLayerTool = defineTool({
  name: 'inspect_layer',
  description:
    'Inspect a layer as Figma’s Dev Mode does: its size and sizing (fixed, hug, fill, min/max), auto layout, corner radii, fills, strokes, shadows, blur, opacity and text style, with the variable each value is bound to, and the same layer as code: CSS, SwiftUI (iOS) and Jetpack Compose (Android). Pass language to get one of them only.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({
    id: v.pipe(v.string(), v.description('Layer to inspect')),
    language: v.optional(v.picklist(INSPECT_LANGUAGES))
  }),
  execute: (figma, { id, language }) => {
    const spec = inspectLayer(figma.graph, id)
    if (!spec) return { error: `Node ${id} not found` }
    const languages = language ? [language] : INSPECT_LANGUAGES
    return {
      spec,
      code: Object.fromEntries(languages.map((lang) => [lang, inspectCode(spec, lang)]))
    }
  }
})
