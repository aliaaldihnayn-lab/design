import { describe, expect, test } from 'bun:test'

import { initCanvasKit } from '@lawha/core/io/formats/raster'
import { svgToVectorPaths } from '@lawha/core/vector'

import { LOCAL_TRACE_PROVIDER } from '@/app/editor/vectorize/local'

/** A 64 px PNG of a green square on white. */
async function squarePNG() {
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(64, 64)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const canvas = surface.getCanvas()
  canvas.clear(ck.WHITE)
  const paint = new ck.Paint()
  paint.setColor(ck.Color(10, 160, 60, 1))
  canvas.drawRect(ck.LTRBRect(16, 16, 48, 48), paint)
  paint.delete()
  const image = surface.makeImageSnapshot()
  const bytes = image.encodeToBytes()
  image.delete()
  surface.delete()
  if (!bytes) throw new Error('Could not encode the image')
  return { ck, bytes }
}

describe('on-device Image Trace provider', () => {
  test('answers with SVG the vector importer reads, without a key or network', async () => {
    const { ck, bytes } = await squarePNG()
    const svg = LOCAL_TRACE_PROVIDER.vectorize(bytes, ck, {
      preset: 'logo',
      colors: 2,
      threshold: 128
    })
    expect(svg).toStartWith('<svg')
    expect(svg).toContain('fill="#0aa03c"')
    const imported = svgToVectorPaths(svg, { width: 64, height: 64 })
    expect(imported?.paths).toHaveLength(2)
  })

  test('refuses bytes that are not an image', async () => {
    const { ck } = await squarePNG()
    expect(() => LOCAL_TRACE_PROVIDER.vectorize(new Uint8Array([1, 2, 3]), ck)).toThrow(
      'The image could not be decoded'
    )
  })
})
