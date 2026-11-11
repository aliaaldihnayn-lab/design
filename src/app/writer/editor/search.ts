import { Extension, type Range } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction
} from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** A match of the find bar's query, in document positions. */
export type SearchMatch = Range

export interface SearchQuery {
  text: string
  matchCase: boolean
}

/**
 * Every match of `query` in the document. Text is searched per paragraph, so a match may cross
 * bold or link boundaries but never a paragraph break, as in Word.
 */
export function findMatches(doc: ProseMirrorNode, query: SearchQuery): SearchMatch[] {
  if (!query.text) return []
  const needle = query.matchCase ? query.text : query.text.toLocaleLowerCase()
  const matches: SearchMatch[] = []
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true
    // Map each character of the paragraph's text back to its document position.
    let text = ''
    const positions: number[] = []
    block.forEach((child, offset) => {
      if (!child.isText) return
      const value = child.text ?? ''
      for (let i = 0; i < value.length; i += 1) positions.push(blockPos + 1 + offset + i)
      text += value
    })
    const haystack = query.matchCase ? text : text.toLocaleLowerCase()
    for (
      let index = haystack.indexOf(needle);
      index !== -1;
      index = haystack.indexOf(needle, index + needle.length)
    ) {
      const from = positions[index]
      const to = positions[index + needle.length - 1] + 1
      matches.push({ from, to })
    }
    return false
  })
  return matches
}

/** Replaces the given matches, last first so earlier positions stay valid. */
export function replaceMatches(
  tr: Transaction,
  matches: readonly SearchMatch[],
  replacement: string
): Transaction {
  for (const match of [...matches].sort((a, b) => b.from - a.from)) {
    const marks = tr.doc.resolve(match.from + 1).marks()
    if (replacement)
      tr.replaceWith(match.from, match.to, tr.doc.type.schema.text(replacement, marks))
    else tr.delete(match.from, match.to)
  }
  return tr
}

interface SearchState {
  query: SearchQuery
  matches: SearchMatch[]
  current: number
}

export const searchKey = new PluginKey<SearchState>('writerSearch')

type SearchMeta = { query: SearchQuery } | { current: number }

function decorations(state: EditorState): DecorationSet {
  const search = searchKey.getState(state)
  if (!search?.matches.length) return DecorationSet.empty
  return DecorationSet.create(
    state.doc,
    search.matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === search.current ? 'find-match find-current' : 'find-match'
      })
    )
  )
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    writerSearch: {
      setSearch: (query: SearchQuery) => ReturnType
      goToMatch: (step: 1 | -1) => ReturnType
      replaceMatch: (replacement: string) => ReturnType
      replaceAllMatches: (replacement: string) => ReturnType
    }
  }
}

/** Find and replace: highlights every match, steps through them, and replaces one or all. */
export const Search = Extension.create({
  name: 'writerSearch',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: { text: '', matchCase: false }, matches: [], current: 0 }),
          apply(tr, previous, _old, state) {
            const meta = tr.getMeta(searchKey) as SearchMeta | undefined
            if (meta && 'current' in meta) return { ...previous, current: meta.current }
            const query = meta?.query ?? previous.query
            if (!meta && !tr.docChanged) return previous
            const matches = findMatches(state.doc, query)
            const current = meta ? 0 : Math.min(previous.current, Math.max(matches.length - 1, 0))
            return { query, matches, current }
          }
        },
        props: { decorations }
      })
    ]
  },
  addCommands() {
    return {
      setSearch:
        (query) =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setMeta(searchKey, { query }))
          return true
        },
      goToMatch:
        (step) =>
        ({ state, tr, dispatch }) => {
          const search = searchKey.getState(state)
          if (!search?.matches.length) return false
          const current = (search.current + step + search.matches.length) % search.matches.length
          const match = search.matches[current]
          dispatch?.(
            tr
              .setMeta(searchKey, { current })
              .setSelection(TextSelection.create(tr.doc, match.from, match.to))
              .scrollIntoView()
          )
          return true
        },
      replaceMatch:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const search = searchKey.getState(state)
          const match = search?.matches[search.current]
          if (!match) return false
          dispatch?.(replaceMatches(tr, [match], replacement))
          return true
        },
      replaceAllMatches:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const search = searchKey.getState(state)
          if (!search?.matches.length) return false
          dispatch?.(replaceMatches(tr, search.matches, replacement))
          return true
        }
    }
  }
})

/** How many matches there are and which one is current, for the find bar. */
export function searchStatus(state: EditorState): { total: number; current: number } {
  const search = searchKey.getState(state)
  return { total: search?.matches.length ?? 0, current: search?.current ?? 0 }
}
