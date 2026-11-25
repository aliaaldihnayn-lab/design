import { expect, test } from 'bun:test'

import { includesCloud } from '#vite-config/aliases'

test('the editor includes Cloud only when asked, and a Cloud site always does', () => {
  expect(includesCloud({ cloudSite: false, flag: undefined })).toBe(false)
  expect(includesCloud({ cloudSite: false, flag: 'off' })).toBe(false)
  expect(includesCloud({ cloudSite: false, flag: 'on' })).toBe(true)
  // `bun run build:cloud` and `cloud:dev` serve the editor from the Cloud server itself.
  expect(includesCloud({ cloudSite: true, flag: undefined })).toBe(true)
})
