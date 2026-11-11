import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { strToU8, zipSync } from 'fflate'
import { toUint8Array } from 'js-base64'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import type { SceneGraph, SceneNode } from '@lawha/scene-graph'

const io = new IORegistry(BUILTIN_IO_FORMATS)

const TINY_PNG = toUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
)

const A = 'http://schemas.openxmlformats.org/drawingml/2006'
const NS = `xmlns:a="${A}/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const EMU = 9525

function rels(entries: [string, string, string][]): string {
  return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map(([id, type, target]) => {
      const full = type.startsWith('http') ? type : `${REL}/${type}`
      return `<Relationship Id="${id}" Type="${full}" Target="${target}"/>`
    })
    .join('')}</Relationships>`
}

/** A graphic frame at `x`, `y` (px) of `w` × `h` holding `data` of the kind `uri` names. */
function frame(id: number, name: string, box: number[], uri: string, data: string) {
  const [x, y, w, h] = box.map((v) => v * EMU)
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></p:xfrm><a:graphic><a:graphicData uri="${A}/${uri}">${data}</a:graphicData></a:graphic></p:graphicFrame>`
}

function cell(text: string, extra = '', tcPr = '') {
  return `<a:tc${extra}><a:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr${tcPr}/></a:tc>`
}

const TABLE = `<a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="${200 * EMU}"/><a:gridCol w="${100 * EMU}"/></a:tblGrid>
<a:tr h="${40 * EMU}">${cell('Region')}${cell('Sales')}</a:tr>
<a:tr h="${40 * EMU}">${cell('Riyadh')}<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>120</a:t></a:r></a:p></a:txBody><a:tcPr anchor="ctr"><a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill></a:tcPr></a:tc></a:tr>
<a:tr h="${40 * EMU}">${cell('Total', ' gridSpan="2"')}<a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc></a:tr>
</a:tbl>`

const C = `xmlns:c="${A}/chart" xmlns:a="${A}/main"`

function series(name: string, values: number[], color: string) {
  const pts = (list: (string | number)[]) =>
    `<c:ptCount val="${list.length}"/>${list.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}`
  return `<c:ser><c:idx val="0"/><c:tx><c:strRef><c:strCache>${pts([name])}</c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:cat><c:strRef><c:strCache>${pts(['Q1', 'Q2', 'Q3'])}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache>${pts(values)}</c:numCache></c:numRef></c:val></c:ser>`
}

const BAR_CHART = `<c:chartSpace ${C}><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:barDir val="col"/>${series('2025', [10, 20, 30], 'FF0000')}${series('2026', [15, 25, 5], '0000FF')}</c:barChart></c:plotArea></c:chart></c:chartSpace>`

const PIE_CHART = `<c:chartSpace ${C}><c:chart><c:plotArea><c:pieChart><c:varyColors val="1"/>${series('Share', [1, 1, 2], '000000')}</c:pieChart></c:plotArea></c:chart></c:chartSpace>`

const UNKNOWN_CHART = `<c:chartSpace ${C}><c:chart><c:plotArea><c:radarChart/></c:plotArea></c:chart></c:chartSpace>`

const DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram'
const DIAGRAM_DRAWING = `<dsp:drawing xmlns:dsp="${DSP}" xmlns:a="${A}/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>
<dsp:sp modelId="{1}"><dsp:nvSpPr><dsp:cNvPr id="0" name="Step 1"/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${100 * EMU}" cy="${50 * EMU}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr/><a:p><a:r><a:t>Plan</a:t></a:r></a:p></dsp:txBody></dsp:sp>
<dsp:sp modelId="{2}"><dsp:nvSpPr><dsp:cNvPr id="0" name="Step 2"/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="${150 * EMU}" y="0"/><a:ext cx="${100 * EMU}" cy="${50 * EMU}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr/><a:p><a:r><a:t>Build</a:t></a:r></a:p></dsp:txBody></dsp:sp>
</dsp:spTree></dsp:drawing>`

const DIAGRAM_DATA = `<dgm:dataModel xmlns:dgm="${A}/diagram" xmlns:a="${A}/main"><dgm:ptLst/><dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="${DSP}" relId="rId6" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>`

function deck(): Uint8Array {
  const slide = `<p:sld ${NS}><p:cSld name="Data"><p:spTree>
${frame(2, 'Sales table', [40, 40, 300, 120], 'table', TABLE)}
${frame(3, 'Revenue chart', [400, 40, 400, 300], 'chart', '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/>')}
${frame(4, 'Share chart', [850, 40, 300, 300], 'chart', '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId3"/>')}
${frame(5, 'Process', [40, 400, 250, 50], 'diagram', '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId4" r:lo="rId9" r:qs="rId9" r:cs="rId9"/>')}
${frame(6, 'Radar', [400, 400, 100, 100], 'chart', '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId5"/>')}
${frame(7, 'Embedded sheet', [600, 400, 100, 80], 'presentationml/2006/ole', '<p:oleObj r:id="rId9" progId="Excel.Sheet.12"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="0" name=""/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId7"/></p:blipFill><p:spPr/></p:pic></p:oleObj>')}
</p:spTree></p:cSld></p:sld>`
  return zipSync({
    '_rels/.rels': strToU8(rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])),
    'ppt/presentation.xml': strToU8(
      `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(rels([['rId2', 'slide', 'slides/slide1.xml']])),
    'ppt/slides/slide1.xml': strToU8(slide),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(
      rels([
        ['rId2', 'chart', '../charts/chart1.xml'],
        ['rId3', 'chart', '../charts/chart2.xml'],
        ['rId4', 'diagramData', '../diagrams/data1.xml'],
        ['rId5', 'chart', '../charts/chart3.xml'],
        [
          'rId6',
          'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
          '../diagrams/drawing1.xml'
        ],
        ['rId7', 'image', '../media/image1.png']
      ])
    ),
    'ppt/charts/chart1.xml': strToU8(BAR_CHART),
    'ppt/charts/chart2.xml': strToU8(PIE_CHART),
    'ppt/charts/chart3.xml': strToU8(UNKNOWN_CHART),
    'ppt/diagrams/data1.xml': strToU8(DIAGRAM_DATA),
    'ppt/diagrams/drawing1.xml': strToU8(DIAGRAM_DRAWING),
    'ppt/media/image1.png': TINY_PNG
  })
}

