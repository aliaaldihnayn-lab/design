import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'

/**
 * A publication's pages are the frames placed directly on a canvas page, in reading order: rows
 * from the top, each row from the left. Master pages, being components, are not pages.
 */
export function publicationPages(graph: SceneGraph, canvasId: string): SceneNode[] {
  const canvas = graph.getNode(canvasId)
  if (!canvas) return []
  const frames = canvas.childIds.flatMap((id) => {
    const node = graph.getNode(id)
    return node?.type === 'FRAME' && node.visible ? [node] : []
  })
  // A frame starts a new row once it sits below half the height of the row's first frame.
  const sorted = frames.toSorted((a, b) => a.y - b.y || a.x - b.x)
  const rows: SceneNode[][] = []
  for (const frame of sorted) {
    const row = rows.at(-1)
    const first = row?.[0]
    if (row && first && frame.y < first.y + first.height / 2) row.push(frame)
    else rows.push([frame])
  }
  return rows.flatMap((row) => row.toSorted((a, b) => a.x - b.x))
}

export function isMasterPage(node: SceneNode | undefined): boolean {
  return (
    node?.type === 'COMPONENT' &&
    readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.masterPage)?.role === 'master'
  )
}

/** The master pages of a canvas page, in layer order. */
export function masterPages(graph: SceneGraph, canvasId: string): SceneNode[] {
  return (graph.getNode(canvasId)?.childIds ?? []).flatMap((id) => {
    const node = graph.getNode(id)
    return node && isMasterPage(node) ? [node] : []
  })
}

/** The instance a page shows its master through, if one is applied. */
export function appliedMaster(graph: SceneGraph, page: SceneNode): SceneNode | undefined {
  return page.childIds
    .map((id) => graph.getNode(id))
    .find(
      (child) =>
        child?.type === 'INSTANCE' &&
        readPluginData(child.pluginData, LAWHA_PLUGIN_DATA.masterPage)?.role === 'applied'
    )
}

/** The frame on the canvas a layer is in: the layer itself or its outermost container. */
export function topLevelAncestor(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode = node
  while (current.parentId) {
    const parent = graph.getNode(current.parentId)
    if (!parent || parent.type === 'CANVAS') return current
    current = parent
  }
  return undefined
}

/** The canvas page a layer is on. */
export function canvasOf(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  const top = topLevelAncestor(graph, node)
  return top?.parentId ? graph.getNode(top.parentId) : undefined
}

/** A page number template filled in: `{page}` is the number, `{pages}` the page count. */
export function formatPageNumber(template: string, page: number | null, pages: number): string {
  return template
    .replaceAll('{page}', page === null ? '#' : String(page))
    .replaceAll('{pages}', String(pages))
}
