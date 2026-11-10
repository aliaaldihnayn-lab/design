import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { SceneGraph } from '@lawha/scene-graph'
import { pixelLength } from '@lawha/scene-graph/text'

import { inspectCompose, inspectCSS, inspectLayer, inspectSwiftUI } from '#core/inspect'
import { inspectLayerTool } from '#core/tools/inspect'

const solid = (r: number, g: number, b: number, opacity = 1) => [
  { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity, visible: true }
]

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('expected a value')
  return value
}

/** A card: auto layout column with padding and gap, a bound fill, a border, a shadow and a title. */
function card() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const collection = graph.createCollection('Theme')
  const primary = graph.createVariable('color/primary', 'COLOR', collection.id, {
    r: 0.31,
    g: 0.27,
    b: 0.9,
    a: 1
  })
  const frame = graph.createNode('FRAME', page, {
    name: 'Card',
    width: 320,
    height: 200,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    paddingTop: 16,
    paddingRight: 24,
    paddingBottom: 16,
    paddingLeft: 24,
    primaryAxisAlign: 'MIN',
    counterAxisAlign: 'CENTER',
    cornerRadius: 12,
    minWidth: 240,
    maxWidth: 480,
    fills: solid(0.31, 0.27, 0.9),
    strokes: [{ ...solid(0, 0, 0, 0.1)[0], weight: 1, align: 'INSIDE' }],
    effects: [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 4 },
        radius: 12,
        spread: 0,
        visible: true
      }
    ]
  })
  graph.bindVariable(frame.id, 'fills/0/color', primary.id)
  const title = graph.createNode('TEXT', frame.id, {
    name: 'Title',
    text: 'Hello',
    fontFamily: 'Inter',
    fontWeight: 600,
    fontSize: 20,
    lineHeight: pixelLength(28),
    textAlignHorizontal: 'CENTER',
    fills: solid(1, 1, 1),
    width: 100,
    height: 28
  })
  return { graph, frame, title }
}

describe('inspect', () => {
  test('reads size limits, layout, paint and the variables values are bound to', () => {
    const { graph, frame } = card()
    const spec = must(inspectLayer(graph, frame.id))
    expect(spec).toMatchObject({
      width: 320,
      height: 200,
      radii: [12, 12, 12, 12],
      sizing: { width: 'fixed', height: 'fixed', minWidth: 240, maxWidth: 480 },
      layout: {
        direction: 'column',
        gap: 12,
        padding: [16, 24, 16, 24],
        justify: 'start',
        align: 'center'
      }
    })
    expect(spec.fills).toEqual([
      {
        kind: 'solid',
        hex: '#4F45E6',
        opacity: 1,
        css: '#4F45E6',
        variable: { name: 'color/primary', css: 'color-primary' }
      }
    ])
    expect(spec.strokes[0]).toMatchObject({ weight: 1, align: 'inside', opacity: 0.1 })
    expect(spec.shadows[0]).toMatchObject({ x: 0, y: 4, blur: 12, inner: false, opacity: 0.25 })
  })

  test('CSS lists the declarations Dev Mode shows, through variables', () => {
    const { graph, frame, title } = card()
    const css = inspectCSS(must(inspectLayer(graph, frame.id)))
    expect(css.split('\n')).toEqual([
      'width: 320px;',
      'height: 200px;',
      'min-width: 240px;',
      'max-width: 480px;',
      'display: flex;',
      'flex-direction: column;',
      'justify-content: flex-start;',
      'align-items: center;',
      'gap: 12px;',
      'padding: 16px 24px 16px 24px;',
      'border-radius: 12px;',
      'background: var(--color-primary, #4F45E6);',
      'box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1), 0px 4px 12px 0px rgba(0, 0, 0, 0.25);'
    ])
    const text = inspectCSS(must(inspectLayer(graph, title.id)))
    expect(text).toContain('font-family: "Inter";')
    expect(text).toContain('font-weight: 600;')
    expect(text).toContain('line-height: 28px;')
    expect(text).toContain('text-align: center;')
    expect(text).toContain('color: #FFFFFF;')
  })

  test('SwiftUI and Compose give the same layer as native code', () => {
    const { graph, frame, title } = card()
    const spec = must(inspectLayer(graph, frame.id))
    const swift = inspectSwiftUI(spec)
    expect(swift).toStartWith('VStack(alignment: .center, spacing: 12) {')
    expect(swift).toContain('.padding(EdgeInsets(top: 16, leading: 24, bottom: 16, trailing: 24))')
    expect(swift).toContain('.frame(width: 320, height: 200)')
    expect(swift).toContain('.frame(minWidth: 240, maxWidth: 480, minHeight: nil, maxHeight: nil)')
    expect(swift).toContain(
      '.background(/* color/primary */ Color(hex: 0x4F45E6), in: RoundedRectangle(cornerRadius: 12))'
    )
    const compose = inspectCompose(spec)
    expect(compose).toStartWith('Column(')
    expect(compose).toContain('.widthIn(min = 240.dp, max = 480.dp)')
    expect(compose).toContain(
      '.background(Color(0xFF4F45E6) /* color/primary */, RoundedCornerShape(12.dp))'
    )
    expect(compose).toContain('verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.Top)')
    const label = inspectCompose(must(inspectLayer(graph, title.id)))
    expect(label).toContain('fontWeight = FontWeight(600)')
    expect(label).toContain('textAlign = TextAlign.Center')
    expect(inspectSwiftUI(must(inspectLayer(graph, title.id)))).toContain('.weight(.semibold)')
  })

  test('a child that fills its auto layout parent reads as fill', () => {
    const { graph, frame, title } = card()
    graph.updateNode(title.id, { layoutAlignSelf: 'STRETCH' })
    const spec = must(inspectLayer(graph, title.id))
    expect(spec.sizing.width).toBe('fill')
    expect(inspectCSS(must(inspectLayer(graph, frame.id)))).toContain('align-items: center;')
  })

  test('inspect_layer returns the spec and code, or one language', () => {
    const { graph, frame } = card()
    const figma = new FigmaAPI(graph)
    const all = inspectLayerTool.execute(figma, { id: frame.id }) as {
      code: Record<string, string>
    }
    expect(Object.keys(all.code)).toEqual(['css', 'swiftui', 'compose'])
    const one = inspectLayerTool.execute(figma, { id: frame.id, language: 'compose' }) as {
      code: Record<string, string>
    }
    expect(Object.keys(one.code)).toEqual(['compose'])
    expect(inspectLayerTool.execute(figma, { id: 'nope' })).toEqual({
      error: 'Node nope not found'
    })
  })
})