async function read() {
  let skipped: Record<string, number> = {}
  const { readPPTXDocument } = await import('#core/io/formats/pptx/import')
  const graph = await readPPTXDocument(deck(), { onSkipped: (counts) => (skipped = counts) })
  const slide = graph.getChildren(graph.getPages()[0].id)[0]
  const layers = graph.getChildren(slide.id)
  const named = (name: string) =>
    expectDefined(
      layers.find((layer) => layer.name === name),
      name
    )
  return { graph, layers, named, skipped }
}

function texts(graph: SceneGraph, id: string): string[] {
  const out: string[] = []
  const visit = (node: SceneNode) => {
    if (node.type === 'TEXT') out.push(node.text)
    for (const child of graph.getChildren(node.id)) visit(child)
  }
  visit(expectDefined(graph.getNode(id)))
  return out
}

describe('PPTX tables, charts, SmartArt and embedded objects', () => {
  test('the PowerPoint reader is registered', () => {
    expect(io.getFormat('pptx')?.support.readDocument).toBe(true)
  })

  test('a table is a frame of cell frames with their text, fills and merges', async () => {
    const { graph, named } = await read()
    const table = named('Sales table')
    expect(table).toMatchObject({ type: 'FRAME', x: 40, y: 40, width: 300, height: 120 })
    const cells = graph.getChildren(table.id)
    // The cell a merge covers draws nothing of its own.
    expect(cells).toHaveLength(5)
    expect(cells.map((c) => [c.x, c.y, c.width, c.height])).toEqual([
      [0, 0, 200, 40],
      [200, 0, 100, 40],
      [0, 40, 200, 40],
      [200, 40, 100, 40],
      [0, 80, 300, 40]
    ])
    expect(texts(graph, table.id)).toEqual(['Region', 'Sales', 'Riyadh', '120', 'Total'])
    // A cell's own fill wins; the others take the default table style's header and bands.
    expect(cells[3].fills[0]?.color).toMatchObject({ r: 1, g: 0.8, b: 0 })
    const header = cells[0].fills[0]?.color
    const body = cells[2].fills[0]?.color
    expect(header && body && header.r < body.r).toBe(true)
    const headerText = graph.getChildren(cells[0].id)[0]
    expect(headerText).toMatchObject({ type: 'TEXT', fontWeight: 700 })
    expect(graph.getChildren(cells[3].id)[0]?.textAlignVertical).toBe('CENTER')
  })

  test('a chart is drawn as editable shapes from its cached values', async () => {
    const { graph, named } = await read()
    const chart = named('Revenue chart')
    expect(chart).toMatchObject({ type: 'FRAME', x: 400, y: 40, width: 400, height: 300 })
    const parts = graph.getChildren(chart.id)
    const bars = parts.filter((part) => part.type === 'RECTANGLE' && !part.name.endsWith('key'))
    expect(bars).toHaveLength(6)
    const heights = (name: string) =>
      bars.filter((bar) => bar.name.startsWith(name)).map((bar) => bar.height)
    const first = heights('2025')
    // Taller bars for larger values, in proportion.
    expect(first[2] / first[0]).toBeCloseTo(3, 1)
    expect(bars.find((bar) => bar.name === '2025 Q1')?.fills[0]?.color).toMatchObject({
      r: 1,
      g: 0,
      b: 0
    })
    const words = texts(graph, chart.id)
    expect(words).toContain('Revenue')
    expect(words).toEqual(expect.arrayContaining(['Q1', 'Q2', 'Q3', '2025', '2026']))
  })

  test('a pie chart is a slice for each value, in its share of the circle', async () => {
    const { graph, named } = await read()
    const slices = graph
      .getChildren(named('Share chart').id)
      .filter((part) => part.type === 'VECTOR')
    expect(slices.map((slice) => slice.name)).toEqual(['Q1', 'Q2', 'Q3'])
    // Q3 is half the pie, so its slice spans the circle's full height.
    const [q1, , q3] = slices
    expect(q3.height).toBeGreaterThan(q1.height * 1.5)
    expect(new Set(slices.map((slice) => JSON.stringify(slice.fills[0]?.color))).size).toBe(3)
  })

  test('SmartArt is the shapes PowerPoint saved for it, editable, in its frame', async () => {
    const { graph, named } = await read()
    const smartArt = named('Process')
    expect(smartArt).toMatchObject({ type: 'GROUP', x: 40, y: 400 })
    const steps = graph.getChildren(smartArt.id)
    expect(steps.map((step) => step.name)).toEqual(['Step 1', 'Step 2'])
    expect(steps[1].x).toBe(150)
    expect(texts(graph, smartArt.id)).toEqual(['Plan', 'Build'])
  })

  test('an embedded object shows its preview; a chart type it cannot draw is reported', async () => {
    const { named, layers, skipped } = await read()
    expect(named('Embedded sheet')).toMatchObject({ type: 'RECTANGLE', width: 100, height: 80 })
    expect(named('Embedded sheet').fills[0]?.type).toBe('IMAGE')
    expect(layers.some((layer) => layer.name === 'Radar')).toBe(false)
    expect(skipped).toEqual({ chart: 1 })
  })
})
