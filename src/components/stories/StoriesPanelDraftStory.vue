<script setup lang="ts">
import { ref, watch } from 'vue'

import type { UserStory } from '@lawha/scene-graph/stories'
import { useStoriesMessages } from '@lawha/vue/i18n'

import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'

import { stories as storiesTheme } from './ui'

/**
 * A drafted story's fields, editable before the draft is saved: its title, statement,
 * acceptance criteria and behaviour. Each field sends the edited story when it changes; nothing
 * reaches the document until Save.
 */
const { story } = defineProps<{ story: UserStory }>()
const emit = defineEmits<{ update: [story: UserStory] }>()

const t = useStoriesMessages()
const ui = storiesTheme()

const fields = ref<UserStory>(structuredClone(story))
watch(
  () => JSON.stringify(story),
  () => {
    fields.value = structuredClone(story)
  }
)

const send = () => emit('update', structuredClone(fields.value))
</script>

<template>
  <div class="flex flex-col gap-1.5" data-slot="drafted-story-editor">
    <label :class="ui.field()">
      <span :class="ui.label()">{{ t.title }}</span>
      <AppInput v-model="fields.title" dir="auto" data-field="title" @change="send" />
    </label>
    <div :class="ui.narrative()">
      <span :class="ui.label()">{{ t.asA }}</span>
      <AppInput
        v-model="fields.narrative.role"
        dir="auto"
        :aria-label="t.asA"
        :placeholder="t.rolePlaceholder"
        @change="send"
      />
      <span :class="ui.label()">{{ t.iWant }}</span>
      <AppInput
        v-model="fields.narrative.goal"
        dir="auto"
        :aria-label="t.iWant"
        :placeholder="t.goalPlaceholder"
        @change="send"
      />
      <span :class="ui.label()">{{ t.soThat }}</span>
      <AppInput
        v-model="fields.narrative.benefit"
        dir="auto"
        :aria-label="t.soThat"
        :placeholder="t.benefitPlaceholder"
        @change="send"
      />
    </div>
    <div
      v-for="criterion in fields.acceptanceCriteria"
      :key="criterion.id"
      :class="ui.narrative()"
      data-slot="drafted-criterion"
    >
      <span :class="ui.label()">{{ t.given }}</span>
      <AppInput v-model="criterion.given" dir="auto" :aria-label="t.given" @change="send" />
      <span :class="ui.label()">{{ t.when }}</span>
      <AppInput v-model="criterion.when" dir="auto" :aria-label="t.when" @change="send" />
      <span :class="ui.label()">{{ t.thenClause }}</span>
      <AppInput v-model="criterion.outcome" dir="auto" :aria-label="t.thenClause" @change="send" />
    </div>
    <label :class="ui.field()">
      <span :class="ui.label()">{{ t.behaviour }}</span>
      <AppTextarea
        v-model="fields.behaviour"
        :rows="2"
        dir="auto"
        :placeholder="t.behaviourPlaceholder"
        @change="send"
      />
    </label>
  </div>
</template>
