<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import { resolvePlayState } from '@lawha/core'
import { vectorElement } from '@lawha/core/io'
import { interactiveLayers, type Action } from '@lawha/core/prototype'
import { behaviourControls, controlRoles, sceneNodeToDesignDocument } from '@lawha/dom-css/export'

import { useEditor } from '#vue/editor/context'

import { useIslandInteractions, type IslandOverlay } from './interactions'
import { renderNode } from './render'
import { useShadowContainer } from './shadow'
import { createIslandState, instanceStates } from './state'
import { animateOverlayIn } from './transitions'

/**
 * One live island: a top-level layer that holds controls or prototype interactions, rendered as
 * DOM in its own shadow root, with each control running as its Reka UI component and each
 * interactive component switching between its variants in place. The design's variants draw
 * the states; the document never changes.
 */
const { rootId, revision, tokens } = defineProps<{
  rootId: string
  /** Changing it starts every control again as designed. */
  revision: number
  /** The document's variables as custom properties, shared by every island of the canvas. */
  tokens: CSSStyleSheet
}>()
const emit = defineEmits<{
  /** An action the island leaves to its host: navigation, links, or closing it as an overlay. */
  action: [action: Action]
}>()
const editor = useEditor()

const container = useShadowContainer(useTemplateRef<HTMLElement>('host'), [tokens])
const stage = useTemplateRef<HTMLElement>('stage')

const controls = computed(() => {
  void editor.state.sceneVersion
  return behaviourControls(editor.graph, rootId)
})
const roles = computed(() => controlRoles(controls.value))
const state = shallowRef(createIslandState(controls.value))

/** The root as it shows now, kept apart so interactions can read it while it changes. */
const showing = shallowRef(editor.graph)
const interactions = useIslandInteractions({
  rootId: () => rootId,
  document: () => editor.graph,
  showing: () => showing.value,
  root: stage,
  stage,
  onAction: (action) => emit('action', action),
  onLiveKey: (handler) => editor.onLiveKey(handler)
})

watch(
  () => [rootId, revision, [...controls.value.keys()].join('\n')],
  () => {
    state.value = createIslandState(controls.value)
    interactions.reset()
  }
)

const projection = computed(() => {
  void editor.state.sceneVersion
  const states = interactions.mergeStates(instanceStates(controls.value, state.value))
  const graph = resolvePlayState(editor.graph, rootId, states)
  const [root] = sceneNodeToDesignDocument(graph, rootId, { vectorElement }).children
  return { graph, root }
})
watch(projection, ({ graph }) => (showing.value = graph), { immediate: true })

const interactive = computed(() => interactiveLayers(projection.value.graph, rootId))

/** The island's layers, rendered from the projection of their current states. */
function Layers() {
  const { graph, root } = projection.value
  return root
    ? renderNode(
        {
          graph,
          rootId,
          controls: controls.value,
          roles: roles.value,
          state: state.value,
          interactive: interactive.value
        },
        root,
        ''
      )
    : null
}

const ALIGN: Record<IslandOverlay['position'], { justifyContent: string; alignItems: string }> = {
  center: { justifyContent: 'center', alignItems: 'center' },
  top: { justifyContent: 'center', alignItems: 'flex-start' },
  bottom: { justifyContent: 'center', alignItems: 'flex-end' },
  left: { justifyContent: 'flex-start', alignItems: 'center' },
  right: { justifyContent: 'flex-end', alignItems: 'center' }
}

const reducedMotion = usePreferredReducedMotion()
const animated = new WeakSet<Element>()
function overlayMounted(element: unknown, overlay: IslandOverlay) {
  if (!(element instanceof HTMLElement) || animated.has(element)) return
  animated.add(element)
  void animateOverlayIn(element, overlay.transition, reducedMotion.value === 'reduce')
}

function outside(overlay: IslandOverlay) {
  if (overlay.closeOnOutside) interactions.closeOverlay(overlay.key)
}

/** What an overlay's own island leaves to this one: closing it, or what this one leaves up. */
function overlayAction(overlay: IslandOverlay, action: Action) {
  if (action.type === 'close-overlay' || action.type === 'back')
    interactions.closeOverlay(overlay.key)
  else interactions.runActions([action])
}
</script>

<template>
  <div ref="host" :data-island="rootId">
    <Teleport v-if="container" :to="container">
      <div ref="stage" data-island-stage v-on="interactions.listeners">
        <Layers />
        <div
          v-for="overlay in interactions.overlays.value"
          :key="overlay.key"
          data-island-overlays
          :data-overlay="overlay.destination"
          :style="{ background: overlay.background ?? 'transparent', ...ALIGN[overlay.position] }"
          @click.self="outside(overlay)"
        >
          <div :ref="(element) => overlayMounted(element, overlay)" role="dialog">
            <Island
              :root-id="overlay.destination"
              :revision="revision"
              :tokens="tokens"
              @action="overlayAction(overlay, $event)"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
