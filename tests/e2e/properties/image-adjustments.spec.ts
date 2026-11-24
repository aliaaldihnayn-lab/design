import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { photoDriver } from '#tests/helpers/canvas/photo/driver'

// The image fill picker's adjustments, edited with the pointer and keyboard as a person does.

const editor = useEditorSetupWithClear('/?test')
const photo = photoDriver(() => editor.page)

async function openPicker() {
  await editor.page.getByTestId('fill-picker-swatch').first().click()
  await expect(editor.page.getByTestId('image-adjustments')).toBeVisible()
}

test('a slider sets its adjustment on the image fill', async () => {
  const id = await photo.showImage()
  await openPicker()
  await editor.page.getByRole('slider', { name: 'Exposure' }).focus()
  await editor.page.keyboard.press('PageUp')
  await expect.poll(() => photo.adjustments(id)).toMatchObject({ exposure: expect.any(Number) })
})

test('dragging the straight tone curve adds a point and bends the curve there', async () => {
  const id = await photo.showImage()
  await openPicker()
  const curve = editor.page.getByTestId('curve-editor')
  const box = await curve.boundingBox()
  if (!box) throw new Error('The curve editor has no box')
  // A press on the straight curve adds a point that changes nothing until it is dragged.
  await editor.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await editor.page.mouse.down()
  await editor.page.mouse.move(box.x + box.width / 2, box.y + box.height / 4, { steps: 5 })
  await editor.page.mouse.up()
  const points = (await photo.adjustments(id))?.curve ?? []
  expect(points).toHaveLength(3)
  expect(points[0]).toEqual({ x: 0, y: 0 })
  expect(points[2]).toEqual({ x: 1, y: 1 })
  expect(points[1].x).toBeCloseTo(0.5, 1)
  expect(points[1].y).toBeGreaterThan(0.7)
})
