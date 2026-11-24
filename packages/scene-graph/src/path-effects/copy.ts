import { readPluginData, withPluginData } from '../plugin-data/field'
import { LAWHA_PLUGIN_DATA } from '../plugin-data/fields'
import type { PluginDataEntry } from '../types'

/**
 * A copied live blend's plugin data, its ends, steps, and spine pointed at their copies by
 * `mapped`, so the copy stays live instead of naming the original's children. Plugin data
 * without a live blend comes back as it is.
 */
export function remapLiveBlendIds(
  pluginData: readonly PluginDataEntry[],
  mapped: (id: string) => string
): readonly PluginDataEntry[] {
  const blend = readPluginData(pluginData, LAWHA_PLUGIN_DATA.liveBlend)
  if (!blend) return pluginData
  return withPluginData(pluginData, LAWHA_PLUGIN_DATA.liveBlend, {
    ...blend,
    fromId: mapped(blend.fromId),
    toId: mapped(blend.toId),
    ...(blend.spineId ? { spineId: mapped(blend.spineId) } : {}),
    stepIds: blend.stepIds.map(mapped)
  })
}
