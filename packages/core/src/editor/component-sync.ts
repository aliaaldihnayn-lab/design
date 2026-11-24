import type { SceneGraph, SceneNode } from '@lawha/scene-graph'

import { layoutNodeAndAncestors } from '#core/layout/mutations'

const isComponent = (node: SceneNode) => node.type === 'COMPONENT'

function componentSyncOrder(graph: SceneGraph, seeds: Set<string>): string[] {
  const dependents = new Map<string, Set<string>>()
  const discover = (id: string): void => {
    if (dependents.has(id)) return
    const parents = new Set<string>()
    dependents.set(id, parents)
    for (const instance of graph.getInstances(id)) {
      const parent = instance.parentId ? graph.closest(instance.parentId, isComponent) : undefined
      if (parent) parents.add(parent.id)
    }
    for (const parent of parents) discover(parent)
  }
  for (const id of seeds) discover(id)
  const result: string[] = []
  const active = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (active.has(id)) throw new Error('Cyclic component synchronization dependency')
    if (visited.has(id)) return
    active.add(id)
    for (const parent of dependents.get(id) ?? []) visit(parent)
    active.delete(id)
    visited.add(id)
    result.push(id)
  }
  for (const id of seeds) visit(id)
  return result.reverse()
}

type LayoutNode = (graph: SceneGraph, nodeId: string) => void

/**
 * Only the layers a sync changed need layout work: the synced components and every instance of
 * them, which may sit on another page, each with the auto-layout frames above it. Laying out
 * their whole pages instead costs as much as the page holds on every sync, which a build that
 * draws many components one after another pays thousands of times.
 */
function syncedLayoutRoots(graph: SceneGraph, componentIds: Iterable<string>): string[] {
  const candidates = new Set<string>()
  for (const componentId of componentIds) {
    if (!graph.getNode(componentId)) continue
    candidates.add(componentId)
    for (const instance of graph.getInstances(componentId)) candidates.add(instance.id)
  }
  // A root inside another root is laid out with it.
  return [...candidates].filter((id) => {
    let parentId = graph.getNode(id)?.parentId ?? null
    while (parentId) {
      if (candidates.has(parentId)) return false
      parentId = graph.getNode(parentId)?.parentId ?? null
    }
    return true
  })
}

export function createComponentSyncScheduler(
  getGraph: () => SceneGraph,
  requestRender: () => void,
  layoutNode: LayoutNode = layoutNodeAndAncestors
) {
  let pendingComponentSync: Set<string> | null = null
  let isFlushingComponentSync = false

  function flushComponentSync() {
    const ids = pendingComponentSync
    if (!ids) return
    pendingComponentSync = null
    isFlushingComponentSync = true
    try {
      const graph = getGraph()
      const componentIds = new Set<string>()
      for (const id of ids) {
        const component = graph.closest(id, isComponent)
        if (component) componentIds.add(component.id)
      }
      const order = componentSyncOrder(graph, componentIds)
      graph.syncInstancesTogether(order)
      if (componentIds.size > 0) {
        for (const id of syncedLayoutRoots(graph, order)) layoutNode(graph, id)
        requestRender()
      }
    } finally {
      isFlushingComponentSync = false
    }
  }

  function scheduleComponentSync(nodeId: string) {
    // Import/materialization has already resolved component overrides. These updates
    // are not authored component edits and must not reset instances to their defaults.
    // Layout's own writes are results, not edits: it lays out the instances too, and the edit
    // that made it run has already scheduled its sync.
    const graph = getGraph()
    if (isFlushingComponentSync || graph.isApplyingImportedState || graph.isApplyingLayout) return
    if (!pendingComponentSync) {
      pendingComponentSync = new Set()
      queueMicrotask(flushComponentSync)
    }
    pendingComponentSync.add(nodeId)
  }

  return { scheduleComponentSync }
}
