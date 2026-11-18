/** RGBA pixels, row by row, as a canvas or CanvasKit reads them unpremultiplied. */
export interface TracePixels {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

/** Pixels more transparent than this are left out of the trace. */
const OPAQUE_ALPHA = 128
const KMEANS_ROUNDS = 10

export type RGB = [number, number, number]

/** A palette and each pixel's colour in it; −1 marks a transparent pixel. */
export interface Quantized {
  palette: RGB[]
  labels: Int16Array
}

/**
 * Splits the box of colours with the widest channel at the middle of its range, until there are
 * `count`: unlike a median split, a small patch of a distinct colour gets a box of its own.
 */
function medianCut(colors: RGB[], count: number): RGB[] {
  const boxes: RGB[][] = [colors]
  while (boxes.length < count) {
    let widest = -1
    let widestRange = 0
    let channel = 0
    for (const [index, box] of boxes.entries()) {
      if (box.length < 2) continue
      for (let c = 0; c < 3; c++) {
        let min = 255
        let max = 0
        for (const color of box) {
          min = Math.min(min, color[c])
          max = Math.max(max, color[c])
        }
        if (max - min > widestRange) {
          widestRange = max - min
          widest = index
          channel = c
        }
      }
    }
    if (widest < 0) break
    const box = boxes[widest].toSorted((a, b) => a[channel] - b[channel])
    const middle = (box[0][channel] + (box.at(-1)?.[channel] ?? 0)) / 2
    const split = Math.max(
      1,
      box.findIndex((color) => color[channel] > middle)
    )
    boxes.splice(widest, 1, box.slice(0, split), box.slice(split))
  }
  return boxes.map((box) => {
    const sum: RGB = [0, 0, 0]
    for (const color of box) for (let c = 0; c < 3; c++) sum[c] += color[c]
    return sum.map((value) => value / Math.max(1, box.length)) as RGB
  })
}

function nearest(palette: readonly RGB[], r: number, g: number, b: number): number {
  let best = 0
  let bestDistance = Infinity
  for (const [index, [pr, pg, pb]] of palette.entries()) {
    // Weighted towards green, as the eye is, so greys and skin tones keep apart.
    const distance = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return best
}

/**
 * Reduces an image to at most `count` colours: a median cut of a sample of its opaque pixels
 * seeds k-means, which then settles the palette over every pixel. Deterministic, so the same
 * image always traces the same.
 */
export function quantize(pixels: TracePixels, count: number): Quantized {
  const { width, height, data } = pixels
  const total = width * height
  const step = Math.max(1, Math.floor(total / 20_000))
  const sample: RGB[] = []
  for (let i = 0; i < total; i += step) {
    if (data[i * 4 + 3] >= OPAQUE_ALPHA)
      sample.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
  }
  const labels = new Int16Array(total).fill(-1)
  if (sample.length === 0) return { palette: [], labels }
  let palette = medianCut(sample, Math.max(1, Math.min(count, sample.length)))
  for (let round = 0; round < KMEANS_ROUNDS; round++) {
    const sums = palette.map(() => [0, 0, 0, 0])
    for (let i = 0; i < total; i++) {
      if (data[i * 4 + 3] < OPAQUE_ALPHA) continue
      const label = nearest(palette, data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
      labels[i] = label
      const sum = sums[label]
      sum[0] += data[i * 4]
      sum[1] += data[i * 4 + 1]
      sum[2] += data[i * 4 + 2]
      sum[3]++
    }
    palette = palette.map((color, index) => {
      const [r, g, b, n] = sums[index]
      return n > 0 ? [r / n, g / n, b / n] : color
    })
  }
  // Colours no pixel kept go, and the labels close up.
  const used = palette.map(() => 0)
  for (const label of labels) if (label >= 0) used[label]++
  const remap = new Int16Array(palette.length).fill(-1)
  const kept: RGB[] = []
  for (const [index, color] of palette.entries()) {
    if (used[index] === 0) continue
    remap[index] = kept.length
    kept.push(color.map(Math.round) as RGB)
  }
  for (let i = 0; i < total; i++) if (labels[i] >= 0) labels[i] = remap[labels[i]]
  return { palette: kept, labels }
}

/**
 * Gives every patch of one colour smaller than `minArea` pixels the colour most of its
 * neighbours have, as Image Trace's Noise setting does, so specks do not become paths.
 */
export function despeckle(labels: Int16Array, width: number, height: number, minArea: number) {
  if (minArea <= 1) return
  const seen = new Uint8Array(labels.length)
  const stack: number[] = []
  const patch: number[] = []
  for (let start = 0; start < labels.length; start++) {
    if (seen[start] || labels[start] < 0) continue
    const label = labels[start]
    patch.length = 0
    stack.push(start)
    seen[start] = 1
    const around = new Map<number, number>()
    while (stack.length > 0) {
      const at = stack.pop() ?? 0
      patch.push(at)
      const x = at % width
      const y = (at - x) / width
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        const nextLabel = labels[next]
        if (nextLabel === label) {
          if (!seen[next]) {
            seen[next] = 1
            stack.push(next)
          }
        } else around.set(nextLabel, (around.get(nextLabel) ?? 0) + 1)
      }
    }
    if (patch.length >= minArea) continue
    let best = label
    let bestCount = 0
    for (const [other, count] of around) {
      if (other >= 0 && count > bestCount) {
        best = other
        bestCount = count
      }
    }
    for (const at of patch) labels[at] = best
  }
}
