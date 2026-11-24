import { describe, expect, test } from 'bun:test'

import { designDocumentToSceneGraph } from '#dom-css/import/scene-graph'
import { createHeadlessCSSRuntime, htmlToDesignDocument } from '#dom-css/index'

import type { SceneNode } from '@lawha/scene-graph'

async function layers(html: string): Promise<SceneNode[]> {
  const document = await htmlToDesignDocument(html, { runtime: createHeadlessCSSRuntime() })
  return [...designDocumentToSceneGraph(document).getAllNodes()]
}

function textOf(nodes: SceneNode[], text: string): SceneNode | undefined {
  return nodes.find((node) => node.type === 'TEXT' && node.text === text)
}

describe('right-to-left HTML', () => {
  test('a page with dir="rtl" lays its boxes out right to left and starts its text on the right', async () => {
    const nodes = await layers(
      '<html dir="rtl"><body><div style="display:flex;gap:4px"><p>أهلا</p><p>Hello</p></div></body></html>'
    )
    const row = nodes.find((node) => node.name === 'div')
    expect(row?.layoutDirection).toBe('RTL')
    // Latin text keeps the paragraph's right-to-left base direction, which it would not detect.
    expect(textOf(nodes, 'Hello')).toMatchObject({
      textAlignHorizontal: 'RIGHT',
      textDirection: 'RTL'
    })
    expect(textOf(nodes, 'أهلا')).toMatchObject({ textAlignHorizontal: 'RIGHT' })
  })

  test('direction from a body rule reaches the content, and a left-to-right box inside says so', async () => {
    const nodes =
      await layers(`<style>body { direction: rtl; font-family: 'Noto Naskh Arabic' }</style>
      <div class="outer" style="display:flex"><div class="inner" dir="ltr" style="display:flex"><p>مرحبا</p></div></div>`)
    const frame = (name: string) => nodes.find((node) => node.name === name)
    expect(frame('outer')?.layoutDirection).toBe('RTL')
    expect(frame('inner')?.layoutDirection).toBe('LTR')
    // Arabic text in left-to-right content keeps that base direction rather than its own.
    expect(textOf(nodes, 'مرحبا')).toMatchObject({
      fontFamily: 'Noto Naskh Arabic',
      textAlignHorizontal: 'LEFT',
      textDirection: 'LTR'
    })
  })

  test('text-align start and end follow the direction, and justify justifies', async () => {
    const nodes = await layers(`<div dir="rtl" style="display:flex">
      <p style="text-align:start">start</p><p style="text-align:end">end</p>
      <p style="text-align:left">left</p><p style="text-align:justify">justify</p></div>`)
    expect(textOf(nodes, 'start')?.textAlignHorizontal).toBe('RIGHT')
    expect(textOf(nodes, 'end')?.textAlignHorizontal).toBe('LEFT')
    expect(textOf(nodes, 'left')?.textAlignHorizontal).toBe('LEFT')
    expect(textOf(nodes, 'justify')?.textAlignHorizontal).toBe('JUSTIFIED')
  })

  test('left-to-right pages keep their text as they read', async () => {
    const nodes = await layers('<div style="display:flex"><p>Hello</p><p>مرحبا</p></div>')
    expect(nodes.find((node) => node.name === 'div')?.layoutDirection).toBe('AUTO')
    expect(textOf(nodes, 'Hello')).toMatchObject({
      textAlignHorizontal: 'LEFT',
      textDirection: 'AUTO'
    })
  })
})

describe('the page body', () => {
  test('several roots sit in a body frame in block flow, each its own layer', async () => {
    const nodes = await layers(
      '<p>One</p><div style="width:20px;height:20px;background:red"></div>'
    )
    const body = nodes.find((node) => node.name === 'body')
    expect(body).toMatchObject({ type: 'FRAME', layoutMode: 'VERTICAL' })
    expect(body?.childIds).toHaveLength(2)
  })

  test('headings are bold, as browsers draw them, unless the page says otherwise', async () => {
    const nodes = await layers('<h2>Bold</h2><h3 style="font-weight:400">Light</h3>')
    expect(textOf(nodes, 'Bold')?.fontWeight).toBe(700)
    expect(textOf(nodes, 'Light')?.fontWeight).toBe(400)
  })
})
