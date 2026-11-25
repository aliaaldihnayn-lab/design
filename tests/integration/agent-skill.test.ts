import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { uniq } from 'es-toolkit'
import * as v from 'valibot'

import { COMMANDS } from '@lawha/cli/commands'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'
import { isArrowCap } from '@lawha/scene-graph/arrow-caps'
import { isShapeWithTextType } from '@lawha/scene-graph/shape-with-text'

import { startServer, type ServerHandle } from '#mcp/server'

import { connectMockBrowser, type MockBrowser } from '#tests/helpers/mcp/server'
import { repoPath } from '#tests/helpers/paths'

/**
 * The installable skill tells agents which tools, arguments, and commands exist. This checks it
 * against what a connected MCP server lists and what the CLI registers, so a renamed tool or
 * argument fails here instead of misleading every agent that reads the skill.
 */

const SKILL = readFileSync(repoPath('skills/lawha/SKILL.md'), 'utf8')
const AUTHORING = readFileSync(repoPath('skills/lawha/references/design-authoring.md'), 'utf8')

const AUTH_TOKEN = 'skill-test-token'

let handle: ServerHandle
let browser: MockBrowser
let client: Client
/** Every tool the server lists, by name, with its argument schema. */
const listed = new Map<string, unknown>()

beforeAll(async () => {
  handle = await startServer({
    httpPort: 0,
    withTcp: true,
    socketPath: null,
    authToken: AUTH_TOKEN,
    disabledTools: [],
    scope: 'document',
    enableEval: true,
    // A root registers the filesystem tools the skill describes.
    mcpRoot: tmpdir()
  })
  const port = handle.httpPort
  if (!port) throw new Error('TCP listener not started')
  browser = await connectMockBrowser(port, new SceneGraph(), AUTH_TOKEN)
  client = new Client({ name: 'skill-test', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
    })
  )
  for (const tool of (await client.listTools()).tools) listed.set(tool.name, tool.inputSchema)
})

afterAll(async () => {
  await client.close()
  browser.close()
  await handle.close()
})

/** Every property name and string value a schema mentions, at any depth. */
function schemaWords(schema: unknown, words = new Set<string>()): Set<string> {
  if (typeof schema === 'string') words.add(schema)
  else if (Array.isArray(schema)) for (const item of schema) schemaWords(item, words)
  else if (schema && typeof schema === 'object') {
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'properties' && value && typeof value === 'object') {
        for (const name of Object.keys(value)) words.add(name)
      }
      if (key !== 'description') schemaWords(value, words)
    }
  }
  return words
}

/** snake_case names written as code: tools, their arguments, or the values they take. */
function codeNames(markdown: string): string[] {
  return uniq([...markdown.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]))
}

/** Calls written as `tool_name { …JSON… }`, on one line or across several. */
function inlineCalls(markdown: string): Array<{ name: string; args: string }> {
  const calls: Array<{ name: string; args: string }> = []
  for (const match of markdown.matchAll(/^([a-z]+(?:_[a-z]+)+) (\{[\s\S]*?\})\s*$/gm)) {
    calls.push({ name: match[1], args: match[2] })
  }
  return calls
}

describe('agent skill', () => {
  test('names only tools, arguments, and values the MCP server lists', () => {
    const known = new Set(listed.keys())
    for (const schema of listed.values()) for (const word of schemaWords(schema)) known.add(word)
    expect(codeNames(SKILL).filter((name) => !known.has(name))).toEqual([])
    // The authoring reference also names FigJam shape kinds and connector caps, in lowercase.
    const figJam = (name: string) =>
      isShapeWithTextType(name.toUpperCase()) || isArrowCap(name.toUpperCase())
    expect(codeNames(AUTHORING).filter((name) => !known.has(name) && !figJam(name))).toEqual([])
  })

  test('calls every tool it shows with arguments the tool takes', () => {
    const calls = inlineCalls(SKILL)
    expect(calls.length).toBeGreaterThan(0)
    for (const { name, args } of calls) {
      expect(listed.has(name)).toBe(true)
      const tool = ALL_TOOLS.find((candidate) => candidate.name === name)
      if (!tool) continue
      const parsed = v.safeParse(v.pipe(v.string(), v.parseJson(), tool.input), args)
      expect(parsed.issues ? `${name}: ${v.summarize(parsed.issues)}` : null).toBeNull()
    }
  })

  test('shows `lawha tool call` examples with valid arguments', () => {
    const examples = [...SKILL.matchAll(/lawha tool call (\S+).*--args '([^']*)'/g)]
    expect(examples.length).toBeGreaterThan(0)
    for (const [, name, args] of examples) {
      const tool = ALL_TOOLS.find((candidate) => candidate.name === name)
      expect(tool?.name).toBe(name)
      if (!tool) continue
      const parsed = v.safeParse(v.pipe(v.string(), v.parseJson(), tool.input), args)
      expect(parsed.issues ? `${name}: ${v.summarize(parsed.issues)}` : null).toBeNull()
    }
  })

  test('lists exactly the commands the CLI has', () => {
    const section = SKILL.slice(SKILL.indexOf('Common commands:'), SKILL.indexOf('### Inspect'))
    const documented = [...section.matchAll(/^- `([a-z]+)`(?: \/ `([a-z]+)`)?/gm)].flatMap(
      ([, first, second]) => (second ? [first, second] : [first])
    )
    expect(documented.toSorted()).toEqual(Object.keys(COMMANDS).toSorted())
  })
})
