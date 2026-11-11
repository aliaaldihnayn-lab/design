<script setup lang="ts">
import { countBy, maxBy, meanBy, sumBy } from 'es-toolkit'
import { tv } from 'tailwind-variants'
import { BarList } from 'vccs'
import { computed } from 'vue'

import type { MetricsSnapshot } from '@lawha/feedback/contract'
import { useMetricsMessages } from '@lawha/vue/i18n'

import { utcDayOfTimestamp } from '@/app/metrics/days'
import {
  formatCount,
  formatCountry,
  formatDay,
  formatPercent,
  formatShare,
  formatTime
} from '@/app/metrics/format'
import { rangePhrase } from '@/app/metrics/range'
import type { MetricsRange } from '@/app/metrics/range'
import BrandMark from '@/components/brand/BrandMark.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'
import { metricsDashboardTheme } from '@/theme/metrics/dashboard'

import DailyChart from './DailyChart.vue'
import type { DailySeries } from './DailyChart.vue'
import DailyLevelChart from './DailyLevelChart.vue'
import MetricsCard from './MetricsCard.vue'
import MetricsRangePicker from './MetricsRangePicker.vue'
import MetricsTile from './MetricsTile.vue'
import NetworksTable from './NetworksTable.vue'
import PlatformsChart from './PlatformsChart.vue'
import RetentionChart from './RetentionChart.vue'
import type { DailyActiveDay, DailyPulls, DailyTraffic, DailyVersions, DailyVisits } from './types'
import WaitlistList from './WaitlistList.vue'

const metricsDashboard = tv(metricsDashboardTheme)

/**
 * Day-to-day numbers in one place: anonymous daily pings and Cloudflare visits for reach,
 * PostHog for what the installs that share stats do, and GitHub and the Cloud waitlist for
 * growth. The range scopes everything below it; `snapshot` already holds only those days.
 */
const {
  host,
  snapshot,
  loading = false
} = defineProps<{
  host: string
  snapshot: MetricsSnapshot
  /** Newer numbers are on their way; the current ones stay, dimmed. */
  loading?: boolean
}>()
const range = defineModel<MetricsRange>('range', { required: true })
const emit = defineEmits<{ refresh: [] }>()
defineSlots<{ /** A notice above the numbers, such as a failed refresh. */ alert?(): unknown }>()

const ui = metricsDashboard()
const t = useMetricsMessages()
const phrase = computed(() => rangePhrase(range.value, t.value))
const usage = computed(() => snapshot.usage)

// Today is still being counted, so headline numbers and tile trends use full days only.
const isFull = (row: { day: string }) => row.day !== snapshot.today
const totals = computed(() =>
  snapshot.dailyActive.map((day) => ({ day: day.day, installs: day.desktop + day.web }))
)
const fullDays = computed(() => totals.value.filter(isFull))
const peak = computed(() => maxBy(fullDays.value, (day) => day.installs))
const active = computed(() =>
  fullDays.value.length
    ? {
        value: Math.round(meanBy(fullDays.value, (day) => day.installs)),
        label: t.value.activeAverage,
        detail: peak.value
          ? t.value.activePeak({
              count: formatCount(peak.value.installs),
              day: formatDay(peak.value.day)
            })
          : undefined,
        trend: fullDays.value.map((day) => day.installs)
      }
    : {
        value: totals.value.at(-1)?.installs ?? 0,
        label: t.value.activeToday,
        detail: t.value.soFarToday,
        trend: undefined
      }
)
type Growth = MetricsSnapshot['github']['stars']['daily']
// Growth needs two recorded days; until then the tile says so rather than showing a zero.
const added = (daily: Growth) => (daily.length ? sumBy(daily, (day) => day.added) : undefined)
const growthDetail = (daily: Growth) => (daily.length ? phrase.value : t.value.noDailyHistory)
const fullTrend = (daily: Growth) => daily.filter(isFull).map((day) => day.added)
const signupTrend = computed(() => {
  const perDay = countBy(snapshot.waitlist.recent, (signup) =>
    utcDayOfTimestamp(signup.signedUpAt).toString()
  )
  return fullDays.value.map((day) => perDay[day.day] ?? 0)
})

