import { describe, expect, test } from 'bun:test'

import { converter } from 'culori'

import { FigmaAPI } from '@lawha/core/figma-api'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'
import { getSharedStyles } from '@lawha/scene-graph/shared-styles'
import { pixelLength } from '@lawha/scene-graph/text'

import { darkColor } from '#core/design-system/themes'

const toOKLCH = converter('oklch')
const lightness = (c: { r: number; g: number; b: number }) => toOKLCH({ mode: 'rgb', ...c }).l

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('expected a value')
  return value
}

const build = must(ALL_TOOLS.find((tool) => tool.name === 'build_design_system'))

/** What the build reports about its component sets. */
interface ComponentsReport {
  components: { name: string; id: string; variants: number; properties: string[] }[]
}

const hex = (h: string) => ({
  r: Number.parseInt(h.slice(1, 3), 16) / 255,
  g: Number.parseInt(h.slice(3, 5), 16) / 255,
  b: Number.parseInt(h.slice(5, 7), 16) / 255,
  a: 1
})
const fill = (h: string) => [{ type: 'SOLID' as const, color: hex(h), opacity: 1, visible: true }]

/** A screen with a white background, dark and grey text at 28/16/12, and an indigo button. */
function design() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const screen = graph.createNode('FRAME', page, {
    name: 'Home',
    width: 390,
    height: 844,
    fills: fill('#FFFFFF'),
    paddingLeft: 24,
    paddingTop: 16
  })
  const texts: string[] = []
  const text = (size: number, weight: number, color: string) => {
    const node = graph.createNode('TEXT', screen.id, {
      name: `Text ${size}`,
      text: 'Hello',
      fontFamily: 'Inter',
      fontSize: size,
      fontWeight: weight,
      lineHeight: pixelLength(Math.round(size * 1.5)),
      fills: fill(color)
    })
    texts.push(node.id)
  }
  text(28, 700, '#111111')
  for (let i = 0; i < 3; i++) text(16, 400, '#111111')
  text(12, 400, '#6B7280')
  graph.createNode('FRAME', screen.id, {
    name: 'Button',
    width: 342,
    height: 52,
    cornerRadius: 8,
    fills: fill('#4F46E5')
  })
  graph.createNode('FRAME', screen.id, {
    name: 'Card',
    width: 342,
    height: 52,
    cornerRadius: 8,
    fills: fill('#4F46E5')
  })
  return { figma: new FigmaAPI(graph), graph, texts }
}

describe('dark mode', () => {
  test('dark values swap surfaces and text and lift brand colours', () => {
    const background = darkColor('color/background', hex('#FFFFFF'))
    const textPrimary = darkColor('color/text/primary', hex('#111111'))
    const primary = darkColor('color/primary', hex('#4F46E5'))
    expect(lightness(background)).toBeLessThan(0.25)
    expect(lightness(textPrimary)).toBeGreaterThan(0.85)
    expect(lightness(primary)).toBeGreaterThan(lightness(hex('#4F46E5')))
    const hue = (c: { r: number; g: number; b: number }) => toOKLCH({ mode: 'rgb', ...c }).h ?? 0
    expect(Math.abs(hue(primary) - hue(hex('#4F46E5')))).toBeLessThan(6)
  })

  test('the build gives the collection Light and Dark modes with a value for each colour', () => {
    const { figma } = design()
    const out = build.execute(figma, {}) as {
      collection: string
      modes: { light: string; dark: string }
    }
    const collection = must(figma.variables.getVariableCollectionById(out.collection))
    expect(collection.modes.map((mode) => mode.name)).toEqual(['Light', 'Dark'])
    const background = must(
      figma.variables.getLocalVariables().find((v) => v.name === 'color/background')
    )
    const light = background.valuesByMode[out.modes.light] as { r: number; g: number; b: number }
    const dark = background.valuesByMode[out.modes.dark] as { r: number; g: number; b: number }
    expect(lightness(light)).toBeGreaterThan(0.95)
    expect(lightness(dark)).toBeLessThan(0.25)
    // Building again keeps the two modes.
    build.execute(figma, {})
    expect(collection.modes).toHaveLength(2)
  })

  test('the docs page shows a Dark copy of the colours set to the Dark mode', () => {
    const { figma, graph } = design()
    const out = build.execute(figma, {}) as {
      docsPage: string
      darkPreview: string
      modes: { dark: string }
      collection: string
    }
    const preview = must(graph.getNode(out.darkPreview))
    expect(preview.name).toBe('Colors · Dark')
    expect(preview.variableModes[out.collection]).toBe(out.modes.dark)
    const labels = preview.childIds.map((id) => must(graph.getNode(id)).name)
    expect(labels.some((name) => name.startsWith('#'))).toBe(false)
  })
})

