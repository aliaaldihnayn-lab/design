import * as v from 'valibot'

import type { GUID } from '@lawha/kiwi/fig'
import type { SceneGraph } from '@lawha/scene-graph'

import type { Action } from '#core/prototype/model'
import type { Condition, PlayValue } from '#core/prototype/variables'

/**
 * Prototype variables in Figma's own form, as a `.fig` record keeps them: Set variable is a
 * `SET_VARIABLE` action with the variable and the value it takes, a toggle the variable
 * negated, and an add the variable plus a number; a conditional is a `CONDITIONAL` action whose
 * blocks each hold a condition, an expression over the variables, and the actions it runs, the
 * last without a condition for the otherwise branch.
 */

type SetVariable = Extract<Action, { type: 'set-variable' }>
type Conditional = Extract<Action, { type: 'conditional' }>

/** What a variable resolves to, as `VariableData.resolvedDataType` names it. */
type Resolved = 'BOOLEAN' | 'FLOAT' | 'STRING'

/** A `VariableData` record: a literal, an alias of a variable, or an expression. */
export interface FigVariableData {
  value: Record<string, unknown>
  dataType: string
  resolvedDataType: Resolved
}

/** Looks up variables both ways: a variable's GUID in the written file, and back. */
export interface FigVariableIds {
  guidOf: (variableId: string) => GUID | undefined
  variableOf: (guid: GUID) => string | undefined
}

function resolvedOf(graph: SceneGraph, variableId: string): Resolved | undefined {
  const type = graph.variables.get(variableId)?.type
  return type === 'BOOLEAN' || type === 'FLOAT' || type === 'STRING' ? type : undefined
}

function literal(value: PlayValue): FigVariableData {
  if (typeof value === 'boolean')
    return { value: { boolValue: value }, dataType: 'BOOLEAN', resolvedDataType: 'BOOLEAN' }
  if (typeof value === 'number')
    return { value: { floatValue: value }, dataType: 'FLOAT', resolvedDataType: 'FLOAT' }
  return { value: { textValue: value }, dataType: 'STRING', resolvedDataType: 'STRING' }
}

function alias(guid: GUID, resolved: Resolved): FigVariableData {
  return { value: { alias: { guid } }, dataType: 'ALIAS', resolvedDataType: resolved }
}

function expression(
  fn: string,
  args: FigVariableData[],
  resolved: Resolved = 'BOOLEAN'
): FigVariableData {
  return {
    value: { expressionValue: { expressionFunction: fn, expressionArguments: args } },
    dataType: 'EXPRESSION',
    resolvedDataType: resolved
  }
}

/** The `SET_VARIABLE` action for a Set variable, or null for a variable Figma cannot hold. */
export function setVariableToFig(
  graph: SceneGraph,
  action: SetVariable,
  ids: FigVariableIds
): object | null {
  const guid = ids.guidOf(action.variable)
  const resolved = resolvedOf(graph, action.variable)
  if (!guid || !resolved) return null
  let data: FigVariableData
  if (action.toggle) data = expression('NOT', [alias(guid, resolved)])
  else if (action.add !== undefined)
    data = expression('ADDITION', [alias(guid, resolved), literal(action.add)], 'FLOAT')
  else if (action.value !== undefined) data = literal(action.value)
  else return null
  return {
    connectionType: 'SET_VARIABLE',
    targetVariable: { id: { guid } },
    targetVariableData: data
  }
}

const COMPARISONS: Partial<Record<Condition['op'], string>> = {
  eq: 'EQUALS',
  neq: 'NOT_EQUAL',
  gt: 'GREATER_THAN',
  gte: 'GREATER_THAN_OR_EQUAL',
  lt: 'LESS_THAN',
  lte: 'LESS_THAN_OR_EQUAL'
}
const OPERATORS = new Map(Object.entries(COMPARISONS).map(([op, fn]) => [fn, op]))

function conditionToFig(
  graph: SceneGraph,
  condition: Condition,
  ids: FigVariableIds
): FigVariableData | null {
  const guid = ids.guidOf(condition.variable)
  const resolved = resolvedOf(graph, condition.variable)
  if (!guid || !resolved) return null
  const variable = alias(guid, resolved)
  if (condition.op === 'truthy') return expression('IS_TRUTHY', [variable])
  if (condition.op === 'falsy') return expression('NOT', [expression('IS_TRUTHY', [variable])])
  const fn = COMPARISONS[condition.op]
  if (!fn || condition.value === undefined) return null
  return expression(fn, [variable, literal(condition.value)])
}

/**
 * The `CONDITIONAL` action for a conditional, every condition joined with AND, or null when a
 * condition has no Figma form. `branch` writes a branch's actions, dropping those Figma lacks.
 */
export function conditionalToFig(
  graph: SceneGraph,
  action: Conditional,
  ids: FigVariableIds,
  branch: (actions: readonly Action[]) => object[]
): object | null {
  const conditions = action.when.map((condition) => conditionToFig(graph, condition, ids))
  if (conditions.some((condition) => condition === null)) return null
  const [first, ...rest] = conditions.filter((condition) => condition !== null)
  const condition = rest.reduce((all, next) => expression('AND', [all, next]), first)
  const blocks: object[] = [{ condition, actions: branch(action.actions) }]
  if (action.otherwise) blocks.push({ actions: branch(action.otherwise) })
  return { connectionType: 'CONDITIONAL', conditionalActions: blocks }
}

const guidSchema = v.object({ sessionID: v.number(), localID: v.number() })

type FigData = {
  dataType?: string
  value?: {
    boolValue?: boolean
    textValue?: string
    floatValue?: number
    alias?: { guid?: GUID }
    expressionValue?: { expressionFunction?: string; expressionArguments?: FigData[] }
  }
}

