import * as v from 'valibot'

import { behaviourSchema } from '../behaviours/schema'
import type { OkHCLPayload } from '../color/okhcl'
import { commentThreadsSchema } from '../comments/schema'
import { isExportFormatId, type ExportFormatId } from '../export-format'
import { clampExportScale } from '../export-scale'
import { FIG_COMPRESSIONS } from '../fig-compression'
import { iconSchema, iconTintSchema } from '../icons/schema'
import { liveBlendSchema, pathEffectSchema } from '../path-effects/schema'
import type { Rect } from '../primitives'
import { shaderPaintSchema } from '../shaders/schema'
import { nodeStatusSchema, statusWorkflowSchema } from '../statuses/schema'
import { epicsSchema, storyJiraProjectSchema, userStoriesSchema } from '../stories/schema'
import {
  MODE_ATTRIBUTE_PATTERN,
  TOKEN_UNITS,
  type EnabledLibraryBinding,
  type ExportSetting,
  type LayoutDirection,
  type LibraryAssetSource,
  type PluginDataEntry,
  type SourceLibraryPublication,
  type TextDirection,
  type TokenUnit
} from '../types'
import {
  jsonPluginDataField,
  textPluginDataField,
  withoutPluginData,
  type PluginDataKey
} from './field'

const DIRECTIONS = ['AUTO', 'LTR', 'RTL'] as const satisfies readonly (
  | TextDirection
  | LayoutDirection
)[]

const textPathBoxSchema: v.GenericSchema<unknown, Rect> = v.pipe(
  v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number() }),
  v.check(
    ({ x, y, width, height }) => Number.isFinite(x + y + width + height) && width > 0 && height > 0
  )
)

/** String-valued entries of a JSON object; other entries are dropped, not rejected. */
const boundVariablesSchema = v.pipe(
  v.custom<Record<string, unknown>>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
  ),
  v.transform((value) =>
    Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  )
)

/** Every entry must be valid, or the whole value is ignored in favour of native settings. */
const exportSettingsSchema: v.GenericSchema<unknown, ExportSetting[]> = v.array(
  v.pipe(
    v.object({
      scale: v.pipe(v.number(), v.finite()),
      format: v.custom<ExportFormatId>(isExportFormatId)
    }),
    // Clamp at the file boundary: imported plugin data may carry a scale the UI never produces.
    v.transform(({ scale, format }) => ({ scale: clampExportScale(scale), format }))
  )
)

const librarySourceSchema: v.GenericSchema<unknown, LibraryAssetSource> = v.pipe(
  v.object({
    identity: v.object({ libraryId: v.string(), assetKey: v.string(), revisionId: v.string() }),
    sourceNodeId: v.optional(v.unknown()),
    readOnly: v.optional(v.unknown())
  }),
  v.transform(({ identity, sourceNodeId, readOnly }) => ({
    identity,
    sourceNodeId: typeof sourceNodeId === 'string' ? sourceNodeId : null,
    readOnly: readOnly === true
  }))
)

const enabledLibrarySchema = v.object({
  libraryId: v.string(),
  revisionId: v.string(),
  enabled: v.optional(v.unknown())
})

/** Invalid entries are skipped one by one, so one bad binding keeps the others. */
const enabledLibrariesSchema: v.GenericSchema<unknown, EnabledLibraryBinding[]> = v.pipe(
  v.array(v.unknown()),
  v.transform((items) =>
    items.flatMap((item) => {
      const parsed = v.safeParse(enabledLibrarySchema, item)
      if (!parsed.success) return []
      const { libraryId, revisionId, enabled } = parsed.output
      return [{ libraryId, revisionId, enabled: enabled === true }]
    })
  )
)

// Shape only. Whether a string is valid CSS is checked where it is written into a stylesheet.
const cssTextSchema = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(1000))

/** Token fields Figma has no slot for, with mode ids as the file spells them. */
export interface StoredToken {
  unit?: TokenUnit
  expressions?: Record<string, { css: string; resolved?: number }>
}

const tokenSchema: v.GenericSchema<unknown, StoredToken> = v.object({
  unit: v.optional(v.picklist(TOKEN_UNITS)),
  expressions: v.optional(
    v.record(
      v.string(),
      v.object({ css: cssTextSchema, resolved: v.optional(v.pipe(v.number(), v.finite())) })
    )
  )
})

const okhclSchema: v.GenericSchema<unknown, OkHCLPayload> = v.object({
  version: v.literal(1),
  kind: v.picklist(['fill', 'stroke']),
  index: v.number(),
  color: v.object({
    h: v.number(),
    c: v.number(),
    l: v.number(),
    a: v.fallback(v.optional(v.number()), undefined)
  })
})

const sourceLibraryPublicationSchema: v.GenericSchema<unknown, SourceLibraryPublication> = v.object(
  {
    libraryId: v.string(),
    revisionId: v.string(),
    name: v.string(),
    catalogSource: v.optional(v.string())
  }
)

