import type { Element } from '@xmldom/xmldom'

import type { SceneNode } from '@lawha/scene-graph'

import type { PaintContext } from './paint'
import { EMU_PER_PX } from './text'
import { boolAttr, child, numAttr } from './xml'

/** Where a part's shapes go on a slide, and what every shape reader shares. */

/** Maps a part's EMU coordinates into a parent layer's pixels: `(emu − origin) · scale / 9525`. */
export interface Space {
  originX: number
  originY: number
  scaleX: number
  scaleY: number
}

export const SLIDE_SPACE: Space = { originX: 0, originY: 0, scaleX: 1, scaleY: 1 }

/** The placeholder shapes a slide's placeholders inherit from: its layout's, then its master's. */
export interface Placeholders {
  layout: Element[]
  master: Element[]
  masterRoot: Element | null
  /** The presentation's `p:defaultTextStyle`, for text outside placeholders. */
  defaultText: Element | undefined
}

export interface ShapeContext extends PaintContext {
  placeholders: Placeholders
  /** Whether placeholders are drawn: a layout's or master's are only prompts. */
  drawPlaceholders: boolean
  skipped: Map<string, number>
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
  /** OOXML turn, degrees clockwise, applied after the flips. */
  rotation: number
  flipH: boolean
  flipV: boolean
}

export const ANGLE_UNIT = 60000
/** Lines at most a pixel across are straight: pptxgenjs gives an empty extent 0.01 in. */
export const HAIRLINE_PX = 1.01

/** EMU to pixels, snapping the rounding slack of inch-based writers to whole pixels. */
export function px(emu: number): number {
  const value = emu / EMU_PER_PX
  const whole = Math.round(value)
  return Math.abs(value - whole) < 0.05 ? whole : Math.round(value * 100) / 100
}

export function normalizeAngle(degrees: number): number {
  let angle = degrees % 360
  if (angle > 180) angle -= 360
  if (angle <= -180) angle += 360
  return Math.round(angle * 1000) / 1000
}

export function readBox(xfrm: Element | undefined, space: Space): Box | null {
  const off = child(xfrm, 'off')
  const ext = child(xfrm, 'ext')
  if (!off || !ext) return null
  return {
    x: px(((numAttr(off, 'x') ?? 0) - space.originX) * space.scaleX),
    y: px(((numAttr(off, 'y') ?? 0) - space.originY) * space.scaleY),
    width: px((numAttr(ext, 'cx') ?? 0) * space.scaleX),
    height: px((numAttr(ext, 'cy') ?? 0) * space.scaleY),
    rotation: (numAttr(xfrm, 'rot') ?? 0) / ANGLE_UNIT,
    flipH: boolAttr(xfrm, 'flipH') ?? false,
    flipV: boolAttr(xfrm, 'flipV') ?? false
  }
}

/**
 * A box as a layer's placement. OOXML flips a shape inside its box and then turns it; a layer
 * turns first and then flips, so a single flip turns the other way and two flips are a half turn.
 */
export function placement(box: Box): Pick<SceneNode, 'rotation' | 'flipX' | 'flipY'> {
  if (box.flipH && box.flipV) {
    return { rotation: normalizeAngle(box.rotation + 180), flipX: false, flipY: false }
  }
  if (box.flipH || box.flipV) {
    return { rotation: normalizeAngle(-box.rotation), flipX: box.flipH, flipY: box.flipV }
  }
  return { rotation: normalizeAngle(box.rotation), flipX: false, flipY: false }
}

export function skip(ctx: ShapeContext, reason: string) {
  ctx.skipped.set(reason, (ctx.skipped.get(reason) ?? 0) + 1)
}

/** A graphic frame's name, visibility and place, for what it holds. */
export interface FrameInfo {
  name: string
  visible: boolean
  box: Box
}
