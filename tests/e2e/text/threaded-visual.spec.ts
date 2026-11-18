import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { photoDriver } from '#tests/helpers/canvas/photo/driver'

// Affinity Publisher's linked text frames: one story poured through three frames, its bold and
// red words keeping their style wherever they land, and a deleted frame's words flowing on.

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')
const scenes = photoDriver(() => editor.page)

test('a story flows through linked frames with its styles, and a deleted frame reflows', async () => {
  const { frames } = await scenes.showThread()
  await expect
    .poll(async () => (await scenes.frameTexts(frames)).filter((frame) => frame.text).length)
    .toBe(3)
  const flowed = await scenes.frameTexts(frames)
  expect(flowed.some((frame) => frame.runs > 0)).toBe(true)
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()
  expect(await editor.canvas.screenshotCanvasRegion(640, 300)).toMatchSnapshot(
    'threaded-frames.png'
  )

  const words = flowed.map((frame) => frame.text).join(' ')
  await scenes.deleteLayer(frames[1])
  await expect
    .poll(async () =>
      (await scenes.frameTexts([frames[0], frames[2]])).map((f) => f.text).join(' ')
    )
    .toBe(words)
  await editor.canvas.waitForRender()
  expect(await editor.canvas.screenshotCanvasRegion(640, 300)).toMatchSnapshot(
    'threaded-frames-deleted.png'
  )
})
