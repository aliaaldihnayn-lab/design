import { describe, expect, test } from 'bun:test'

import {
  PANEL_SECTION_TABS,
  panelSections,
  PROPERTIES_TABS,
  sectionsByTab,
  shownDevView,
  shownTab,
  splitTabRow,
  visibleTabs,
  type PanelSection,
  type PanelSelection,
  type SectionTab
} from '@/app/editor/properties-panel/tabs'

const SECTION_TABS: SectionTab[] = ['design', 'prototype', 'adapt', 'system', 'export']

function selection(overrides: Partial<PanelSelection>): PanelSelection {
  return {
    kind: 'single',
    frameTool: false,
    resizes: true,
    freeStyle: true,
    pathEffects: false,
    layoutGuides: false,
    ...overrides
  }
}

/**
 * The sections the one-list Design panel drew for each selection before it was split into tabs,
 * as recorded from `DesignPanel.vue`. Every one must still be drawn, by exactly one tab.
 */
const BEFORE_SPLIT: Array<{ name: string; selection: PanelSelection; sections: PanelSection[] }> = [
  {
    name: 'nothing selected',
    selection: selection({ kind: 'none', resizes: false }),
    sections: ['page', 'variables', 'statuses', 'document', 'prototype', 'designSystem', 'export']
  },
  {
    name: 'a rectangle',
    selection: selection({ type: 'RECTANGLE', pathEffects: true }),
    sections: [
      'header',
      'status',
      'componentPropertyList',
      'slotAuthoring',
      'icon',
      'sticky',
      'shapeWithText',
      'connector',
      'position',
      'constraints',
      'layout',
      'appearance',
      'mask',
      'fill',
      'stroke',
      'effects',
      'selectionColors',
      'pathEffects',
      'prototype',
      'designSystem',
      'export'
    ]
  },
  {
    name: 'a frame',
    selection: selection({ type: 'FRAME', layoutGuides: true }),
    sections: [
      'header',
      'status',
      'componentPropertyList',
      'slotAuthoring',
      'framePreset',
      'icon',
      'sticky',
      'shapeWithText',
      'connector',
      'position',
      'constraints',
      'layout',
      'appearance',
      'mask',
      'fill',
      'stroke',
      'effects',
      'selectionColors',
      'layoutGuides',
      'adapt',
      'prototype',
      'designSystem',
      'export'
    ]
  },
  {
    name: 'text',
    selection: selection({ type: 'TEXT', pathEffects: true }),
    sections: [
      'header',
      'textContent',
      'status',
      'componentPropertyList',
      'slotAuthoring',
      'icon',
      'sticky',
      'shapeWithText',
      'connector',
      'position',
      'constraints',
      'layout',
      'appearance',
      'mask',
      'typography',
      'fill',
      'stroke',
      'effects',
      'selectionColors',
      'pathEffects',
      'prototype',
      'designSystem',
      'export'
    ]
  },
  {
    name: 'a component in a set',
    selection: selection({ type: 'COMPONENT', inComponentSet: true, layoutGuides: true }),
    sections: [
      'header',
      'status',
      'variantAuthoring',
      'componentPropertyList',
      'slotAuthoring',
      'behaviours',
      'icon',
      'sticky',
      'shapeWithText',
      'connector',
      'position',
      'constraints',
      'layout',
      'appearance',
      'mask',
      'fill',
      'stroke',
      'effects',
      'selectionColors',
      'layoutGuides',
      'adapt',
      'prototype',
      'designSystem',
      'export'
    ]
  },
  {
    name: 'an instance',
    selection: selection({ type: 'INSTANCE', layoutGuides: true }),
    sections: [
      'header',
      'status',
      'componentProperties',
      'componentPropertyList',
      'slotAuthoring',
      'icon',
      'sticky',
      'shapeWithText',
      'connector',
      'position',
      'constraints',
      'layout',
      'appearance',
      'mask',
      'fill',
      'stroke',
      'effects',
      'selectionColors',
      'layoutGuides',
      'adapt',
      'prototype',
      'designSystem',
      'export'
    ]
  },
  {
    name: 'a connector',
    selection: selection({ type: 'CONNECTOR', freeStyle: false }),
    sections: [
      'header',
      'status',
      'componentPropertyList',
      'slotAuthoring',
      'icon',
      'sticky',
      'shapeWithText',
      'connector',
      'prototype',
      'designSystem',
      'export'
    ]
  },
  {
    name: 'several layers',
    selection: selection({ kind: 'multi', pathEffects: true }),
    sections: [
      'header',
      'status',
      'componentProperties',
      'position',
      'constraints',
      'selectionLayout',
      'appearance',
      'typography',
      'fill',
      'stroke',
      'effects',
      'selectionColors',
      'pathEffects',
      'export'
    ]
  },
  {
    name: 'the Frame tool',
    selection: selection({ kind: 'none', frameTool: true }),
    sections: [
      'framePresets',
      'page',
      'variables',
      'statuses',
      'document',
      'prototype',
      'designSystem',
      'export'
    ]
  }
]

