import { useLocalStorage } from '@vueuse/core'
import * as v from 'valibot'
import { computed } from 'vue'

import { TRACE_PRESETS } from '@lawha/core/vector'

import {
  VECTORIZE_PROVIDER_IDS,
  type VectorizeEngine,
  type VectorizeProviderID
} from '@/app/editor/vectorize/types'

import { DEFAULT_LOCAL_TRACE_OPTIONS, type LocalTraceOptions } from './local'

const storedProvider = useLocalStorage<string>('lawha:vectorize:provider', 'recraft')

function isVectorizeProviderID(value: string): value is VectorizeProviderID {
  return VECTORIZE_PROVIDER_IDS.some((providerID) => providerID === value)
}

/** The cloud service whose key Settings edits; Image Trace on this device needs none. */
export const vectorizeProviderID = computed<VectorizeProviderID>({
  get: () => (isVectorizeProviderID(storedProvider.value) ? storedProvider.value : 'recraft'),
  set: (providerID) => {
    storedProvider.value = providerID
  }
})

/** What Convert to vector uses: the on-device Image Trace or the chosen cloud service. */
export const vectorizeEngine = computed<VectorizeEngine>({
  get: () => (storedProvider.value === 'local' ? 'local' : vectorizeProviderID.value),
  set: (engine) => {
    storedProvider.value = engine
  }
})

const traceOptionsSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({
    preset: v.picklist(TRACE_PRESETS),
    colors: v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(32)),
    threshold: v.pipe(v.number(), v.minValue(0), v.maxValue(255))
  })
)

/** How Image Trace on this device reads images, as Settings last set it. */
export const localTraceOptions = useLocalStorage<LocalTraceOptions>(
  'lawha:vectorize:trace',
  { ...DEFAULT_LOCAL_TRACE_OPTIONS },
  {
    serializer: {
      read: (raw) => {
        const result = v.safeParse(traceOptionsSchema, raw)
        return result.success ? result.output : { ...DEFAULT_LOCAL_TRACE_OPTIONS }
      },
      write: JSON.stringify
    }
  }
)