const adjustmentValueSchema = v.optional(v.pipe(v.number(), v.minValue(-1), v.maxValue(1)))

/** Every adjustment of each adjusted fill, by fill index, so a save loses none of them. */
const imageAdjustmentsSchema = v.record(
  v.pipe(v.string(), v.regex(/^\d+$/)),
  v.object({
    exposure: adjustmentValueSchema,
    contrast: adjustmentValueSchema,
    brightness: adjustmentValueSchema,
    saturation: adjustmentValueSchema,
    vibrance: adjustmentValueSchema,
    temperature: adjustmentValueSchema,
    tint: adjustmentValueSchema,
    highlights: adjustmentValueSchema,
    shadows: adjustmentValueSchema,
    hue: adjustmentValueSchema,
    sharpen: adjustmentValueSchema,
    noise: adjustmentValueSchema,
    vignette: adjustmentValueSchema,
    invert: v.optional(v.boolean()),
    levels: v.optional(
      v.object({
        black: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
        white: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
        gamma: v.pipe(v.number(), v.minValue(0.1), v.maxValue(10))
      })
    ),
    curve: v.optional(
      v.pipe(
        v.array(
          v.object({
            x: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
            y: v.pipe(v.number(), v.minValue(0), v.maxValue(1))
          })
        ),
        v.maxLength(32)
      )
    )
  })
)

/** Where each pattern fill's tiles sit, by fill index: Figma's pattern paint has no offset or turn. */
const patternPlacementSchema = v.record(
  v.pipe(v.string(), v.regex(/^\d+$/)),
  v.object({
    offset: v.optional(
      v.object({ x: v.pipe(v.number(), v.finite()), y: v.pipe(v.number(), v.finite()) })
    ),
    rotation: v.optional(v.pipe(v.number(), v.finite()))
  })
)

const paintLayerSchema = v.object({ hash: v.pipe(v.string(), v.minLength(1)) })

const masterPageSchema = v.object({ role: v.picklist(['master', 'applied']) })

const pageNumberSchema = v.object({ template: v.pipe(v.string(), v.maxLength(200)) })

const textThreadSchema = v.object({
  story: v.pipe(v.string(), v.minLength(1)),
  order: v.pipe(v.number(), v.integer(), v.minValue(0)),
  lead: v.pipe(v.string(), v.maxLength(1000))
})

/**
 * Every plugin-data entry Lawha writes under {@link LAWHA_PLUGIN_ID}: state Figma's
 * format has no field for. Add a key here, never as a string elsewhere, so reading and writing
 * it share one schema.
 */
