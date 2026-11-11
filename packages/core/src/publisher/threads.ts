import { isEqual } from 'es-toolkit'

import type { SceneGraph, SceneNode, StyleRun } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData, withPluginData } from '@lawha/scene-graph/plugin-data'

/** One frame's share of a story: its text, the white space dropped before it, and where it starts. */
export interface FlowedFrame {
  text: string
  lead: string
  /** Where the frame's text starts in the story. */
  start: number
}

/** A story's whole text with its character styles, as runs over the story's characters. */
export interface Story {
  text: string
  runs: StyleRun[]
}

/** The parts of `runs` that fall in `[start, end)`, moved to start at 0. */
export function sliceRuns(runs: readonly StyleRun[], start: number, end: number): StyleRun[] {
  const out: StyleRun[] = []
  for (const run of runs) {
    const from = Math.max(start, run.start)
    const to = Math.min(end, run.start + run.length)
    if (to > from) out.push({ start: from - start, length: to - from, style: run.style })
  }
  return out
}

/** The places a story may break into the next frame: after each run of white space. */
function breakPoints(story: string): number[] {
  const points: number[] = []
  for (let i = 1; i < story.length; i++) {
    if (/\s/.test(story[i - 1]) && !/\s/.test(story[i])) points.push(i)
  }
  points.push(story.length)
  return points
}

/** The last of `candidates` (sorted, fitting monotonically) for which `fits` holds, or -1. */
function lastFitting(candidates: readonly number[], fits: (index: number) => boolean): number {
  let low = 0
  let high = candidates.length - 1
  let best = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (fits(candidates[mid])) {
      best = mid
      low = mid + 1
    } else high = mid - 1
  }
  return best
}

/** How much of `text` a frame takes: whole words while any fit, else as many characters. */
function fittingEnd(text: string, fits: (shown: string) => boolean): number {
  const take = (end: number) => fits(text.slice(0, end).trimEnd())
  const words = breakPoints(text)
  const end = words[lastFitting(words, take)] ?? 0
  if (end > 0 || text.length === 0) return end
  const characters = Array.from({ length: text.length }, (_, i) => i + 1)
  return characters[lastFitting(characters, take)] ?? 0
}

/**
 * Pours `story` through `count` frames, as Affinity Publisher flows text between linked frames:
 * each frame but the last takes as many whole words as `fits` says it holds, breaking a word only
 * when not even one fits, and the last takes the rest, overflowing if it must. White space at a
 * break is kept as the next frame's `lead`, so the frames put back together give the story.
 */
export function flowText(
  story: string,
  count: number,
  fits: (frame: number, text: string, start: number) => boolean
): FlowedFrame[] {
  const frames: FlowedFrame[] = []
  let rest = story
  let lead = ''
  let start = 0
  for (let frame = 0; frame < count; frame++) {
    if (frame === count - 1) {
      frames.push({ text: rest, lead, start })
      break
    }
    const at = start
    const end = fittingEnd(rest, (text) => fits(frame, text, at))
    const text = rest.slice(0, end).trimEnd()
    const after = rest.slice(text.length)
    const space = /^\s*/.exec(after)?.[0] ?? ''
    frames.push({ text, lead, start })
    lead = space
    rest = after.slice(space.length)
    start += text.length + space.length
  }
  return frames
}

/** The frames of a story, in the order its text runs through them. */
export function threadFrames(graph: SceneGraph, story: string): SceneNode[] {
  const frames: Array<{ node: SceneNode; order: number }> = []
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'TEXT') continue
    const thread = readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.textThread)
    if (thread?.story === story) frames.push({ node, order: thread.order })
  }
  return frames.toSorted((a, b) => a.order - b.order).map(({ node }) => node)
}

export function threadOf(node: SceneNode) {
  return node.type === 'TEXT'
    ? readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.textThread)
    : undefined
}

/**
 * The story's whole text, read back from its frames, with each frame's character styles moved to
 * where its text sits in the story. The white space between frames takes no style of its own.
 */
export function composeStory(frames: readonly SceneNode[]): Story {
  let text = ''
  const runs: StyleRun[] = []
  frames.forEach((frame, index) => {
    if (index > 0) text += threadOf(frame)?.lead ?? ''
    const offset = text.length
    for (const run of sliceRuns(frame.styleRuns, 0, frame.text.length)) {
      runs.push({ ...run, start: run.start + offset })
    }
    text += frame.text
  })
  return { text, runs }
}

/** Whether a frame can hold `text` styled by `runs`, as a story's frames are measured. */
export type FrameFits = (frame: SceneNode, text: string, runs: StyleRun[]) => boolean

/**
 * Pours the story through its frames again, writing only frames whose text, styles, or lead
 * changed. Character styles travel with their characters from frame to frame, over each frame's
 * own base style, so bold, italic, colour, and size changes survive the flow. Returns the
 * frames written.
 */
