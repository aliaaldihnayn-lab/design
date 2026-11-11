import type { Vector } from '@lawha/scene-graph/primitives'

import type { RGBAImage } from '#core/io/formats/raster'

import { blendPixel, dabCoverage, type BrushTip, type StrokeCoverage } from './brush'
import type { CloneSampling } from './clone'
import type { PixelMask } from './mask'

/** The four neighbours a pixel's Laplacian reads, as grid steps. */
const NEIGHBOURS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
] as const

/** A pixel whose RMS residual falls below this, in 0–255 levels, is solved. */
const SOLVE_TOLERANCE = 0.02
/** Keeps a region with no boundary (the whole image) from having no single solution. */
const ANCHOR = 1e-4

/** A region of a grid to solve over: its pixels, and where each sits in the solution. */
export interface HealRegion {
  width: number
  height: number
  /** The grid index of each pixel in the region. */
  pixels: Int32Array
  /** For every grid pixel, its place in `pixels`, or -1 outside the region. */
  slot: Int32Array
}

export function regionOf(
  width: number,
  height: number,
  inside: (index: number) => boolean
): HealRegion {
  const slot = new Int32Array(width * height).fill(-1)
  const list: number[] = []
  for (let i = 0; i < width * height; i++) {
    if (!inside(i)) continue
    slot[i] = list.length
    list.push(i)
  }
  return { width, height, pixels: Int32Array.from(list), slot }
}

/** What one channel of a Poisson problem reads at a grid pixel. */
export interface PoissonChannel {
  /** The guide whose gradients the solution copies, at any grid pixel. */
  guide: (index: number) => number
  /** The fixed value just outside the region, which the solution meets at its edge. */
  boundary: (index: number) => number
  /** A starting guess for each region pixel; the closer, the fewer iterations. */
  initial?: (slot: number) => number
}

/**
 * Solves the discrete Poisson equation of seamless cloning (Pérez et al., "Poisson Image
 * Editing", 2003) on one channel: values over `region` whose 4-neighbour Laplacian equals the
 * guide's, meeting `boundary` at the region's edge. Neighbours outside the grid are left out
 * (Neumann edges). Solved by conjugate gradients on the symmetric positive definite system.
 */
export function solvePoisson(region: HealRegion, channel: PoissonChannel): Float32Array {
  const { width, height, pixels, slot } = region
  const count = pixels.length
  const diagonal = new Float32Array(count)
  const rhs = new Float64Array(count)
  for (let s = 0; s < count; s++) {
    const index = pixels[s]
    const x = index % width
    const y = (index - x) / width
    const g = channel.guide(index)
    let n = 0
    let b = 0
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const q = ny * width + nx
      n++
      b += g - channel.guide(q)
      if (slot[q] < 0) b += channel.boundary(q)
    }
    const start = channel.initial ? channel.initial(s) : g
    diagonal[s] = n + ANCHOR
    rhs[s] = b + ANCHOR * start
  }

  const x = new Float64Array(count)
  for (let s = 0; s < count; s++) x[s] = channel.initial ? channel.initial(s) : 0

  /** `A · v` into `out`: the region's Laplacian with its edge moved to the right-hand side. */
  const multiply = (v: Float64Array, out: Float64Array) => {
    for (let s = 0; s < count; s++) {
      const index = pixels[s]
      const px = index % width
      const py = (index - px) / width
      let sum = diagonal[s] * v[s]
      if (px > 0 && slot[index - 1] >= 0) sum -= v[slot[index - 1]]
      if (px < width - 1 && slot[index + 1] >= 0) sum -= v[slot[index + 1]]
      if (py > 0 && slot[index - width] >= 0) sum -= v[slot[index - width]]
      if (py < height - 1 && slot[index + width] >= 0) sum -= v[slot[index + width]]
      out[s] = sum
    }
  }

  const residual = new Float64Array(count)
  const direction = new Float64Array(count)
  const product = new Float64Array(count)
  multiply(x, product)
  let rs = 0
  for (let s = 0; s < count; s++) {
    residual[s] = rhs[s] - product[s]
    direction[s] = residual[s]
    rs += residual[s] * residual[s]
  }
  const limit = SOLVE_TOLERANCE * SOLVE_TOLERANCE * count
  // Conjugate gradients converge in at most `count` steps; a smooth region needs far fewer.
  const iterations = Math.min(count, 4 * Math.ceil(Math.sqrt(count)) + 200)
  for (let i = 0; i < iterations && rs > limit; i++) {
    multiply(direction, product)
    let pAp = 0
    for (let s = 0; s < count; s++) pAp += direction[s] * product[s]
    if (pAp <= 0) break
    const alpha = rs / pAp
    let next = 0
    for (let s = 0; s < count; s++) {
      x[s] += alpha * direction[s]
      residual[s] -= alpha * product[s]
      next += residual[s] * residual[s]
    }
    const beta = next / rs
    rs = next
    for (let s = 0; s < count; s++) direction[s] = residual[s] + beta * direction[s]
  }
  return Float32Array.from(x)
}

/**
 * A healing stroke in progress: what the layer showed when it began, which the healed pixels
 * blend into, and each reached pixel's healed colour so far.
 */
export interface HealingStroke {
  sampling: CloneSampling
  /** Healed RGB, 0–255, three per grid pixel; meaningful where `reached` is set. */
  solved: Float32Array
  reached: Uint8Array
}

export function createHealingStroke(sampling: CloneSampling): HealingStroke {
  const { width, height } = sampling.source
  return {
    sampling,
    solved: new Float32Array(width * height * 3),
    reached: new Uint8Array(width * height)
  }
}

