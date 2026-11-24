/**
 * PowerPoint's preset shapes (`a:prstGeom`) as SVG path data in a `w` × `h` box, following the
 * guide formulas of ECMA-376's preset shape definitions for each shape's adjust values, so
 * arrows, chevrons, stars and the like keep their outline instead of becoming rectangles.
 */

/** A shape's adjust value by its guide name, or the preset's default. */
export type Adjust = (name: string, fallback: number) => number

const pin = (low: number, value: number, high: number) => Math.min(Math.max(value, low), high)

function polygon(points: [number, number][]): string {
  return `${points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join('')}Z`
}

/** A star of `points` tips whose inner corners lie `inner` (0–1) of the way out. */
function star(points: number, inner: number, w: number, h: number): string {
  const corners: [number, number][] = []
  for (let i = 0; i < points * 2; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / points
    const radius = i % 2 === 0 ? 1 : inner
    corners.push([
      w / 2 + (w / 2) * radius * Math.cos(angle),
      h / 2 + (h / 2) * radius * Math.sin(angle)
    ])
  }
  return polygon(corners)
}

/** An arrow pointing right in a `w` × `h` box, its shaft `a1` of the height, its head `a2` long. */
function rightArrow(w: number, h: number, adjust: Adjust): [number, number][] {
  const ss = Math.min(w, h)
  const a1 = pin(0, adjust('adj1', 50000), 100000)
  const a2 = pin(0, adjust('adj2', 50000), (100000 * w) / ss)
  const x1 = w - (ss * a2) / 100000
  const dy = (h * a1) / 200000
  return [
    [0, h / 2 - dy],
    [x1, h / 2 - dy],
    [x1, 0],
    [w, h / 2],
    [x1, h],
    [x1, h / 2 + dy],
    [0, h / 2 + dy]
  ]
}

/** An arrow pointing down, the right arrow's rule along the other axis. */
function downArrow(w: number, h: number, adjust: Adjust): [number, number][] {
  const ss = Math.min(w, h)
  const a1 = pin(0, adjust('adj1', 50000), 100000)
  const a2 = pin(0, adjust('adj2', 50000), (100000 * h) / ss)
  const y1 = h - (ss * a2) / 100000
  const dx = (w * a1) / 200000
  return [
    [w / 2 - dx, 0],
    [w / 2 + dx, 0],
    [w / 2 + dx, y1],
    [w, y1],
    [w / 2, h],
    [0, y1],
    [w / 2 - dx, y1]
  ]
}

export function presetPath(preset: string, w: number, h: number, adjust: Adjust): string | null {
  const ss = Math.min(w, h)
  switch (preset) {
    case 'triangle': {
      const x = (w * pin(0, adjust('adj', 50000), 100000)) / 100000
      return polygon([
        [x, 0],
        [w, h],
        [0, h]
      ])
    }
    case 'rtTriangle':
      return polygon([
        [0, 0],
        [0, h],
        [w, h]
      ])
    case 'diamond':
      return polygon([
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2]
      ])
    case 'parallelogram': {
      const x = (ss * pin(0, adjust('adj', 25000), (100000 * w) / ss)) / 100000
      return polygon([
        [x, 0],
        [w, 0],
        [w - x, h],
        [0, h]
      ])
    }
    case 'trapezoid': {
      const x = (ss * pin(0, adjust('adj', 25000), (50000 * w) / ss)) / 100000
      return polygon([
        [0, h],
        [x, 0],
        [w - x, 0],
        [w, h]
      ])
    }
    case 'hexagon': {
      const x = (ss * pin(0, adjust('adj', 25000), (50000 * w) / ss)) / 100000
      return polygon([
        [x, 0],
        [w - x, 0],
        [w, h / 2],
        [w - x, h],
        [x, h],
        [0, h / 2]
      ])
    }
    case 'octagon': {
      const x = (ss * pin(0, adjust('adj', 29289), 50000)) / 100000
      return polygon([
        [0, x],
        [x, 0],
        [w - x, 0],
        [w, x],
        [w, h - x],
        [w - x, h],
        [x, h],
        [0, h - x]
      ])
    }
    case 'pentagon':
      // A regular pentagon stretched to its box, as PowerPoint draws it.
      return polygon([
        [w / 2, 0],
        [w, h * 0.382],
        [w * 0.809, h],
        [w * 0.191, h],
        [0, h * 0.382]
      ])
    case 'homePlate': {
      const x = w - (ss * pin(0, adjust('adj', 50000), (100000 * w) / ss)) / 100000
      return polygon([
        [0, 0],
        [x, 0],
        [w, h / 2],
        [x, h],
        [0, h]
      ])
    }
    case 'chevron': {
      const x = (ss * pin(0, adjust('adj', 50000), (100000 * w) / ss)) / 100000
      return polygon([
        [0, 0],
        [w - x, 0],
        [w, h / 2],
        [w - x, h],
        [0, h],
        [x, h / 2]
      ])
    }
    case 'plus': {
      const x = (ss * pin(0, adjust('adj', 25000), 50000)) / 100000
      return polygon([
        [0, x],
        [x, x],
        [x, 0],
        [w - x, 0],
        [w - x, x],
        [w, x],
        [w, h - x],
        [w - x, h - x],
        [w - x, h],
        [x, h],
        [x, h - x],
        [0, h - x]
      ])
    }
    default:
      return arrowOrStarPath(preset, w, h, adjust)
  }
}

/** The arrows and stars among the presets. */
function arrowOrStarPath(preset: string, w: number, h: number, adjust: Adjust): string | null {
  const ss = Math.min(w, h)
  switch (preset) {
    case 'rightArrow':
      return polygon(rightArrow(w, h, adjust))
    case 'leftArrow':
      return polygon(rightArrow(w, h, adjust).map(([x, y]) => [w - x, y]))
    case 'downArrow':
      return polygon(downArrow(w, h, adjust))
    case 'upArrow':
      return polygon(downArrow(w, h, adjust).map(([x, y]) => [x, h - y]))
    case 'leftRightArrow': {
      const a1 = pin(0, adjust('adj1', 50000), 100000)
      const a2 = pin(0, adjust('adj2', 50000), (50000 * w) / ss)
      const x = (ss * a2) / 100000
      const dy = (h * a1) / 200000
      return polygon([
        [0, h / 2],
        [x, 0],
        [x, h / 2 - dy],
        [w - x, h / 2 - dy],
        [w - x, 0],
        [w, h / 2],
        [w - x, h],
        [w - x, h / 2 + dy],
        [x, h / 2 + dy],
        [x, h]
      ])
    }
    case 'star4':
      return star(4, pin(0, adjust('adj', 12500), 50000) / 50000, w, h)
    case 'star5':
      return star(5, pin(0, adjust('adj', 19098), 50000) / 50000, w, h)
    case 'star6':
      return star(6, pin(0, adjust('adj', 28868), 50000) / 50000, w, h)
    case 'star8':
      return star(8, pin(0, adjust('adj', 37500), 50000) / 50000, w, h)
    default:
      return null
  }
}
