import { parseDate } from '@internationalized/date'

import { MAX_METRICS_RANGE_DAYS } from '@lawha/feedback/contract'
import type { useMetricsMessages } from '@lawha/vue/i18n'

import { formatDay } from './format'

export type MetricsRangePreset = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom'

/** A span of whole UTC days, both ends included, as ISO dates. */
export interface MetricsRange {
  preset: MetricsRangePreset
  start: string
  end: string
}

type MetricsMessages = ReturnType<typeof useMetricsMessages>['value']
type PresetMessage = 'rangeToday' | 'range7d' | 'range30d' | 'range90d' | 'rangeAll'
type PhraseMessage = 'phraseToday' | 'phrase7d' | 'phrase30d' | 'phrase90d' | 'phraseAll'

export const METRICS_RANGE_PRESETS: {
  value: Exclude<MetricsRangePreset, 'custom'>
  /** Its name in the picker, and the end of a sentence it makes ("+374 in the last 7 days"). */
  label: PresetMessage
  phrase: PhraseMessage
}[] = [
  { value: 'today', label: 'rangeToday', phrase: 'phraseToday' },
  { value: '7d', label: 'range7d', phrase: 'phrase7d' },
  { value: '30d', label: 'range30d', phrase: 'phrase30d' },
  { value: '90d', label: 'range90d', phrase: 'phrase90d' },
  { value: 'all', label: 'rangeAll', phrase: 'phraseAll' }
]

// "All time" is as long as the API answers; the history is far shorter for now.
const PRESET_DAYS = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: MAX_METRICS_RANGE_DAYS
} as const

/**
 * The days a preset covers, ending today. Ranges never start before `earliest`, the first day
 * anything was recorded, so "Last 90 days" in the first week shows the same days as "All time";
 * before the first answer that day is not known yet and the preset's full length is asked for.
 */
export function presetRange(
  preset: Exclude<MetricsRangePreset, 'custom'>,
  today: string,
  earliest?: string | null
): MetricsRange {
  const start = parseDate(today)
    .subtract({ days: PRESET_DAYS[preset] - 1 })
    .toString()
  return { preset, start: earliest && start < earliest ? earliest : start, end: today }
}

export function rangeLabel(range: MetricsRange, t: MetricsMessages): string {
  const preset = METRICS_RANGE_PRESETS.find((option) => option.value === range.preset)
  if (preset) return t[preset.label]
  if (range.start === range.end) return formatDay(range.start)
  return `${formatDay(range.start)} – ${formatDay(range.end)}`
}

/** The range as the end of a sentence: "+374 in the last 7 days". */
export function rangePhrase(range: MetricsRange, t: MetricsMessages): string {
  const preset = METRICS_RANGE_PRESETS.find((option) => option.value === range.preset)
  if (preset) return t[preset.phrase]
  return range.start === range.end
    ? t.phraseOn({ day: formatDay(range.start) })
    : `${formatDay(range.start)} – ${formatDay(range.end)}`
}
