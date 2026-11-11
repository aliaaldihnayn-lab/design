import type { CanvasKit, Path } from 'canvaskit-wasm'

/** Areas smaller than this, in square pixels, are slivers path operations leave behind. */
const SLIVER_AREA = 0.25

interface Contour {
  path: Path
  area: number
  samples: [number, number][]
}

/** How many numbers follow each path verb. */
export function verbArgs(ck: CanvasKit): Map<number, number> {
  return new Map<number, number>([
    [ck.MOVE_VERB, 2],
    [ck.LINE_VERB, 2],
    [ck.QUAD_VERB, 4],
    [ck.CONIC_VERB, 5],
    [ck.CUBIC_VERB, 6],
    [ck.CLOSE_VERB, 0]
  ])
}

/** Splits path commands at every move, one command list per contour. */
function contourCommands(ck: CanvasKit, cmds: Float32Array): number[][] {
  const argCount = verbArgs(ck)
  const contours: number[][] = []
  let current: number[] | null = null
  for (let i = 0; i < cmds.length;) {
    const verb = cmds[i]
    const count = argCount.get(verb) ?? 0
    if (verb === ck.MOVE_VERB) {
      current = []
      contours.push(current)
    }
    current?.push(...cmds.subarray(i, i + 1 + count))
    i += 1 + count
  }
  return contours.filter((contour) => contour.length > 3)
}

/** The on-curve points of a contour and the polygon area they span, enough to rank contours. */
function contourShape(ck: CanvasKit, cmds: number[]): Omit<Contour, 'path'> {
  const argCount = verbArgs(ck)
  const points: [number, number][] = []
  for (let i = 0; i < cmds.length;) {
    const verb = cmds[i]
    if (verb === ck.CLOSE_VERB) {
      i += 1
      continue
    }
    const count = argCount.get(verb) ?? 2
    // A conic's weight follows its end point; every other verb ends on its last point.
    const end = verb === ck.CONIC_VERB ? i + 3 : i + count - 1
    points.push([cmds[end], cmds[end + 1]])
    i += 1 + count
  }
  let twice = 0
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[(i + 1) % points.length]
    twice += ax * by - bx * ay
  }
  return { area: Math.abs(twice) / 2, samples: points }
}

/**
 * The connected pieces of a filled path that path operations made, so contours do not cross, each an outer contour with the holes directly inside
 * it, filled even-odd. Contours nest by containment, so an island inside a hole is a piece of
 * its own. Slivers smaller than a quarter pixel are dropped.
 */
export function connectedPieces(ck: CanvasKit, path: Path): Path[] {
  const contours: Contour[] = []
  for (const cmds of contourCommands(ck, path.toCmds())) {
    const contourPath = ck.Path.MakeFromCmds(cmds)
    if (!contourPath) continue
    contours.push({ path: contourPath, ...contourShape(ck, cmds) })
  }
  try {
    const parents = contours.map((contour, index) => {
      let parent = -1
      for (let j = 0; j < contours.length; j++) {
        const other = contours[j]
        if (j === index || other.area <= contour.area) continue
        const inside = contour.samples.filter(([x, y]) => other.path.contains(x, y)).length
        if (inside * 2 < contour.samples.length) continue
        if (parent < 0 || other.area < contours[parent].area) parent = j
      }
      return parent
    })
    const depth = (index: number): number => {
      let d = 0
      for (let at = parents[index]; at >= 0; at = parents[at]) d++
      return d
    }
    const pieces: Path[] = []
    for (let index = 0; index < contours.length; index++) {
      if (depth(index) % 2 === 1) continue
      const holes = contours.filter((_, j) => parents[j] === index)
      const area = contours[index].area - holes.reduce((sum, hole) => sum + hole.area, 0)
      if (area < SLIVER_AREA) continue
      const builder = new ck.PathBuilder()
      builder.addPath(contours[index].path)
      for (const hole of holes) builder.addPath(hole.path)
      const piece = builder.detachAndDelete()
      piece.setFillType(ck.FillType.EvenOdd)
      pieces.push(piece)
    }
    return pieces
  } finally {
    for (const contour of contours) contour.path.delete()
  }
}

/** The area of a filled path, from its contours' polygons: positive outer, holes taken away. */
export function filledArea(ck: CanvasKit, path: Path): number {
  let total = 0
  for (const piece of connectedPieces(ck, path)) {
    for (const [index, cmds] of contourCommands(ck, piece.toCmds()).entries()) {
      const { area } = contourShape(ck, cmds)
      total += index === 0 ? area : -area
    }
    piece.delete()
  }
  return total
}