describe('properties panel sections per tab', () => {
  for (const before of BEFORE_SPLIT) {
    test(`${before.name}: every section is drawn by exactly one tab`, () => {
      const byTab = sectionsByTab(before.selection)
      const drawn = SECTION_TABS.flatMap((tab) => byTab[tab])
      expect(drawn.toSorted()).toEqual(before.sections.toSorted())
      expect(new Set(drawn).size).toBe(drawn.length)
      for (const tab of SECTION_TABS)
        for (const id of byTab[tab]) expect(PANEL_SECTION_TABS[id]).toBe(tab)
    })
  }

  test('every section belongs to a tab that draws sections', () => {
    for (const tab of Object.values(PANEL_SECTION_TABS)) expect(SECTION_TABS).toContain(tab)
  })

  test('a rectangle splits into Design, Prototype, System, and Export', () => {
    const byTab = sectionsByTab(selection({ type: 'RECTANGLE' }))
    expect(byTab.prototype).toEqual(['prototype'])
    expect(byTab.adapt).toEqual([])
    expect(byTab.system).toEqual(['designSystem'])
    expect(byTab.export).toEqual(['export'])
    expect(byTab.design).toContain('fill')
  })

  test('a frame adapts by its presets and by Adapt', () => {
    expect(sectionsByTab(selection({ type: 'FRAME' })).adapt).toEqual(['framePreset', 'adapt'])
    expect(sectionsByTab(selection({ type: 'FRAME', icon: true })).adapt).toEqual(['adapt'])
  })

  test('with nothing selected, variables join the System tab', () => {
    expect(sectionsByTab(selection({ kind: 'none' })).system).toEqual(['variables', 'designSystem'])
  })

  test('the Frame tool keeps a layer’s other tabs', () => {
    const byTab = sectionsByTab(selection({ type: 'FRAME', frameTool: true }))
    expect(byTab.design).toEqual(['framePresets'])
    expect(byTab.adapt).toEqual(['framePreset', 'adapt'])
    expect(byTab.export).toEqual(['export'])
  })

  test('panelSections lists no section twice', () => {
    for (const before of BEFORE_SPLIT) {
      const sections = panelSections(before.selection)
      expect(new Set(sections).size).toBe(sections.length)
    }
  })
})

describe('visible tabs', () => {
  test('Adapt appears only for frames, components, and instances', () => {
    expect(visibleTabs(selection({ type: 'RECTANGLE' }))).not.toContain('adapt')
    expect(visibleTabs(selection({ type: 'TEXT' }))).not.toContain('adapt')
    expect(visibleTabs(selection({ kind: 'none' }))).not.toContain('adapt')
    for (const type of ['FRAME', 'COMPONENT', 'INSTANCE'] as const)
      expect(visibleTabs(selection({ type }))).toContain('adapt')
  })

  test('several layers offer no Prototype, Adapt, or System tab', () => {
    expect(visibleTabs(selection({ kind: 'multi' }))).toEqual([
      'design',
      'export',
      'dev',
      'stories',
      'ai'
    ])
  })

  test('tabs keep their reading order', () => {
    expect(visibleTabs(selection({ type: 'FRAME' }))).toEqual([...PROPERTIES_TABS])
  })

  test('a tab that does not apply falls back to Design, and returns when it applies', () => {
    const rectangle = visibleTabs(selection({ type: 'RECTANGLE' }))
    const frame = visibleTabs(selection({ type: 'FRAME' }))
    expect(shownTab('adapt', rectangle)).toBe('design')
    expect(shownTab('adapt', frame)).toBe('adapt')
    expect(shownTab('export', rectangle)).toBe('export')
  })

  test('Lint shows Inspect where the document has no design lint', () => {
    expect(shownDevView('lint', false)).toBe('inspect')
    expect(shownDevView('lint', true)).toBe('lint')
    expect(shownDevView('code', false)).toBe('code')
  })
})

describe('tab row overflow', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e']

  test('every tab stays while the row fits or before it is measured', () => {
    expect(splitTabRow(tabs, 'a', { available: 500, active: 80, icon: 30 }).overflow).toEqual([])
    expect(splitTabRow(tabs, 'a', { available: 0, active: 80, icon: 30 }).overflow).toEqual([])
  })

  test('the last tabs move into More, and the active one always stays', () => {
    const row = splitTabRow(tabs, 'e', { available: 170, active: 80, icon: 30 })
    // 80 for the active tab, 30 for More, leaves room for two icons.
    expect(row.inline).toEqual(['a', 'b', 'e'])
    expect(row.overflow).toEqual(['c', 'd'])
  })

  test('tabs keep their place by priority and the row keeps its order', () => {
    const row = splitTabRow(tabs, 'a', { available: 170, active: 80, icon: 30 }, ['a', 'e', 'c'])
    expect(row.inline).toEqual(['a', 'c', 'e'])
    expect(row.overflow).toEqual(['b', 'd'])
  })

  test('a row too narrow for any other tab keeps only the active one', () => {
    const row = splitTabRow(tabs, 'c', { available: 90, active: 80, icon: 30 })
    expect(row.inline).toEqual(['c'])
    expect(row.overflow).toEqual(['a', 'b', 'd', 'e'])
  })
})
