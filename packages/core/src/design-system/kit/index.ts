import type { CalendarDate } from '@internationalized/date'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import type { Vector } from '@lawha/scene-graph/primitives'

import { designJSXRenderer } from '#core/design-jsx'
import type { IconProvider } from '#core/icons'

import { CHOICE_KITS } from './choices'
import { CONTROL_KITS } from './controls'
import { dateKits, type KitCalendar } from './dates'
import { FIELD_KITS } from './fields'
import { KIT_KINDS, type KitDefinition, type KitKind } from './jsx'
import { NAVIGATION_KITS } from './navigation'
import { OVERLAY_KITS } from './overlays'
import { kitTheme, type KitOptions } from './theme'
import { KitWiring } from './wire'

export { KIT_KINDS, type KitKind } from './jsx'
export type { KitCalendar } from './dates'
export { KIT_STATE_COLLECTION } from './wire'

/**
 * The interactive kit: ready-made controls whose every state is a variant of one component,
 * wired with in-place interactions and prototype variables, so they open, type, toggle, and
 * animate live on the canvas and in the player. Each is drawn once per document on the kit's
 * page, themed by the document's design-system variables, and inserted as an instance.
 */
export interface KitBuildOptions extends KitOptions {
  /** The calendar the date pickers draw. */
  calendar?: KitCalendar
  /** The month the date pickers open on; today's when unset. */
  today?: CalendarDate
  /** Where the kit's components are drawn; its own page when unset. */
  pageId?: string
  icons?: IconProvider
}

export const KIT_PAGE_NAME = 'Interactive kit'
export const KIT_RTL_PAGE_NAME = 'Interactive kit (RTL)'

/** Every control's definition, in the kit's order. */
function definitions(options: KitBuildOptions): Map<KitKind, KitDefinition> {
  const all = [
    ...FIELD_KITS,
    ...CHOICE_KITS,
    ...CONTROL_KITS,
    ...OVERLAY_KITS,
    ...NAVIGATION_KITS,
    ...dateKits({ calendar: options.calendar, today: options.today })
  ]
  return new Map(KIT_KINDS.map((kind) => [kind, requireDefinition(all, kind)]))
}

function requireDefinition(all: readonly KitDefinition[], kind: KitKind): KitDefinition {
  const found = all.find((item) => item.kind === kind)
  if (!found) throw new Error(`The kit has no ${kind}`)
  return found
}

/** The page the kit is drawn on, made the first time. */
export function kitPage(graph: SceneGraph, options: KitBuildOptions = {}): SceneNode {
  if (options.pageId) {
    const page = graph.getNode(options.pageId)
    if (!page) throw new Error(`Page ${options.pageId} not found`)
    return page
  }
  const name = options.rtl ? KIT_RTL_PAGE_NAME : KIT_PAGE_NAME
  return graph.getPages().find((page) => page.name === name) ?? graph.addPage(name)
}

/** Components and sets by name below a layer, itself included. */
function componentsBelow(graph: SceneGraph, rootIds: readonly string[]): Map<string, SceneNode> {
  const out = new Map<string, SceneNode>()
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    if (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && !out.has(node.name))) {
      // A set's variants are found through the set.
      if (!out.has(node.name)) out.set(node.name, node)
      if (node.type === 'COMPONENT_SET') return
    }
    for (const child of node.childIds) walk(child)
  }
  rootIds.forEach(walk)
  return out
}

/** Where the next control goes on the kit's page: below everything on it. */
function nextSlot(graph: SceneGraph, page: SceneNode): Vector {
  let bottom = 0
  for (const child of graph.getChildren(page.id)) bottom = Math.max(bottom, child.y + child.height)
  return { x: 0, y: page.childIds.length > 0 ? bottom + 80 : 0 }
}

export interface BuiltKitComponent {
  kind: KitKind
  name: string
  /** The main set or component, which instances come from. */
  id: string
  /** The variant an inserted instance shows. */
  insertId: string
  created: boolean
}

/** The variant or component a control's instances show when inserted. */
function insertTarget(graph: SceneGraph, main: SceneNode, definition: KitDefinition): SceneNode {
  if (main.type !== 'COMPONENT_SET') return main
  const variant = graph.getChildren(main.id).find((child) => child.name === definition.insert)
  if (!variant) throw new Error(`${main.name} has no variant ${definition.insert}`)
  return variant
}

/**
 * The control's component in the document, drawing and wiring it on the kit's page the first
 * time; later calls reuse it, so every instance shares one component and its states.
 */
export async function buildKitComponent(
  graph: SceneGraph,
  kind: KitKind,
  options: KitBuildOptions = {}
): Promise<BuiltKitComponent> {
  const definition = definitions(options).get(kind)
  if (!definition) throw new Error(`Unknown kit control ${kind}`)
  const page = kitPage(graph, options)
  const existing = componentsBelow(graph, page.childIds).get(definition.name)
  if (existing)
    return {
      kind,
      name: definition.name,
      id: existing.id,
      insertId: insertTarget(graph, existing, definition).id,
      created: false
    }
  const theme = kitTheme(graph, options)
  const { renderJSX } = designJSXRenderer(options.icons)
  const roots = await renderJSX(graph, definition.jsx(theme), {
    parentId: page.id,
    ...nextSlot(graph, page)
  })
  const sets = componentsBelow(
    graph,
    roots.map((root) => root.id)
  )
  const main = sets.get(definition.name)
  if (!main) throw new Error(`The kit's ${kind} drew no ${definition.name}`)
  definition.wire?.(new KitWiring(graph, main), theme, sets)
  return {
    kind,
    name: definition.name,
    id: main.id,
    insertId: insertTarget(graph, main, definition).id,
    created: true
  }
}

/** Draws every control of the kit, or the ones named, on the kit's page. */
export async function buildKit(
  graph: SceneGraph,
  kinds: readonly KitKind[] = KIT_KINDS,
  options: KitBuildOptions = {}
): Promise<BuiltKitComponent[]> {
  const built: BuiltKitComponent[] = []
  for (const kind of kinds) built.push(await buildKitComponent(graph, kind, options))
  return built
}

export interface KitInsertOptions extends KitBuildOptions {
  parentId: string
  x?: number
  y?: number
}

/** Inserts an instance of a kit control, drawing its component first if the document lacks it. */
export async function insertKitComponent(
  graph: SceneGraph,
  kind: KitKind,
  options: KitInsertOptions
): Promise<{ instanceId: string; component: BuiltKitComponent }> {
  const component = await buildKitComponent(graph, kind, options)
  const instance = graph.createInstance(component.insertId, options.parentId, {
    x: options.x ?? 0,
    y: options.y ?? 0
  })
  if (!instance) throw new Error(`Could not insert ${component.name}`)
  graph.updateNode(instance.id, { name: component.name.replace(/^Kit\//, '') })
  return { instanceId: instance.id, component }
}
