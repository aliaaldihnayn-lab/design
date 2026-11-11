import type { GUID } from '@lawha/kiwi/fig'
import { guidToString } from '@lawha/kiwi/fig/guid'
import type { SceneGraph } from '@lawha/scene-graph'

import { getPluginData, LAWHA_PLUGIN_DATA_NAMESPACE } from '#core/figma-api/plugin-data'
import { splitForFig } from '#core/prototype/fig'
import { INTERACTIONS_KEY, KEPT_INTERACTIONS_KEY, readInteractions } from '#core/prototype/model'

import type { KiwiNodeChange } from './setup'

/**
 * Writes Lawha's prototype interactions on the records as Figma's own `prototypeInteractions`,
 * once every record has its GUID, so destinations written later resolve too, and set-variable
 * and conditional actions name the variables written. Lawha's own data on the record then keeps
 * only the interactions Figma's form loses something of. Layers without interactions of Lawha's
 * keep the ones they were read with.
 */
export function writePrototypeInteractions(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  nodeIdToGuid: ReadonlyMap<string, GUID>,
  assignedGuidValues: Set<string>,
  localIdCounter: { value: number },
  varIdToGuid: ReadonlyMap<string, GUID> = new Map()
): void {
  const nodeByGuid = new Map<string, string>()
  for (const [nodeId, guid] of nodeIdToGuid) nodeByGuid.set(guidToString(guid), nodeId)
  const variableByGuid = new Map<string, string>()
  for (const [variableId, guid] of varIdToGuid) variableByGuid.set(guidToString(guid), variableId)
  const nextGuid = (): GUID => {
    const guid = { sessionID: 1, localID: localIdCounter.value++ }
    assignedGuidValues.add(guidToString(guid))
    return guid
  }
  const targets = {
    graph,
    guidOf: (id: string) => nodeIdToGuid.get(id),
    variables: {
      guidOf: (id: string) => (graph.variables.has(id) ? varIdToGuid.get(id) : undefined),
      variableOf: (guid: GUID) => variableByGuid.get(guidToString(guid))
    }
  }
  for (const change of nodeChanges) {
    const nodeId = change.guid ? nodeByGuid.get(guidToString(change.guid)) : undefined
    const node = nodeId ? graph.getNode(nodeId) : undefined
    if (!node || !getPluginData(node, INTERACTIONS_KEY)) continue
    const { figma, kept } = splitForFig(readInteractions(node), targets, nextGuid)
    change.prototypeInteractions = figma
    const others = (change.pluginData ?? []).filter(
      (entry) =>
        entry.pluginID !== LAWHA_PLUGIN_DATA_NAMESPACE ||
        (entry.key !== INTERACTIONS_KEY && entry.key !== KEPT_INTERACTIONS_KEY)
    )
    change.pluginData =
      kept.length > 0
        ? [
            ...others,
            {
              pluginID: LAWHA_PLUGIN_DATA_NAMESPACE,
              key: KEPT_INTERACTIONS_KEY,
              value: JSON.stringify(kept)
            }
          ]
        : others
  }
}
