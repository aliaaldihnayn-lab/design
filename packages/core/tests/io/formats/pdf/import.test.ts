import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { SceneGraph, type SceneNode } from '@lawha/scene-graph'

setDefaultTimeout(120_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)

/** A hand-written PDF: a red filled rectangle, a blue 3pt line and the word Hello. */
function handWrittenPDF(): Uint8Array {
  const content =
    '1 0 0 rg 50 50 100 60 re f 0 0 1 RG 3 w 20 150 m 180 150 l S BT /F1 24 Tf 40 180 Td (Hello) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 220] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(pdf)
}

function all(graph: SceneGraph, id: string): SceneNode[] {
  const node = graph.getNode(id)
  if (!node) return []
  return [node, ...node.childIds.flatMap((child) => all(graph, child))]
}

describe('opening PDF', () => {
  test('a page becomes a frame of its size with editable shapes and text in place', async () => {
    const { graph } = await io.readDocument({ name: 'flyer.pdf', data: handWrittenPDF() })
    const frame = expectDefined(graph.getNode(graph.getPages()[0].childIds[0]))
    expect(frame).toMatchObject({ name: 'flyer', width: 200, height: 220 })
    const nodes = all(graph, frame.id)
    const text = expectDefined(nodes.find((node) => node.type === 'TEXT'))
    expect(text.text).toBe('Hello')
    expect(text.fontSize).toBeCloseTo(24, 0)
    const vectors = nodes.filter((node) => node.type === 'VECTOR')
    expect(vectors.length).toBeGreaterThanOrEqual(2)
    // The rectangle sits at (50, 220 − 50 − 60) = (50, 110) once the page flips to top-left.
    const red = expectDefined(
      vectors.find((node) => node.fills[0]?.type === 'SOLID' && node.fills[0].color.r > 0.9)
    )
    const box = graph.getAbsoluteBounds(red.id)
    expect(box.x - frame.x).toBeCloseTo(50, 0)
    expect(box.y - frame.y).toBeCloseTo(110, 0)
    expect([box.width, box.height].map(Math.round)).toEqual([100, 60])
    const line = expectDefined(vectors.find((node) => node.strokes[0]?.color.b > 0.9))
    expect(line.strokes[0].weight).toBeCloseTo(3, 1)
  })

  test("Lawha's own PDF opens again with its shapes and text", async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const frame = graph.createNode('FRAME', page, {
      name: 'Poster',
      width: 300,
      height: 200,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    graph.createNode('RECTANGLE', frame.id, {
      x: 20,
      y: 30,
      width: 120,
      height: 40,
      cornerRadius: 8,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0.5, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    const exported = await io.exportContent('pdf', {
      graph,
      target: { scope: 'node', nodeId: frame.id }
    })
    if (typeof exported.data === 'string') throw new Error('Expected bytes')
    const { graph: opened } = await io.readDocument({
      name: 'poster.pdf',
      data: new Uint8Array(exported.data)
    })
    const root = expectDefined(opened.getNode(opened.getPages()[0].childIds[0]))
    expect([Math.round(root.width), Math.round(root.height)]).toEqual([300, 200])
    const green = all(opened, root.id).find(
      (node) =>
        node.type === 'VECTOR' &&
        node.fills[0]?.type === 'SOLID' &&
        node.fills[0].color.g > 0.4 &&
        node.fills[0].color.r < 0.1
    )
    const box = graph.getAbsoluteBounds(expectDefined(green).id)
    expect(Math.round(opened.getAbsoluteBounds(expectDefined(green).id).width)).toBe(120)
    expect(box).toBeDefined()
  })
})

describe('opening Illustrator', () => {
  test('a PDF-compatible .ai file opens like a PDF', async () => {
    const { graph, sourceFormat } = await io.readDocument({
      name: 'logo.ai',
      data: handWrittenPDF()
    })
    expect(sourceFormat).toBe('ai')
    const frame = expectDefined(graph.getNode(graph.getPages()[0].childIds[0]))
    expect(frame.name).toBe('logo')
  })

  test('an .ai file without PDF inside explains how to save it', async () => {
    const legacy = new TextEncoder().encode(
      '%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator 8'
    )
    expect(io.readDocument({ name: 'old.ai', data: legacy })).rejects.toThrow('PDF Compatible')
  })
})
