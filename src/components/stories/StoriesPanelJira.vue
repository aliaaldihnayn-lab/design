<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { readStoryJiraProject } from '@lawha/scene-graph/stories'
import { useStoriesMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import { jiraConnected, jiraPreferences } from '@/app/integrations/jira/connection'
import { openSettingsDialog } from '@/app/settings/dialog'
import { useJiraSync } from '@/app/stories/jira'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppCombobox, { type AppComboboxOption } from '@/components/ui/select/AppCombobox.vue'

import { stories as storiesTheme } from './ui'

/**
 * The Stories tab's Jira row: connect, choose the document's project, push the selection's or
 * the page's stories, and read their status back.
 */
const { nodeIds } = defineProps<{ nodeIds: string[] }>()

const store = useEditorStore()
const sync = useJiraSync()
const t = useStoriesMessages()
const ui = storiesTheme()

const project = ref(sync.projectKey.value)
watch(sync.projectKey, (key) => {
  project.value = key
})

/** The site's projects as the picker lists them, the document's own first if Jira hid it. */
const projectOptions = computed<AppComboboxOption[]>(() => {
  const options = sync.projects.value.map((item) => ({
    value: item.key,
    label: item.name,
    meta: item.key
  }))
  const own = sync.projectKey.value
  if (own && !options.some((option) => option.value === own)) {
    options.unshift({ value: own, label: own, meta: own })
  }
  return options
})
/** The picker shows once projects loaded; typing a key stays for sites that list none. */
const picking = computed(() => sync.projects.value.length > 0)

function chooseProject(key: string) {
  project.value = key
  commitProject()
}

function commitProject() {
  const key = project.value.trim().toUpperCase()
  const site = jiraPreferences.value.site
  if (!/^[A-Z][A-Z0-9_]*$/.test(key) || !site) {
    project.value = sync.projectKey.value
    return
  }
  const current = readStoryJiraProject(store.graph)
  if (current?.projectKey === key && current.site === site) return
  store.setStoryJiraProject({ site, projectKey: key })
}

const scope = computed(() => ({
  rootIds: nodeIds.length > 0 ? nodeIds : [store.state.currentPageId]
}))
</script>

<template>
  <section :class="ui.section()" data-slot="jira">
    <div :class="ui.sectionTitle()">
      <icon-lucide-ticket class="size-3.5" aria-hidden="true" />
      <span class="flex-1">{{ t.jira }}</span>
    </div>
    <template v-if="!jiraConnected">
      <p class="text-[11px] text-muted">{{ t.jiraNotConnected }}</p>
      <AppButton
        variant="outline"
        size="xs"
        data-action="connect-jira"
        @click="openSettingsDialog('jira')"
      >
        {{ t.connectJira }}
      </AppButton>
    </template>
    <template v-else>
      <div v-if="picking" :class="ui.field()">
        <span :class="ui.label()">{{ t.jiraProject }}</span>
        <AppCombobox
          :model-value="sync.projectKey.value"
          :options="projectOptions"
          :label="t.jiraProject"
          :placeholder="t.jiraChooseProject"
          :search-placeholder="t.jiraSearchProjects"
          :empty-label="t.jiraNoProjects"
          data-field="jira-project-picker"
          @update:model-value="chooseProject"
        />
      </div>
      <label v-else :class="ui.field()">
        <span :class="ui.label()">{{ t.jiraProject }}</span>
        <AppInput
          v-model="project"
          dir="ltr"
          :placeholder="t.jiraProjectPlaceholder"
          data-field="jira-project"
          @change="commitProject"
        />
      </label>
      <div class="flex flex-wrap gap-1">
        <AppButton
          size="xs"
          :disabled="!sync.ready.value || sync.busy.value"
          data-action="push-jira"
          @click="sync.push(scope)"
        >
          <icon-lucide-send class="size-3" aria-hidden="true" />
          {{ t.pushToJira }}
        </AppButton>
        <AppButton
          variant="outline"
          size="xs"
          :disabled="sync.busy.value"
          data-action="pull-jira"
          @click="sync.pull(scope)"
        >
          <icon-lucide-refresh-cw class="size-3" aria-hidden="true" />
          {{ t.pullFromJira }}
        </AppButton>
      </div>
      <p v-if="sync.busy.value" class="text-[11px] text-muted" role="status">{{ t.syncing }}</p>
      <p v-else-if="sync.lastSummary.value" class="text-[11px] text-muted" role="status">
        {{
          t.syncSummary({
            created: sync.lastSummary.value.created,
            updated: sync.lastSummary.value.updated,
            pulled: sync.lastSummary.value.pulled,
            failed: sync.lastSummary.value.failed
          })
        }}
      </p>
      <AppAlert
        v-if="sync.lastError.value || sync.lastSummary.value?.firstError"
        tone="error"
        :heading="t.syncFailed"
        :description="sync.lastError.value ?? sync.lastSummary.value?.firstError"
      />
    </template>
  </section>
</template>