export function reflowThread(graph: SceneGraph, story: string, fits: FrameFits): string[] {
  const frames = threadFrames(graph, story)
  if (frames.length === 0) return []
  const whole = composeStory(frames)
  const flowed = flowText(whole.text, frames.length, (index, text, start) =>
    fits(frames[index], text, sliceRuns(whole.runs, start, start + text.length))
  )
  const written: string[] = []
  frames.forEach((frame, order) => {
    const { text, lead, start } = flowed[order]
    const runs = sliceRuns(whole.runs, start, start + text.length)
    const thread = threadOf(frame)
    if (
      frame.text === text &&
      isEqual(sliceRuns(frame.styleRuns, 0, frame.text.length), runs) &&
      thread?.lead === lead &&
      thread.order === order
    )
      return
    graph.updateNode(frame.id, {
      text,
      styleRuns: runs,
      pluginData: withPluginData(frame.pluginData, LAWHA_PLUGIN_DATA.textThread, {
        story,
        order,
        lead
      })
    })
    written.push(frame.id)
  })
  return written
}

/**
 * Adds `next` to the end of `first`'s story, starting a story at `first` when it has none, so
 * text that overflows the last frame runs on into `next`. Both become fixed-size frames, which
 * a story needs to know where each frame ends. Returns the story.
 */
export function linkTextFrames(graph: SceneGraph, first: SceneNode, next: SceneNode): string {
  if (first.type !== 'TEXT' || next.type !== 'TEXT') throw new Error('Only text frames link')
  if (first.id === next.id) throw new Error('A frame cannot follow itself')
  const story = threadOf(first)?.story ?? first.id
  const current = threadOf(next)
  if (current?.story === story) throw new Error('That frame is already in this story')
  if (current) unlinkTextFrame(graph, next)
  const frames = threadFrames(graph, story)
  if (frames.length === 0) {
    graph.updateNode(first.id, {
      textAutoResize: 'NONE',
      pluginData: withPluginData(first.pluginData, LAWHA_PLUGIN_DATA.textThread, {
        story,
        order: 0,
        lead: ''
      })
    })
  }
  const last = threadFrames(graph, story).at(-1)
  const order = (last ? (threadOf(last)?.order ?? 0) : 0) + 1
  const fresh = graph.getNode(next.id) ?? next
  // The frame's own text joins the end of the story, after a space.
  graph.updateNode(next.id, {
    textAutoResize: 'NONE',
    pluginData: withPluginData(fresh.pluginData, LAWHA_PLUGIN_DATA.textThread, {
      story,
      order,
      lead: fresh.text ? ' ' : ''
    })
  })
  return story
}

/**
 * Takes a frame out of its story. Its text goes back to the frames before and after it, which
 * close up; the frame keeps nothing. A story of one frame stops being a story.
 */
export function unlinkTextFrame(graph: SceneGraph, frame: SceneNode): void {
  const thread = threadOf(frame)
  if (!thread) return
  const frames = threadFrames(graph, thread.story)
  const index = frames.findIndex((node) => node.id === frame.id)
  const remaining = frames.filter((node) => node.id !== frame.id)
  const story = composeStory(frames)
  graph.updateNode(frame.id, {
    text: '',
    styleRuns: [],
    pluginData: withPluginData(frame.pluginData, LAWHA_PLUGIN_DATA.textThread, undefined)
  })
  if (remaining.length === 0) return
  // The story now starts at its first remaining frame, holding all the text until it flows again.
  const head = remaining[0]
  const newStory = index === 0 ? head.id : thread.story
  remaining.forEach((node, order) => {
    const current = graph.getNode(node.id) ?? node
    const single = remaining.length === 1
    const content: Partial<SceneNode> =
      order === 0 ? { text: story.text, styleRuns: story.runs } : { text: '', styleRuns: [] }
    graph.updateNode(node.id, {
      ...content,
      pluginData: withPluginData(
        current.pluginData,
        LAWHA_PLUGIN_DATA.textThread,
        single ? undefined : { story: newStory, order, lead: '' }
      )
    })
  })
}

/**
 * Before the layers `rootIds` are deleted, takes every threaded frame among them or inside them
 * out of its story, giving its text back to the story's frames that stay, so deleting a frame
 * reflows its text into the rest instead of losing it, as in Affinity Publisher. A story whose
 * frames all go keeps nothing. Returns the frames that stay and now hold their story's text.
 */
export function releaseDeletedFrames(graph: SceneGraph, rootIds: Iterable<string>): string[] {
  const going = new Set<string>()
  const stack = [...rootIds]
  while (stack.length > 0) {
    const id = stack.pop()
    const node = id === undefined ? undefined : graph.getNode(id)
    if (!node) continue
    going.add(node.id)
    stack.push(...node.childIds)
  }
  const heads = new Set<string>()
  for (const id of going) {
    const node = graph.getNode(id)
    const thread = node && threadOf(node)
    if (!node || !thread) continue
    const frames = threadFrames(graph, thread.story)
    if (frames.every((frame) => going.has(frame.id))) continue
    unlinkTextFrame(graph, node)
    const head = frames.find((frame) => !going.has(frame.id))
    if (head) heads.add(head.id)
  }
  return [...heads].filter((id) => graph.getNode(id) && !going.has(id))
}
