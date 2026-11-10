<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import IconX from '~icons/lucide/x'

import { usePluginMessages } from '@lawha/vue/i18n'

import { closeRunningPlugin, connectPluginWindow, runningPlugin } from '@/app/plugins/session'
import IconButton from '@/components/ui/button/IconButton.vue'

const t = usePluginMessages()
const frame = useTemplateRef<HTMLIFrameElement>('frame')

const plugin = computed(() => runningPlugin.value)
const pluginWindow = computed(() => plugin.value?.window ?? null)

// Messages wait in the plugin's outbox while no frame is loaded.
watch(pluginWindow, (shown) => {
  if (!shown) connectPluginWindow(null)
})

// A plugin's UI runs in an opaque-origin frame (scripts only, no same-origin access), as in
// Figma; it talks to the plugin's code through `parent.postMessage({ pluginMessage })`.
function onFrameLoad() {
  connectPluginWindow((message) =>
    frame.value?.contentWindow?.postMessage(
      { pluginMessage: message, pluginId: plugin.value?.bundle.manifest.id },
      '*'
    )
  )
}

useEventListener(globalThis, 'message', (event: MessageEvent<unknown>) => {
  const current = plugin.value
  if (!current || !frame.value || event.source !== frame.value.contentWindow) return
  const data = event.data
  if (typeof data !== 'object' || data === null || !('pluginMessage' in data)) return
  void current.session.receiveFromUI(data.pluginMessage, event.origin)
})

onBeforeUnmount(() => connectPluginWindow(null))

const style = computed(() => {
  const w = pluginWindow.value
  if (!w) return {}
  const { width, height, position } = w.options
  const size = { width: `${width}px`, height: `${height + 36}px` }
  if (!position) return size
  return { ...size, left: `${position.x}px`, top: `${position.y}px` }
})
</script>

<template>
  <section
    v-if="plugin && pluginWindow"
    v-show="pluginWindow.visible"
    class="fixed end-4 top-16 z-[900] flex flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
    :style="style"
    data-test-id="plugin-window"
    :aria-label="pluginWindow.options.title"
  >
    <header class="flex h-9 shrink-0 items-center gap-2 border-b border-border ps-3 pe-1 text-xs">
      <span class="flex-1 truncate font-medium" data-test-id="plugin-window-title">
        {{ pluginWindow.options.title }}
      </span>
      <IconButton :label="t.close" data-test-id="plugin-window-close" @click="closeRunningPlugin">
        <IconX />
      </IconButton>
    </header>
    <iframe
      :key="plugin.session.pluginId + pluginWindow.html.length"
      ref="frame"
      class="w-full flex-1 border-0 bg-white"
      sandbox="allow-scripts allow-popups allow-forms"
      :srcdoc="pluginWindow.html"
      :aria-label="pluginWindow.options.title"
      data-test-id="plugin-window-frame"
      @load="onFrameLoad"
    />
  </section>
</template>
