import * as v from 'valibot'

/** One entry of a manifest's `menu`: a command, a separator, or a submenu. */
export interface PluginManifestMenuEntry {
  name?: string
  command?: string
  separator?: boolean
  menu?: PluginManifestMenuEntry[]
}

export const pluginMenuEntrySchema: v.GenericSchema<PluginManifestMenuEntry> = v.union([
  v.object({ separator: v.literal(true) }),
  v.object({
    name: v.pipe(v.string(), v.minLength(1)),
    command: v.pipe(v.string(), v.minLength(1))
  }),
  v.object({
    name: v.pipe(v.string(), v.minLength(1)),
    menu: v.lazy(() => v.array(pluginMenuEntrySchema))
  })
])

/**
 * Figma's plugin `manifest.json`: the fields Lawha reads. Other fields Figma defines (such as
 * `parameters` or `capabilities`) are kept but not interpreted.
 */
export const pluginManifestSchema = v.looseObject({
  name: v.pipe(v.string(), v.trim(), v.minLength(1)),
  id: v.pipe(v.string(), v.trim(), v.minLength(1)),
  api: v.optional(v.string(), '1.0.0'),
  main: v.pipe(v.string(), v.minLength(1)),
  /** One HTML file, or several, which the code reads as `__uiFiles__`. */
  ui: v.optional(v.union([v.string(), v.record(v.string(), v.string())])),
  editorType: v.optional(v.array(v.string()), ['figma']),
  menu: v.optional(v.array(pluginMenuEntrySchema)),
  networkAccess: v.optional(
    v.looseObject({
      allowedDomains: v.array(v.string()),
      devAllowedDomains: v.optional(v.array(v.string())),
      reasoning: v.optional(v.string())
    })
  ),
  documentAccess: v.optional(v.string())
})
