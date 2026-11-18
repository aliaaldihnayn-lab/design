import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { PHOTO_PAN, photoDriver } from '#tests/helpers/canvas/photo/driver'
import { readScenePixels } from '#tests/helpers/canvas/pixels'

// Affinity Photo's pixel tools on a gradient "photo" 300 × 200 at the page origin, driven by the
// pointer as a person paints, and the paint they lay down as the canvas draws it.

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')
const photo = photoDriver(() => editor.page)

const RED = { r: 0.9, g: 0.1, b: 0.1, a: 1 }

/** Drags on the canvas between page points. */
async function stroke(from: [number, number], to: [number, number]) {
  await editor.canvas.drag(
    from[0] + PHOTO_PAN,
    from[1] + PHOTO_PAN,
    to[0] + PHOTO_PAN,
    to[1] + PHOTO_PAN,
    12
  )
}

async function altClick(x: number, y: number) {
  await editor.page.keyboard.down('Alt')
  await editor.canvas.click(x + PHOTO_PAN, y + PHOTO_PAN)
  await editor.page.keyboard.up('Alt')
}

async function snapshot(name: string) {
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()
  expect(await editor.canvas.screenshotCanvasRegion(380, 280)).toMatchSnapshot(name)
}

test('the brush paints a stroke into a paint layer over the photo', async () => {
  const id = await photo.showPhoto()
  await editor.canvas.pressKey('b')
  await photo.setTool('BRUSH', { color: RED, size: 16, hardness: 1, opacity: 1 })
  await stroke([40, 60], [260, 140])
  expect(await photo.fillCount(id)).toBe(2)
  await snapshot('brush-stroke.png')

  await editor.page.keyboard.press('ControlOrMeta+z')
  await editor.canvas.waitForRender()
  expect(await photo.fillCount(id)).toBe(1)
})

test('an ellipse selection becomes a layer mask', async () => {
  const id = await photo.showPhoto()
  await photo.setTool('MARQUEE_ELLIPSE')
  await stroke([60, 30], [240, 170])
  expect(await photo.maskFromSelection()).not.toBeNull()
  expect(await photo.parentType(id)).toBe('GROUP')
  // The mask's image decodes before it draws: the photo's corner, outside the ellipse, goes.
  await expect
    .poll(async () => {
      const [corner] = await readScenePixels(editor.page, [{ x: PHOTO_PAN + 6, y: PHOTO_PAN + 6 }])
      return corner[2] > 200 && corner[0] > 200
    })
    .toBe(true)
  await snapshot('mask-from-selection.png')
})

test('the clone stamp copies from the Alt-clicked source', async () => {
  await photo.showPhoto()
  await photo.setTool('BRUSH', { color: RED, size: 24, hardness: 1, opacity: 1 })
  await stroke([60, 100], [61, 100])
  await photo.setTool('CLONE_STAMP', { size: 40, hardness: 0.8 })
  await altClick(60, 100)
  await stroke([220, 100], [222, 100])
  await snapshot('clone-stamp.png')
})

test('the healing brush blends a patch into the shading around it', async () => {
  await photo.showPhoto()
  // A dark blemish on the light side, healed with clean pixels from further left.
  await photo.setTool('BRUSH', { color: { r: 0.05, g: 0.05, b: 0.1, a: 1 }, size: 14 })
  await stroke([230, 100], [231, 100])
  await photo.setTool('HEALING_BRUSH', { size: 30, hardness: 0.9 })
  await altClick(150, 60)
  await stroke([226, 100], [236, 100])
  await snapshot('healing-brush.png')
})

test('an enlarged paint layer shows its pixels as crisp blocks', async () => {
  const id = await photo.showPhoto()
  await photo.resize(id, 30, 20)
  await photo.setTool('BRUSH', { color: RED, size: 3, hardness: 1, opacity: 1 })
  await stroke([5, 5], [25, 15])
  await photo.resize(id, 300, 200)
  await photo.setTool('SELECT')
  await snapshot('enlarged-paint-layer.png')
})
