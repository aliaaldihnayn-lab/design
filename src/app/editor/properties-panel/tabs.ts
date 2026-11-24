import type { NodeType } from '@lawha/scene-graph'

/**
 * The right panel's tabs, in reading order: one per kind of work. Design holds everything about
 * the layer itself; Prototype how it behaves when presented; Adapt how a frame turns into other
 * sizes and print products; System the design system built from it; Export its files; Dev the
 * handoff views (inspect, code, lint); Stories and AI as their own panels.
 */
export const PROPERTIES_TABS = [
  'design',
  'prototype',
  'adapt',
  'system',
  'export',
  'dev',
  'stories',
  'ai'
] as const

export type PropertiesTab = (typeof PROPERTIES_TABS)[number]

/** The tabs that draw property sections; the rest are panels of their own. */
export type SectionTab = Extract<
  PropertiesTab,
  'design' | 'prototype' | 'adapt' | 'system' | 'export'
>

/** The views the Dev tab switches between, which were three tabs of their own. */
export const DEV_VIEWS = ['inspect', 'code', 'lint'] as const

export type DevView = (typeof DEV_VIEWS)[number]

/**
 * Every section the properties panel can draw and the one tab that draws it. Being a record, no
 * section can sit in two tabs; `panelSections` decides which of them a selection shows.
 */
export const PANEL_SECTION_TABS = {
  framePresets: 'design',
  header: 'design',
  textContent: 'design',
  status: 'design',
  componentProperties: 'design',
  variantAuthoring: 'design',
  componentPropertyList: 'design',
  slotAuthoring: 'design',
  behaviours: 'design',
  icon: 'design',
  sticky: 'design',
  shapeWithText: 'design',
  connector: 'design',
  position: 'design',
  constraints: 'design',
  selectionLayout: 'design',
  layout: 'design',
  appearance: 'design',
  mask: 'design',
  typography: 'design',
  fill: 'design',
  stroke: 'design',
  effects: 'design',
  selectionColors: 'design',
  layoutGuides: 'design',
  pathEffects: 'design',
  page: 'design',
  statuses: 'design',
  document: 'design',
  prototype: 'prototype',
  framePreset: 'adapt',
  adapt: 'adapt',
  variables: 'system',
  designSystem: 'system',
  export: 'export'
} as const satisfies Record<string, SectionTab>

export type PanelSection = keyof typeof PANEL_SECTION_TABS

/** What the panel needs to know about the selection to choose its sections. */
export interface PanelSelection {
  /** No layer, one layer, or several. */
  kind: 'none' | 'single' | 'multi'
  /** The Frame tool's presets take the Design tab while the tool is active, as in Figma. */
  frameTool: boolean
  /** The single selected layer's type. */
  type?: NodeType
  /** A component inside a component set, whose variant properties it edits. */
  inComponentSet?: boolean
  /** A frame drawn as an icon, which is a glyph rather than an artboard. */
  icon?: boolean
  /** Whether the layer's size is its own to change (a sticky note's follows its text). */
  resizes?: boolean
  /** No FigJam sticky note, shape, or connector, whose sections offer fixed styles instead. */
  freeStyle: boolean
  /** Every selected layer takes Illustrator's path effects. */
  pathEffects: boolean
  /** Every selected layer is a frame, which can hold layout guides. */
  layoutGuides: boolean
}

const COMPONENT_TYPES: ReadonlySet<NodeType> = new Set(['COMPONENT', 'COMPONENT_SET'])
const ADAPTABLE_TYPES: ReadonlySet<NodeType> = new Set(['FRAME', 'COMPONENT', 'INSTANCE'])

function styleSections(selection: PanelSelection, typography: boolean): PanelSection[] {
  const sections: PanelSection[] = []
  if (selection.freeStyle) {
    sections.push('appearance')
    if (selection.kind === 'single') sections.push('mask')
    if (typography) sections.push('typography')
    sections.push('fill', 'stroke', 'effects', 'selectionColors')
  }
  if (selection.layoutGuides) sections.push('layoutGuides')
  if (selection.freeStyle && selection.pathEffects) sections.push('pathEffects')
  return sections
}

