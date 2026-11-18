import type { SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'

import { groupFitOptions } from '#core/canvas/boolean'
import type { EditorContext } from '#core/editor/types'

import { liveBlendOf, regenerateBlend } from '.'

/** Changes to a blend's end or spine that leave its steps as they were, such as a rename. */
const IGNORED_FIELDS = new Set<keyof SceneNode>(['name', 'locked', 'pluginData', 'expanded'])

/**
 * Keeps live blends in step with their ends, as Illustrator does: when an end or the spine of a
 * live blend changes, its steps are made again once the change has landed. Several changes in
 * one edit rebuild a blend once.
 */
export function watchLiveBlends(ctx: EditorContext): () => void {
  const pending = new Set<string>()
  let rebuilding = false

  function rebuild() {
    const renderer = ctx.getRenderer()
    const ids = [...pending]
    pending.clear()
    if (!renderer) return
    rebuilding = true
    try {
      for (const id of ids) {
        const group = ctx.graph.getNode(id)
        const blend = group && liveBlendOf(ctx.graph, group)
        if (!group || !blend) continue
        regenerateBlend(renderer, ctx.graph, group, blend, groupFitOptions(renderer, ctx.graph))
      }
    } finally {
      rebuilding = false
    }
    ctx.requestRender()
  }

  return ctx.onEditorEvent('node:updated', (id, changes) => {
    if (rebuilding) return
    if (Object.keys(changes).every((key) => IGNORED_FIELDS.has(key as keyof SceneNode))) return
    const node = ctx.graph.getNode(id)
    const group = node?.parentId ? ctx.graph.getNode(node.parentId) : undefined
    const blend = group && readPluginData(group.pluginData, LAWHA_PLUGIN_DATA.liveBlend)
    if (!group || !blend) return
    if (id !== blend.fromId && id !== blend.toId && id !== blend.spineId) return
    if (pending.size === 0) queueMicrotask(rebuild)
    pending.add(group.id)
  })
}
