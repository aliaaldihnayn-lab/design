import type { WriterNode } from '#core/writer/model'

/**
 * A value as the comparison of what was read and what is saved sees it: object keys sorted,
 * absent values (`null`, `undefined`, empty attribute objects and lists) dropped, and marks in
 * type order, so the editor's defaults and mark ordering do not count as edits. The editor's
 * `dir: 'auto'` on every node is no direction, as Word has none, and a link is only its target:
 * the editor's `rel` and `target` are not written to Word.
 */
const compare = (a: string, b: string) => Number(a > b) - Number(a < b)

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean)
  if (value === null || typeof value !== 'object') return value
  const linkAttrs =
    'type' in value && value.type === 'link' && 'attrs' in value && isRecord(value.attrs)
      ? { href: value.attrs.href }
      : null
  const entries = Object.entries(linkAttrs ? { ...value, attrs: linkAttrs } : value)
    .map(([key, entry]) => [key, clean(entry)] as const)
    .filter(([key, entry]) => {
      if (entry === null || entry === undefined) return false
      if (key === 'dir' && entry === 'auto') return false
      if (Array.isArray(entry)) return entry.length > 0
      if (typeof entry === 'object') return Object.keys(entry).length > 0
      return true
    })
    .sort(([a], [b]) => compare(a, b))
  const out: Record<string, unknown> = Object.fromEntries(entries)
  if (Array.isArray(out.marks)) {
    out.marks = [...out.marks].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)))
  }
  return out
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function canonical(value: unknown): string {
  return JSON.stringify(clean(value) ?? null)
}

export const sameNode = (a: WriterNode | null | undefined, b: WriterNode | null | undefined) =>
  canonical(a) === canonical(b)

/**
 * Pairs of indices of the longest common subsequence of two key lists, in order: which read
 * blocks the saved document still holds unchanged.
 */
export function commonSubsequence(
  a: readonly string[],
  b: readonly string[]
): Array<[number, number]> {
  const rows = a.length + 1
  const columns = b.length + 1
  const lengths = new Uint32Array(rows * columns)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i * columns + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * columns + j + 1] + 1
          : Math.max(lengths[(i + 1) * columns + j], lengths[i * columns + j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i += 1
      j += 1
    } else if (lengths[(i + 1) * columns + j] >= lengths[i * columns + j + 1]) i += 1
    else j += 1
  }
  return pairs
}
