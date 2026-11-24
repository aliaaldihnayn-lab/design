import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getWorldMatrix } from '@lawha/scene-graph/coordinate'
import TransformMatrix, { type Mat3 } from '@lawha/scene-graph/matrix'
import type { Vector } from '@lawha/scene-graph/primitives'

import { clampRot, round2 } from './style'

const MIN_SIZE_IN = 0.01
const MATRIX_EPSILON = 1e-6

export interface PPTXGeometryContext {
  graph: SceneGraph
  pxPerInch: number
  toSlideSpace: Mat3
  offsetX: number
  offsetY: number
}

export interface SlideBox {
  x: number
  y: number
  w: number
  h: number
  rotate: number
  flipH: boolean
}

interface NodeTransform {
  matrix: Mat3
  scaleX: number
  scaleY: number
  mirrored: boolean
  radians: number
}

export function inch(ctx: PPTXGeometryContext, px: number): number {
  return px / ctx.pxPerInch
}

/** px → pt. 1in = 96px (scene units) = 72pt. */
export function pt(ctx: PPTXGeometryContext, px: number): number {
  return (px * 72) / ctx.pxPerInch
}

export function nodeBox(ctx: PPTXGeometryContext, node: SceneNode): SlideBox {
  const transform = getNodeTransform(ctx, node)
  const [centerX, centerY] = TransformMatrix.mapPoints(transform.matrix, [
    node.width / 2,
    node.height / 2
  ])
  const w = Math.max(inch(ctx, node.width * transform.scaleX), MIN_SIZE_IN)
  const h = Math.max(inch(ctx, node.height * transform.scaleY), MIN_SIZE_IN)
  return {
    x: ctx.offsetX + inch(ctx, centerX) - w / 2,
    y: ctx.offsetY + inch(ctx, centerY) - h / 2,
    w,
    h,
    rotate: clampRot(round2((transform.radians * 180) / Math.PI)),
    flipH: transform.mirrored
  }
}

export function hasUnsupportedTransform(ctx: PPTXGeometryContext, node: SceneNode): boolean {
  const { matrix, scaleX, scaleY } = getNodeTransform(ctx, node)
  if (scaleX <= MATRIX_EPSILON || scaleY <= MATRIX_EPSILON) return true
  if (
    Math.abs(matrix[6]) > MATRIX_EPSILON ||
    Math.abs(matrix[7]) > MATRIX_EPSILON ||
    Math.abs(matrix[8] - 1) > MATRIX_EPSILON
  ) {
    return true
  }
  const basisDot = matrix[0] * matrix[1] + matrix[3] * matrix[4]
  return Math.abs(basisDot) > MATRIX_EPSILON * scaleX * scaleY
}

export function transformNodeVector(
  ctx: PPTXGeometryContext,
  node: SceneNode,
  vector: Vector
): Vector {
  const { matrix } = getNodeTransform(ctx, node)
  return {
    x: inch(ctx, matrix[0] * vector.x + matrix[1] * vector.y),
    y: inch(ctx, matrix[3] * vector.x + matrix[4] * vector.y)
  }
}

export function nodeScale(ctx: PPTXGeometryContext, node: SceneNode): Vector {
  const { scaleX, scaleY } = getNodeTransform(ctx, node)
  return { x: scaleX, y: scaleY }
}

function getNodeTransform(ctx: PPTXGeometryContext, node: SceneNode): NodeTransform {
  const matrix = TransformMatrix.multiply(ctx.toSlideSpace, getWorldMatrix(node, ctx.graph))
  const scaleX = Math.hypot(matrix[0], matrix[3])
  const scaleY = Math.hypot(matrix[1], matrix[4])
  const mirrored = matrix[0] * matrix[4] - matrix[1] * matrix[3] < 0
  const radians = mirrored ? Math.atan2(-matrix[3], matrix[4]) : Math.atan2(matrix[3], matrix[0])
  return { matrix, scaleX, scaleY, mirrored, radians }
}

/**
 * The box a layer's picture fills: the layer's box, grown about its centre to the picture's size
 * where what the layer draws reaches past its box (a stroke, a shadow), so it is not squeezed in.
 */
export function pictureBox(
  box: SlideBox,
  png: Uint8Array,
  scale: number,
  pxPerInch: number
): SlideBox {
  // A PNG's width and height are the first fields of its header chunk, big-endian.
  const header = String.fromCharCode(...png.subarray(12, 16))
  if (png.length < 24 || header !== 'IHDR') return box
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const w = view.getUint32(16) / scale / pxPerInch
  const h = view.getUint32(20) / scale / pxPerInch
  if (!(w > box.w) && !(h > box.h)) return box
  const width = Math.max(w, box.w)
  const height = Math.max(h, box.h)
  return {
    ...box,
    x: box.x - (width - box.w) / 2,
    y: box.y - (height - box.h) / 2,
    w: width,
    h: height
  }
}
