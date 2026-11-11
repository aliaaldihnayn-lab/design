import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { strToU8, zipSync } from 'fflate'
import { toUint8Array } from 'js-base64'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { SceneGraph, type Fill, type SceneNode, type Stroke } from '@lawha/scene-graph'

const io = new IORegistry(BUILTIN_IO_FORMATS)

// 1×1 PNG, so the exporter's pictures need no CanvasKit.
const TINY_PNG = toUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
)

function solid(r: number, g: number, b: number, a = 1): Fill {
  return { type: 'SOLID', color: { r, g, b, a }, opacity: 1, visible: true }
}

function stroke(r: number, g: number, b: number, weight: number): Stroke {
  return { ...solid(r, g, b), weight, align: 'CENTER' }
}

async function exportPPTX(graph: SceneGraph, nodeIds: string[]): Promise<Uint8Array> {
  const result = await io.exportContent(
    'pptx',
    { graph, target: { scope: 'selection', nodeIds } },
    { rasterize: () => Promise.resolve(TINY_PNG) }
  )
  if (typeof result.data === 'string') throw new Error('PPTX is binary')
  return result.data
}

async function readPPTX(data: Uint8Array): Promise<SceneGraph> {
  return (await io.readDocument({ name: 'deck.pptx', data })).graph
}

function slideLayers(graph: SceneGraph) {
  const page = graph.getPages()[0]
  const frames = graph.getChildren(page.id)
  return { frames, layers: (index: number) => graph.getChildren(frames[index].id) }
}

function byType(layers: SceneNode[], type: SceneNode['type']): SceneNode {
  return expectDefined(
    layers.find((layer) => layer.type === type),
    type
  )
}

function firstColor(paints: readonly Fill[]) {
  const paint = expectDefined(paints[0], 'paint')
  return paint.color
}

