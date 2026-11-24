import type { DesignDocument } from '@lawha/dom-css'

import {
  browserRuntimeComputeStyles,
  publicBrowserHTMLLayers
} from '#tests/helpers/dom-css-browser'

import { expect, test } from '../fixtures'

test.describe('@lawha/dom-css browser import', () => {
  test('imports a right-to-left page by its dir and its body font', async ({ page }) => {
    const layers = await publicBrowserHTMLLayers(
      page,
      `<!doctype html><html dir="rtl"><head><style>
        body { font-family: 'Noto Naskh Arabic', serif; }
      </style></head><body>
        <nav style="display:flex;gap:8px"><span>الرئيسية</span><span>Contact</span></nav>
        <section style="display:flex" dir="ltr"><p>English first</p></section>
      </body></html>`
    )
    const named = (name: string) => layers.find((layer) => layer.name === name)
    const text = (value: string) => layers.find((layer) => layer.text === value)

    expect(named('body')?.layoutDirection).toBe('RTL')
    expect(named('section')?.layoutDirection).toBe('LTR')
    expect(text('الرئيسية')).toMatchObject({
      textAlignHorizontal: 'RIGHT',
      fontFamily: 'Noto Naskh Arabic'
    })
    // Latin text in the right-to-left nav keeps the paragraph's direction.
    expect(text('Contact')).toMatchObject({ textDirection: 'RTL', textAlignHorizontal: 'RIGHT' })
    expect(text('English first')).toMatchObject({ textAlignHorizontal: 'LEFT' })
  })

  test('leaves sizes the page does not set to the import, in either sandbox', async ({ page }) => {
    await page.goto('/')
    const element = (className: string, text: string) => ({
      type: 'element' as const,
      tagName: 'span',
      attrs: { class: className },
      children: [{ type: 'text' as const, text }]
    })
    const document: DesignDocument = {
      type: 'document',
      children: [element('label', 'Sized by its text'), element('half', 'Half')]
    }
    const css = '.label { padding: 8px; } .half { display: block; width: 50%; height: 2rem; }'

    for (const sandbox of ['iframe', 'shadow-root'] as const) {
      const styled = await browserRuntimeComputeStyles(page, document, css, sandbox)
      const [label, half] = styled.children
      if (label?.type !== 'element' || half?.type !== 'element') throw new Error('No elements')
      // The browser's laid-out size, measured in its own fonts, would fix the box around them.
      expect(label.computedStyle?.width).toBeUndefined()
      expect(label.computedStyle?.height).toBeUndefined()
      expect(label.computedStyle?.['padding-left']).toBe('8px')
      expect(half.computedStyle?.width).toBe('50%')
      expect(half.computedStyle?.height).toBe('32px')
    }
  })
})
