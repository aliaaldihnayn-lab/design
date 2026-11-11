import { createGlobalState } from '@vueuse/core'
import { generateText } from 'ai'
import { computed, ref, shallowRef } from 'vue'

import {
  applyStoryDraft,
  findInteractiveElements,
  parseStoryDraft,
  storyDraftPrompt,
  type InteractiveElement,
  type StoryDraft
} from '@lawha/core/stories'
import { readEpics, type UserStory } from '@lawha/scene-graph/stories'

import { createAIModelRuntime, type AIModelRuntime } from '@/app/ai/models'
import { runtimeReasoningSettings } from '@/app/ai/models/reasoning/settings'
import {
  getActiveEditorStore,
  useActiveEditorStoreRef,
  type EditorStore
} from '@/app/editor/active-store'

const MAX_DRAFT_TOKENS = 8000

export type StoryDraftFailure = 'no-model' | 'unreadable' | 'failed'

export interface StoryDraftDependencies {
  createRuntime: (role: 'fast' | 'design') => Promise<AIModelRuntime | null>
  generate: typeof generateText
}

const defaultDependencies: StoryDraftDependencies = {
  createRuntime: createAIModelRuntime,
  generate: generateText
}

/** A direct model to draft with: the Fast role's, else the Design role's. */
async function draftingRuntime(deps: StoryDraftDependencies) {
  for (const role of ['fast', 'design'] as const) {
    const runtime = await deps.createRuntime(role).catch(() => null)
    if (runtime?.kind === 'direct') return runtime
  }
  return null
}

/**
 * Asks the app's AI model to draft stories for a frame and its interactive elements. Returns
 * the draft to review, or why there is none; nothing is written to the document.
 */
export async function draftStoriesForFrame(
  store: EditorStore,
  frameId: string,
  deps: StoryDraftDependencies = defaultDependencies
): Promise<{ draft: StoryDraft; elements: InteractiveElement[] } | { failure: StoryDraftFailure }> {
  const frame = store.graph.getNode(frameId)
  if (!frame) return { failure: 'failed' }
  const runtime = await draftingRuntime(deps)
  if (!runtime) return { failure: 'no-model' }
  const elements = findInteractiveElements(store.graph, frameId)
  const prompt = storyDraftPrompt({ frame, elements, epics: readEpics(store.graph) })
  let reply: string
  try {
    const result = await deps.generate({
      model: runtime.model,
      maxOutputTokens: Math.min(runtime.role.profile.maxOutputTokens, MAX_DRAFT_TOKENS),
      ...runtimeReasoningSettings(runtime),
      messages: [{ role: 'user', content: prompt }]
    })
    reply = result.text
  } catch (error) {
    console.warn('[Stories] Drafting failed:', error)
    return { failure: 'failed' }
  }
  const allowed = new Set([frameId, ...elements.map((element) => element.nodeId)])
  const draft = parseStoryDraft(reply, allowed)
  return draft && draft.stories.length > 0 ? { draft, elements } : { failure: 'unreadable' }
}

/**
 * "Draft user stories for this frame": the draft under review in the Stories tab. The person
 * keeps or drops each drafted story before any is saved, in one undo step.
 */
export const useStoryDraft = createGlobalState(() => {
  const storeRef = useActiveEditorStoreRef()
  const frameId = ref<string | null>(null)
  const drafting = ref(false)
  const failure = ref<StoryDraftFailure | null>(null)
  const draft = shallowRef<StoryDraft | null>(null)
  /** Indexes of the drafted stories the person keeps. */
  const kept = ref<Set<number>>(new Set())

  const reviewing = computed(() => draft.value !== null)

  async function start(id: string, deps?: StoryDraftDependencies) {
    if (drafting.value) return
    frameId.value = id
    drafting.value = true
    failure.value = null
    draft.value = null
    if (!storeRef.value) {
      drafting.value = false
      return
    }
    const store = getActiveEditorStore()
    try {
      const result = await draftStoriesForFrame(store, id, deps)
      // The person may have started another draft or switched documents meanwhile.
      if (frameId.value !== id || getActiveEditorStore() !== store) return
      if ('failure' in result) failure.value = result.failure
      else {
        draft.value = result.draft
        kept.value = new Set(result.draft.stories.map((_, index) => index))
      }
    } finally {
      drafting.value = false
    }
  }

  function toggle(index: number) {
    const next = new Set(kept.value)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    kept.value = next
  }

  /** Replaces a drafted story with the person's edit of it, before anything is saved. */
  function edit(index: number, story: UserStory) {
    const current = draft.value
    const item = current?.stories[index]
    if (!current || !item) return
    const stories = [...current.stories]
    stories[index] = { ...item, story: structuredClone(story) }
    draft.value = { ...current, stories }
  }

  function discard() {
    draft.value = null
    failure.value = null
    frameId.value = null
  }

  /** Saves the kept stories; returns how many were saved. */
  function save(): number {
    const current = draft.value
    if (!current) return 0
    const chosen: StoryDraft = {
      epics: current.epics,
      stories: current.stories.filter((_, index) => kept.value.has(index))
    }
    const saved =
      storeRef.value?.editStories('Draft user stories', (graph) =>
        applyStoryDraft(graph, chosen)
      ) ?? 0
    discard()
    return saved
  }

  return {
    frameId,
    drafting,
    failure,
    draft,
    kept,
    reviewing,
    start,
    toggle,
    edit,
    discard,
    save
  }
})
