import { type Node, parse } from 'acorn'

import type { FigmaAPI } from '#core/figma-api'
import { LawhaAPI } from '#core/lawha-api'

/**
 * Wrap eval code so the last bare expression is returned (REPL-style).
 *
 * Uses acorn to parse the code as a proper JS AST:
 * - Already starts with `return` -> used verbatim (inside async function body)
 * - Last statement is an ExpressionStatement -> replace it with `return (expr)`
 * - Otherwise -> wrap in async IIFE so side-effects still execute
 */
export function wrapEvalCode(code: string): string {
  const trimmed = code.trim()
  if (trimmed.startsWith('return')) return trimmed

  let body: Node[]
  try {
    body = parse(trimmed, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true
    }).body
  } catch {
    return `return (async () => { ${trimmed} })()`
  }

  if (body.length === 0) return trimmed

  const last = body[body.length - 1]
  if (last.type === 'ExpressionStatement') {
    const before = trimmed.slice(0, last.start)
    const expr = trimmed.slice(last.start, last.end).replace(/;$/, '')
    return `${before}return (${expr})`
  }

  return `return (async () => { ${trimmed} })()`
}

type AsyncFunctionConstructor = new (...args: string[]) => (...args: unknown[]) => Promise<unknown>

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/**
 * Compile a script for a document: it sees the `figma` global, the Figma Plugin API, and the
 * `lawha` global, what Lawha adds to it, both over the same document. `globals` adds names a
 * runner gives its scripts, such as a plugin's `__html__`, or hides host globals by naming
 * them with `undefined`.
 */
export function compileScript(
  code: string,
  globals: Readonly<Record<string, unknown>> = {}
): (figma: FigmaAPI) => Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async () => undefined)
    .constructor as AsyncFunctionConstructor
  const names = Object.keys(globals)
  for (const name of names)
    if (!IDENTIFIER.test(name) || name === 'figma' || name === 'lawha')
      throw new Error(`Invalid script global name: ${name}`)
  const run = new AsyncFunction('figma', 'lawha', ...names, wrapEvalCode(code))
  const values = names.map((name) => globals[name])
  return (figma) => run(figma, new LawhaAPI(figma), ...values)
}
