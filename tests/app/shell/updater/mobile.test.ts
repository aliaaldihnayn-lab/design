import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { isNewerVersion, newerAPK } from '@/app/shell/updater/mobile'

import { testPath } from '#tests/helpers/paths'

/** The release GitHub's API describes, as the desktop-preview workflow publishes it. */
const release = () => readFile(testPath('fixtures/updater/github-release.json'), 'utf8')

describe('phone update versions', () => {
  test('a higher build number is newer, compared as numbers', () => {
    expect(isNewerVersion('0.17.10', '0.17.9')).toBe(true)
    expect(isNewerVersion('0.17.9', '0.17.10')).toBe(false)
    expect(isNewerVersion('0.18.0', '0.17.99')).toBe(true)
  })

  test('the same version or an unreadable one is not an update', () => {
    expect(isNewerVersion('0.17.5', '0.17.5')).toBe(false)
    expect(isNewerVersion('beta', '0.17.5')).toBe(false)
  })
})

describe('the phone update check', () => {
  test('offers the release APK when the release is newer', async () => {
    expect(newerAPK(await release(), '0.17.41')).toEqual({
      version: '0.17.42',
      url: 'https://github.com/aliaaldihnayn-lab/design/releases/download/desktop-preview/Lawha-android.apk'
    })
  })

  test('offers nothing for the installed version, an unnamed release, or other answers', async () => {
    const text = await release()
    expect(newerAPK(text, '0.17.42')).toBeNull()
    expect(newerAPK(text.replace('Lawha 0.17.42 (preview)', 'Preview'), '0.1.0')).toBeNull()
    expect(newerAPK(text.replaceAll('Lawha-android.apk', 'other.apk'), '0.1.0')).toBeNull()
    expect(newerAPK('{"message":"API rate limit exceeded"}', '0.1.0')).toBeNull()
    expect(newerAPK('<html>', '0.1.0')).toBeNull()
  })
})
