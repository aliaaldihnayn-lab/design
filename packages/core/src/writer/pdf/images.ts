import type { CanvasKit } from 'canvaskit-wasm'

/**
 * PDF holds JPEG and PNG pictures and nothing else, so other images (WebP, GIF, BMP) are
 * decoded and written again as PNG before they go in. A GIF keeps its first frame, which is what
 * Word prints for one.
 */
export type WriterImageConverter = (bytes: Uint8Array, mime: string) => Promise<Uint8Array | null>

/** Converts with CanvasKit, which decodes every format the editor shows. */
export function canvasKitImageConverter(canvasKit: CanvasKit): WriterImageConverter {
  return async (bytes) => {
    const image = canvasKit.MakeImageFromEncoded(bytes)
    if (!image) return null
    try {
      return image.encodeToBytes(canvasKit.ImageFormat.PNG, 100)
    } finally {
      image.delete()
    }
  }
}
