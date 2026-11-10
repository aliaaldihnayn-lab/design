import type { GUID } from '@lawha/kiwi/fig'
import { guidToString } from '@lawha/kiwi/fig/guid'
import type { SceneGraph } from '@lawha/scene-graph'

import { getPluginData } from '#core/figma-api/plugin-data'
import { figPrototypeInteractions } from '#core/prototype/fig'
import { INTERACTIONS_KEY, readInteractions } from '#core/prototype/model'

import type { KiwiNodeChange } from './setup'

/**
 * Writes Lawha's prototype interactions on the records as Figma's own `prototypeInteractions`,
 * once every record has its GUID, so destinations written later resolve too. Layers without
 * interactions of Lawha's keep the ones they were read with.
 */
export function writePrototypeInteractions(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  nodeIdToGuid: ReadonlyMap<string, GUID>,
  assignedGuidValues: Set<string>,
  localIdCounter: { value: number }
): void {
  const nodeByGuid = new Map<string, string>()
  for (const [nodeId, guid] of nodeIdToGuid) nodeByGuid.set(guidToString(guid), nodeId)
  const nextGuid = (): GUID => {
    const guid = { sessionID: 1, localID: localIdCounter.value++ }
    assignedGuidValues.add(guidToString(guid))
    return guid
  }
  for (const change of nodeChanges) {
    const nodeId = change.guid ? nodeByGuid.get(guidToString(change.guid)) : undefined
    const node = nodeId ? graph.getNode(nodeId) : undefined
    if (!node || !getPluginData(node, INTERACTIONS_KEY)) continue
    change.prototypeInteractions = figPrototypeInteractions(
      readInteractions(node),
      (id) => nodeIdToGuid.get(id),
      nextGuid
    )
  }
}
