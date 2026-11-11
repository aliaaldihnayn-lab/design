import { describe, expect, test } from 'bun:test'

import { gradientToCSS } from '#dom-css/export/gradient'

import type { Fill } from '@lawha/scene-graph'

const stops = [
  { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
  { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
]

function gradient(
  type: Fill['type'],
  transform = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
): Fill {
  return {
    type,
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity: 1,
    visible: true,
    gradientStops: stops,
    gradientTransform: transform
  }
}

describe('gradients as CSS', () => {
  test('a left-to-right linear gradient runs at 90deg with its stops where its handles are', () => {
    expect(gradientToCSS(gradient('GRADIENT_LINEAR'), 200, 100)).toBe(
      'linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)'
    )
  })

  test('handles inside the box move the stops along the CSS gradient line', () => {
    // From x = 0.25 to x = 0.75 of the width.
    const fill = gradient('GRADIENT_LINEAR', { m00: 2, m01: 0, m02: -0.5, m10: 0, m11: 1, m12: 0 })
    expect(gradientToCSS(fill, 200, 100)).toBe(
      'linear-gradient(90deg, rgb(255, 0, 0) 25%, rgb(0, 0, 255) 75%)'
    )
  })

  test('radial and angular gradients keep their centre, radii and start angle', () => {
    expect(gradientToCSS(gradient('GRADIENT_RADIAL'), 200, 100)).toBe(
      'radial-gradient(50% 50% at 50% 50%, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)'
    )
    expect(gradientToCSS(gradient('GRADIENT_ANGULAR'), 200, 100)).toBe(
      'conic-gradient(from 90deg at 50% 50%, rgb(255, 0, 0) 0deg, rgb(0, 0, 255) 360deg)'
    )
  })

  test('the fill opacity multiplies into the stops, and hidden fills draw nothing', () => {
    expect(gradientToCSS({ ...gradient('GRADIENT_LINEAR'), opacity: 0.5 }, 10, 10)).toContain(
      'rgba(255, 0, 0, 0.5) 0%'
    )
    expect(
      gradientToCSS({ ...gradient('GRADIENT_LINEAR'), visible: false }, 10, 10)
    ).toBeUndefined()
  })
})
