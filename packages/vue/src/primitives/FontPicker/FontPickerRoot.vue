<script setup lang="ts">
import { templateRef, unrefElement } from '@vueuse/core'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxVirtualizer,
  ComboboxViewport,
  type AcceptableValue
} from 'reka-ui'
import { nextTick, useTemplateRef, watch } from 'vue'

import type { FontFamilyOption } from '@lawha/core/text'

import { useRetainedPopup } from '#vue/lifecycle/retention/popup'
import type { FontPickerUI } from '#vue/primitives/FontPicker/types'
import { useFontPicker, type FontAccessController } from '#vue/primitives/FontPicker/useFontPicker'

const {
  listFamilies,
  localFontAccess,
  ui,
  searchPlaceholder = 'Search fonts…',
  emptySearchText,
  emptyFontsText,
  emptyFontsHint,
  accessPromptText = 'Allow local font access to browse installed fonts.',
  accessDeniedText = 'Local font access is blocked for this site.',
  accessUnsupportedText = 'Local fonts are not available in this browser.',
  allowAccessText = 'Allow local fonts',
  loadingText = 'Loading…'
} = defineProps<{
  listFamilies: () => Promise<string[] | FontFamilyOption[]>
  localFontAccess?: FontAccessController
  ui?: FontPickerUI
  /** The search field's placeholder. */
  searchPlaceholder?: string
  emptySearchText?: string
  emptyFontsText?: string
  emptyFontsHint?: string
  /** Shown while the browser has not been asked for local font access yet. */
  accessPromptText?: string
  /** Shown when the site may not read local fonts. */
  accessDeniedText?: string
  /** Shown when the browser cannot read local fonts at all. */
  accessUnsupportedText?: string
  /** The button that asks the browser for local font access. */
  allowAccessText?: string
  /** The same button while access is being requested. */
  loadingText?: string
}>()

const modelValue = defineModel<string>({ required: true })
const emit = defineEmits<{ select: [family: string] }>()

const contentRef = templateRef<HTMLElement>('contentRef')

function focusSearchInput() {
  nextTick(() => {
    const content = unrefElement(contentRef)
    if (!(content instanceof HTMLElement)) return
    content.querySelector<HTMLInputElement>('input')?.focus()
  })
}

const { searchTerm, open, filtered, loading, accessState, requestAccess, select } = useFontPicker({
  modelValue,
  listFamilies,
  localFontAccess,
  onSelect: (family) => emit('select', family)
})
const { portalActive } = useRetainedPopup(open)
const root = useTemplateRef<{ highlightItem: (value: AcceptableValue) => void }>('root')

// The families arrive after the list opens, too late for Reka's own scroll to the chosen font.
watch(
  () => open.value && !loading.value && filtered.value.length > 0,
  async (ready) => {
    if (!ready || searchTerm.value) return
    await nextTick()
    root.value?.highlightItem(modelValue.value)
  }
)

/**
 * The list holds font options and the value is a family name; Reka compares them to find the
 * chosen font, so opening scrolls to it.
 */
function sameFamily(left: unknown, right: unknown): boolean {
  return familyOf(left) === familyOf(right)
}

function familyOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'family' in value ? value.family : value
}
</script>

<template>
  <ComboboxRoot
    ref="root"
    v-model:open="open"
    :model-value="modelValue"
    :ignore-filter="true"
    :by="sameFamily"
    @update:model-value="
      (v: AcceptableValue) => {
        if (typeof v === 'string') select(v)
      }
    "
  >
    <ComboboxAnchor as-child>
      <ComboboxTrigger as-child>
        <slot name="trigger" :value="modelValue" :open="open">
          <button :class="ui?.trigger">
            <span class="truncate">{{ modelValue }}</span>
          </button>
        </slot>
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal v-if="portalActive">
      <ComboboxContent
        :side-offset="2"
        align="start"
        position="popper"
        :class="ui?.content"
        @open-auto-focus.prevent
        ref="contentRef"
        @vue:mounted="focusSearchInput"
      >
        <slot name="search" :search-term="searchTerm">
          <ComboboxInput
            v-model="searchTerm"
            :display-value="() => ''"
            :class="ui?.search"
            :placeholder="searchPlaceholder"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </slot>

        <ComboboxViewport :class="ui?.viewport ?? 'max-h-72 overflow-y-auto'">
          <ComboboxVirtualizer
            v-slot="{ option }"
            :options="filtered"
            :text-content="(option: FontFamilyOption) => option.family"
            :estimate-size="36"
          >
            <ComboboxItem
              :value="option.family"
              :class="ui?.item"
              :style="{ fontFamily: `'${option.family}', sans-serif` }"
            >
              <slot
                name="item"
                :family="option.family"
                :source="option.source"
                :selected="option.family === modelValue"
              >
                <ComboboxItemIndicator>
                  <slot name="indicator" :selected="option.family === modelValue" />
                </ComboboxItemIndicator>
                <span class="truncate">{{ option.family }}</span>
              </slot>
            </ComboboxItem>
          </ComboboxVirtualizer>

          <div v-if="filtered.length === 0 && searchTerm" :class="ui?.empty">
            {{ emptySearchText ?? 'No fonts found' }}
          </div>
          <div v-else-if="filtered.length === 0" :class="ui?.empty">
            <div>
              <p v-if="accessState === 'prompt'">{{ accessPromptText }}</p>
              <p v-else-if="accessState === 'denied'">{{ accessDeniedText }}</p>
              <p v-else-if="accessState === 'unsupported'">{{ accessUnsupportedText }}</p>
              <p v-else>{{ emptyFontsText ?? 'No local fonts available.' }}</p>
              <p v-if="emptyFontsHint" class="mt-1">{{ emptyFontsHint }}</p>
              <button
                v-if="accessState === 'prompt'"
                type="button"
                :class="ui?.emptyAction"
                :disabled="loading"
                @click="requestAccess"
              >
                {{ loading ? loadingText : allowAccessText }}
              </button>
            </div>
          </div>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
