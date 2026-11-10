<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { computed, ref } from 'vue'

import {
  INSPECT_LANGUAGES,
  inspectCode,
  inspectLayer,
  type InspectColor,
  type InspectLanguage,
  type InspectSpec
} from '@lawha/core/inspect'
import { useInspectMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'
import SegmentedControl from '@/components/ui/select/SegmentedControl.vue'

const { active = true } = defineProps<{ active?: boolean }>()

const store = useEditorStore()
const t = useInspectMessages()
const language = ref<InspectLanguage>('css')
const { copy, copied } = useClipboard({ copiedDuring: 2000 })

/** The single selected layer's spec, read again after every edit while the tab is open. */
const spec = computed<InspectSpec | null>(() => {
  void store.state.sceneVersion
  if (!active || store.state.selectedIds.size !== 1) return null
  const [id] = store.state.selectedIds
  return inspectLayer(store.graph, id)
})

const LANGUAGE_LABELS: Record<InspectLanguage, string> = {
  css: 'CSS',
  swiftui: 'iOS · SwiftUI',
  compose: 'Android · Compose'
}
const languageOptions = INSPECT_LANGUAGES.map((value) => ({ value, label: LANGUAGE_LABELS[value] }))

const snippet = computed(() => (spec.value ? inspectCode(spec.value, language.value) : ''))

const num = (value: number) => `${Math.round(value * 100) / 100}`
const sizingLabel = (sizing: InspectSpec['sizing']['width']) =>
  ({ fixed: t.value.sizingFixed, hug: t.value.sizingHug, fill: t.value.sizingFill })[sizing]

/** Every colour the layer draws with: fills, strokes, shadows and text. */
const colors = computed<InspectColor[]>(() => {
  const s = spec.value
  if (!s) return []
  return [
    ...s.fills.flatMap((paint) => (paint.kind === 'solid' ? [paint] : [])),
    ...s.strokes,
    ...s.shadows,
    ...(s.text?.color ? [s.text.color] : [])
  ]
})

const rows = computed(() => {
  const s = spec.value
  if (!s) return []
  const out: { label: string; value: string }[] = [
    {
      label: t.value.size,
      value: `${num(s.width)} × ${num(s.height)} · ${sizingLabel(s.sizing.width)} / ${sizingLabel(s.sizing.height)}`
    }
  ]
  const { minWidth, maxWidth, minHeight, maxHeight } = s.sizing
  if ([minWidth, maxWidth, minHeight, maxHeight].some((v) => v !== null)) {
    const pair = (a: number | null, b: number | null) => `${a ?? '–'} … ${b ?? '–'}`
    out.push({
      label: t.value.limits,
      value: `W ${pair(minWidth, maxWidth)} · H ${pair(minHeight, maxHeight)}`
    })
  }
  if (s.layout)
    out.push({
      label: t.value.layout,
      value: `${s.layout.direction} · gap ${s.layout.gap} · padding ${s.layout.padding.join(' ')}`
    })
  if (s.radii) out.push({ label: t.value.radius, value: s.radii.map(num).join(' ') })
  if (s.text)
    out.push({
      label: t.value.typography,
      value: `${s.text.family} ${s.text.weight} · ${num(s.text.size)}/${s.text.lineHeight === null ? 'auto' : num(s.text.lineHeight)}`
    })
  return out
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-test-id="inspect-panel">
    <AppPlaceholder
      v-if="!spec"
      size="compact"
      :fill="false"
      :label="t.tab"
      :description="t.noSelection"
    />
    <template v-else>
      <header class="border-b border-border px-3 py-2 text-xs font-semibold text-surface">
        {{ spec.name }}
      </header>
      <dl
        class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-b border-border px-3 py-2 text-[11px]"
      >
        <template v-for="row in rows" :key="row.label">
          <dt class="text-muted">{{ row.label }}</dt>
          <dd class="min-w-0 truncate text-end font-mono text-surface" dir="ltr">
            {{ row.value }}
          </dd>
        </template>
      </dl>
      <section v-if="colors.length > 0" class="border-b border-border px-3 py-2">
        <h3 class="mb-1.5 text-[11px] font-semibold text-surface">{{ t.colors }}</h3>
        <ul class="flex flex-col gap-1">
          <li
            v-for="(color, index) in colors"
            :key="index"
            class="flex items-center gap-2 text-[11px]"
            data-test-id="inspect-color"
          >
            <span
              class="size-4 shrink-0 rounded border border-border"
              :style="{ background: color.css }"
            />
            <span class="font-mono text-surface" dir="ltr">{{ color.css }}</span>
            <span v-if="color.variable" class="ms-auto truncate text-muted" dir="ltr">
              {{ color.variable.name }}
            </span>
          </li>
        </ul>
      </section>
      <section class="flex flex-col gap-2 px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-[11px] font-semibold text-surface">{{ t.code }}</h3>
          <AppButton variant="ghost" size="xs" data-test-id="inspect-copy" @click="copy(snippet)">
            <icon-lucide-check v-if="copied" class="size-3.5" aria-hidden="true" />
            <icon-lucide-copy v-else class="size-3.5" aria-hidden="true" />
            {{ t.copy }}
          </AppButton>
        </div>
        <SegmentedControl
          v-model="language"
          :options="languageOptions"
          :label="t.code"
          data-test-id="inspect-language"
        />
        <pre
          class="overflow-x-auto rounded bg-input p-2 font-mono text-[11px] leading-relaxed text-surface select-text"
          dir="ltr"
          data-test-id="inspect-code"
          >{{ snippet }}</pre>
      </section>
    </template>
  </div>
</template>
