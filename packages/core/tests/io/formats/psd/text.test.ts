import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { writePsdUint8Array, type Layer, type LayerTextData } from 'ag-psd'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import type { SceneNode } from '@lawha/scene-graph'

setDefaultTimeout(60_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)
const px = (value: number) => ({ units: 'Pixels' as const, value })

/**
 * A text layer as Photoshop saves one: its drawn pixels in a tight box (the ink, narrower than
 * the text's layout), and the text's layout bounds or paragraph box around its transform.
 */
function textLayer(
  name: string,
  ink: [number, number, number, number],
  text: LayerTextData
): Layer {
  const [left, top, right, bottom] = ink
  return {
    name,
    left,
    top,
    right,
    bottom,
    imageData: {
      width: right - left,
      height: bottom - top,
      data: new Uint8ClampedArray((right - left) * (bottom - top) * 4)
    },
    text
  }
}

async function openText(layer: Layer): Promise<SceneNode> {
  const bytes = writePsdUint8Array(
    { width: 600, height: 400, children: [layer] },
    { generateThumbnail: false, invalidateTextLayers: false }
  )
  const { graph } = await io.readDocument({ name: 'text.psd', data: bytes })
  const frame = expectDefined(graph.getNode(graph.getPages()[0].childIds[0]))
  return expectDefined(graph.getChildren(frame.id).find((node) => node.type === 'TEXT'))
}

const font = { name: 'NotoNaskhArabic-Regular' }

describe('opening PSD text', () => {
  test('point text sits on its layout bounds around its anchor and never wraps', async () => {
    // Right-justified Arabic: the anchor is the line's right end, the bounds reach left of it.
    const text = await openText(
      textLayer('Title', [364, 42, 557, 94], {
        text: 'السَّلَامُ عَلَيْكُمْ',
        transform: [1, 0, 0, 1, 560, 80],
        shapeType: 'point',
        bounds: { left: px(-199.3), top: px(-48), right: px(0), bottom: px(28) },
        paragraphStyle: { justification: 'right' },
        style: { font, fontSize: 44, fillColor: { r: 20, g: 40, b: 160 } }
      })
    )
    expect(text).toMatchObject({
      x: 360.7,
      y: 32,
      width: 199.3,
      height: 76,
      rotation: 0,
      fontFamily: 'Noto Naskh Arabic',
      fontSize: 44,
      textAlignHorizontal: 'RIGHT',
      textDirection: 'RTL',
      textAutoResize: 'WIDTH_AND_HEIGHT'
    })
  })

  test('paragraph text fills its box and grows taller rather than spilling out', async () => {
    const text = await openText(
      textLayer('Paragraph', [315, 199, 570, 310], {
        text: 'هذا نص عربي طويل داخل صندوق فقرة يلتف على عدة أسطر\r',
        transform: [1, 0, 0, 1, 300, 190],
        shapeType: 'box',
        boxBounds: [0, 0, 270, 160],
        paragraphStyle: { justification: 'right' },
        style: { font, fontSize: 24, autoLeading: false, leading: 29, tracking: 50 }
      })
    )
    expect(text).toMatchObject({
      x: 300,
      y: 190,
      width: 270,
      height: 160,
      // Photoshop ends the text with a paragraph break that draws nothing.
      text: 'هذا نص عربي طويل داخل صندوق فقرة يلتف على عدة أسطر',
      textAlignHorizontal: 'RIGHT',
      textAutoResize: 'HEIGHT',
      lineHeight: { value: 29, unit: 'PIXELS' },
      letterSpacing: { value: 5, unit: 'PERCENT' }
    })
  })

  test('turned and scaled text keeps its centre, turn and drawn size', async () => {
    const angle = (-25 * Math.PI) / 180
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
    // Scaled by two: the text is twice its type size and its box twice its bounds.
    const text = await openText(
      textLayer('Rotated', [69, 288, 171, 362], {
        text: 'نص مائل',
        transform: [2 * cos, 2 * sin, -2 * sin, 2 * cos, 120, 330],
        shapeType: 'point',
        bounds: { left: px(-30), top: px(-20), right: px(30), bottom: px(10) },
        paragraphStyle: { justification: 'center' },
        style: { font, fontSize: 18 }
      })
    )
    // The bounds' centre, (0, −5), turned and scaled about the anchor.
    const centerX = 120 + 2 * (-sin * -5)
    const centerY = 330 + 2 * (cos * -5)
    expect(text.rotation).toBeCloseTo(-25, 2)
    expect(text.fontSize).toBe(36)
    expect(text.width).toBe(120)
    expect(text.height).toBe(60)
    expect(text.x + text.width / 2).toBeCloseTo(centerX, 1)
    expect(text.y + text.height / 2).toBeCloseTo(centerY, 1)
    expect(text.textAlignHorizontal).toBe('CENTER')
  })

  test('runs keep their own colour and size', async () => {
    const text = await openText(
      textLayer('Mixed', [40, 117, 362, 170], {
        text: 'لوحة Lawha',
        transform: [1, 0, 0, 1, 40, 150],
        shapeType: 'point',
        bounds: { left: px(0), top: px(-33), right: px(322), bottom: px(20) },
        style: { font, fontSize: 30, fillColor: { r: 0, g: 0, b: 0 } },
        styleRuns: [
          { length: 5, style: { font, fontSize: 30, fillColor: { r: 0, g: 0, b: 0 } } },
          {
            length: 5,
            style: { font: { name: 'Inter-Bold' }, fontSize: 24, fillColor: { r: 255, g: 0, b: 0 } }
          }
        ]
      })
    )
    expect(text.textDirection).toBe('RTL')
    expect(text.styleRuns).toEqual([
      {
        start: 5,
        length: 5,
        style: {
          fontFamily: 'Inter',
          fontSize: 24,
          fontWeight: 700,
          fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
        }
      }
    ])
  })
})
