<script setup lang="ts">
import { computed, ref, useId } from 'vue'

import { useStoriesMessages } from '@lawha/vue/i18n'

import {
  connectJira,
  connectJiraWithAtlassian,
  disconnectJira,
  jiraConnected,
  jiraConnectionMode,
  jiraOAuthAvailable,
  jiraPreferences,
  type JiraConnectOutcome,
  type JiraOAuthStartOutcome
} from '@/app/integrations/jira/connection'
import { useJiraConnectionForm } from '@/app/integrations/jira/settings/form'
import SettingsLink from '@/components/settings/layout/SettingsLink.vue'
import SettingsPage from '@/components/settings/layout/SettingsPage.vue'
import SettingsSection from '@/components/settings/layout/SettingsSection.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppPasswordInput from '@/components/ui/input/AppPasswordInput.vue'
import { JIRA_API_TOKEN_URL } from '@/constants'

/**
 * Settings → Jira: the Jira Cloud site, the account's email and an API token. Connecting asks
 * Jira first; the token then goes to the system credential store (desktop) or the Cloud server
 * (browser), and is cleared from the field.
 */
const t = useStoriesMessages()
const id = useId()
const form = useJiraConnectionForm(t)
const { site, email, projectKey } = form.fields
const errors = form.errors
/** The token as typed; never stored in the form or kept after a connect. */
const token = ref('')
const tokenMissing = ref(false)
const busy = ref(false)
const outcome = ref<JiraConnectOutcome | null>(null)
const oauthOutcome = ref<JiraOAuthStartOutcome | null>(null)
const viaOAuth = computed(
  () => jiraConnected.value === true && jiraPreferences.value.auth === 'oauth'
)

/** Opens Atlassian's consent page; the connection shows once the person comes back. */
async function connectWithAtlassian() {
  busy.value = true
  try {
    oauthOutcome.value = await connectJiraWithAtlassian()
  } finally {
    busy.value = false
  }
}

const holds = computed(() =>
  jiraConnectionMode.value === 'cloud' ? t.value.jiraCloudHolds : t.value.jiraDesktopHolds
)

const failure = computed(() => {
  switch (outcome.value) {
    case 'invalid-site':
      return t.value.jiraInvalidSite
    case 'rejected':
      return t.value.jiraRejected
    case 'unreachable':
      return t.value.jiraUnreachable
    case 'unavailable':
      return t.value.jiraUnavailable
    case 'credential-failed':
      return t.value.jiraCredentialFailed
    default:
      return null
  }
})

const submit = form.submit(async (values) => {
  tokenMissing.value = token.value.trim() === ''
  jiraPreferences.value = { ...jiraPreferences.value, projectKey: values.projectKey }
  if (tokenMissing.value) return
  busy.value = true
  try {
    outcome.value = await connectJira({ ...values, apiToken: token.value })
    if (outcome.value === 'connected') token.value = ''
  } finally {
    busy.value = false
  }
})

async function disconnect() {
  busy.value = true
  try {
    await disconnectJira()
    outcome.value = null
  } finally {
    busy.value = false
  }
}

const errorId = (field: string, has: unknown) => (has ? `${id}-${field}-error` : undefined)
</script>

