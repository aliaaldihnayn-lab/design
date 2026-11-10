<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { storyGaps } from '@lawha/core/stories'
import {
  createAcceptanceCriterion,
  STORY_PRIORITIES,
  STORY_STATUSES,
  type Epic,
  type UserStory
} from '@lawha/scene-graph/stories'
import { useStoriesMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { stories as storiesTheme } from './ui'

/**
 * One story of the selected layer: collapsed to its title, Jira key and status, or open as its
 * editor. Fields commit when they change (on blur or Enter), so a sentence typed is one undo
 * step, and every text field follows the direction of what is typed, Arabic included.
 */
const {
  nodeId,
  story,
  epics,
  focused = false
} = defineProps<{
  nodeId: string
  story: UserStory
  epics: Epic[]
  focused?: boolean
}>()

const store = useEditorStore()
const t = useStoriesMessages()
const ui = storiesTheme()
const open = ref(focused)
watch(
  () => focused,
  (now) => {
    if (now) open.value = true
  }
)

/** What the fields show; replaced whenever the stored story changes, by undo or a peer. */
const draft = ref<UserStory>(structuredClone(story))
watch(
  () => JSON.stringify(story),
  () => {
    draft.value = structuredClone(story)
  }
)

const statesText = ref(story.states.join(', '))
watch(
  () => story.states.join(', '),
  (text) => {
    statesText.value = text
  }
)

function commit(patch: Partial<Omit<UserStory, 'id'>>) {
  store.updateUserStory(nodeId, story.id, patch)
}

const commitTitle = () => commit({ title: draft.value.title })
const commitNarrative = () => commit({ narrative: { ...draft.value.narrative } })
const commitBehaviour = () => commit({ behaviour: draft.value.behaviour })
const commitCriteria = () =>
  commit({ acceptanceCriteria: draft.value.acceptanceCriteria.map((c) => ({ ...c })) })
function commitStates() {
  const states = statesText.value
    .split(/[,،\n]/)
    .map((state) => state.trim())
    .filter((state) => state.length > 0)
  commit({ states })
}

function addCriterion() {
  commit({
    acceptanceCriteria: [...story.acceptanceCriteria, createAcceptanceCriterion()]
  })
}

function removeCriterion(id: string) {
  commit({ acceptanceCriteria: story.acceptanceCriteria.filter((c) => c.id !== id) })
}

const PRIORITY_LABEL_KEYS = {
  highest: 'priorityHighest',
  high: 'priorityHigh',
  medium: 'priorityMedium',
  low: 'priorityLow',
  lowest: 'priorityLowest'
} as const satisfies Record<UserStory['priority'], string>

const STATUS_LABEL_KEYS = {
  draft: 'statusDraft',
  ready: 'statusReady',
  'in-progress': 'statusInProgress',
  'in-review': 'statusInReview',
  done: 'statusDone'
} as const satisfies Record<UserStory['status'], string>

const priorityOptions = computed(() =>
  STORY_PRIORITIES.map((value) => ({ value, label: t.value[PRIORITY_LABEL_KEYS[value]] }))
)
const statusOptions = computed(() =>
  STORY_STATUSES.map((value) => ({ value, label: t.value[STATUS_LABEL_KEYS[value]] }))
)

const NO_EPIC = ''
const epicOptions = computed(() => [
  { value: NO_EPIC, label: t.value.noEpic },
  ...epics.map((epic) => ({ value: epic.id, label: epic.title || t.value.untitledEpic }))
])

const priority = computed({
  get: () => story.priority,
  set: (value: UserStory['priority']) => commit({ priority: value })
})
const status = computed({
  get: () => story.status,
  set: (value: UserStory['status']) => commit({ status: value })
})
const epicId = computed({
  get: () => story.epicId ?? NO_EPIC,
  set: (value: string) => commit({ epicId: value === NO_EPIC ? null : value })
})

const incomplete = computed(() => storyGaps(story).length > 0)
</script>

<template>
  <article
    :class="ui.card()"
    :data-focused="focused || undefined"
    data-slot="story"
    :data-story-id="story.id"
  >
    <button type="button" :class="ui.cardHeader()" :aria-expanded="open" @click="open = !open">
      <icon-lucide-chevron-down v-if="open" class="size-3 shrink-0" aria-hidden="true" />
      <icon-lucide-chevron-right v-else class="size-3 shrink-0 rtl:rotate-180" aria-hidden="true" />
      <span v-if="incomplete" :class="ui.gap()" :aria-label="t.missing" role="img" />
      <span :class="ui.cardTitle()" dir="auto">{{ story.title || t.untitledStory }}</span>
      <span v-if="story.jiraKey" :class="ui.jiraKey()" dir="ltr">{{ story.jiraKey }}</span>
      <span v-if="story.jira" :class="ui.chip()" :data-category="story.jira.category" dir="auto">
        {{ story.jira.status }}
      </span>
    </button>

    <div v-if="open" :class="ui.cardBody()">
      <label :class="ui.field()">
        <span :class="ui.label()">{{ t.title }}</span>
        <AppInput v-model="draft.title" dir="auto" data-field="title" @change="commitTitle" />
      </label>

      <div :class="ui.narrative()">
        <span :class="ui.label()">{{ t.asA }}</span>
        <AppInput
          v-model="draft.narrative.role"
          dir="auto"
          :aria-label="t.asA"
          :placeholder="t.rolePlaceholder"
          data-field="role"
          @change="commitNarrative"
        />
        <span :class="ui.label()">{{ t.iWant }}</span>
        <AppInput
          v-model="draft.narrative.goal"
          dir="auto"
          :aria-label="t.iWant"
          :placeholder="t.goalPlaceholder"
          data-field="goal"
          @change="commitNarrative"
        />
        <span :class="ui.label()">{{ t.soThat }}</span>
        <AppInput
          v-model="draft.narrative.benefit"
          dir="auto"
          :aria-label="t.soThat"
          :placeholder="t.benefitPlaceholder"
          data-field="benefit"
          @change="commitNarrative"
        />
      </div>

      <div :class="ui.field()">
        <div class="flex items-center justify-between">
          <span :class="ui.label()">{{ t.acceptanceCriteria }}</span>
          <IconButton :label="t.addCriterion" data-action="add-criterion" @click="addCriterion">
            <icon-lucide-plus class="size-3.5" />
          </IconButton>
        </div>
        <div
          v-for="(criterion, index) in draft.acceptanceCriteria"
          :key="criterion.id"
          :class="ui.criterion()"
        >
          <div :class="ui.criterionHeader()">
            <span>{{ index + 1 }}</span>
            <IconButton :label="t.deleteCriterion" @click="removeCriterion(criterion.id)">
              <icon-lucide-x class="size-3" />
            </IconButton>
          </div>
          <span :class="ui.label()">{{ t.given }}</span>
          <AppInput
            v-model="criterion.given"
            dir="auto"
            :aria-label="t.given"
            @change="commitCriteria"
          />
          <span :class="ui.label()">{{ t.when }}</span>
          <AppInput
            v-model="criterion.when"
            dir="auto"
            :aria-label="t.when"
            @change="commitCriteria"
          />
          <span :class="ui.label()">{{ t.thenClause }}</span>
          <AppInput
            v-model="criterion.outcome"
            dir="auto"
            :aria-label="t.thenClause"
            @change="commitCriteria"
          />
        </div>
      </div>

      <label :class="ui.field()">
        <span :class="ui.label()">{{ t.behaviour }}</span>
        <AppTextarea
          v-model="draft.behaviour"
          :rows="3"
          dir="auto"
          :placeholder="t.behaviourPlaceholder"
          data-field="behaviour"
          @change="commitBehaviour"
        />
      </label>

      <label :class="ui.field()">
        <span :class="ui.label()">{{ t.states }}</span>
        <AppInput
          v-model="statesText"
          dir="auto"
          :placeholder="t.statesPlaceholder"
          data-field="states"
          @change="commitStates"
        />
      </label>

      <div :class="ui.row()">
        <div :class="ui.field()">
          <span :class="ui.label()">{{ t.priority }}</span>
          <AppSelect v-model="priority" :label="t.priority" :options="priorityOptions" />
        </div>
        <div :class="ui.field()">
          <span :class="ui.label()">{{ t.status }}</span>
          <AppSelect v-model="status" :label="t.status" :options="statusOptions" />
        </div>
      </div>

      <div :class="ui.field()">
        <span :class="ui.label()">{{ t.epic }}</span>
        <AppSelect v-model="epicId" :label="t.epic" :options="epicOptions" />
      </div>

      <div class="flex justify-end">
        <IconButton
          :label="t.deleteStory"
          data-action="delete-story"
          @click="store.removeUserStory(nodeId, story.id)"
        >
          <icon-lucide-trash-2 class="size-3.5" />
        </IconButton>
      </div>
    </div>
  </article>
</template>
