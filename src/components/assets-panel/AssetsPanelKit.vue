<script setup lang="ts">
import { computed, ref } from 'vue'

import { KIT_KINDS, type KitKind } from '@lawha/core/design-system/kit'
import { ALL_TOOLS } from '@lawha/core/tools'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { runEditorTool } from '@/app/ai/tools/runner'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

/** The interactive kit: live controls inserted at the centre of the view. */
const store = useEditorStore()
const t = usePrototypeMessages()
const busy = ref<KitKind | null>(null)
const rtl = ref(false)
const hijri = ref(false)

const camel = (kind: string) => kind.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())
const items = computed(() =>
  KIT_KINDS.map((kind) => ({
    kind,
    name: String(t.value[`kit${camel(kind)}` as keyof typeof t.value] ?? kind)
  }))
)

async function insert(kind: KitKind) {
  const def = ALL_TOOLS.find((tool) => tool.name === 'insert_kit_component')
  if (!def || busy.value) return
  busy.value = kind
  try {
    const parentId = store.state.enteredContainerId ?? store.state.currentPageId
    const center = store.viewportCanvasCenter()
    const point = store.screenToCanvas(center.x, center.y)
    const offset =
      parentId === store.state.currentPageId
        ? { x: 0, y: 0 }
        : store.graph.getAbsolutePosition(parentId)
    const result = await runEditorTool({
      store,
      figma: makeFigmaFromStore(store),
      def,
      args: {
        kind,
        parent_id: parentId,
        x: point.x - offset.x,
        y: point.y - offset.y,
        centered: true,
        rtl: rtl.value,
        calendar: hijri.value ? 'islamic-umalqura' : 'gregory'
      },
      source: t.value.kitSection
    })
    if (result && typeof result === 'object' && 'error' in result)
      throw new Error(String(result.error))
    if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string')
      store.select([result.id])
  } catch (error) {
    toast.error(t.value.failed({ error: error instanceof Error ? error.message : String(error) }))
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section class="mb-3" data-test-id="assets-kit" :aria-label="t.kitSection">
    <h2 class="mb-1 px-1 text-[11px] font-semibold text-muted">{{ t.kitSection }}</h2>
    <p class="mb-1.5 px-1 text-[10px] text-muted">{{ t.kitHint }}</p>
    <div class="mb-1.5 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px]">
      <label class="flex items-center gap-1.5">
        <AppCheckbox v-model="rtl" :ariaLabel="t.kitRtl" />
        <span aria-hidden="true">{{ t.kitRtl }}</span>
      </label>
      <label class="flex items-center gap-1.5">
        <AppCheckbox v-model="hijri" :ariaLabel="t.kitHijri" />
        <span aria-hidden="true">{{ t.kitHijri }}</span>
      </label>
    </div>
    <div class="grid grid-cols-2 gap-1">
      <button
        v-for="item in items"
        :key="item.kind"
        type="button"
        class="truncate rounded px-1.5 py-1 text-start text-xs text-surface outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-panel-focus"
        :aria-label="t.kitInsert({ name: item.name })"
        :aria-busy="busy === item.kind"
        :data-kit-kind="item.kind"
        @click="insert(item.kind)"
      >
        {{ item.name }}
      </button>
    </div>
  </section>
</template>
