<script setup lang="ts">
import { computed } from 'vue'

import { runningPlugins } from '@/app/plugins/session'
import PluginFrame from '@/components/plugins/PluginFrame.vue'

/** Space between plugin windows placed side by side. */
const GAP = 12

/** Windows without a position of their own sit side by side from the end edge, newest last. */
const offsets = computed(() => {
  let offset = 16
  return runningPlugins.value.map((plugin) => {
    const at = offset
    if (plugin.window?.visible && !plugin.window.options.position)
      offset += plugin.window.options.width + GAP
    return at
  })
})
</script>

<template>
  <PluginFrame
    v-for="(plugin, index) in runningPlugins"
    :key="plugin.key"
    :plugin="plugin"
    :offset="offsets[index]"
  />
</template>
