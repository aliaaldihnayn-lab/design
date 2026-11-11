<script setup lang="ts">
import { computed, ref } from 'vue'

import { storyStatement } from '@lawha/scene-graph/stories'
import { useStoriesMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import { openSettingsDialog } from '@/app/settings/dialog'
import { useStoryDraft } from '@/app/stories/draft'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

import StoriesPanelDraftStory from './StoriesPanelDraftStory.vue'
import { stories as storiesTheme } from './ui'

/**
 * Draft user stories for this frame: the AI model drafts a story for the frame and each of its
 * interactive elements, and the person keeps, drops or edits each one before saving.
 */
const { nodeId } = defineProps<{ nodeId: string }>()

const store = useEditorStore()
const draft = useStoryDraft()
const t = useStoriesMessages()
const ui = storiesTheme()

const mine = computed(() => draft.frameId.value === nodeId)
const rows = computed(() =>
  mine.value
    ? (draft.draft.value?.stories ?? []).map((item, index) => ({
        index,
        item,
        layer: store.graph.getNode(item.nodeId)?.name ?? '',
        statement: storyStatement(item.story.narrative)
      }))
    : []
)
/** The drafted stories open for editing, by index. */
const editing = ref(new Set<number>())
function toggleEditing(index: number) {
  const next = new Set(editing.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  editing.value = next
}

const failureText = computed(() => {
  if (!mine.value) return null
  switch (draft.failure.value) {
    case 'no-model':
      return t.value.draftNoModel
    case 'unreadable':
      return t.value.draftUnreadable
    case 'failed':
      return t.value.draftFailed
    default:
      return null
  }
})
</script>

<template>
  <section :class="ui.section()" data-slot="story-draft">
    <AppButton
      v-if="!mine || (!draft.reviewing.value && !draft.drafting.value)"
      variant="outline"
      size="xs"
      :disabled="draft.drafting.value"
      data-action="draft-stories"
      @click="draft.start(nodeId)"
    >
      <icon-lucide-sparkles class="size-3" aria-hidden="true" />
      {{ t.draftForFrame }}
    </AppButton>
    <p v-if="mine && draft.drafting.value" class="text-[11px] text-muted" role="status">
      {{ t.drafting }}
    </p>
    <AppAlert v-if="failureText" tone="error" :heading="failureText">
      <template v-if="draft.failure.value === 'no-model'" #actions>
        <AppButton variant="outline" size="xs" @click="openSettingsDialog('ai')">
          {{ t.draftChooseModel }}
        </AppButton>
      </template>
    </AppAlert>
    <template v-if="mine && draft.reviewing.value">
      <p class="text-[11px] text-muted">{{ t.draftReview({ count: rows.length }) }}</p>
      <div
        v-for="row in rows"
        :key="row.index"
        class="flex flex-col gap-1.5 rounded border border-border p-1.5 text-[11px]"
        data-slot="drafted-story"
      >
        <div class="flex items-start gap-2">
          <input
            :id="`drafted-story-${row.index}`"
            type="checkbox"
            class="mt-0.5"
            :checked="draft.kept.value.has(row.index)"
            @change="draft.toggle(row.index)"
          />
          <label :for="`drafted-story-${row.index}`" class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="font-semibold text-surface" dir="auto">{{ row.item.story.title }}</span>
            <span class="text-muted" dir="auto">{{ t.draftOnLayer({ layer: row.layer }) }}</span>
            <span v-if="row.statement" class="text-surface/80" dir="auto">{{ row.statement }}</span>
            <span class="text-muted">
              {{ t.acceptanceCriteria }}: {{ row.item.story.acceptanceCriteria.length }}
            </span>
          </label>
          <AppButton
            variant="ghost"
            size="xs"
            :aria-expanded="editing.has(row.index)"
            data-action="edit-drafted-story"
            @click="toggleEditing(row.index)"
          >
            {{ editing.has(row.index) ? t.draftDoneEditing : t.draftEdit }}
          </AppButton>
        </div>
        <StoriesPanelDraftStory
          v-if="editing.has(row.index)"
          :story="row.item.story"
          @update="draft.edit(row.index, $event)"
        />
      </div>
      <div class="flex gap-1">
        <AppButton
          size="xs"
          :disabled="draft.kept.value.size === 0"
          data-action="save-draft"
          @click="draft.save()"
        >
          {{ t.draftSave }}
        </AppButton>
        <AppButton variant="ghost" size="xs" data-action="discard-draft" @click="draft.discard()">
          {{ t.draftDiscard }}
        </AppButton>
      </div>
    </template>
  </section>
</template>
