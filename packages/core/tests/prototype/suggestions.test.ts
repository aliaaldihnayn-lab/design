import { describe, expect, test } from 'bun:test'

import { matchesQuery, searchKey } from '#core/prototype/suggestions'

describe('suggestion search', () => {
  test('ignores case and accents', () => {
    expect(matchesQuery('São Paulo', 'sao')).toBe(true)
    expect(matchesQuery('Zürich', 'ZUR')).toBe(true)
    expect(matchesQuery('Riyadh', 'jed')).toBe(false)
  })

  test('reads Arabic spelled with or without vowels, hamza seats, and teh marbuta', () => {
    expect(matchesQuery('جدة', 'جده')).toBe(true)
    expect(matchesQuery('الرِّيَاض', 'الرياض')).toBe(true)
    expect(matchesQuery('أبها', 'ابها')).toBe(true)
    expect(matchesQuery('مستشفى', 'مستشفي')).toBe(true)
    expect(matchesQuery('القاهـــرة', 'القاهرة')).toBe(true)
    expect(matchesQuery('مكة', 'الرياض')).toBe(false)
  })

  test('reads Arabic-Indic digits as digits and empty text as matching everything', () => {
    expect(searchKey('شارع ١٢')).toBe(searchKey('شارع 12'))
    expect(matchesQuery('Anything', '   ')).toBe(true)
  })
})
