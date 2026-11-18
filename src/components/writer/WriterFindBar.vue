<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { computed, onMounted, ref, watch } from 'vue'

import { useWriterMessages } from '@lawha/vue/i18n'

import { searchStatus } from '@/app/writer/editor/search'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

import { writer } from './ui'

/** Find and replace over the body, highlighting every match as Word does. */
const { editor } = defineProps<{ editor: Editor }>()
const emit = defineEmits<{ close: [] }>()
const t = useWriterMessages()
const ui = writer()

const query = ref('')
const replacement = ref('')
const matchCase = ref(false)
const replaced = ref<number | null>(null)
const findInput = ref<{ focus: () => void } | null>(null)

watch([query, matchCase], ([text, caseSensitive]) => {
  replaced.value = null
  editor.commands.setSearch({ text, matchCase: caseSensitive })
})

const status = computed(() => searchStatus(editor.state))
const position = computed(() => {
  if (!query.value) return ''
  if (!status.value.total) return t.value.noMatches
  return t.value.matchPosition({
    current: String(status.value.current + 1),
    total: String(status.value.total)
  })
})

function replaceAll() {
  const count = status.value.total
  if (editor.commands.replaceAllMatches(replacement.value)) replaced.value = count
}

function close() {
  editor.commands.setSearch({ text: '', matchCase: false })
  emit('close')
}

onMounted(() => findInput.value?.focus())
</script>

<template>
  <div :class="ui.findBar()" role="search" data-test-id="writer-find">
    <AppInput
      ref="findInput"
      v-model="query"
      class="w-48"
      :aria-label="t.find"
      :placeholder="t.findPlaceholder"
      data-test-id="writer-find-input"
      @keydown.enter.prevent="editor.commands.goToMatch($event.shiftKey ? -1 : 1)"
      @keydown.esc="close"
    />
    <IconButton
      :label="t.previousMatch"
      :disabled="!status.total"
      @click="editor.commands.goToMatch(-1)"
    >
      <icon-lucide-chevron-up class="size-3.5" />
    </IconButton>
    <IconButton
      :label="t.nextMatch"
      :disabled="!status.total"
      @click="editor.commands.goToMatch(1)"
    >
      <icon-lucide-chevron-down class="size-3.5" />
    </IconButton>
    <span class="min-w-16 text-muted" role="status" data-test-id="writer-find-status">{{
      replaced === null ? position : t.replacedCount({ count: String(replaced) })
    }}</span>
    <label class="flex items-center gap-1">
      <AppCheckbox v-model="matchCase" :ariaLabel="t.matchCase" />
      <span>{{ t.matchCase }}</span>
    </label>
    <AppInput
      v-model="replacement"
      class="w-48"
      :aria-label="t.replaceWith"
      :placeholder="t.replaceWith"
      data-test-id="writer-replace-input"
    />
    <AppButton
      size="sm"
      variant="outline"
      :disabled="!status.total"
      @click="editor.commands.replaceMatch(replacement)"
    >
      {{ t.replace }}
    </AppButton>
    <AppButton
      size="sm"
      variant="outline"
      :disabled="!status.total"
      data-test-id="writer-replace-all"
      @click="replaceAll"
    >
      {{ t.replaceAll }}
    </AppButton>
    <IconButton :label="t.cancel" class="ms-auto" @click="close"
      ><icon-lucide-x class="size-3.5"
    /></IconButton>
  </div>
</template>
