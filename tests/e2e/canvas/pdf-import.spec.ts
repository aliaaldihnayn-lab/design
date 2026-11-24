import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&no-chrome&no-rulers')

/**
 * An Illustrator file opened in the app: its layers, and text layers whose boxes hold the text as
 * the file drew it, whether or not the app has the file's fonts (`tests/fixtures/pdf`).
 */
test('an Illustrator file opens with its layers and text boxes where the text is drawn', async () => {
  await editor.page.evaluate(() =>
    window.lawha?.openFile?.('/tests/fixtures/pdf/illustrator-box.ai')
  )
  await editor.canvas.waitForInit()

  const imported = await editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const graph = store.graph
    const [artboard] = graph.getChildren(store.state.currentPageId)
    const layers = graph.getChildren(artboard.id).map((layer) => ({
      name: layer.name,
      visible: layer.visible
    }))
    const text = graph.getChildren(
      graph.getChildren(artboard.id).find((layer) => layer.name === 'Text')?.id ?? ''
    )
    const box = (content: string) => {
      const node = text.find(
        (candidate) => candidate.text.normalize('NFD') === content.normalize('NFD')
      )
      if (!node) throw new Error(`No text layer "${content}"`)
      const bounds = graph.getAbsoluteBounds(node.id)
      return {
        left: Math.round(bounds.x - artboard.x),
        right: Math.round(bounds.x + bounds.width - artboard.x)
      }
    }
    return {
      layers,
      latin: box('ALQIMMAC'),
      arabic: box('القِمَّة للمُقاوَلات'),
      shahada: box('لا إله إلا الله')
    }
  })

  expect(imported.layers).toEqual([
    { name: 'Background', visible: true },
    { name: 'Text', visible: true },
    { name: 'Guides', visible: false }
  ])
  // ALQIMMAC runs from 30 to about 379 in the file, set in a face the app does not have.
  expect(imported.latin.left).toBe(30)
  expect(Math.abs(imported.latin.right - 379)).toBeLessThanOrEqual(3)
  // Right-to-left lines start at their right edge, 728.
  expect(imported.arabic.right).toBe(728)
  expect(imported.shahada.right).toBe(728)
})
