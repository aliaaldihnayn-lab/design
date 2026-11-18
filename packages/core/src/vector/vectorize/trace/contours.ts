import type { Vector } from '@lawha/scene-graph/primitives'

/** A closed outline on the pixel grid, as its corners in order. */
export type Loop = Vector[]

/**
 * The outlines of the pixels `inside` marks, following pixel edges: outer edges run clockwise
 * and holes the other way, so filled even-odd they cover the marked pixels exactly. Pixels that
 * touch only at a corner are kept apart.
 */
export function traceMask(inside: Uint8Array, width: number, height: number): Loop[] {
  const stride = width + 1
  const from: number[] = []
  const to: number[] = []
  const dx: number[] = []
  const dy: number[] = []
  const outgoing = new Map<number, number[]>()
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const id = from.length
    from.push(y0 * stride + x0)
    to.push(y1 * stride + x1)
    dx.push(x1 - x0)
    dy.push(y1 - y0)
    const key = y0 * stride + x0
    const list = outgoing.get(key)
    if (list) list.push(id)
    else outgoing.set(key, [id])
  }
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && inside[y * width + x] === 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue
      // Each edge keeps the pixel on its right, in screen coordinates.
      if (!at(x, y - 1)) addEdge(x, y, x + 1, y)
      if (!at(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1)
      if (!at(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1)
      if (!at(x - 1, y)) addEdge(x, y + 1, x, y)
    }
  }
  const used = new Uint8Array(from.length)
  const loops: Loop[] = []
  for (let start = 0; start < from.length; start++) {
    if (used[start]) continue
    const loop: Loop = []
    let edge = start
    while (!used[edge]) {
      used[edge] = 1
      const vertex = from[edge]
      loop.push({ x: vertex % stride, y: Math.floor(vertex / stride) })
      const choices = (outgoing.get(to[edge]) ?? []).filter((id) => !used[id] || id === start)
      if (choices.length === 0) break
      // At a pinch, turn towards the pixel, so pixels meeting at a corner stay apart.
      const [ex, ey] = [dx[edge], dy[edge]]
      const right = choices.find((id) => dx[id] === -ey && dy[id] === ex)
      const straight = choices.find((id) => dx[id] === ex && dy[id] === ey)
      edge = right ?? straight ?? choices[0]
    }
    if (loop.length >= 4) loops.push(loop)
  }
  return loops
}

/** Twice a loop's signed area; positive for clockwise loops in screen coordinates. */
export function loopArea(loop: Loop): number {
  let twice = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    twice += a.x * b.y - b.x * a.y
  }
  return twice / 2
}