const INSTALL_SERIES = computed<DailySeries<keyof DailyActiveDay & string>[]>(() => [
  { key: 'desktop', name: t.value.seriesDesktop, color: 'var(--color-chart-1)' },
  { key: 'web', name: t.value.seriesWeb, color: 'var(--color-chart-2)' }
])
// The web app keeps the web installs' color; the site takes the next one.
const VISIT_SERIES: DailySeries<keyof DailyVisits & string>[] = [
  { key: 'site', name: 'lawha.invalid', color: 'var(--color-chart-3)' },
  { key: 'app', name: 'app.lawha.invalid', color: 'var(--color-chart-2)' }
]
const TRAFFIC_SERIES = computed<DailySeries<keyof DailyTraffic & string>[]>(() => [
  { key: 'views', name: t.value.seriesViews, color: 'var(--color-chart-1)' },
  { key: 'uniqueViews', name: t.value.seriesUniqueVisitors, color: 'var(--color-chart-3)' }
])
// The community leads: outside work is what the team answers to.
const OPEN_SERIES = computed<DailySeries<'openCommunity' | 'openTeam'>[]>(() => [
  { key: 'openCommunity', name: t.value.seriesCommunity, color: 'var(--color-chart-1)' },
  { key: 'openTeam', name: t.value.seriesTeam, color: 'var(--color-chart-3)' }
])
const OPENED_SERIES = computed<DailySeries<'openedCommunity' | 'openedTeam'>[]>(() => [
  { key: 'openedCommunity', name: t.value.seriesCommunity, color: 'var(--color-chart-1)' },
  { key: 'openedTeam', name: t.value.seriesTeam, color: 'var(--color-chart-3)' }
])
const CLOSED_SERIES = computed<DailySeries<'closedCommunity' | 'closedTeam'>[]>(() => [
  { key: 'closedCommunity', name: t.value.seriesCommunity, color: 'var(--color-chart-1)' },
  { key: 'closedTeam', name: t.value.seriesTeam, color: 'var(--color-chart-3)' }
])
const MERGED_SERIES = computed<DailySeries<keyof DailyPulls & string>[]>(() => [
  { key: 'mergedCommunity', name: t.value.seriesCommunity, color: 'var(--color-chart-1)' },
  { key: 'mergedTeam', name: t.value.seriesTeam, color: 'var(--color-chart-3)' }
])
const activity = computed(() => snapshot.github.activity)
/** How many are open at the end of the last finished day, and how many of them are the community's. */
function openNow(days: { openTeam: number; openCommunity: number }[]) {
  const last = days.at(-1)
  return last
    ? t.value.openNow({
        open: formatCount(last.openTeam + last.openCommunity),
        community: formatCount(last.openCommunity)
      })
    : undefined
}

// Older versions recede: the question is how much of the day is already on the latest.
const versionSeries = computed<DailySeries<keyof DailyVersions & string>[]>(() => [
  {
    key: 'latest',
    name: snapshot.versions.latest ?? t.value.seriesLatest,
    color: 'var(--color-chart-1)'
  },
  { key: 'other', name: t.value.seriesOtherVersions, color: 'var(--color-muted)' }
])
const latestShare = computed(() => {
  const day = snapshot.versions.daily.findLast(isFull)
  return day && day.latest + day.other ? day.latest / (day.latest + day.other) : undefined
})

// Pings and visits count different things, so this is a rough share, over full days only.
const fullDaySet = computed(() => new Set(fullDays.value.map((day) => day.day)))
const reachedEditor = computed(() => {
  const visits = sumBy(
    snapshot.visits.filter((day) => fullDaySet.value.has(day.day)),
    (day) => day.app
  )
  const web = sumBy(
    snapshot.dailyActive.filter((day) => fullDaySet.value.has(day.day)),
    (day) => day.web
  )
  return visits ? web / visits : undefined
})
const countries = computed(() =>
  snapshot.website.countries.map((country) => ({ ...country, name: formatCountry(country.name) }))
)
// How much of the daily pings PostHog sees, so its numbers are read as the share they are.
const sharingNote = computed(() => {
  if (!usage.value) return undefined
  const shared = sumBy(
    usage.value.daily.filter((day) => fullDaySet.value.has(day.day)),
    (day) => day.installs
  )
  const pinged = sumBy(fullDays.value, (day) => day.installs)
  const count = formatCount(usage.value.installs)
  return pinged
    ? t.value.sharingShare({ count, share: formatPercent(shared / pinged) })
    : t.value.sharingInstalls({ count })
})
</script>

