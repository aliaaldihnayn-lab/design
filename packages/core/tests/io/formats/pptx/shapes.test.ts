import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { strToU8, zipSync } from 'fflate'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import type { SceneGraph, SceneNode } from '@lawha/scene-graph'

const io = new IORegistry(BUILTIN_IO_FORMATS)

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS = `xmlns:a="${A}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const EMU = 9525

function rels(entries: [string, string, string][]): string {
  return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map(
      ([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`
    )
    .join('')}</Relationships>`
}

/** A shape as python-pptx and PowerPoint write one: a preset, a fill and the theme's style refs. */
function shape(id: number, name: string, prst: string, box: number[], extra = '') {
  const [x, y, w, h] = box.map((v) => v * EMU)
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst>${extra}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="C83C3C"/></a:solidFill></p:spPr><p:style><a:lnRef idx="1"><a:srgbClr val="385D8A"/></a:lnRef><a:fillRef idx="3"><a:srgbClr val="4F81BD"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="4F81BD"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="FFFFFF"/></a:fontRef></p:style>`
}

function text(content: string, rPr = '') {
  return `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr lang="ar-SA"${rPr ? '' : '/'}>${rPr ? `${rPr}</a:rPr>` : ''}<a:t>${content}</a:t></a:r></a:p></p:txBody></p:sp>`
}

function deck(): Uint8Array {
  const slide = `<p:sld ${NS}><p:cSld><p:spTree>
${shape(2, 'Arrow', 'rightArrow', [40, 40, 200, 100])}</p:sp>
${shape(3, 'Slim arrow', 'rightArrow', [40, 200, 200, 100], '<a:gd name="adj1" fmla="val 20000"/><a:gd name="adj2" fmla="val 30000"/>')}</p:sp>
${shape(4, 'Chevron', 'chevron', [300, 40, 100, 100])}</p:sp>
${shape(5, 'Star', 'star5', [300, 200, 100, 100])}</p:sp>
${shape(6, 'Label', 'rect', [500, 40, 200, 100])}${text('نص أبيض')}
${shape(7, 'Own colour', 'rect', [500, 200, 200, 100])}${text('نص أصفر', '<a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill>')}
</p:spTree></p:cSld></p:sld>`
  return zipSync({
    '_rels/.rels': strToU8(rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])),
    // Text in the deck defaults to dark text, which a shape's own font colour overrides.
    'ppt/presentation.xml': strToU8(
      `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(rels([['rId2', 'slide', 'slides/slide1.xml']])),
    'ppt/slides/slide1.xml': strToU8(slide)
  })
}

async function read() {
  const { graph } = await io.readDocument({ name: 'deck.pptx', data: deck() })
  const slide = graph.getChildren(graph.getPages()[0].id)[0]
  const named = (name: string) =>
    expectDefined(
      graph.getChildren(slide.id).find((layer) => layer.name === name),
      name
    )
  return { graph, named }
}

/** The corners of a straight-edged vector, in its box. */
function corners(node: SceneNode): [number, number][] {
  const network = expectDefined(node.vectorNetwork)
  return network.vertices.map((vertex) => [Math.round(vertex.x), Math.round(vertex.y)])
}

function textOf(graph: SceneGraph, group: SceneNode): SceneNode {
  return expectDefined(graph.getChildren(group.id).find((layer) => layer.type === 'TEXT'))
}

describe('opening PPTX preset shapes', () => {
  test('an arrow keeps its outline: shaft and head by its adjust values', async () => {
    const { named } = await read()
    const arrow = named('Arrow')
    expect(arrow.type).toBe('VECTOR')
    // Half the height thick, its head half the height long, its tip at the right middle.
    expect(corners(arrow)).toEqual([
      [0, 25],
      [150, 25],
      [150, 0],
      [200, 50],
      [150, 100],
      [150, 75],
      [0, 75]
    ])
    expect(corners(named('Slim arrow'))).toEqual([
      [0, 40],
      [170, 40],
      [170, 0],
      [200, 50],
      [170, 100],
      [170, 60],
      [0, 60]
    ])
  })

  test('chevrons and stars keep their outline too', async () => {
    const { named } = await read()
    expect(corners(named('Chevron'))).toEqual([
      [0, 0],
      [50, 0],
      [100, 50],
      [50, 100],
      [0, 100],
      [50, 50]
    ])
    const star = named('Star')
    expect(star.type).toBe('VECTOR')
    expect(corners(star)).toHaveLength(10)
  })
})

describe('opening PPTX shape text', () => {
  test("takes the shape style's font colour over the deck's default text colour", async () => {
    const { graph, named } = await read()
    const label = textOf(graph, named('Label'))
    expect(label.fills[0].color).toMatchObject({ r: 1, g: 1, b: 1 })
  })

  test("keeps a run's own colour over the shape style's", async () => {
    const { graph, named } = await read()
    const label = textOf(graph, named('Own colour'))
    expect(label.fills[0].color).toMatchObject({ r: 1, g: 1, b: 0 })
  })
})
