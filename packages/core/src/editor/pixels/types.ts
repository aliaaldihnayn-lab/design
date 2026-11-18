import type { Color, Vector } from '@lawha/scene-graph/primitives'

import { BLACK } from '#core/constants'
import type { SelectionMode } from '#core/pixels/mask'

import type { PixelSampleScope } from './sample'

/** The brush, fill, and selection settings the pixel tools share, as their context bar sets them. */
export interface PixelToolSettings {
  /** What the brush and the fill bucket paint, and what the colour picker sets. */
  color: Color
  /** The brush's diameter in the layer's pixels. */
  size: number
  /** 1 is a hard edge, 0 fades from the centre to the rim. */
  hardness: number
  /** How much paint one stroke lays down, 0–1. */
  opacity: number
  /** How alike pixels must be for the fill bucket and magic wand to take them, 0–1. */
  tolerance: number
  /** Whether the fill bucket and magic wand take only pixels connected to the one clicked. */
  contiguous: boolean
  /** How a new selection joins the one there is. */
  selectionMode: SelectionMode
  /**
   * What the fill bucket, magic wand, colour picker, and clone tools read: the layer as drawn by
   * itself, or every layer the canvas shows there.
   */
  sampleScope: PixelSampleScope
  /** How far a mask made from the selection is softened, in the layer's pixels. */
  feather: number
}

/** A selection shape being dragged out, in canvas coordinates. */
export interface PixelMarquee {
  kind: 'rect' | 'ellipse'
  from: Vector
  to: Vector
}

/** What the pixel tools show on the canvas, drawn in the overlay pass. */
export interface PixelOverlay {
  /** The layer the selection outline belongs to. */
  nodeId: string | null
  /** The selection's outline, as segments `x1, y1, x2, y2` in the layer's pixel grid. */
  outline: Float32Array | null
  /** The size of the layer's pixel grid the outline is in. */
  grid: { width: number; height: number } | null
  marquee: PixelMarquee | null
  /** The brush under the pointer: its centre in canvas coordinates and radius in canvas units. */
  brush: { x: number; y: number; radius: number } | null
  /** Where the clone stamp and healing brush take pixels from, in canvas coordinates. */
  cloneSource: Vector | null
}

export const DEFAULT_PIXEL_TOOL_SETTINGS: PixelToolSettings = {
  color: { ...BLACK },
  size: 24,
  hardness: 0.8,
  opacity: 1,
  tolerance: 0.15,
  contiguous: true,
  selectionMode: 'replace',
  feather: 0,
  sampleScope: 'layer'
}
