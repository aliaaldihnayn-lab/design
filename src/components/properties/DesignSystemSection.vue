<script setup lang="ts">
import { ref } from 'vue'

import { ALL_TOOLS } from '@lawha/core/tools'
import { useDesignSystemMessages, usePrototypeMessages } from '@lawha/vue/i18n'

import { runEditorTool } from '@/app/ai/tools/runner'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import AppButton from '@/components/ui/button/AppButton.vue'
import Tip from '@/components/ui/overlay/Tip.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

/** `page` builds from the whole page; `selection` from the selected layers only. */
const { scope } = defineProps<{ scope: 'page' | 'selection' }>()

const store = useEditorStore()
const t = useDesignSystemMessages()
const prototype = usePrototypeMessages()
const busy = ref(false)

interface BuildReport {
  variables: { created: number; updated: number }
  bound: number
  inconsistencies: unknown[]
  textStyles?: { styles: unknown[] } | null
  components?: unknown[]
}

function isReport(value: unknown): value is BuildReport {
  return !!value && typeof value === 'object' && 'variables' in value && 'bound' in value
}

/** Draws the interactive kit in the tokens the build just made, so its controls follow them. */
async function buildKit() {
  const def = ALL_TOOLS.find((tool) => tool.name === 'build_interactive_kit')
  if (!def) return
  const result = await runEditorTool({
    store,
    figma: makeFigmaFromStore(store),
    def,
    args: {},
    source: t.value.section
  })
  if (
    result &&
    typeof result === 'object' &&
    'components' in result &&
    Array.isArray(result.components)
  )
    toast.info(prototype.value.kitBuilt({ count: result.components.length }))
}

/** Adds the starter component sets to the current page, on demand. */
async function addComponents() {
  if (busy.value) return
  const def = ALL_TOOLS.find((tool) => tool.name === 'create_component_sets')
  if (!def) return
  busy.value = true
  try {
    const result = await runEditorTool({
      store,
      figma: makeFigmaFromStore(store),
      def,
      args: {},
      source: t.value.section
    })
    if (result && typeof result === 'object' && 'error' in result)
      throw new Error(String(result.error))
    const count =
      result &&
      typeof result === 'object' &&
      'components' in result &&
      Array.isArray(result.components)
        ? result.components.length
        : 0
    toast.info(t.value.componentsDone({ count }))
  } catch (error) {
    toast.error(t.value.failed({ error: error instanceof Error ? error.message : String(error) }))
  } finally {
    busy.value = false
  }
}

async function build() {
  if (busy.value) return
  const def = ALL_TOOLS.find((tool) => tool.name === 'build_design_system')
  if (!def) return
  busy.value = true
  try {
    const result = await runEditorTool({
      store,
      figma: makeFigmaFromStore(store),
      def,
      args: { scope },
      source: t.value.section
    })
    if (result && typeof result === 'object' && 'error' in result)
      throw new Error(String(result.error))
    if (!isReport(result)) return
    const tokens = result.variables.created + result.variables.updated
    toast.info(t.value.done({ tokens, bound: result.bound }))
    toast.info(
      t.value.extras({
        styles: result.textStyles?.styles.length ?? 0,
        components: result.components?.length ?? 0
      })
    )
    if (result.inconsistencies.length > 0)
      toast.warning(t.value.duplicates({ count: result.inconsistencies.length }))
    await buildKit()
  } catch (error) {
    toast.error(t.value.failed({ error: error instanceof Error ? error.message : String(error) }))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PanelSection :label="t.section" data-test-id="design-system-section">
    <Tip :label="t.buildHint">
      <AppButton
        variant="outline"
        class="w-full justify-start"
        data-test-id="design-system-build"
        :disabled="busy"
        @click="build"
      >
        <icon-lucide-swatch-book class="size-3.5" aria-hidden="true" />
        <span class="truncate">{{ t.build }}</span>
        <span class="ms-auto truncate text-muted">
          {{ scope === 'page' ? t.buildPage : t.buildSelection }}
        </span>
      </AppButton>
    </Tip>
    <Tip :label="t.componentsHint">
      <AppButton
        variant="outline"
        class="mt-1 w-full justify-start"
        :disabled="busy"
        @click="addComponents"
      >
        <icon-lucide-component class="size-3.5" aria-hidden="true" />
        <span class="truncate">{{ t.components }}</span>
      </AppButton>
    </Tip>
  </PanelSection>
</template>