describe('text styles', () => {
  test('the type scale becomes shared text styles that the text layers use', () => {
    const { figma, graph, texts } = design()
    const out = build.execute(figma, {}) as {
      textStyles: { styles: { name: string; id: string }[]; created: number; linked: number }
    }
    expect(out.textStyles.styles.map((s) => s.name)).toEqual([
      'Type/h1',
      'Type/body',
      'Type/caption'
    ])
    expect(out.textStyles.linked).toBe(5)
    const styles = getSharedStyles(graph, 'text')
    expect(styles.map((s) => s.name).sort()).toEqual(['Type/body', 'Type/caption', 'Type/h1'])
    const h1 = must(styles.find((s) => s.name === 'Type/h1'))
    const node = must(graph.getNode(h1.nodeId))
    expect(node).toMatchObject({ fontSize: 28, fontWeight: 700, fontFamily: 'Inter' })
    expect(node.boundVariables.fontSize).toBeDefined()
    expect(must(graph.getNode(texts[0])).textStyleId).toBe(h1.id)

    // Building again updates the same styles, and the layers keep them.
    const again = build.execute(figma, {}) as { textStyles: { created: number; updated: number } }
    expect(again.textStyles).toMatchObject({ created: 0, updated: 3 })
    expect(getSharedStyles(graph, 'text')).toHaveLength(3)
    expect(must(graph.getNode(texts[0])).textStyleId).toBe(h1.id)
  })
})

describe('components', () => {
  test('Button, Input and Badge are component sets with variants bound to the tokens', () => {
    const { figma, graph } = design()
    const out = build.execute(figma, {}) as {
      components: { name: string; id: string; variants: number; properties: string[] }[]
    }
    expect(out.components.map((c) => [c.name, c.variants])).toEqual([
      ['Button', 9],
      ['Input', 4],
      ['Badge', 3]
    ])
    const button = must(figma.getNodeById(out.components[0].id))
    expect(button.type).toBe('COMPONENT_SET')
    const definitions = button.componentPropertyDefinitions as Record<
      string,
      { type: string; defaultValue: unknown; variantOptions?: string[] }
    >
    expect(definitions.Variant.variantOptions).toEqual(['Primary', 'Secondary', 'Ghost'])
    expect(definitions.State.variantOptions).toEqual(['Default', 'Hover', 'Disabled'])
    const labelKey = must(Object.keys(definitions).find((key) => key.startsWith('Label#')))
    expect(definitions[labelKey]).toMatchObject({ type: 'TEXT', defaultValue: 'Button' })

    const primary = must(
      figma.variables.getLocalVariables().find((v) => v.name === 'color/primary')
    )
    const variants = must(graph.getNode(button.id)).childIds.map((id) => must(graph.getNode(id)))
    const primaryDefault = must(variants.find((v) => v.name === 'Variant=Primary, State=Default'))
    expect(primaryDefault.boundVariables['fills/0/color']).toBe(primary.id)
    const disabled = must(variants.find((v) => v.name === 'Variant=Ghost, State=Disabled'))
    expect(disabled.opacity).toBe(0.4)

    // An instance's label follows the Label property.
    const component = must(figma.getNodeById(primaryDefault.id))
    if (component.type !== 'COMPONENT') throw new Error('not a component')
    const instance = component.createInstance()
    instance.setProperties({ [labelKey]: 'Pay now' })
    const label = must(instance.findOne((n) => n.type === 'TEXT'))
    expect(label.characters).toBe('Pay now')
  })

  test('components can be left out, and they go nowhere without the docs page', () => {
    const { figma } = design()
    expect((build.execute(figma, { components: false }) as ComponentsReport).components).toEqual([])
    const { figma: other } = design()
    expect((build.execute(other, { docs: false }) as ComponentsReport).components).toEqual([])
  })
})
