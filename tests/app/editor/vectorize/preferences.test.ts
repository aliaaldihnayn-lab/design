import { afterEach, describe, expect, test } from 'bun:test'

import {
  DEFAULT_LOCAL_TRACE_OPTIONS,
  localTraceOptions,
  vectorizeEngine,
  vectorizeProviderID
} from '@/app/editor/vectorize'

afterEach(() => {
  vectorizeProviderID.value = 'recraft'
  localTraceOptions.value = { ...DEFAULT_LOCAL_TRACE_OPTIONS }
})

/** The stored choices as they read now; reading through a call keeps assignments from narrowing them. */
const engine = () => vectorizeEngine.value
const provider = () => vectorizeProviderID.value

describe('vectorize engine preference', () => {
  test('Image Trace on this device is chosen like a provider and keeps the cloud key choice', () => {
    vectorizeProviderID.value = 'fal'
    vectorizeEngine.value = 'local'
    expect(engine()).toBe('local')
    // The cloud service whose key Settings edits is still a cloud service.
    expect(provider()).toBe('recraft')
    vectorizeProviderID.value = 'quiver'
    expect(engine()).toBe('quiver')
  })

  test('trace settings are kept as set', () => {
    localTraceOptions.value = { preset: 'line-art', colors: 4, threshold: 200 }
    expect(localTraceOptions.value).toEqual({ preset: 'line-art', colors: 4, threshold: 200 })
  })
})
