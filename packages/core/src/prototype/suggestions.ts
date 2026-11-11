import * as v from 'valibot'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { findLayerByPath, layerPath } from '@lawha/scene-graph/behaviours'
import { instanceMainComponent } from '@lawha/scene-graph/instances'

import { getPluginData } from '#core/figma-api/plugin-data'

/**
 * Suggestions that filter as you type, as a combobox's list does: a component's variant names
 * the text field whose text filters it, the option rows it shows, and a row it shows when none
 * matches. While the prototype runs, each instance hides the rows whose label does not contain
 * what its field holds; the document never changes.
 */
export const SUGGESTIONS_KEY = 'prototype.suggestions'

const suggestionsSchema = v.object({
  /** The text field's layer path below the instance. */
  field: v.pipe(v.string(), v.minLength(1)),
  /** The option rows' layer paths below the instance. */
  options: v.array(v.string()),
  /** The row shown when the field holds text and no option matches. */
  empty: v.optional(v.string())
})

export type SuggestionsSpec = v.InferOutput<typeof suggestionsSchema>

/** A variant's suggestions, or null when it has none or they are malformed. */
export function readSuggestions(node: SceneNode): SuggestionsSpec | null {
  const text = getPluginData(node, SUGGESTIONS_KEY)
  if (!text) return null
  const parsed = v.safeParse(v.pipe(v.string(), v.parseJson(), suggestionsSchema), text)
  return parsed.success ? parsed.output : null
}

/** Arabic letters written several ways that a search treats as one. */
const ARABIC_FOLDS: Record<string, string> = {
  ٱ: 'ا', // alef wasla
  ة: 'ه', // teh marbuta
  ى: 'ي', // alef maksura
  ی: 'ي', // Farsi yeh
  ک: 'ك' // keheh
}

/**
 * Text as a search compares it: without case, accents, Arabic short vowels and tatweel, with
 * the letters Arabic spells several ways (hamza seats, teh marbuta, alef maksura) folded to one,
 * Arabic-Indic digits read as digits, and runs of space as one.
 */
export function searchKey(text: string): string {
  return (
    text
      // Compatibility decomposition splits hamza and madda off their alef, waw, and yeh seats.
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/ـ/g, '')
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
      .replace(/[ةىٱکی]/g, (letter) => ARABIC_FOLDS[letter] ?? letter)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Whether a suggestion's label matches what was typed: it contains it, as a search reads. */
export function matchesQuery(label: string, query: string): boolean {
  const wanted = searchKey(query)
  return wanted === '' || searchKey(label).includes(wanted)
}

/** The text a row shows: its text layers', in order. */
function rowText(graph: SceneGraph, node: SceneNode): string {
  if (node.type === 'TEXT') return node.text
  return graph
    .getChildren(node.id)
    .map((child) => rowText(graph, child))
    .filter((text) => text !== '')
    .join(' ')
}

/** The suggestions an instance shows: its variant's, or its set's when the variant has none. */
function suggestionsOf(graph: SceneGraph, instance: SceneNode): SuggestionsSpec | null {
  const main = instanceMainComponent(graph, instance)
  if (!main) return null
  const parent = main.parentId ? graph.getNode(main.parentId) : undefined
  return readSuggestions(main) ?? (parent ? readSuggestions(parent) : null)
}

/**
 * Filters the suggestions of the instances below a root in a private graph, by what each
 * one's field holds: `typed` gives a text field's text by its layer path below the root.
 * Writes into `graph`, a copy the caller owns, and returns the layers it changed.
 */
export function showSuggestions(
  graph: SceneGraph,
  rootId: string,
  typed: (fieldPath: string) => string | undefined
): string[] {
  const changed: string[] = []
  const show = (node: SceneNode | undefined, visible: boolean) => {
    if (!node || node.visible === visible) return
    graph.updateNode(node.id, { visible })
    changed.push(node.id)
  }
  const walk = (node: SceneNode) => {
    const spec = node.type === 'INSTANCE' ? suggestionsOf(graph, node) : null
    if (spec) {
      const base = layerPath(graph, rootId, node.id)
      const query = typed(base ? `${base}/${spec.field}` : spec.field) ?? ''
      let shown = 0
      for (const path of spec.options) {
        const row = findLayerByPath(graph, node.id, path)
        if (!row) continue
        const match = matchesQuery(rowText(graph, row), query)
        if (match) shown++
        show(row, match)
      }
      if (spec.empty)
        show(findLayerByPath(graph, node.id, spec.empty), shown === 0 && searchKey(query) !== '')
    }
    for (const child of graph.getChildren(node.id)) walk(child)
  }
  const root = graph.getNode(rootId)
  if (root) walk(root)
  return changed
}