/** The design every round trip starts from: one 1280 × 720 slide of each kind of layer. */
function sampleDesign() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', pageId, {
    name: 'Slide',
    width: 1280,
    height: 720,
    fills: [solid(1, 1, 1)]
  })
  graph.createNode('RECTANGLE', frame.id, {
    name: 'Card',
    x: 100,
    y: 50,
    width: 200,
    height: 100,
    rotation: 30,
    cornerRadius: 12,
    fills: [solid(1, 0, 0, 0.5)],
    strokes: [stroke(0, 0, 1, 4)],
    effects: [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 4, y: 4 },
        radius: 8,
        spread: 0,
        visible: true
      }
    ]
  })
  graph.createNode('ELLIPSE', frame.id, {
    x: 400,
    y: 50,
    width: 100,
    height: 80,
    fills: [solid(0, 1, 0)]
  })
  graph.createNode('LINE', frame.id, {
    x: 600,
    y: 100,
    width: 200,
    height: 0,
    rotation: 45,
    strokes: [stroke(0, 0, 0, 2)]
  })
  graph.createNode('TEXT', frame.id, {
    x: 100,
    y: 300,
    width: 500,
    height: 80,
    text: 'مرحبا Hello\nSecond',
    fontSize: 32,
    fontFamily: 'Cairo',
    textDirection: 'RTL',
    textAlignHorizontal: 'RIGHT',
    fills: [solid(0.2, 0.4, 0.6)],
    styleRuns: [{ start: 0, length: 5, style: { fontWeight: 700 } }]
  })
  graph.images.set('tiny', TINY_PNG)
  graph.createNode('RECTANGLE', frame.id, {
    name: 'Photo',
    x: 800,
    y: 400,
    width: 120,
    height: 90,
    fills: [
      {
        type: 'IMAGE',
        imageHash: 'tiny',
        imageScaleMode: 'FILL',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })
  return { graph, frame }
}

describe('PPTX import', () => {
  test('the PowerPoint format opens .pptx files', () => {
    expect(io.findReader('Deck.PPTX')?.id).toBe('pptx')
  })

  test('round-trips the exporter: slides, shapes, lines, text and pictures as layers', async () => {
    const { graph, frame } = sampleDesign()
    const imported = await readPPTX(await exportPPTX(graph, [frame.id]))
    const { frames, layers } = slideLayers(imported)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ type: 'FRAME', width: 1280, height: 720 })
    expect(firstColor(frames[0].fills)).toEqual({ r: 1, g: 1, b: 1, a: 1 })

    const slide = layers(0)
    const card = expectDefined(slide.find((layer) => layer.cornerRadius > 0))
    expect(card.type).toBe('RECTANGLE')
    expect(card.x).toBeCloseTo(100, 0)
    expect(card.y).toBeCloseTo(50, 0)
    expect(card.width).toBeCloseTo(200, 0)
    expect(card.height).toBeCloseTo(100, 0)
    expect(card.rotation).toBeCloseTo(30, 1)
    expect(card.cornerRadius).toBeCloseTo(12, 0)
    expect(firstColor(card.fills)).toEqual({ r: 1, g: 0, b: 0, a: 0.5 })
    expect(card.strokes[0]?.weight).toBeCloseTo(4, 1)
    expect(firstColor(card.strokes)).toEqual({ r: 0, g: 0, b: 1, a: 1 })
    const shadow = expectDefined(card.effects[0])
    expect(shadow.type).toBe('DROP_SHADOW')
    expect(shadow.radius).toBeCloseTo(8, 0)
    expect(shadow.offset.x).toBeCloseTo(4, 0)
    expect(shadow.offset.y).toBeCloseTo(4, 0)
    expect(shadow.color.a).toBeCloseTo(0.25, 2)

    const ellipse = byType(slide, 'ELLIPSE')
    expect(ellipse).toMatchObject({ x: 400, y: 50, width: 100, height: 80 })
    expect(ellipse.strokes).toEqual([])

    const line = byType(slide, 'LINE')
    expect(line.x).toBeCloseTo(600, 0)
    expect(line.y).toBeCloseTo(100, 0)
    expect(line.width).toBeCloseTo(200, 0)
    expect(line.rotation).toBeCloseTo(45, 0)
    expect(line.strokes[0]?.weight).toBeCloseTo(2, 1)

    const text = byType(slide, 'TEXT')
    expect(text.text).toBe('مرحبا Hello\nSecond')
    expect(text).toMatchObject({
      x: 100,
      y: 300,
      width: 500,
      height: 80,
      fontSize: 32,
      fontFamily: 'Cairo',
      fontWeight: 400,
      textAlignHorizontal: 'RIGHT',
      textDirection: 'RTL'
    })
    expect(text.styleRuns).toEqual([{ start: 0, length: 5, style: { fontWeight: 700 } }])
    expect(firstColor(text.fills)).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 1 })

    const photo = expectDefined(slide.find((layer) => layer.fills[0]?.type === 'IMAGE'))
    expect(photo).toMatchObject({ x: 800, y: 400, width: 120, height: 90 })
    const hash = expectDefined(photo.fills[0]?.imageHash)
    expect(imported.images.get(hash)).toEqual(TINY_PNG)
  })

  test('a deck read back exports to the same slide', async () => {
    const { graph, frame } = sampleDesign()
    const first = await exportPPTX(graph, [frame.id])
    const imported = await readPPTX(first)
    const again = await readPPTX(await exportPPTX(imported, [slideLayers(imported).frames[0].id]))
    const summary = (deck: SceneGraph) =>
      slideLayers(deck)
        .layers(0)
        .map((layer) => ({
          type: layer.type,
          x: Math.round(layer.x),
          y: Math.round(layer.y),
          width: Math.round(layer.width),
          rotation: Math.round(layer.rotation),
          text: layer.text
        }))
    expect(summary(again)).toEqual(summary(imported))
  })
})

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function rels(entries: [string, string, string][]): string {
  return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map(
      ([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`
    )
    .join('')}</Relationships>`
}

/**
 * A deck as PowerPoint writes one: theme colours and fonts, a master with a logo and text styles,
 * a layout whose title placeholder places the slide's title, and a slide with a flipped shape in a
 * group, a theme-coloured shape with text, and an Arabic paragraph.
 */
function handWrittenDeck(): Uint8Array {
  const theme = `<a:theme ${NS} name="T"><a:themeElements><a:clrScheme name="C"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1></a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Georgia"/><a:cs typeface="Amiri"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:cs typeface="Tajawal"/></a:minorFont></a:fontScheme><a:fmtScheme name="S"><a:lnStyleLst><a:ln w="12700"/><a:ln w="25400"/></a:lnStyleLst></a:fmtScheme></a:themeElements></a:theme>`
  const master = `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Logo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="476250"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Title Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Click to edit</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"/><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>`
  const layout = `<p:sldLayout ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="952500"/><a:ext cx="9525000" cy="952500"/></a:xfrm></p:spPr><p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/><a:p><a:r><a:t>Title prompt</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`
  const slide = `<p:sld ${NS}><p:cSld name="Welcome"><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="ar-SA"/><a:t>أهلا بكم</a:t></a:r></a:p></p:txBody></p:sp>
<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Arrows"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1905000" y="2857500"/><a:ext cx="1905000" cy="952500"/><a:chOff x="0" y="0"/><a:chExt cx="3810000" cy="1905000"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Arrow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm flipH="1" rot="5400000"><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="triangle"/><a:solidFill><a:srgbClr val="FF0000"><a:lumMod val="50000"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>
</p:grpSp>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="Badge"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="5715000" y="2857500"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr" rtl="1"/><a:r><a:rPr sz="1200" i="1"/><a:t>جديد</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`
  return zipSync({
    '_rels/.rels': strToU8(rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])),
    'ppt/presentation.xml': strToU8(
      `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(rels([['rId2', 'slide', 'slides/slide1.xml']])),
    'ppt/slides/slide1.xml': strToU8(slide),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(
      rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])
    ),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(layout),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8(
      rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])
    ),
    'ppt/slideMasters/slideMaster1.xml': strToU8(master),
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': strToU8(
      rels([['rId1', 'theme', '../theme/theme1.xml']])
    ),
    'ppt/theme/theme1.xml': strToU8(theme)
  })
}

describe('PPTX import of PowerPoint decks', () => {
  test('placeholders, themes, masters, groups and flips', async () => {
    const graph = await readPPTX(handWrittenDeck())
    const { frames, layers } = slideLayers(graph)
    expect(frames[0]).toMatchObject({ name: 'Welcome', width: 1280, height: 720 })
    // The master's background, through the colour map: bg2 → lt2.
    expect(firstColor(frames[0].fills)).toEqual({
      r: 0xf3 / 255,
      g: 0xf4 / 255,
      b: 0xf6 / 255,
      a: 1
    })
    const slide = layers(0)
    // Master shapes first, its placeholder prompt left out; the layout's prompt too.
    expect(slide.map((layer) => layer.name)).toEqual(['Logo', 'Title', 'Arrows', 'Badge'])
    expect(slide[0]).toMatchObject({ x: 0, y: 0, width: 100, height: 50 })

    const title = slide[1]
    expect(title).toMatchObject({
      type: 'TEXT',
      text: 'أهلا بكم',
      x: 100,
      y: 100,
      width: 1000,
      height: 100,
      // 44 pt, bold, centred, from the master's title style; the Arabic face of the major font.
      fontSize: 58.67,
      fontWeight: 700,
      fontFamily: 'Amiri',
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'CENTER'
    })
    expect(firstColor(title.fills)).toEqual({ r: 0x1f / 255, g: 0x29 / 255, b: 0x37 / 255, a: 1 })

    const group = slide[2]
    expect(group).toMatchObject({ type: 'GROUP', x: 200, y: 300, width: 200, height: 100 })
    const arrow = graph.getChildren(group.id)[0]
    // Half size through the group's child extent; a single flip turns the other way.
    expect(arrow).toMatchObject({
      type: 'VECTOR',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: -90,
      flipX: true
    })
    expect(firstColor(arrow.fills).r).toBeCloseTo(0.5, 2)
    expect(arrow.strokes).toEqual([])

    const badge = slide[3]
    expect(badge.type).toBe('GROUP')
    const [shape, label] = graph.getChildren(badge.id)
    expect(shape).toMatchObject({ type: 'RECTANGLE', cornerRadius: 50, width: 200, height: 100 })
    expect(firstColor(shape.fills)).toEqual({ r: 0x25 / 255, g: 0x63 / 255, b: 0xeb / 255, a: 1 })
    expect(shape.strokes[0]?.weight).toBeCloseTo(2.67, 2)
    expect(label).toMatchObject({
      type: 'TEXT',
      text: 'جديد',
      fontSize: 16,
      italic: true,
      // Arabic text naming no font takes the theme body font's Arabic face.
      fontFamily: 'Tajawal',
      textDirection: 'RTL',
      textAlignHorizontal: 'CENTER'
    })
    // White from the shape style's font reference.
    expect(firstColor(label.fills)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
  })

  test('refuses a file without a presentation', async () => {
    const data = zipSync({ 'word/document.xml': strToU8('<w:document/>') })
    let error: unknown = null
    try {
      await readPPTX(data)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
  })
})