const figDataSchema: v.GenericSchema<FigData> = v.looseObject({
  dataType: v.optional(v.string()),
  value: v.optional(
    v.looseObject({
      boolValue: v.optional(v.boolean()),
      textValue: v.optional(v.string()),
      floatValue: v.optional(v.number()),
      alias: v.optional(v.looseObject({ guid: v.optional(guidSchema) })),
      expressionValue: v.optional(
        v.looseObject({
          expressionFunction: v.optional(v.string()),
          expressionArguments: v.optional(v.array(v.lazy(() => figDataSchema)))
        })
      )
    })
  )
})

function literalFromFig(data: FigData | undefined): PlayValue | undefined {
  const value = data?.value
  if (!value) return undefined
  if (data.dataType === 'BOOLEAN') return value.boolValue ?? false
  if (data.dataType === 'FLOAT') return value.floatValue ?? 0
  if (data.dataType === 'STRING') return value.textValue ?? ''
  return undefined
}

function aliasFromFig(data: FigData | undefined, ids: FigVariableIds): string | undefined {
  const guid = data?.dataType === 'ALIAS' ? data.value?.alias?.guid : undefined
  return guid ? ids.variableOf(guid) : undefined
}

function call(data: FigData | undefined): { fn: string; args: FigData[] } | undefined {
  const expressionValue = data?.dataType === 'EXPRESSION' ? data.value?.expressionValue : undefined
  if (!expressionValue?.expressionFunction) return undefined
  return { fn: expressionValue.expressionFunction, args: expressionValue.expressionArguments ?? [] }
}

/** A Set variable read from a `SET_VARIABLE` action, or null when Lawha cannot run it. */
export function setVariableFromFig(raw: unknown, ids: FigVariableIds): SetVariable | null {
  const parsed = v.safeParse(
    v.looseObject({
      targetVariable: v.optional(
        v.looseObject({ id: v.optional(v.looseObject({ guid: v.optional(guidSchema) })) })
      ),
      targetVariableID: v.optional(guidSchema),
      targetVariableData: v.optional(figDataSchema)
    }),
    raw
  )
  if (!parsed.success) return null
  const guid = parsed.output.targetVariable?.id?.guid ?? parsed.output.targetVariableID
  const variable = guid ? ids.variableOf(guid) : undefined
  const data = parsed.output.targetVariableData
  if (!variable || !data) return null
  const value = literalFromFig(data)
  if (value !== undefined) return { type: 'set-variable', variable, value }
  const expr = call(data)
  if (expr?.fn === 'NOT' && aliasFromFig(expr.args[0], ids) === variable)
    return { type: 'set-variable', variable, toggle: true }
  const added = expr?.fn === 'ADDITION' ? literalFromFig(expr.args[1]) : undefined
  if (typeof added === 'number' && aliasFromFig(expr?.args[0], ids) === variable)
    return { type: 'set-variable', variable, add: added }
  return null
}

function conditionsFromFig(data: FigData | undefined, ids: FigVariableIds): Condition[] | null {
  const expr = call(data)
  if (!expr) {
    const variable = aliasFromFig(data, ids)
    return variable ? [{ variable, op: 'truthy' }] : null
  }
  if (expr.fn === 'AND') {
    const parts = expr.args.map((arg) => conditionsFromFig(arg, ids))
    return parts.some((part) => part === null) ? null : parts.flatMap((part) => part ?? [])
  }
  if (expr.fn === 'IS_TRUTHY') {
    const variable = aliasFromFig(expr.args[0], ids)
    return variable ? [{ variable, op: 'truthy' }] : null
  }
  if (expr.fn === 'NOT') {
    const inner = call(expr.args[0])
    const variable = aliasFromFig(inner?.fn === 'IS_TRUTHY' ? inner.args[0] : expr.args[0], ids)
    return variable ? [{ variable, op: 'falsy' }] : null
  }
  const op = OPERATORS.get(expr.fn)
  const variable = aliasFromFig(expr.args[0], ids)
  const value = literalFromFig(expr.args[1])
  if (!op || !variable || value === undefined) return null
  return [{ variable, op: v.parse(v.picklist(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']), op), value }]
}

/**
 * A conditional read from a `CONDITIONAL` action: its first block's condition and actions, and
 * the block without a condition as the otherwise branch. `branch` reads a block's actions.
 */
export function conditionalFromFig(
  raw: unknown,
  ids: FigVariableIds,
  branch: (actions: unknown) => Action[]
): Conditional | null {
  const parsed = v.safeParse(
    v.looseObject({
      conditionalActions: v.optional(
        v.array(
          v.looseObject({
            condition: v.optional(figDataSchema),
            actions: v.optional(v.array(v.unknown()))
          })
        )
      )
    }),
    raw
  )
  const blocks = parsed.success ? (parsed.output.conditionalActions ?? []) : []
  const first = blocks.at(0)
  const rest = blocks.slice(1)
  const when = first?.condition ? conditionsFromFig(first.condition, ids) : null
  if (!first || !when || when.length === 0 || when.length > 10) return null
  // Lawha's conditional has one branch for its condition and one otherwise.
  if (rest.length > 1 || rest.some((block) => block.condition)) return null
  const simple = (actions: unknown) =>
    branch(actions).filter((action) => action.type !== 'conditional')
  const otherwise = rest[0] ? simple(rest[0].actions ?? []) : undefined
  return {
    type: 'conditional',
    when,
    actions: simple(first.actions ?? []),
    ...(otherwise ? { otherwise } : {})
  }
}
