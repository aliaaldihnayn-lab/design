import { readFileSync } from 'node:fs'

import type { FontManager } from '#core/text/font/manager'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { testPath } from '#tests/helpers/paths'

const editor = useEditorSetup('/?test&no-chrome&no-rulers')
const FAMILIES = ['Geist', 'Geist Mono', 'Roboto Mono']

test('loads document font families from the browser provider before rendering', async () => {
  test.setTimeout(60_000)
  // Fontsource answers with fixture bytes, so the test never depends on the font host.
  const data = readFileSync(testPath('fixtures', 'fonts', 'InterVariable-Latin.ttf'))
  const fontsource = await mockFontsource(
    editor.page,
    FAMILIES.map((family) => ({ family, subset: 'latin', data }))
  )
  const result = await editor.page.evaluate(async (families) => {
    const coreTextURL = '/packages/core/src/text/index.ts'
    const { fontManager }: { fontManager: FontManager } = await import(coreTextURL)
    fontManager.setOnlineFontProviders({
      google: false,
      fontsource: true,
      bunny: false,
      fontshare: false
    })
    return Promise.all(
      families.map(async (family) => {
        const data = await fontManager.loadRemoteFont(family, 'Regular', 'Browser font')
        return {
          family,
          bytes: data?.byteLength ?? 0,
          source: fontManager.loadedFontSource(family, 'Regular')
        }
      })
    )
  }, FAMILIES)
  await fontsource.dispose()

  expect(result).toEqual([
    { family: 'Geist', bytes: expect.any(Number), source: 'fontsource' },
    { family: 'Geist Mono', bytes: expect.any(Number), source: 'fontsource' },
    { family: 'Roboto Mono', bytes: expect.any(Number), source: 'fontsource' }
  ])
  for (const face of result) expect(face.bytes).toBe(data.byteLength)
  expect(fontsource.counts.downloads).toBe(FAMILIES.length)
})