export const LAWHA_PLUGIN_DATA = {
  /** A text node's direction, on TEXT nodes. */
  textDirection: textPluginDataField('textDirection', 'format', DIRECTIONS),
  /** An auto-layout frame's direction. */
  layoutDirection: textPluginDataField('layoutDirection', 'format', DIRECTIONS),
  /** Marks a component set Figma would read as a plain frame. */
  nodeType: textPluginDataField('nodeType', 'format', ['COMPONENT_SET']),
  /** Variable bindings by field path, including those Figma cannot store natively. */
  boundVariables: jsonPluginDataField('boundVariables', 'format', boundVariablesSchema),
  exportSettings: jsonPluginDataField('exportSettings', 'format', exportSettingsSchema),
  /** The node-local rect a TEXT_PATH layout maps onto, which Kiwi has no field for. */
  textPathBox: jsonPluginDataField('textPathBox', 'format', textPathBoxSchema),
  /**
   * Image fill adjustments by fill index. Figma's paint filter keeps eight of them; hue, invert
   * and vibrance have no Figma field, so this keeps every one exactly.
   */
  imageAdjustments: jsonPluginDataField('imageAdjustments', 'format', imageAdjustmentsSchema),
  /** Each pattern fill's offset and turn by fill index, which Figma's pattern paint cannot hold. */
  patternPlacement: jsonPluginDataField('patternPlacement', 'format', patternPlacementSchema),
  /**
   * The image fill that holds what was painted on the layer with the brush, eraser and fill
   * bucket, by its image's hash, so its other fills stay as they were (Affinity's pixel layer).
   */
  paintLayer: jsonPluginDataField('paintLayer', 'content', paintLayerSchema),
  /**
   * A publication's master page (a component) or a master applied to a page (its instance at the
   * bottom of the page frame), as Affinity Publisher's master pages.
   */
  masterPage: jsonPluginDataField('masterPage', 'content', masterPageSchema),
  /** A text that shows its page's number: `{page}` and `{pages}` in the template are filled in. */
  pageNumber: jsonPluginDataField('pageNumber', 'content', pageNumberSchema),
  /**
   * A text frame in a threaded story: the story (its first frame's id), its place in the chain,
   * and the white space the story had where the text broke into this frame.
   */
  textThread: jsonPluginDataField('textThread', 'content', textThreadSchema),
  /** The library asset a node was inserted from. */
  librarySource: jsonPluginDataField('librarySource', 'bookkeeping', librarySourceSchema),
  /**
   * The document root's id, on the DOCUMENT node, whose own GUID is always Figma's `0:0`; the
   * root keeps it across a save as every layer keeps its GUID.
   */
  documentId: jsonPluginDataField(
    'documentId',
    'bookkeeping',
    v.pipe(v.string(), v.nonEmpty(), v.maxLength(64))
  ),
  /** Libraries enabled for the document, on the DOCUMENT node. */
  enabledLibraries: jsonPluginDataField('enabledLibraries', 'bookkeeping', enabledLibrariesSchema),
  /** The library this document publishes as, on the DOCUMENT node. */
  sourceLibraryPublication: jsonPluginDataField(
    'sourceLibraryPublication',
    'bookkeeping',
    sourceLibraryPublicationSchema
  ),
  /** Canvas comment threads, deleted ones included, on the DOCUMENT node. */
  comments: jsonPluginDataField('comments', 'bookkeeping', commentThreadsSchema),
  /** The statuses layers can be in, on the DOCUMENT node. */
  statuses: jsonPluginDataField('statuses', 'bookkeeping', statusWorkflowSchema),
  /** The epics a document's user stories are grouped under, on the DOCUMENT node. */
  epics: jsonPluginDataField('epics', 'bookkeeping', epicsSchema),
  /** The Jira site and project the document's stories are created in, on the DOCUMENT node. */
  storyJiraProject: jsonPluginDataField('storyJiraProject', 'bookkeeping', storyJiraProjectSchema),
  /**
   * The user stories that specify a layer, on any layer: the product spec stays with the
   * document, so a component copied into a library leaves them behind.
   */
  userStories: jsonPluginDataField('userStories', 'bookkeeping', userStoriesSchema),
  /** How tightly the document's `.fig` data is compressed, on the DOCUMENT node. */
  figCompression: textPluginDataField('figCompression', 'bookkeeping', FIG_COMPRESSIONS),
  /** A layer's status, any state of the workflow; Figma's `sectionStatusInfo` knows only two. */
  status: jsonPluginDataField('status', 'format', nodeStatusSchema),
  /** Unit and CSS expressions, on each VARIABLE. */
  token: jsonPluginDataField('token', 'format', tokenSchema),
  /** Mode conditions by mode id, on each VARIABLE_SET. */
  modeConditions: jsonPluginDataField(
    'modeConditions',
    'format',
    v.record(v.string(), cssTextSchema)
  ),
  /** The attribute that switches manual modes, on each VARIABLE_SET. */
  modeAttribute: jsonPluginDataField(
    'modeAttribute',
    'format',
    v.pipe(v.string(), v.trim(), v.maxLength(100), v.regex(MODE_ATTRIBUTE_PATTERN))
  ),
  /** One entry per paint picked in OkHCL, so the picker reopens on the same coordinates. */
  okhcl: jsonPluginDataField('okhcl', 'content', okhclSchema),
  /** How a main component or component set behaves as a control in preview. */
  behaviour: jsonPluginDataField('behaviour', 'content', behaviourSchema),
  /** The icon a frame draws, such as `lucide:home`, on the frame its paths are in. */
  icon: jsonPluginDataField('icon', 'content', iconSchema),
  /** Which of an icon path's paints its icon's color sets, on each path the source drew in it. */
  iconTint: jsonPluginDataField('iconTint', 'content', iconTintSchema),
  /** One entry per paint that draws a shader, matched to its image paint by the frame's hash. */
  shader: jsonPluginDataField('shader', 'content', shaderPaintSchema),
  /**
   * A live warp, envelope mesh, or width profile on the vector it made, with the outline it was
   * made from, so it can be edited again, expanded, or released.
   */
  pathEffect: jsonPluginDataField('pathEffect', 'content', pathEffectSchema),
  /** A live blend, on the group holding its ends and the steps it made between them. */
  liveBlend: jsonPluginDataField('liveBlend', 'content', liveBlendSchema)
} satisfies Record<string, PluginDataKey>

const NOT_CONTENT = Object.values(LAWHA_PLUGIN_DATA).filter((field) => field.role !== 'content')

/**
 * A node's plugin data that is part of its content, in a stable order: Lawha's content
 * fields and every other plugin's entries, which the node carries wherever it goes. Format
 * copies of node fields and bookkeeping are left out.
 */
export function contentPluginData(entries: readonly PluginDataEntry[]): PluginDataEntry[] {
  return withoutPluginData(entries, NOT_CONTENT).sort(
    (a, b) => a.pluginId.localeCompare(b.pluginId) || a.key.localeCompare(b.key)
  )
}
