import { describe, expect, test } from 'bun:test'

import { useFramePresetMessages } from '@lawha/vue/i18n'

import {
  FRAME_PRESET_CATEGORIES,
  framePresetLabel,
  framePresetMessageKey
} from '@/app/editor/frame-presets'

const presets = FRAME_PRESET_CATEGORIES.flatMap((category) => category.presets)

describe('frame preset names', () => {
  test('every translated name belongs to a preset', () => {
    const keys = new Set(presets.map(framePresetMessageKey))
    for (const key of Object.keys(useFramePresetMessages().value)) expect(keys.has(key)).toBe(true)
  })

  test('shows a generic preset in the reader language and a device as written', () => {
    const desktop = presets.find((preset) => preset.id === 'desktop')
    const iphone = presets.find((preset) => preset.id === 'iphone-air')
    if (!desktop || !iphone) throw new Error('presets missing')
    const arabic = { desktop: 'سطح المكتب' }
    expect(framePresetLabel(desktop, arabic)).toBe('سطح المكتب')
    expect(framePresetLabel(iphone, arabic)).toBe(iphone.name)
    expect(framePresetLabel(desktop, {})).toBe(desktop.name)
  })
})