function singleSections(selection: PanelSelection): PanelSection[] {
  const type = selection.type
  const sections: PanelSection[] = ['header']
  if (type === 'TEXT') sections.push('textContent')
  sections.push('status')
  if (type === 'INSTANCE') sections.push('componentProperties')
  if (type === 'COMPONENT_SET' || (type === 'COMPONENT' && selection.inComponentSet))
    sections.push('variantAuthoring')
  sections.push('componentPropertyList', 'slotAuthoring')
  if (type && COMPONENT_TYPES.has(type)) sections.push('behaviours')
  // Presets size artboards; an icon is a glyph.
  if (type === 'FRAME' && !selection.icon) sections.push('framePreset')
  sections.push('icon', 'sticky', 'shapeWithText', 'connector')
  // A connector is placed and shaped by its ends, and styled by its line.
  if (type !== 'CONNECTOR') {
    sections.push('position', 'constraints')
    if (selection.resizes) sections.push('layout')
  }
  sections.push(...styleSections(selection, type === 'TEXT'))
  if (type && ADAPTABLE_TYPES.has(type)) sections.push('adapt')
  sections.push('prototype', 'designSystem', 'export')
  return sections
}

/** The sections a selection shows, across every tab, in the order the panel draws them. */
export function panelSections(selection: PanelSelection): PanelSection[] {
  const sections: PanelSection[] = selection.frameTool ? ['framePresets'] : []
  if (selection.kind === 'none')
    return [
      ...sections,
      'page',
      'variables',
      'statuses',
      'document',
      'prototype',
      'designSystem',
      'export'
    ]
  if (selection.kind === 'single') {
    const single = singleSections(selection)
    // The presets replace the layer's own Design sections; its other tabs stay as they were.
    return selection.frameTool
      ? [...sections, ...single.filter((id) => PANEL_SECTION_TABS[id] !== 'design')]
      : single
  }
  const multi: PanelSection[] = [
    'header',
    'status',
    'componentProperties',
    'position',
    'constraints',
    'selectionLayout',
    ...styleSections(selection, true),
    'export'
  ]
  return selection.frameTool
    ? [...sections, ...multi.filter((id) => PANEL_SECTION_TABS[id] !== 'design')]
    : multi
}

/** The sections each section tab shows for a selection. */
export function sectionsByTab(selection: PanelSelection): Record<SectionTab, PanelSection[]> {
  const byTab: Record<SectionTab, PanelSection[]> = {
    design: [],
    prototype: [],
    adapt: [],
    system: [],
    export: []
  }
  for (const id of panelSections(selection)) byTab[PANEL_SECTION_TABS[id]].push(id)
  return byTab
}

/** The tabs a selection offers: a section tab only while it has a section to show. */
export function visibleTabs(selection: PanelSelection): PropertiesTab[] {
  const byTab = sectionsByTab(selection)
  return PROPERTIES_TABS.filter((tab) => {
    if (tab === 'design') return true
    if (tab === 'dev' || tab === 'stories' || tab === 'ai') return true
    return byTab[tab].length > 0
  })
}

/** The tab to draw: the chosen one while the selection offers it, otherwise Design. */
export function shownTab(chosen: PropertiesTab, visible: readonly PropertiesTab[]): PropertiesTab {
  return visible.includes(chosen) ? chosen : 'design'
}

/** The Dev view to draw: Lint only where the document has design lint. */
export function shownDevView(chosen: DevView, lints: boolean): DevView {
  return chosen === 'lint' && !lints ? 'inspect' : chosen
}

/** The room the tab row has, in pixels, and what its tabs take of it. */
export interface TabRowSpace {
  /** Width left for tabs, after the row's padding and anything else in it. */
  available: number
  /** Width of the active tab, which shows its label. */
  active: number
  /** Width an icon-only tab takes, the More button included. */
  icon: number
}

/**
 * The order tabs keep their place in a narrow row: the AI chat and the tabs used while designing
 * stay longest, and the occasional ones move into More first.
 */
export const TAB_ROW_PRIORITY: readonly PropertiesTab[] = [
  'design',
  'ai',
  'prototype',
  'export',
  'dev',
  'adapt',
  'system',
  'stories'
]

/**
 * Which tabs stay in the row and which go into the More menu. The active tab always stays, the
 * others stay by `priority`, and both keep the row's order; before the row has been measured every
 * tab stays.
 */
export function splitTabRow<T>(
  tabs: readonly T[],
  active: T,
  space: TabRowSpace,
  priority: readonly T[] = tabs
): { inline: T[]; overflow: T[] } {
  const others = tabs.filter((tab) => tab !== active)
  if (space.available <= 0 || space.active + others.length * space.icon <= space.available)
    return { inline: [...tabs], overflow: [] }
  const fit = Math.max(0, Math.floor((space.available - space.active - space.icon) / space.icon))
  const rank = (tab: T) => {
    const index = priority.indexOf(tab)
    return index === -1 ? priority.length : index
  }
  const kept = new Set(others.toSorted((a, b) => rank(a) - rank(b)).slice(0, fit))
  return {
    inline: tabs.filter((tab) => tab === active || kept.has(tab)),
    overflow: others.filter((tab) => !kept.has(tab))
  }
}
