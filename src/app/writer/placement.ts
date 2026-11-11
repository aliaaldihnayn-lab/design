import type { Vector } from '@lawha/scene-graph/primitives'

/**
 * Where a visible signature goes on a PDF page: a box the person clicks or drags on the page's
 * preview, kept as fractions of the page from its top-left corner so it does not depend on how
 * large the preview is drawn, and turned into PDF points from the bottom-left corner to sign.
 */

/** A box on a page, in fractions of its width and height from the top-left corner. */
export interface PageBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PageSize {
  width: number
  height: number
}

/** The size a signature gets when the person clicks rather than drags, in points. */
export const STAMP_SIZE = { width: 180, height: 60 } as const
/** A drag smaller than this, in points, is a click. */
const MIN_DRAG = 12

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The box from a press at `start` and a release at `end`, both fractions of the page: the
 * dragged rectangle, or a stamp-sized box centred on a click, kept inside the page.
 */
export function boxFromGesture(start: Vector, end: Vector, page: PageSize): PageBox {
  const dragWidth = Math.abs(end.x - start.x) * page.width
  const dragHeight = Math.abs(end.y - start.y) * page.height
  if (dragWidth < MIN_DRAG && dragHeight < MIN_DRAG) {
    const width = Math.min(1, STAMP_SIZE.width / page.width)
    const height = Math.min(1, STAMP_SIZE.height / page.height)
    return {
      x: clamp(start.x - width / 2, 0, 1 - width),
      y: clamp(start.y - height / 2, 0, 1 - height),
      width,
      height
    }
  }
  const x = clamp(Math.min(start.x, end.x), 0, 1)
  const y = clamp(Math.min(start.y, end.y), 0, 1)
  return {
    x,
    y,
    width: clamp(Math.max(start.x, end.x), 0, 1) - x,
    height: clamp(Math.max(start.y, end.y), 0, 1) - y
  }
}

/** The box as a PDF rectangle: x, y, width, height in points from the bottom-left corner. */
export function boxToRect(box: PageBox, page: PageSize): [number, number, number, number] {
  const round = (value: number) => Math.round(value * 100) / 100
  const width = box.width * page.width
  const height = box.height * page.height
  return [
    round(box.x * page.width),
    round(page.height - box.y * page.height - height),
    round(width),
    round(height)
  ]
}

/** A PDF rectangle as a box on its page, as for showing a field the file already has. */
export function rectToBox(
  rect: readonly [number, number, number, number],
  page: PageSize
): PageBox {
  const [x, y, width, height] = rect
  return {
    x: x / page.width,
    y: (page.height - y - height) / page.height,
    width: width / page.width,
    height: height / page.height
  }
}

/** Where a signature goes when the person places none: the bottom end corner of the page. */
export function defaultBox(page: PageSize, rtl: boolean): PageBox {
  const margin = 36
  const width = Math.min(1, STAMP_SIZE.width / page.width)
  const height = Math.min(1, STAMP_SIZE.height / page.height)
  const x = rtl ? margin / page.width : 1 - width - margin / page.width
  return {
    x: clamp(x, 0, 1 - width),
    y: clamp(1 - height - margin / page.height, 0, 1),
    width,
    height
  }
}