<template>
  <div :class="ui.page()">
    <header :class="ui.bar()">
      <BrandMark variant="micro" decorative />
      <span :class="ui.barTitle()">{{ t.title }}</span>
      <span :class="ui.barHost()">{{ host }}</span>
      <div :class="ui.barEnd()">
        <span :class="ui.barMeta()">{{ t.updated({ time: formatTime(snapshot.asOf) }) }}</span>
        <MetricsRangePicker
          v-model="range"
          :today="snapshot.today"
          :earliest="snapshot.earliest ?? snapshot.start"
        />
        <IconButton :label="t.refresh" :disabled="loading" @click="emit('refresh')">
          <icon-lucide-refresh-cw class="size-3.5" />
        </IconButton>
      </div>
    </header>
    <main :class="ui.main()">
      <div :class="ui.inner()" :data-loading="loading" :aria-busy="loading">
        <slot name="alert" />
        <div :class="ui.tiles()">
          <MetricsTile
            :label="active.label"
            :value="active.value"
            :detail="active.detail"
            :trend="active.trend"
          />
          <MetricsTile
            :label="t.installerDownloads"
            :value="snapshot.github.downloads.total"
            :change="added(snapshot.github.downloads.daily)"
            :detail="growthDetail(snapshot.github.downloads.daily)"
            :trend="fullTrend(snapshot.github.downloads.daily)"
          />
          <MetricsTile
            :label="t.githubStars"
            :value="snapshot.github.stars.total"
            :change="added(snapshot.github.stars.daily)"
            :detail="growthDetail(snapshot.github.stars.daily)"
            :trend="fullTrend(snapshot.github.stars.daily)"
          />
          <MetricsTile
            :label="t.cloudWaitlist"
            :value="snapshot.waitlist.total"
            :change="snapshot.waitlist.added"
            :detail="
              t.waitlistDetail({ phrase, confirmed: formatCount(snapshot.waitlist.confirmed) })
            "
            :trend="signupTrend"
          />
        </div>

        <section :class="ui.section()" aria-labelledby="metrics-reach">
          <h2 id="metrics-reach" :class="ui.sectionHeading()">{{ t.reach }}</h2>
          <MetricsCard :heading="t.activeToday" :note="t.dailyActiveNote">
            <DailyChart
              :label="t.dailyActiveChart"
              :days="snapshot.dailyActive"
              :series="INSTALL_SERIES"
              :today="snapshot.today"
              :releases="snapshot.releases"
              stacked
            />
          </MetricsCard>
          <MetricsCard :heading="t.visits" :note="t.visitsNote">
            <template v-if="reachedEditor !== undefined" #aside>
              {{ t.reachedEditor({ share: formatPercent(reachedEditor) }) }}
            </template>
            <DailyChart
              :label="t.visitsChart"
              :days="snapshot.visits"
              :series="VISIT_SERIES"
              :today="snapshot.today"
              :releases="snapshot.releases"
            />
          </MetricsCard>
          <div :class="ui.row()">
            <MetricsCard :heading="t.platforms" :note="t.platformsNote">
              <PlatformsChart :platforms="snapshot.platforms" />
            </MetricsCard>
            <MetricsCard :heading="t.networks" :note="t.networksNote">
              <NetworksTable
                v-if="snapshot.networks.top.length"
                :networks="snapshot.networks.top"
                :total="snapshot.networks.total"
              />
              <p v-else :class="ui.sectionLabel()">{{ t.noNetworks }}</p>
            </MetricsCard>
          </div>
          <MetricsCard :heading="t.versions" :note="t.versionsNote">
            <template v-if="latestShare !== undefined && snapshot.versions.latest" #aside>
              {{
                t.latestShare({
                  share: formatShare(latestShare),
                  version: snapshot.versions.latest
                })
              }}
            </template>
            <DailyChart
              :label="t.versionsChart"
              :days="snapshot.versions.daily"
              :series="versionSeries"
              :today="snapshot.today"
              :height="200"
              stacked
            />
          </MetricsCard>
          <MetricsCard :heading="t.website" :note="t.websiteNote">
            <div :class="ui.breakdown()">
              <div>
                <h4 :class="ui.sectionLabel()">{{ t.topPages }}</h4>
                <BarList
                  class="text-xs"
                  :data="snapshot.website.pages"
                  :value-formatter="formatCount"
                  :row-height="28"
                  :is-animation-active="false"
                />
              </div>
              <div>
                <h4 :class="ui.sectionLabel()">{{ t.countries }}</h4>
                <BarList
                  class="text-xs"
                  :data="countries"
                  :value-formatter="formatCount"
                  :row-height="28"
                  :is-animation-active="false"
                />
              </div>
            </div>
          </MetricsCard>
        </section>

        <section :class="ui.section()" aria-labelledby="metrics-engagement">
          <h2 id="metrics-engagement" :class="ui.sectionHeading()">{{ t.engagement }}</h2>
          <div v-if="usage" :class="ui.row()">
            <MetricsCard :heading="t.retention" :note="t.retentionNote">
              <RetentionChart :cohorts="usage.retention" />
            </MetricsCard>
            <MetricsCard :heading="t.whatPeopleDo" :note="sharingNote">
              <div :class="ui.usage()">
                <div>
                  <h4 :class="ui.sectionLabel()">{{ t.documentsOpened }}</h4>
                  <BarList
                    class="text-xs"
                    :data="usage.documents"
                    :row-height="28"
                    :is-animation-active="false"
                  />
                </div>
                <div>
                  <h4 :class="ui.sectionLabel()">{{ t.exports }}</h4>
                  <BarList
                    class="text-xs"
                    :data="usage.exports"
                    :row-height="28"
                    :is-animation-active="false"
                  />
                </div>
                <div>
                  <h4 :class="ui.sectionLabel()">{{ t.aiReplies }}</h4>
                  <BarList
                    class="text-xs"
                    :data="usage.aiProviders"
                    :row-height="28"
                    :is-animation-active="false"
                  />
                </div>
              </div>
            </MetricsCard>
          </div>
          <MetricsCard v-else :heading="t.usage">
            <AppPlaceholder
              size="compact"
              :fill="false"
              :label="t.posthogDown"
              :description="t.posthogDownDetail"
            >
              <template #icon><icon-lucide-cloud-off class="size-4" /></template>
            </AppPlaceholder>
          </MetricsCard>
        </section>

        <section :class="ui.section()" aria-labelledby="metrics-growth">
          <h2 id="metrics-growth" :class="ui.sectionHeading()">{{ t.growth }}</h2>
          <div :class="ui.row()">
            <MetricsCard :heading="t.github" :note="t.githubNote">
              <DailyChart
                :label="t.githubChart"
                :days="snapshot.github.traffic"
                :series="TRAFFIC_SERIES"
                :today="snapshot.today"
                :height="200"
              />
              <BarList
                class="text-xs"
                :data="snapshot.github.referrers"
                :value-formatter="formatCount"
                :row-height="28"
                :is-animation-active="false"
              />
            </MetricsCard>
            <MetricsCard :heading="t.cloudWaitlist" :note="t.waitlistNote">
              <template #aside>
                {{
                  t.waitlistConfirmed({
                    confirmed: formatCount(snapshot.waitlist.confirmed),
                    total: formatCount(snapshot.waitlist.total)
                  })
                }}
              </template>
              <WaitlistList :signups="snapshot.waitlist.recent" />
            </MetricsCard>
          </div>
        </section>

        <section :class="ui.section()" aria-labelledby="metrics-development">
          <h2 id="metrics-development" :class="ui.sectionHeading()">{{ t.development }}</h2>
          <div v-if="activity.issues.length" :class="ui.row()">
            <MetricsCard :heading="t.issues" :note="t.issuesNote">
              <template v-if="openNow(activity.issues)" #aside>{{
                openNow(activity.issues)
              }}</template>
              <h4 :class="ui.sectionLabel()">{{ t.open }}</h4>
              <DailyLevelChart
                :label="t.openIssuesChart"
                :days="activity.issues"
                :series="OPEN_SERIES"
              />
              <h4 :class="ui.sectionLabel()">{{ t.openedPerDay }}</h4>
              <DailyChart
                :label="t.issuesOpenedChart"
                :days="activity.issues"
                :series="OPENED_SERIES"
                :today="snapshot.today"
                :height="160"
                stacked
              />
              <h4 :class="ui.sectionLabel()">{{ t.closedPerDay }}</h4>
              <DailyChart
                :label="t.issuesClosedChart"
                :days="activity.issues"
                :series="CLOSED_SERIES"
                :today="snapshot.today"
                :height="160"
                stacked
              />
            </MetricsCard>
            <MetricsCard :heading="t.pullRequests" :note="t.pullsNote">
              <template v-if="openNow(activity.pulls)" #aside>{{
                openNow(activity.pulls)
              }}</template>
              <h4 :class="ui.sectionLabel()">{{ t.open }}</h4>
              <DailyLevelChart
                :label="t.openPullsChart"
                :days="activity.pulls"
                :series="OPEN_SERIES"
              />
              <h4 :class="ui.sectionLabel()">{{ t.openedPerDay }}</h4>
              <DailyChart
                :label="t.pullsOpenedChart"
                :days="activity.pulls"
                :series="OPENED_SERIES"
                :today="snapshot.today"
                :height="160"
                stacked
              />
              <h4 :class="ui.sectionLabel()">{{ t.mergedPerDay }}</h4>
              <DailyChart
                :label="t.pullsMergedChart"
                :days="activity.pulls"
                :series="MERGED_SERIES"
                :today="snapshot.today"
                :height="160"
                stacked
              />
            </MetricsCard>
          </div>
          <MetricsCard v-else :heading="t.issuesAndPulls">
            <AppPlaceholder
              size="compact"
              :fill="false"
              :label="t.notSynced"
              :description="t.notSyncedDetail"
            >
              <template #icon><icon-lucide-git-pull-request class="size-4" /></template>
            </AppPlaceholder>
          </MetricsCard>
        </section>
      </div>
    </main>
  </div>
</template>
