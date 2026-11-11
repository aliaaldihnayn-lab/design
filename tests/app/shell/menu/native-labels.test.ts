import { describe, expect, test } from 'bun:test'

import { useMenuMessages } from '@lawha/vue/i18n'

import { nativeMenuLabels } from '@/app/shell/menu/native-labels'

describe('desktop menu labels', () => {
  test('name native-only items, the application menu and the top menus in the app language', () => {
    const english = useMenuMessages().value
    const translated = {
      ...english,
      developerTools: 'أدوات المطوّر',
      aboutLawha: 'حول لوحة',
      quitLawha: 'إنهاء لوحة',
      file: 'ملف'
    }
    const labels = nativeMenuLabels(translated as typeof english)
    expect(labels['dev-tools']).toBe('أدوات المطوّر')
    expect(labels.about).toBe('حول لوحة')
    expect(labels.quit).toBe('إنهاء لوحة')
    expect(labels['group:File']).toBe('ملف')
    expect(labels['app.hide']).toBe(english.hideLawha)
    // Items with a message of their own keep it.
    expect(labels.save).toBe(english.save)
  })
})
