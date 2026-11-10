<script setup lang="ts">
import { reactive } from 'vue'

import type { StoryGroup } from '@lawha/core/stories'
import type { Epic } from '@lawha/scene-graph/stories'
import { useStoriesMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import { useStories } from '@/app/stories/use'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'

import { stories as storiesTheme } from './ui'

/** The page's epics with their stories, and the stories without one; a story opens its layer. */
defineProps<{ groups: StoryGroup[] }>()

const store = useEditorStore()
const stories = useStories()
const t = useStoriesMessages()
const ui = storiesTheme()

/** Titles being typed, by epic, committed when the field changes. */
const titles = reactive(new Map<string, string>())

function rename(epic: Epic) {
  const title = titles.get(epic.id)
  titles.delete(epic.id)
  if (title !== undefined && title !== epic.title) store.updateEpic(epic.id, { title })
}

function describe(epic: Epic, event: Event) {
  if (event.target instanceof HTMLTextAreaElement) {
    store.updateEpic(epic.id, { description: event.target.value })
  }
}
</script>

<template>
  <section :class="ui.section()" data-slot="epics">
    <div :class="ui.sectionTitle()">
      <span class="flex-1">{{ t.epicsOnPage }}</span>
      <IconButton :label="t.addEpic" data-action="add-epic" @click="store.addEpic()">
        <icon-lucide-plus class="size-3.5" />
      </IconButton>
    </div>
    <p v-if="groups.length === 0" class="text-[11px] text-muted">{{ t.noEpics }}</p>
    <div
      v-for="group in groups"
      :key="group.epic?.id ?? 'none'"
      :class="ui.epic()"
      data-slot="epic"
    >
      <template v-if="group.epic">
        <div class="flex items-center gap-1">
          <AppInput
            :model-value="titles.get(group.epic.id) ?? group.epic.title"
            dir="auto"
            :aria-label="t.epicTitle"
            :placeholder="t.untitledEpic"
            class="flex-1"
            @update:model-value="group.epic && titles.set(group.epic.id, String($event))"
            @change="group.epic && rename(group.epic)"
          />
          <span v-if="group.epic.jiraKey" :class="ui.jiraKey()" dir="ltr">
            {{ group.epic.jiraKey }}
          </span>
          <span
            v-if="group.epic.jira"
            :class="ui.chip()"
            :data-category="group.epic.jira.category"
            dir="auto"
            >{{ group.epic.jira.status }}</span
          >
          <IconButton :label="t.deleteEpic" @click="group.epic && store.removeEpic(group.epic.id)">
            <icon-lucide-trash-2 class="size-3.5" />
          </IconButton>
        </div>
        <AppTextarea
          :model-value="group.epic.description"
          :rows="2"
          dir="auto"
          :aria-label="t.epicDescription"
          :placeholder="t.epicDescription"
          @change="describe(group.epic, $event)"
        />
      </template>
      <span v-else :class="ui.label()">{{ t.withoutEpic }}</span>
      <button
        v-for="{ nodeId, story, path } in group.stories"
        :key="`${nodeId}:${story.id}`"
        type="button"
        :class="ui.epicStory()"
        @click="stories.openStory(nodeId, story.id)"
      >
        <span :class="ui.cardTitle()" dir="auto">{{ story.title || t.untitledStory }}</span>
        <span class="max-w-24 shrink-0 truncate text-muted" dir="auto">{{ path.at(-1) }}</span>
        <span v-if="story.jiraKey" :class="ui.jiraKey()" dir="ltr">{{ story.jiraKey }}</span>
      </button>
    </div>
  </section>
</template>
