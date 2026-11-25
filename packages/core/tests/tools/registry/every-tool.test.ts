import { describe, expect, test } from 'bun:test'

// eslint-disable-next-line lawha/no-mixed-case-acronym-identifiers -- Upstream export spelling.
import { toJsonSchema as toJSONSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { FigmaAPI } from '@lawha/core/figma-api'
import { ALL_TOOLS, type ToolDef } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'

/**
 * Every registered tool, called as an agent calls it: with arguments its schema takes, with
 * arguments naming layers that do not exist, and with arguments it does not take. A tool answers
 * with a result or an error that says what went wrong, never a crash from inside it.
 */

const jsonSchemaSchema = v.looseObject({
  type: v.optional(v.union([v.string(), v.array(v.string())])),
  properties: v.optional(v.record(v.string(), v.unknown())),
  required: v.optional(v.array(v.string())),
  items: v.optional(v.unknown()),
  anyOf: v.optional(v.array(v.unknown())),
  oneOf: v.optional(v.array(v.unknown())),
  enum: v.optional(v.array(v.unknown())),
  const: v.optional(v.unknown()),
  minimum: v.optional(v.number()),
  maximum: v.optional(v.number()),
  minLength: v.optional(v.number()),
  minItems: v.optional(v.number())
})
type JSONSchema = v.InferOutput<typeof jsonSchemaSchema>

function inputSchema(tool: ToolDef): JSONSchema {
  return v.parse(
    jsonSchemaSchema,
    toJSONSchema(tool.input, { typeMode: 'input', errorMode: 'throw' })
  )
}

/** Errors that mean the tool broke, rather than refused the call with a reason. */
const CRASHES = [TypeError, ReferenceError, RangeError, SyntaxError]

const NODE_KEY = /(^|_)ids?$|node|parent|target|^from|^to$|source|frame|component|instance|layer/i

function stringFor(schema: JSONSchema, key: string, layerId: string): string {
  if (key === 'jsx')
    return '<Frame name="Card" w={120} h={60} bg="#FFFFFF"><Text>مرحبا</Text></Frame>'
  if (key === 'code') return 'return figma.currentPage.children.length'
  if (NODE_KEY.test(key)) return layerId
  if (/colou?r|fill|stroke/i.test(key)) return '#2563EB'
  return 'x'.repeat(Math.max(1, schema.minLength ?? 1))
}

/** The smallest arguments `schema` takes, with every layer reference set to `layerId`. */
function argumentsFor(schema: JSONSchema, key: string, layerId: string): unknown {
  const variant = schema.anyOf ?? schema.oneOf
  if (variant) return argumentsFor(v.parse(jsonSchemaSchema, variant[0]), key, layerId)
  if (schema.const !== undefined) return schema.const
  if (schema.enum) return schema.enum[0]
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  switch (type) {
    case 'string':
      return stringFor(schema, key, layerId)
    case 'number':
    case 'integer':
      return Math.min(Math.max(schema.minimum ?? 1, 1), schema.maximum ?? 1)
    case 'boolean':
      return false
    case 'array': {
      const item = v.parse(jsonSchemaSchema, schema.items ?? {})
      const count = Math.max(1, schema.minItems ?? 1)
      return Array.from({ length: count }, () => argumentsFor(item, key, layerId))
    }
    case 'object': {
      const properties = schema.properties ?? {}
      return Object.fromEntries(
        (schema.required ?? []).map((name) => [
          name,
          argumentsFor(v.parse(jsonSchemaSchema, properties[name]), name, layerId)
        ])
      )
    }
    default:
      return null
  }
}

function documentWithLayers() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const frame = figma.createFrame()
  frame.resize(200, 200)
  const rect = figma.createRectangle()
  frame.appendChild(rect)
  return { figma, rectId: rect.id }
}

/** Runs a call as the executors do, fonts first, and returns what it threw, if anything. */
async function thrownBy(tool: ToolDef, figma: FigmaAPI, args: Record<string, unknown>) {
  try {
    await tool.loadFonts(figma, args)
    const result = await tool.execute(figma, args)
    // Results go to agents as JSON.
    JSON.stringify(result)
    return null
  } catch (error) {
    return error
  }
}

function describeCrash(name: string, error: unknown): string | null {
  if (!CRASHES.some((type) => error instanceof type)) return null
  return `${name}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
}

describe.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))('%s', (name, tool) => {
  test('lists with an object JSON Schema for its arguments', () => {
    expect(inputSchema(tool).type).toBe('object')
  })

  test('refuses an argument it does not take, naming itself', async () => {
    const { figma } = documentWithLayers()
    const error = await thrownBy(tool, figma, { not_an_argument: 1 })
    expect(error instanceof Error ? error.message : error).toStartWith(
      `Invalid arguments for ${name}`
    )
  })

  test('answers arguments its schema takes without crashing', async () => {
    const { figma, rectId } = documentWithLayers()
    const args = argumentsFor(inputSchema(tool), '', rectId)
    const error = await thrownBy(tool, figma, v.parse(v.record(v.string(), v.unknown()), args))
    expect(describeCrash(name, error)).toBeNull()
  })

  test('answers a layer that does not exist without crashing', async () => {
    const { figma } = documentWithLayers()
    const args = argumentsFor(inputSchema(tool), '', '999999:404')
    const error = await thrownBy(tool, figma, v.parse(v.record(v.string(), v.unknown()), args))
    expect(describeCrash(name, error)).toBeNull()
  })
})
