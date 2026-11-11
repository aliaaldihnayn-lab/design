<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { computed, ref } from 'vue'

import { useWriterMessages } from '@lawha/vue/i18n'

import { useDateFormat } from '@/app/i18n/date'
import {
  addComment,
  commentQuote,
  deleteComment,
  selectComment,
  setCommentResolved
} from '@/app/writer/comments'
import {
  resolveChanges,
  trackedChanges,
  type TrackedChange
} from '@/app/writer/editor/track-changes'
import { updateWriterDocument, writerAuthor, writerDocument } from '@/app/writer/session'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import AppSwitch from '@/components/ui/toggle/AppSwitch.vue'

import { writer } from './ui'

/** Review: comments on the selection and tracked changes to accept or reject. */
const { editor, tab } = defineProps<{ editor: Editor; tab: 'comments' | 'changes' }>()
const emit = defineEmits<{ close: [] }>()
const t = useWriterMessages()
const dates = useDateFormat()
const ui = writer()

const draft = ref('')
const hasSelection = computed(() => !editor.state.selection.empty)
const comments = computed(() => writerDocument.value.comments)

function submitComment() {
  if (addComment(editor, draft.value)) draft.value = ''
}

const changes = computed(() => trackedChanges(editor.state.doc))
const tracking = computed({
  get: () => writerDocument.value.trackChanges,
  set: (trackChanges: boolean) => updateWriterDocument({ trackChanges })
})

function resolve(list: readonly TrackedChange[], accept: boolean) {
  editor.view.dispatch(resolveChanges(editor.state, list, accept))
}

const formatDate = (value: string) => (value ? dates.format(value, 'dateTime') : '')
</script>

<template>
  <aside
    :class="ui.side()"
    :aria-label="tab === 'comments' ? t.comments : t.changes"
    data-test-id="writer-side"
  >
    <div :class="ui.sideHeader()">
      <span>{{ tab === 'comments' ? t.comments : t.changes }}</span>
      <IconButton :label="t.cancel" @click="emit('close')"
        ><icon-lucide-x class="size-3.5"
      /></IconButton>
    </div>
    <div :class="ui.sideBody()">
      <label class="flex flex-col gap-1">
        <span class="text-muted">{{ t.authorName }}</span>
        <AppInput v-model="writerAuthor" :aria-label="t.authorName" />
      </label>
      <template v-if="tab === 'comments'">
        <form class="flex flex-col gap-1.5" @submit.prevent="submitComment">
          <AppTextarea
            v-model="draft"
            :rows="2"
            :aria-label="t.commentPlaceholder"
            :placeholder="t.commentPlaceholder"
            data-test-id="writer-comment-draft"
          />
          <p v-if="!hasSelection" class="text-muted">{{ t.selectTextFirst }}</p>
          <AppButton
            size="sm"
            type="submit"
            :disabled="!hasSelection || !draft.trim()"
            data-test-id="writer-comment-add"
          >
            {{ t.addComment }}
          </AppButton>
        </form>
        <p v-if="!comments.length" class="text-muted">{{ t.noComments }}</p>
        <article
          v-for="comment in comments"
          :key="comment.id"
          :class="ui.card()"
          :data-resolved="comment.resolved ? '' : undefined"
          data-test-id="writer-comment"
        >
          <button
            type="button"
            class="flex flex-col gap-1 text-start"
            @click="selectComment(editor, comment.id)"
          >
            <span class="font-semibold text-surface">{{ comment.author }}</span>
            <span class="text-[10px] text-muted">{{ formatDate(comment.date) }}</span>
            <span class="line-clamp-2 border-s-2 border-warning ps-1.5 text-muted">{{
              commentQuote(editor, comment.id)
            }}</span>
            <span class="whitespace-pre-wrap text-surface">{{ comment.text }}</span>
          </button>
          <div class="flex justify-end gap-1">
            <AppButton
              size="xs"
              variant="ghost"
              @click="setCommentResolved(comment.id, !comment.resolved)"
            >
              {{ comment.resolved ? t.reopen : t.resolve }}
            </AppButton>
            <IconButton :label="t.deleteComment" @click="deleteComment(editor, comment.id)">
              <icon-lucide-trash-2 class="size-3" />
            </IconButton>
          </div>
        </article>
      </template>
      <template v-else>
        <div class="flex items-center justify-between gap-2">
          <span>{{ t.trackChanges }}</span
          ><AppSwitch
            v-model="tracking"
            :label="t.trackChanges"
            data-test-id="writer-track-switch"
          />
        </div>
        <div class="flex gap-1.5">
          <AppButton
            size="xs"
            variant="outline"
            :disabled="!changes.length"
            @click="resolve(changes, true)"
          >
            {{ t.acceptAll }}
          </AppButton>
          <AppButton
            size="xs"
            variant="outline"
            :disabled="!changes.length"
            @click="resolve(changes, false)"
          >
            {{ t.rejectAll }}
          </AppButton>
        </div>
        <p v-if="!changes.length" class="text-muted">{{ t.noChanges }}</p>
        <article
          v-for="change in changes"
          :key="`${change.type}:${change.from}`"
          :class="ui.card()"
          data-test-id="writer-change"
        >
          <span class="font-semibold text-surface">
            {{ change.type === 'insertion' ? t.inserted : t.deleted }} · {{ change.author }}
          </span>
          <span class="text-[10px] text-muted">{{ formatDate(change.date) }}</span>
          <span
            :data-change="change.type"
            class="text-surface data-[change=deletion]:line-through"
            >{{ change.text }}</span
          >
          <div class="flex justify-end gap-1">
            <AppButton size="xs" variant="ghost" @click="resolve([change], true)">{{
              t.accept
            }}</AppButton>
            <AppButton size="xs" variant="ghost" @click="resolve([change], false)">{{
              t.reject
            }}</AppButton>
          </div>
        </article>
      </template>
    </div>
  </aside>
</template>