<template>
  <SettingsPage>
    <SettingsSection data-test-id="settings-jira">
      <template #title>{{ t.jira }}</template>
      <template #description>
        {{ t.jiraSettingsDescription }}
        {{ holds }}
      </template>

      <AppAlert
        v-if="jiraConnectionMode === 'unavailable'"
        tone="warning"
        :heading="t.jiraUnavailable"
      />

      <div
        v-if="jiraOAuthAvailable && !viaOAuth"
        class="flex flex-col gap-2"
        data-slot="jira-oauth"
      >
        <p class="text-[11px] text-muted">{{ t.jiraOAuthDescription }}</p>
        <div>
          <AppButton
            size="sm"
            :disabled="busy"
            data-action="jira-connect-atlassian"
            @click="connectWithAtlassian"
          >
            {{ t.jiraConnectAtlassian }}
          </AppButton>
        </div>
        <AppAlert
          v-if="oauthOutcome === 'opened' && !jiraConnected"
          tone="info"
          :heading="t.jiraOAuthOpened"
        />
        <AppAlert
          v-else-if="oauthOutcome === 'failed' || oauthOutcome === 'unavailable'"
          tone="error"
          :heading="t.jiraOAuthFailed"
        />
        <p class="text-[11px] font-semibold text-surface">{{ t.jiraOrToken }}</p>
      </div>

      <form
        v-if="!viaOAuth"
        class="flex flex-col gap-3"
        :aria-busy="busy"
        novalidate
        @submit.prevent="submit"
      >
        <fieldset
          :disabled="busy || jiraConnectionMode === 'unavailable'"
          class="flex flex-col gap-3"
        >
          <label class="flex flex-col gap-1 text-[11px] text-muted">
            {{ t.jiraSite }}
            <AppInput
              v-model="site"
              type="url"
              dir="ltr"
              autocomplete="url"
              :placeholder="t.jiraSitePlaceholder"
              :state="errors.site ? 'invalid' : 'idle'"
              :aria-invalid="errors.site ? true : undefined"
              :aria-describedby="errorId('site', errors.site)"
              @blur="form.blur('site')"
            />
            <span v-if="errors.site" :id="`${id}-site-error`" class="text-error">{{
              errors.site
            }}</span>
          </label>
          <label class="flex flex-col gap-1 text-[11px] text-muted">
            {{ t.jiraEmail }}
            <AppInput
              v-model="email"
              type="email"
              dir="ltr"
              autocomplete="email"
              :state="errors.email ? 'invalid' : 'idle'"
              :aria-invalid="errors.email ? true : undefined"
              :aria-describedby="errorId('email', errors.email)"
              @blur="form.blur('email')"
            />
            <span v-if="errors.email" :id="`${id}-email-error`" class="text-error">{{
              errors.email
            }}</span>
          </label>
          <label class="flex flex-col gap-1 text-[11px] text-muted">
            {{ t.jiraToken }}
            <AppPasswordInput
              v-model="token"
              :aria-invalid="tokenMissing ? true : undefined"
              :aria-describedby="tokenMissing ? `${id}-token-error` : undefined"
            />
            <span v-if="tokenMissing" :id="`${id}-token-error`" class="text-error">{{
              t.jiraTokenRequired
            }}</span>
            <SettingsLink :href="JIRA_API_TOKEN_URL">{{ t.jiraGetToken }}</SettingsLink>
          </label>
          <label class="flex flex-col gap-1 text-[11px] text-muted">
            {{ t.jiraDefaultProject }}
            <AppInput
              v-model="projectKey"
              dir="ltr"
              :placeholder="t.jiraProjectPlaceholder"
              :state="errors.projectKey ? 'invalid' : 'idle'"
              :aria-invalid="errors.projectKey ? true : undefined"
              @blur="form.blur('projectKey')"
            />
          </label>
        </fieldset>
        <div class="flex items-center gap-2">
          <AppButton type="submit" size="sm" :disabled="busy" data-action="jira-connect">
            {{ t.jiraConnect }}
          </AppButton>
          <AppButton
            v-if="jiraConnected"
            type="button"
            variant="outline"
            size="sm"
            :disabled="busy"
            data-action="jira-disconnect"
            @click="disconnect"
          >
            {{ t.jiraDisconnect }}
          </AppButton>
        </div>
      </form>

      <div v-if="viaOAuth">
        <AppButton
          type="button"
          variant="outline"
          size="sm"
          :disabled="busy"
          data-action="jira-disconnect"
          @click="disconnect"
        >
          {{ t.jiraDisconnect }}
        </AppButton>
      </div>
      <AppAlert
        v-if="viaOAuth"
        tone="success"
        :heading="t.jiraConnectedWithAtlassian({ site: jiraPreferences.site })"
      />
      <AppAlert
        v-else-if="jiraConnected"
        tone="success"
        :heading="t.jiraConnectedAs({ site: jiraPreferences.site, email: jiraPreferences.email })"
      />
      <AppAlert v-else-if="failure" tone="error" :heading="failure" />
    </SettingsSection>
  </SettingsPage>
</template>
