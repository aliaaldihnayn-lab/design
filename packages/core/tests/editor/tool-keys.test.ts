import { describe, expect, test } from 'bun:test'

import { cycleToolKey, EDITOR_TOOLS, TOOL_KEY_CYCLES, TOOL_SHORTCUTS } from '@lawha/core'

describe('design tool keys', () => {
  test('Shift+M picks the Shape Builder and M the rectangular marquee', () => {
    expect([TOOL_SHORTCUTS['Shift+KeyM'], TOOL_SHORTCUTS.KeyM]).toEqual([
      'SHAPE_BUILDER',
      'MARQUEE_RECT'
    ])
  })

  test('Shift+W picks the Width tool, as in Illustrator', () => {
    expect(TOOL_SHORTCUTS['Shift+KeyW']).toBe('WIDTH')
  })

  test('M again moves between the two marquees and starts from the rectangle', () => {
    expect([
      cycleToolKey('MARQUEE_RECT', 'SELECT'),
      cycleToolKey('MARQUEE_RECT', 'MARQUEE_RECT'),
      cycleToolKey('MARQUEE_RECT', 'MARQUEE_ELLIPSE'),
      cycleToolKey('MARQUEE_RECT', 'MAGIC_WAND'),
      cycleToolKey('RECTANGLE', 'RECTANGLE')
    ]).toEqual(['MARQUEE_RECT', 'MARQUEE_ELLIPSE', 'MARQUEE_RECT', 'MARQUEE_RECT', 'RECTANGLE'])
  })

  test('a cycled tool stays in its key tool’s toolbar group', () => {
    for (const cycle of TOOL_KEY_CYCLES) {
      const flyout = EDITOR_TOOLS.find((tool) => tool.key === cycle[0])?.flyout ?? []
      expect(cycle.every((tool) => flyout.includes(tool))).toBe(true)
    }
  })

  test('each toolbar key names the tool the key map gives it', () => {
    const keyed = EDITOR_TOOLS.filter((tool) => tool.shortcut)
    const codes = keyed.map((tool) =>
      tool.shortcut
        .split('+')
        .map((part) => (part.length === 1 ? `Key${part}` : part))
        .join('+')
    )
    expect(codes.map((code) => TOOL_SHORTCUTS[code])).toEqual(keyed.map((tool) => tool.key))
    expect(new Set(codes).size).toBe(codes.length)
  })
})
