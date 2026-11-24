import { describe, expect, test } from 'bun:test'

import { readHTMLDocument } from '@lawha/core/io/formats/html/import'

// The layout from #788: a phone-sized column with a title, a card, and a button.
const DEMO = `<div style="width:390px;height:844px;background:#0b0f1a;display:flex;flex-direction:column;padding:24px;gap:16px">
  <div style="font-size:28px;font-weight:700;color:#fff">D-claro</div>
  <div style="background:#151b2b;border-radius:16px;padding:20px;color:#fff">Saldo disponible</div>
  <button style="background:#2563eb;border-radius:12px;padding:14px;color:#fff">Enviar dinero</button>
</div>`

describe('reading HTML', () => {
  test('lays out block children and flex items as a browser does', async () => {
    const { graph } = await readHTMLDocument(DEMO)
    const node = (id: string | undefined) => {
      const found = id === undefined ? undefined : graph.getNode(id)
      if (!found) throw new Error(`Missing layer ${id}`)
      return found
    }
    const column = node(graph.getPages()[0]?.childIds[0])
    const [title, card, button] = column.childIds.map(node)

    // Padding sits outside the 390px width, as CSS's content-box sizing puts it, and each
    // child fills that width, one below the other 16px apart.
    expect(column).toMatchObject({ width: 438, height: 892 })
    expect(title).toMatchObject({ x: 24, y: 24, width: 390 })
    expect(card).toMatchObject({ x: 24, y: title.y + title.height + 16, width: 390 })
    expect(button).toMatchObject({ x: 24, y: card.y + card.height + 16, width: 390 })

    // The card wraps its padding around the text, and the button centers its label.
    const cardText = node(card.childIds[0])
    expect(cardText).toMatchObject({ x: 20, y: 20 })
    expect(card.height).toBe(cardText.height + 40)
    const label = node(button.childIds[0])
    expect(label.x * 2 + label.width).toBeCloseTo(390, 0)
  })
})

describe('reading right-to-left HTML', () => {
  const RTL_PAGE = `<!doctype html><html dir="rtl" lang="ar"><head><style>
    body { font-family: 'Noto Naskh Arabic'; }
    .card { width: 300px; display: flex; flex-direction: column; gap: 8px; }
    .row { display: flex; gap: 8px; }
    .btn { width: 60px; height: 30px; background: #e8632c; }
  </style></head><body>
    <div class="card"><h1>مرحبا</h1><p>نص عربي</p><div class="row"><span class="btn">أ</span><span class="btn">ب</span></div></div>
    <div class="note" style="width:120px;height:40px;background:#eef"></div>
  </body></html>`

  test('lays content out from the right and stacks the body in flow', async () => {
    const { graph } = await readHTMLDocument(RTL_PAGE)
    const layers = [...graph.getAllNodes()]
    const named = (name: string) => {
      const found = layers.find((node) => node.name === name)
      if (!found) throw new Error(`Missing layer ${name}`)
      return found
    }
    const body = named('body')
    expect(body.layoutDirection).toBe('RTL')
    const [card, note] = body.childIds.map((id) => graph.getNode(id))
    // The two roots sit one below the other, each from the right edge, rather than both at 0,0.
    expect(card?.y).toBe(0)
    expect(note?.y).toBe(card?.height)
    expect((note?.x ?? 0) + (note?.width ?? 0)).toBe(body.width)

    // The first button of the row is the rightmost, as a browser draws it.
    const [first, second] = named('row').childIds.map((id) => graph.getNode(id))
    expect(first?.x).toBeGreaterThan(second?.x ?? Infinity)

    // Text starts on the right, in the page's font, and the heading is bold.
    const heading = layers.find((node) => node.type === 'TEXT' && node.text === 'مرحبا')
    expect(heading).toMatchObject({
      textAlignHorizontal: 'RIGHT',
      fontFamily: 'Noto Naskh Arabic',
      fontWeight: 700
    })
  })
})
