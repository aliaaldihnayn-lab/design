import * as v from 'valibot'

import { MAX_BLEND_STEPS } from '@lawha/scene-graph/path-effects'

import {
  enclosingLiveBlend,
  expandLiveBlend,
  makeLiveBlend,
  regenerateBlend,
  releaseLiveBlend,
  replaceBlendSpine
} from '#core/editor/structure/blend'
import type { FigmaAPI } from '#core/figma-api'
import { measuringRenderer } from '#core/figma-api/measure'
import { defineTool } from '#core/tools/schema'

const NO_RENDERER = 'Blends need path geometry, which this host cannot measure'

const stepsSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_BLEND_STEPS))
const spacingSchema = v.picklist(['steps', 'distance'])
const distanceSchema = v.pipe(
  v.number(),
  v.minValue(1),
  v.maxValue(10_000),
  v.description('Pixels between steps, for distance spacing')
)

function blendAt(figma: FigmaAPI, id: string) {
  const node = figma.graph.getNode(id)
  if (!node) return { error: `Node ${id} not found` }
  const found = enclosingLiveBlend(figma.graph, node)
  if (!found) return { error: `${node.name} is not a live blend` }
  return found
}

export const blendShapes = defineTool({
  name: 'blend_shapes',
  description:
    'Illustrator\'s Blend (Object → Blend → Make): shapes between two sibling layers, their outlines, solid fill colours, opacity, and stroke weight eased from the first to the second, grouped with both as "Blend". The blend stays live: edit_blend changes its steps, spacing, and spine; release_blend and expand_blend end it. Spacing is a number of steps, or a distance in pixels between them; spine_id makes a path the line the steps follow.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    from_id: v.string(),
    to_id: v.string(),
    steps: v.optional(stepsSchema, 5),
    spacing: v.optional(spacingSchema, 'steps'),
    distance: v.optional(distanceSchema, 20),
    spine_id: v.optional(v.string())
  }),
  execute: (figma, { from_id, to_id, steps, spacing, distance, spine_id }) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const from = figma.graph.getNode(from_id)
    const to = figma.graph.getNode(to_id)
    if (!from) return { error: `Node ${from_id} not found` }
    if (!to) return { error: `Node ${to_id} not found` }
    if (from.parentId !== to.parentId) return { error: 'Blended layers must share one parent' }
    const spine = spine_id ? figma.graph.getNode(spine_id) : undefined
    if (spine_id && !spine) return { error: `Node ${spine_id} not found` }
    const fit = figma.groupFitOptions
    const made = makeLiveBlend(renderer, figma.graph, from, to, { spacing, steps, distance }, fit)
    if (!made) return { error: 'These layers cannot be blended' }
    let stepIds = made.stepIds
    if (spine) {
      const found = enclosingLiveBlend(figma.graph, made.group)
      const replaced =
        found && replaceBlendSpine(renderer, figma.graph, found.group, found.blend, spine, fit)
      if (!replaced) return { error: `${spine.name} cannot be a blend's spine` }
      stepIds = replaced
    }
    return { id: made.group.id, steps: stepIds }
  }
})

export const editBlend = defineTool({
  name: 'edit_blend',
  description:
    "Change a live blend (the group blend_shapes made, or a layer in it), as Illustrator's Blend Options and Replace Spine: steps, spacing ('steps' or 'distance'), distance in pixels, and spine_id, a path that becomes the line the steps follow (its ends move to the path's start and end). The steps are made again between the ends as they are now, so this also refreshes a blend whose ends moved.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: v.string(),
    steps: v.optional(stepsSchema),
    spacing: v.optional(spacingSchema),
    distance: v.optional(distanceSchema),
    spine_id: v.optional(v.string())
  }),
  execute: (figma, args) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const found = blendAt(figma, args.id)
    if ('error' in found) return found
    const blend = {
      ...found.blend,
      steps: args.steps ?? found.blend.steps,
      spacing: args.spacing ?? found.blend.spacing,
      distance: args.distance ?? found.blend.distance
    }
    const fit = figma.groupFitOptions
    let stepIds: string[] | null
    if (args.spine_id) {
      const spine = figma.graph.getNode(args.spine_id)
      if (!spine) return { error: `Node ${args.spine_id} not found` }
      stepIds = replaceBlendSpine(renderer, figma.graph, found.group, blend, spine, fit)
      if (!stepIds) return { error: `${spine.name} cannot be a blend's spine` }
    } else {
      stepIds = regenerateBlend(renderer, figma.graph, found.group, blend, fit)
    }
    if (!stepIds) return { error: 'This blend can no longer be made' }
    return { id: found.group.id, steps: stepIds }
  }
})

export const releaseBlend = defineTool({
  name: 'release_blend',
  description:
    "Release a live blend (Illustrator's Blend → Release): its steps are removed, and its ends and spine (drawn again) leave the group.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({ id: v.string() }),
  execute: (figma, { id }) => {
    const found = blendAt(figma, id)
    if ('error' in found) return found
    const left = releaseLiveBlend(figma.graph, found.group, found.blend)
    if (!left) return { error: 'This blend cannot be released' }
    return { released: left }
  }
})

export const expandBlend = defineTool({
  name: 'expand_blend',
  description:
    "Expand a live blend (Illustrator's Blend → Expand): its steps stay as ordinary vectors in the group, its spine is removed, and it is no longer live.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({ id: v.string() }),
  execute: (figma, { id }) => {
    const found = blendAt(figma, id)
    if ('error' in found) return found
    expandLiveBlend(figma.graph, found.group, found.blend)
    return { id: found.group.id }
  }
})
