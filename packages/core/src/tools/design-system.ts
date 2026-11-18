import * as v from 'valibot'

import type { SceneNode } from '@lawha/scene-graph'

import { buildDesignSystem } from '#core/design-system/build'
import {
  COMPONENT_SET_NAMES,
  componentsOrigin,
  pageNamed,
  writeComponents
} from '#core/design-system/components'
import {
  DOCS_PAGE_NAME,
  docsPageBottom,
  writeDarkPreview,
  writeDocsPage
} from '#core/design-system/docs'
import { extract } from '#core/design-system/extract'
import { plan as makePlan } from '#core/design-system/plan'
import { writeTextStyles } from '#core/design-system/styles'
import type { FigmaAPI } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

/** Where component sets made without a docs page go. */
const COMPONENTS_PAGE_NAME = 'Components'

export const createComponentSetsTool = defineTool({
  name: 'create_component_sets',
  description:
    'Create starter component sets on demand, without rebuilding the design system: Button (Variant Primary/Secondary/Ghost × State Default/Hover/Disabled), Input (State Default/Focus/Error/Disabled) and Badge (Tone Brand/Neutral/Danger), each with a Label text property. Their colours, padding, gaps, radii and type are bound to the variables of the named collection (as build_design_system names them: color/primary, space/*, radius/*, type/body, font/primary), resolved as they stand now, so they follow its Light and Dark modes; without that collection they use plain values. They are placed below what the page already holds.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    sets: v.optional(
      v.pipe(
        v.array(v.picklist(COMPONENT_SET_NAMES)),
        v.minLength(1),
        v.description('Which sets to create (default all three)')
      )
    ),
    collection: v.optional(
      v.pipe(v.string(), v.minLength(1), v.description('Variable collection to bind to')),
      'Design System'
    ),
    page: v.optional(
      v.pipe(
        v.picklist(['current', 'components']),
        v.description('The current page (default), or a page named Components')
      ),
      'current'
    )
  }),
  execute: (figma, args) => {
    const collection = [...figma.graph.variableCollections.values()].find(
      (item) => item.name === args.collection
    )
    const pageId =
      args.page === 'components' ? pageNamed(figma, COMPONENTS_PAGE_NAME) : figma.currentPage.id
    const components = writeComponents(figma, pageId, {
      collectionId: collection?.id ?? null,
      sets: args.sets,
      origin: componentsOrigin(figma.graph, pageId)
    })
    return { page: pageId, collection: collection?.name ?? null, components }
  }
})

/** The build's component sets: on its docs page, or on a Components page without one. */
function buildComponents(figma: FigmaAPI, collectionId: string, docs: SceneNode | null) {
  const pageId = docs?.id ?? pageNamed(figma, COMPONENTS_PAGE_NAME)
  return writeComponents(figma, pageId, {
    collectionId,
    origin: docs
      ? { x: 0, y: docsPageBottom(figma.graph, docs) + 80 }
      : componentsOrigin(figma.graph, pageId)
  })
}

export const buildDesignSystemTool = defineTool({
  name: 'build_design_system',
  description:
    'Build a design system from the design in one step: reads the colours, type, spacing and corner radii the layers use, names them by role (color/primary, color/text/primary, color/background, color/neutral/100…, type/h1 · body · caption, font/primary, space/16, radius/8), creates them as variables in one collection with Light and Dark modes (dark values derived by role), binds each variable to every layer that used its value (so editing a variable restyles the design), turns the type scale into shared text styles (Type/h1 … Type/body) that the text layers use, writes a "Design System" page documenting the tokens with a Dark preview, and adds starter component sets with variants bound to the variables: Button (Variant × State), Input (State) and Badge (Tone), each with a Label text property. Near-duplicate colours are reported; normalize: true also snaps them to their token. Building again updates the same collection and page.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    scope: v.optional(
      v.pipe(
        v.picklist(['page', 'selection']),
        v.description('Read the whole current page (default) or only the selection')
      ),
      'page'
    ),
    collection: v.optional(
      v.pipe(v.string(), v.minLength(1), v.description('Variable collection name')),
      'Design System'
    ),
    apply: v.optional(
      v.pipe(v.boolean(), v.description('Bind the variables to the layers (default true)')),
      true
    ),
    normalize: v.optional(
      v.pipe(v.boolean(), v.description('Snap near-duplicate colours to their token')),
      false
    ),
    docs: v.optional(
      v.pipe(v.boolean(), v.description('Write the documentation page (default true)')),
      true
    ),
    dark_mode: v.optional(
      v.pipe(v.boolean(), v.description('Add Light and Dark modes to the colours (default true)')),
      true
    ),
    text_styles: v.optional(
      v.pipe(
        v.boolean(),
        v.description('Create shared text styles from the type scale (default true)')
      ),
      true
    ),
    components: v.optional(
      v.pipe(
        v.boolean(),
        v.description(
          'Add Button, Input and Badge component sets (default true): on the docs page, or on a Components page when docs is false'
        )
      ),
      true
    ),
    dry_run: v.optional(
      v.pipe(v.boolean(), v.description('Report the tokens without changing anything')),
      false
    )
  }),
  execute: (figma, args) => {
    const page = figma.graph.getNode(figma.currentPage.id)
    if (!page) return { error: 'No current page' }
    if (page.name === DOCS_PAGE_NAME)
      return { error: 'Run this on a design page, not on the Design System page itself' }
    const roots =
      args.scope === 'selection' ? figma.currentPage.selection.map((n) => n.id) : [...page.childIds]
    if (roots.length === 0)
      return {
        error: args.scope === 'selection' ? 'Select the layers to build from' : 'This page is empty'
      }
    const plan = makePlan(extract(figma.graph, roots))
    const summary = {
      colors: plan.colors.map((c) => ({ name: c.name, uses: c.uses.length, variants: c.variants })),
      type: plan.type.map((t) => ({ name: t.name, ...t.sample, uses: t.uses.length })),
      families: plan.families,
      spacing: plan.spacing.map((s) => ({ name: s.name, value: s.value, uses: s.uses.length })),
      radius: plan.radius.map((r) => ({ name: r.name, value: r.value, uses: r.uses.length }))
    }
    if (args.dry_run) return { dryRun: true, ...summary }
    const built = buildDesignSystem(figma, plan, {
      collection: args.collection,
      apply: args.apply,
      normalize: args.normalize,
      darkMode: args.dark_mode
    })
    const docs = args.docs
      ? writeDocsPage(figma.graph, plan, built, plan.families[0]?.family ?? 'Inter')
      : null
    const darkPreview =
      docs && built.modes ? writeDarkPreview(figma, docs, built.collection, built.modes.dark) : null
    const styles = args.text_styles
      ? writeTextStyles(figma.graph, docs?.id ?? page.id, plan, built)
      : null
    const components = args.components ? buildComponents(figma, built.collection, docs) : []
    return {
      collection: built.collection,
      variables: { created: built.created, updated: built.updated },
      bound: built.bound,
      normalized: built.normalized,
      skipped: built.skipped,
      inconsistencies: built.inconsistencies,
      docsPage: docs?.id ?? null,
      modes: built.modes,
      darkPreview,
      textStyles: styles,
      components,
      ...summary
    }
  }
})
