import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { PHOTO_PAN, photoDriver } from '#tests/helpers/canvas/photo/driver'

// The pixel tools as a person uses them: tool keys, pointer drags on the 300 × 200 gradient
// "photo" at the page origin, and the tool options bar under the canvas.

const editor = useEditorSetupWithClear('/?test&no-rulers')
const photo = photoDriver(() => editor.page)

/** Drags on the canvas between page points. */
async function drag(from: [number, number], to: [number, number]) {
  await editor.canvas.drag(
    from[0] + PHOTO_PAN,
    from[1] + PHOTO_PAN,
    to[0] + PHOTO_PAN,
    to[1] + PHOTO_PAN,
    12
  )
}

function options() {
  return editor.page.getByTestId('pixel-tool-options')
}

test('the selection buttons follow whether pixels are selected', async () => {
  await photo.showPhoto()
  await editor.canvas.pressKey('m')
  const deselect = options().getByRole('button', { name: /deselect/i })
  const invert = editor.page.getByTestId('pixel-invert-selection')
  const mask = editor.page.getByTestId('pixel-mask-from-selection')
  await expect(deselect).toBeDisabled()
  await expect(mask).toBeDisabled()

  await drag([40, 40], [200, 160])
  await expect(deselect).toBeEnabled()
  await expect(invert).toBeEnabled()
  await expect(mask).toBeEnabled()

  await deselect.click()
  await expect(deselect).toBeDisabled()
  await expect(mask).toBeDisabled()
})
