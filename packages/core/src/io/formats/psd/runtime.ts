import { initializeCanvas } from 'ag-psd'

let ready = false

/**
 * ag-psd asks for a canvas only to make ImageData objects when it reads and writes raw pixels
 * (`useImageData`), which a plain object does as well, so the same code runs in the browser,
 * the desktop app and headless (CLI, MCP, tests) without a DOM canvas.
 */
export function preparePSDRuntime(): void {
  if (ready) return
  ready = true
  initializeCanvas(
    () => {
      throw new Error('PSD features that need a canvas (thumbnails, JPEG data) are not used')
    },
    (width, height) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: 'srgb'
    })
  )
}
