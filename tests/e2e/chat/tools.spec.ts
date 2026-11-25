import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { CanvasHelper } from '#tests/helpers/canvas'
import { expect, test } from '#tests/helpers/chat/fixture'
import { injectToolLoopTransport } from '#tests/helpers/chat/tool-loop'

/** The texts of the layers named `name`, from the active document. */
const layerTexts = (page: Page, name: string) =>
  page.evaluate((layerName) => {
    const graph = window.lawha?.getStore?.().graph
    if (!graph) return null
    const layer = [...graph.nodes.values()].find((node) => node.name === layerName)
    if (!layer) return []
    return [...graph.nodes.values()]
      .filter((node) => node.type === 'TEXT' && graph.isDescendant(node.id, layer.id))
      .map((node) => node.text)
  }, name)

test('a reply calls tools: edits land as undoable steps and failed calls reach the model', async ({
  configuredChat: chat,
  page
}) => {
  const canvas = new CanvasHelper(page)
  await injectToolLoopTransport(page, [
    {
      toolName: 'render',
      input: {
        jsx: '<Frame name="بطاقة" w={240} h="hug" flex="col" p={16} gap={8} bg="#FFFFFF"><Text dir="rtl" w="fill" weight="semibold">مرحبا بالعالم</Text></Frame>'
      }
    },
    // A layer that does not exist, and an argument the tool does not take.
    { toolName: 'set_fill', input: { id: '999999:404', color: '#2563EB' } },
    { toolName: 'update_node', input: { id: '999999:404', colour: '#2563EB' } }
  ])

  await chat.submit('أضف بطاقة')
  await expect(chat.assistantMessage()).toContainText('Done')
  expect(await layerTexts(page, 'بطاقة')).toEqual(['مرحبا بالعالم'])

  // Each failure goes back to the model as an error it can act on.
  const results = await page.evaluate(() => document.documentElement.dataset.modelToolResults)
  const [, setFill, updateNode] = v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.unknown())),
    results ?? '[]'
  )
  expect(JSON.stringify(setFill)).toContain('999999:404')
  // The argument the tool does not take is named, rather than dropped and the call run.
  expect(JSON.stringify(updateNode)).toContain('colour')
  expect(JSON.stringify(updateNode)).not.toContain('not found')

  // The render is one undo step on the canvas.
  await canvas.click(10, 10)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => layerTexts(page, 'بطاقة')).toEqual([])
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => layerTexts(page, 'بطاقة')).toEqual(['مرحبا بالعالم'])
  canvas.assertNoErrors()
})
