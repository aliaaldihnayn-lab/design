<script setup lang="ts">
import { ref } from 'vue'

import type { MetricsSnapshot } from '@lawha/feedback/contract'
import { useMetricsMessages } from '@lawha/vue/i18n'

import { usePortalTheme } from '@/app/cloud-portal/theme'
import { useMetricsSnapshot } from '@/app/metrics/load'
import type { MetricsRange } from '@/app/metrics/range'
import MetricsDashboard from '@/components/metrics/MetricsDashboard.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'

// Served from the feedback Worker's own address, so it follows the system theme as Cloud's
// pages do; the editor's stored theme is not visible here.
usePortalTheme()
const t = useMetricsMessages()

/** The page mounts once its first numbers have loaded, or failed to, so it never shows half. */
const { initialRange, initialSnapshot } = defineProps<{
  initialRange: MetricsRange
  initialSnapshot?: MetricsSnapshot
}>()

const range = ref(initialRange)
const { snapshot, loading, failed, refresh } = useMetricsSnapshot(range, initialSnapshot)
const host = globalThis.location.host
// Access's session may have run out; reloading the page signs in again.
const reload = () => globalThis.location.reload()
</script>

<template>
  <MetricsDashboard
    v-if="snapshot"
    v-model:range="range"
    :host="host"
    :snapshot="snapshot"
    :loading="loading"
    @refresh="refresh"
  >
    <template v-if="failed" #alert>
      <AppAlert tone="warning" :heading="t.staleHeading" :description="t.staleDetail">
        <template #actions>
          <AppButton size="sm" variant="outline" @click="reload">{{ t.reload }}</AppButton>
        </template>
      </AppAlert>
    </template>
  </MetricsDashboard>
  <main v-else-if="failed" class="flex h-full bg-canvas text-surface">
    <AppPlaceholder
      size="page"
      label-as="h1"
      :label="t.failedHeading"
      :description="t.failedDetail"
    >
      <template #icon><icon-lucide-cloud-off class="size-5" /></template>
      <template #action>
        <AppButton variant="outline" @click="reload">{{ t.reload }}</AppButton>
      </template>
    </AppPlaceholder>
  </main>
</template>
