import type { WidthPoint } from '@lawha/scene-graph/path-effects'

/** Illustrator's width profiles, as the Width tool's presets in the Stroke panel name them. */
export const WIDTH_PROFILES = [
  'uniform',
  'taper-start',
  'taper-end',
  'taper-both',
  'bulge',
  'pinch'
] as const
export type WidthProfile = (typeof WIDTH_PROFILES)[number]

export function profileWidthPoints(profile: WidthProfile): WidthPoint[] {
  switch (profile) {
    case 'uniform':
      return [
        { t: 0, width: 1 },
        { t: 1, width: 1 }
      ]
    case 'taper-start':
      return [
        { t: 0, width: 0 },
        { t: 1, width: 1 }
      ]
    case 'taper-end':
      return [
        { t: 0, width: 1 },
        { t: 1, width: 0 }
      ]
    case 'taper-both':
      return [
        { t: 0, width: 0 },
        { t: 0.5, width: 1 },
        { t: 1, width: 0 }
      ]
    case 'bulge':
      return [
        { t: 0, width: 0.4 },
        { t: 0.5, width: 1.6 },
        { t: 1, width: 0.4 }
      ]
    case 'pinch':
      return [
        { t: 0, width: 1.4 },
        { t: 0.5, width: 0.2 },
        { t: 1, width: 1.4 }
      ]
    default: {
      const exhaustive: never = profile
      return exhaustive
    }
  }
}

/** The width at `t`, eased between the width points around it, as the Width tool blends them. */
export function widthAt(points: readonly WidthPoint[], t: number): number {
  if (points.length === 0) return 1
  const sorted = points.toSorted((a, b) => a.t - b.t)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (t <= first.t) return first.width
  if (t >= last.t) return last.width
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i]
    if (t > b.t) continue
    const a = sorted[i - 1]
    const s = (t - a.t) / Math.max(b.t - a.t, 1e-9)
    // Smoothstep, so widths meet their points without a kink.
    const eased = s * s * (3 - 2 * s)
    return a.width + (b.width - a.width) * eased
  }
  return last.width
}
