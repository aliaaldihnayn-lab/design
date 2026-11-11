import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { sceneNodeToDesignDocument } from '@lawha/dom-css/export'
import { SceneGraph } from '@lawha/scene-graph'
import { pixelLength } from '@lawha/scene-graph/text'

import {
  inspectAndroidXML,
  inspectCompose,
  inspectCSS,
  inspectLayer,
  inspectSwiftUI,
  inspectUIKit
} from '#core/inspect'
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

  test('CSS is what the HTML and JSX export writes, through variables', () => {
    const { graph, frame, title } = card()
    const spec = must(inspectLayer(graph, frame.id))
    const exported = must(sceneNodeToDesignDocument(graph, frame.id).children[0])
    if (exported.type !== 'element') throw new Error('not an element')
    expect(Object.fromEntries(spec.css)).toEqual(exported.inlineStyle ?? {})
    const css = inspectCSS(spec).split('\n')
    expect(css).toContain('background-color: var(--color-primary);')
    expect(css).toContain('border: 1px solid rgba(0, 0, 0, 0.1);')
    expect(css).toContain('box-shadow: 0px 4px 12px 0px rgba(0, 0, 0, 0.25);')
    expect(css).toContain('min-width: 240px;')
    const text = inspectCSS(must(inspectLayer(graph, title.id)))
    expect(text).toContain('font-family: Inter;')
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
    expect(Object.keys(all.code)).toEqual(['css', 'swiftui', 'uikit', 'compose', 'android-xml'])
    const one = inspectLayerTool.execute(figma, { id: frame.id, language: 'compose' }) as {
      code: Record<string, string>
    }
    expect(Object.keys(one.code)).toEqual(['compose'])
    expect(inspectLayerTool.execute(figma, { id: 'nope' })).toEqual({
      error: 'Node nope not found'
    })
  })

  test('UIKit and Android XML give the same layer as native code', () => {
    const { graph, frame, title } = card()
    const spec = must(inspectLayer(graph, frame.id))
    const uikit = inspectUIKit(spec).split('\n')
    expect(uikit[0]).toBe('let card = UIStackView()')
    expect(uikit).toContain('card.axis = .vertical')
    expect(uikit).toContain('card.spacing = 12')
    expect(uikit).toContain(
      'card.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 16, leading: 24, bottom: 16, trailing: 24)'
    )
    expect(uikit).toContain('card.widthAnchor.constraint(equalToConstant: 320).isActive = true')
    expect(uikit).toContain(
      'card.backgroundColor = UIColor(red: 0.31, green: 0.27, blue: 0.9, alpha: 1) /* color/primary */'
    )
    expect(uikit).toContain('card.layer.cornerRadius = 12')
    expect(uikit).toContain('card.layer.shadowRadius = 6')
    expect(inspectUIKit(must(inspectLayer(graph, title.id)))).toContain(
      'title.font = UIFont(name: "Inter", size: 20) ?? .systemFont(ofSize: 20, weight: .semibold)'
    )

    const xml = inspectAndroidXML(spec).split('\n')
    expect(xml[1]).toBe('<LinearLayout')
    expect(xml).toContain('    android:layout_width="320dp"')
    expect(xml).toContain('    android:orientation="vertical"')
    expect(xml).toContain('    android:paddingStart="24dp"')
    expect(xml).toContain('    android:background="@drawable/card_background"')
    expect(xml).toContain('    <solid android:color="#FF4F45E6" />')
    expect(xml).toContain('    <corners android:radius="12dp" />')
    const label = inspectAndroidXML(must(inspectLayer(graph, title.id)))
    expect(label).toContain('<TextView')
    expect(label).toContain('android:textSize="20sp"')
    expect(label).toContain('android:textFontWeight="600"')
    expect(label).toContain('android:textColor="#FFFFFFFF"')
  })

  test('gradients come out in every language', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const node = graph.createNode('FRAME', page, {
      name: 'Hero',
      width: 200,
      height: 100,
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          // Figma's default: top to bottom.
          gradientTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 },
          gradientStops: [
            { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
            { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
          ]
        }
      ]
    })
    const spec = must(inspectLayer(graph, node.id))
    const gradient = spec.fills[0]
    if (gradient.kind !== 'gradient') throw new Error('not a gradient')
    expect(gradient.geometry.start).toEqual({ x: 0.5, y: 0 })
    expect(gradient.geometry.end).toEqual({ x: 0.5, y: 1 })
    expect(gradient.geometry.angle).toBeCloseTo(180)
    expect(inspectCSS(spec)).toContain(
      'background-image: linear-gradient(180deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%);'
    )
    expect(inspectSwiftUI(spec)).toContain(
      '.background(LinearGradient(stops: [.init(color: Color(hex: 0xFF0000), location: 0), .init(color: Color(hex: 0x0000FF), location: 1)], startPoint: UnitPoint(x: 0.5, y: 0), endPoint: UnitPoint(x: 0.5, y: 1)))'
    )
    expect(inspectCompose(spec)).toContain(
      '.background(Brush.linearGradient(0f to Color(0xFFFF0000), 1f to Color(0xFF0000FF), start = Offset(100f, 0f), end = Offset(100f, 100f)), RectangleShape)'
    )
    const uikit = inspectUIKit(spec)
    expect(uikit).toContain('gradient.type = .axial')
    expect(uikit).toContain('gradient.startPoint = CGPoint(x: 0.5, y: 0)')
    expect(uikit).toContain('gradient.locations = [0, 1]')
    const xml = inspectAndroidXML(spec)
    expect(xml).toContain('android:type="linear"')
    // Top to bottom is Android's 270.
    expect(xml).toContain('android:angle="270"')
    expect(xml).toContain('android:startColor="#FFFF0000"')
    expect(xml).toContain('android:endColor="#FF0000FF"')
  })
})