/** The grid index `index` copies from, or -1 when that falls outside the source. */
function sourceOf(sampling: CloneSampling, width: number, index: number): number {
  const { source, offset } = sampling
  const x = (index % width) + offset.x
  const y = Math.floor(index / width) + offset.y
  const sx = Math.round(x)
  const sy = Math.round(y)
  if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) return -1
  return sy * source.width + sx
}

/**
 * Solves `region` so its colour gradients are the source's at the clone offset and its edge meets
 * `edge`, writing each pixel's healed RGB into the stroke.
 */
function healRegion(
  stroke: HealingStroke,
  region: HealRegion,
  edge: (q: number, c: number) => number
) {
  const { sampling, solved, reached } = stroke
  const { source } = sampling
  const { width, pixels } = region
  const from = new Int32Array(pixels.length)
  for (let s = 0; s < pixels.length; s++) from[s] = sourceOf(sampling, width, pixels[s])
  for (let c = 0; c < 3; c++) {
    const guide = (index: number) => {
      const at = sourceOf(sampling, width, index)
      // A pixel copying from outside the source keeps its own colour's level as its guide.
      return at >= 0 ? source.data[at * 4 + c] : edge(index, c)
    }
    // Start from the copied texture lifted by the average gap along the edge.
    let gap = 0
    let edges = 0
    for (const index of pixels) {
      const x = index % width
      const y = (index - x) / width
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= region.height) continue
        const q = ny * width + nx
        if (region.slot[q] >= 0) continue
        gap += edge(q, c) - guide(index)
        edges++
      }
    }
    const lift = edges > 0 ? gap / edges : 0
    const values = solvePoisson(region, {
      guide,
      boundary: (q) => edge(q, c),
      initial: (s) => (reached[pixels[s]] ? solved[pixels[s] * 3 + c] : guide(pixels[s]) + lift)
    })
    for (let s = 0; s < pixels.length; s++) {
      solved[pixels[s] * 3 + c] = Math.max(0, Math.min(255, values[s]))
    }
  }
  for (const index of pixels) reached[index] = 1
  return from
}

/** Writes pixel `index` of the paint layer as the stroke's base with its healed colour over it. */
function writeHealed(
  image: RGBAImage,
  before: Uint8Array,
  stroke: HealingStroke,
  index: number,
  alpha: number,
  amount: number
) {
  const offset = index * 4
  for (let c = 0; c < 4; c++) image.data[offset + c] = before[offset + c]
  const { solved } = stroke
  blendPixel(
    image.data,
    offset,
    {
      r: solved[index * 3] / 255,
      g: solved[index * 3 + 1] / 255,
      b: solved[index * 3 + 2] / 255,
      a: alpha / 255
    },
    amount
  )
}

/** What the layer shows at a grid pixel now: its start, with the stroke's healing over it. */
function shownNow(stroke: HealingStroke, coverage: StrokeCoverage, q: number, c: number) {
  const start = stroke.sampling.source.data[q * 4 + c]
  if (!stroke.reached[q]) return start
  const amount = coverage[q]
  return start + (stroke.solved[q * 3 + c] - start) * amount
}

/**
 * One dab of the healing brush, as Affinity's and Photoshop's heal: the source's texture at the
 * clone offset, solved over the dab so its gradients are the texture's and its edge meets what
 * the layer shows around it (seamless cloning), so a blemish takes clean skin's detail in the
 * tone and shading of its own spot, with no seam.
 */
export function healDab(
  image: RGBAImage,
  before: Uint8Array,
  coverage: StrokeCoverage,
  centre: Vector,
  tip: BrushTip,
  stroke: HealingStroke,
  mask: PixelMask | null = null
): void {
  const { width, height } = image
  const reach = tip.size / 2 + 1
  const x0 = Math.max(0, Math.floor(centre.x - reach))
  const y0 = Math.max(0, Math.floor(centre.y - reach))
  const x1 = Math.min(width, Math.ceil(centre.x + reach))
  const y1 = Math.min(height, Math.ceil(centre.y + reach))
  const amounts = new Map<number, number>()
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = y * width + x
      let amount = dabCoverage(Math.hypot(x + 0.5 - centre.x, y + 0.5 - centre.y), tip)
      if (mask) amount *= mask.data[index] / 255
      if (amount <= 0 || sourceOf(stroke.sampling, width, index) < 0) continue
      amounts.set(index, amount * tip.opacity)
    }
  }
  if (amounts.size === 0) return
  const region = regionOf(width, height, (index) => amounts.has(index))
  const from = healRegion(stroke, region, (q, c) => shownNow(stroke, coverage, q, c))
  const { source } = stroke.sampling
  region.pixels.forEach((index, s) => {
    coverage[index] = Math.max(coverage[index], amounts.get(index) ?? 0)
    writeHealed(image, before, stroke, index, source.data[from[s] * 4 + 3], coverage[index])
  })
}

/**
 * Solves the whole stroke once more as one region against what the layer showed before it, so
 * overlapping dabs settle into one seamless patch. Call when the stroke ends.
 */
export function finishHealingStroke(
  image: RGBAImage,
  before: Uint8Array,
  coverage: StrokeCoverage,
  stroke: HealingStroke
): void {
  const { width, height } = image
  const region = regionOf(width, height, (index) => stroke.reached[index] === 1)
  if (region.pixels.length === 0) return
  const { source } = stroke.sampling
  const from = healRegion(stroke, region, (q, c) => source.data[q * 4 + c])
  region.pixels.forEach((index, s) => {
    writeHealed(image, before, stroke, index, source.data[from[s] * 4 + 3], coverage[index])
  })
}
