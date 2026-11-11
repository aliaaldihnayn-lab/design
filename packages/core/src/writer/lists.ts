import type { WriterNode } from './model'

/** Where a numbered paragraph sits: its list, its nesting level, and how the list numbers. */
export interface ListPlace {
  /** Paragraphs of one list share it; a new id starts a new list at the same level. */
  id: string
  level: number
  ordered: boolean
  start: number
}

export interface ListedBlock {
  node: WriterNode
  list?: ListPlace
}

const dirOf = (node: WriterNode) => node.attrs?.dir ?? 'auto'

/** A list takes its first item's direction, as a browser cannot see past each item's own. */
function newList(place: ListPlace, first: WriterNode): WriterNode {
  const dir = dirOf(first)
  return place.ordered
    ? { type: 'orderedList', attrs: { start: place.start, dir }, content: [] }
    : { type: 'bulletList', attrs: { dir }, content: [] }
}

/**
 * Groups numbered paragraphs into nested lists, as Word and Google Docs store lists flat: one
 * paragraph per item with its list and level. Other blocks end every open list.
 */
export function buildLists(blocks: readonly ListedBlock[]): WriterNode[] {
  const out: WriterNode[] = []
  const stack: Array<{ list: WriterNode; place: ListPlace }> = []
  for (const block of blocks) {
    const place = block.list
    if (!place) {
      stack.length = 0
      out.push(block.node)
      continue
    }
    while ((stack.at(-1)?.place.level ?? -1) > place.level) stack.pop()
    const same = stack.at(-1)?.place
    if (same?.level === place.level && (same.id !== place.id || same.ordered !== place.ordered)) {
      stack.pop()
    }
    let top = stack.at(-1)
    if (!top || top.place.level < place.level) {
      const list = newList(place, block.node)
      const parent = top?.list.content?.at(-1)
      if (parent) parent.content = [...(parent.content ?? []), list]
      else out.push(list)
      top = { list, place }
      stack.push(top)
    }
    top.list.content?.push({
      type: 'listItem',
      attrs: { dir: dirOf(block.node) },
      content: [block.node]
    })
  }
  return out
}
