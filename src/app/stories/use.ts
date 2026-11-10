import { createGlobalState, useStorage } from '@vueuse/core'
import { computed, ref } from 'vue'

import { nonEmptyGroups, storyReport, type StoryGroup } from '@lawha/core/stories'
import { readEpics, readNodeStories, type Epic, type UserStory } from '@lawha/scene-graph/stories'

import { propertiesTab } from '@/app/ai/chat/panel'
import { useActiveEditorStoreRef } from '@/app/editor/active-store'

/** Whether story pins show on the canvas (View → User stories). */
export const showStoryPins = useStorage('lawha:story-pins', true)

/** A layer that carries stories, as its pin shows it. */
export interface StoryPin {
  nodeId: string
  stories: UserStory[]
}

/**
 * The active document's user stories and the Stories tab's state, shared by the tab, the canvas
 * pins and menus; it follows whichever editor tab is active.
 */
export const useStories = createGlobalState(() => {
  const storeRef = useActiveEditorStoreRef()
  /** The story the tab scrolls to and opens, after a pin or the epics list asked for it. */
  const focusedStoryId = ref<string | null>(null)

  /** Read again on every scene change: stories are plugin data, which edits replace. */
  const sceneVersion = () => storeRef.value.state.sceneVersion

  const selectedNodeId = computed(() => {
    const ids = storeRef.value.state.selectedIds
    return ids.size === 1 ? [...ids][0] : null
  })

  const selectedStories = computed<UserStory[]>(() => {
    void sceneVersion()
    const id = selectedNodeId.value
    return id ? readNodeStories(storeRef.value.graph.getNode(id)) : []
  })

  const epics = computed<Epic[]>(() => {
    void sceneVersion()
    return readEpics(storeRef.value.graph)
  })

  /** Every epic with the stories of the current page, stories without an epic last. */
  const pageGroups = computed<StoryGroup[]>(() => {
    void sceneVersion()
    const store = storeRef.value
    return nonEmptyGroups(storyReport(store.graph, [store.state.currentPageId]), true)
  })

  /** Layers on the current page that carry stories, for the canvas pins. */
  const pins = computed<StoryPin[]>(() => {
    const byNode = new Map<string, UserStory[]>()
    for (const group of pageGroups.value) {
      for (const { nodeId, story } of group.stories) {
        byNode.set(nodeId, [...(byNode.get(nodeId) ?? []), story])
      }
    }
    return [...byNode].map(([nodeId, stories]) => ({ nodeId, stories }))
  })

  /** Selects the story's layer and shows the story in the Stories tab. */
  async function openStory(nodeId: string, storyId: string | null = null) {
    const store = storeRef.value
    const pageId = store.graph.pageOf(nodeId)
    if (pageId && pageId !== store.state.currentPageId) await store.switchPage(pageId)
    store.select([nodeId])
    focusedStoryId.value = storyId
    propertiesTab.value = 'stories'
  }

  return {
    selectedNodeId,
    selectedStories,
    epics,
    pageGroups,
    pins,
    focusedStoryId,
    openStory
  }
})
