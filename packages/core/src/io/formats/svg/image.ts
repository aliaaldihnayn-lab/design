import { isValid, toUint8Array } from 'js-base64'

import type { Fill, SceneGraph, SceneNode } from '@lawha/scene-graph'
import { localTransformFromWorld } from '@lawha/scene-graph/coordinate'
import { computeImageHash, imageSize } from '@lawha/scene-graph/images'
import Matrix from '@lawha/scene-graph/matrix'

import { BLACK } from '#core/constants'
import type { SVGElementLayer } from '#core/icons/types'
import type { VectorizedImage } from '#core/vector/vectorize/svg/to-vectors'

/** The bytes of a Base64 `data:` image; other references are not fetched. */
function dataURLBytes(href: string): Uint8Array | null {
  const match = /^data:image\/[\w.+-]+;base64,(.*)$/s.exec(href.trim())
  const payload = match?.[1].replace(/\s+/g, '')
  return payload && isValid(payload) ? toUint8Array(payload) : null
}

/**
 * The fill that draws a picture over its `<image>` box: whole when the box has its proportions,
 * otherwise stretched over it for `preserveAspectRatio="none"` or fitted inside it as SVG's
 * default `xMidYMid meet` does.
 */
function imageFill(
  bytes: Uint8Array,
  image: VectorizedImage,
  size: { width: number; height: number }
): Fill {
  const fill: Fill = {
    type: 'IMAGE',
    imageHash: computeImageHash(bytes),
    imageScaleMode: 'FILL',
    color: { ...BLACK },
    opacity: 1,
    visible: true
  }
  const picture = imageSize(bytes)
  if (picture && Math.abs(picture.width / picture.height - size.width / size.height) < 1e-3)
    return fill
  if (image.preserveAspectRatio) return { ...fill, imageScaleMode: 'FIT' }
  return {
    ...fill,
    imageScaleMode: 'CROP',
    imageTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
  }
}

/**
 * An `<image>` as a rectangle filled with its picture, as Figma imports one. Its box takes the
 * scale of its transform, so the layer is the size the picture is drawn at, turned and mirrored
 * as it is drawn.
 */
export function createSVGImage(
  graph: SceneGraph,
  parentId: string,
  image: VectorizedImage,
  element: SVGElementLayer
): SceneNode | null {
  const bytes = dataURLBytes(image.href)
  if (!bytes) return null
  const box = Matrix.multiply(image.matrix, Matrix.translated(image.x, image.y))
  const scaleX = Math.hypot(box[0], box[3])
  const scaleY = Math.hypot(box[1], box[4])
  if (!(scaleX > 0) || !(scaleY > 0)) return null
  const width = image.width * scaleX
  const height = image.height * scaleY
  const world = Matrix.multiply(box, [1 / scaleX, 0, 0, 0, 1 / scaleY, 0, 0, 0, 1])
  const node = graph.createNode('RECTANGLE', parentId, {
    name: element.name ?? 'Image',
    opacity: element.opacity,
    visible: element.visible,
    width,
    height,
    fills: [imageFill(bytes, image, { width, height })]
  })
  graph.images.set(computeImageHash(bytes), bytes)
  const place = localTransformFromWorld(node, world, Matrix.identity())
  if (place) graph.updateNode(node.id, place)
  return node
}
