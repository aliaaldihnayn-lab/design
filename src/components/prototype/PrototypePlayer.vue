<script setup lang="ts">
import { useEventListener, useWindowSize } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { liveComponentScreens } from '@lawha/core'
import {
  clickOutside,
  fire,
  hotspots,
  keyPress,
  readFlows,
  reachable,
  overlayOrigin,
  geometryKeyframe,
  readingOrder,
  screensOf,
  pinnedLayerOf,
  scrollRegions,
  scrollTarget,
  start,
  timers,
  trigger,
  type Action,
  type Hotspot,
  type OverlayState,
  type PlayerState,
  type Step,
  type Transition,
  type TriggerType
} from '@lawha/core/prototype'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'
import { PlayIsland, providePlayVariables, useIslandTokens } from '@lawha/vue/canvas'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import {
  cssMatrix,
  renderScreen,
  renderSmartAnimate,
  revokeSmartFrames,
  screenImageURLs,
  type ScreenImages,
  type SmartFrames
} from '@/app/prototype/frames'
import {
  closePlayer,
  outgoingOnTop,
  playerSession,
  transitionFrames,
  transitionTiming
} from '@/app/prototype/player'
import PrototypeScrollRegion from '@/components/prototype/PrototypeScrollRegion.vue'

const store = useEditorStore()
const t = usePrototypeMessages()
const { width: vw, height: vh } = useWindowSize()

const state = ref<PlayerState | null>(null)
/** The screen being animated away, drawn under (or over, for slide out) the current one. */
const leaving = ref<string | null>(null)
/** The transition now running, which decides whether the leaving screen draws on top. */
const running = ref<Transition | null>(null)
const images = shallowRef(new Map<string, ScreenImages>())
/** Smart Animate's frame images while it runs, drawn over the stage. */
const smartFrames = shallowRef<SmartFrames | null>(null)
const smartEl = ref<HTMLElement | null>(null)
/** Whether Smart Animate leaves the outgoing screen in place, as when an overlay opens. */
const smartKeepsFrom = ref(false)
const flashHotspots = ref(false)
const currentEl = ref<HTMLElement | null>(null)
const leavingEl = ref<HTMLElement | null>(null)
const overlayEls = ref<HTMLElement[]>([])
let timerIds: number[] = []

const graph = () => store.graph
const node = (id: string) => store.graph.getNode(id)

const screen = computed(() => (state.value ? node(state.value.screen) : null))

/**
 * Screens that hold controls or interactive components run live, as on the canvas in preview:
 * the player draws them as islands, which type, open, and change in place, rather than images.
 * Screens with only navigation keep their images and hotspots.
 */
const liveScreens = computed(() => {
  void store.state.sceneVersion
  const session = playerSession.value
  if (!session) return new Set<string>()
  const screens = screensOf(store.graph, session.pageId).map((screen) => screen.id)
  return new Set(liveComponentScreens(store.graph, screens))
})
const live = computed(() => !!state.value && liveScreens.value.has(state.value.screen))
const islandTokens = useIslandTokens(computed(() => !!playerSession.value))
/** Bumped on restart, so live screens start again as designed. */
const islandRevision = ref(0)
/** The prototype variables the player's live screens share; restarting resets them. */
const playVariables = providePlayVariables()

/** What a live screen leaves to the player: navigation, Back, links, and scrolling. */
function onIslandAction(action: Action) {
  if (state.value) void apply(fire(graph(), state.value, action))
}

/** Fits the screen into the window with a margin, never upscaling past 2×. */
const scale = computed(() => {
  const s = screen.value
  if (!s) return 1
  return Math.min((vw.value - 48) / s.width, (vh.value - 96) / s.height, 2)
})

const flows = computed(() => {
  const session = playerSession.value
  const page = session ? node(session.pageId) : null
  return page ? readFlows(page) : []
})

const pixelScale = () => Math.min(window.devicePixelRatio || 1, 2)

function revokeScreen(entry: ScreenImages) {
  for (const url of screenImageURLs(entry)) if (url) URL.revokeObjectURL(url)
}

async function imageFor(id: string): Promise<string> {
  const cached = images.value.get(id)
  if (cached) return cached.screen
  const entry = renderScreen(store, id, pixelScale())
  images.value = new Map(images.value).set(id, entry)
  return entry.screen
}

function screenImage(id: string): string {
  return images.value.get(id)?.screen ?? ''
}

function regionsFor(id: string) {
  return images.value.get(id)?.regions ?? []
}

/** The scrolling frames placed on the screen itself; nested ones draw inside them. */
function topRegionsFor(id: string) {
  return regionsFor(id).filter((entry) => entry.region.parent === null)
}

/** The screen's hotspots, less those inside a scrolling frame, which scroll with its content. */
function spotsFor(id: string): Hotspot[] {
  const regions = scrollRegions(graph(), id)
  return hotspots(graph(), id).filter((spot) => !scrollTarget(graph(), regions, spot.node))
}

/** Hotspots inside a scrolling frame, placed in its content; pinned layers place their own. */
function regionSpots(screenId: string, regionNode: string): Hotspot[] {
  const regions = scrollRegions(graph(), screenId)
  return hotspots(graph(), screenId).flatMap((spot) => {
    const target = scrollTarget(graph(), regions, spot.node)
    if (target?.region.node !== regionNode) return []
    if (pinnedLayerOf(graph(), target.region, spot.node)) return []
    return [{ ...spot, x: target.x, y: target.y }]
  })
}

/** Hotspots on a fixed or sticky layer of a scrolling frame, placed in that layer. */
function pinnedSpots(screenId: string, regionNode: string, layerNode: string): Hotspot[] {
  const regions = scrollRegions(graph(), screenId)
  return hotspots(graph(), screenId).flatMap((spot) => {
    const target = scrollTarget(graph(), regions, spot.node)
    if (target?.region.node !== regionNode) return []
    const layer = pinnedLayerOf(graph(), target.region, spot.node)
    if (layer?.node !== layerNode) return []
    return [{ ...spot, x: target.x - layer.x, y: target.y - layer.y }]
  })
}

function scrollTo(nodeId: string) {
  const current = state.value
  if (!current) return
  const target = scrollTarget(graph(), scrollRegions(graph(), current.screen), nodeId)
  const el =
    target && currentEl.value?.querySelector<HTMLElement>(`[data-scroll="${target.region.node}"]`)
  if (!target || !el) return
  el.scrollTo({ left: target.x * scale.value, top: target.y * scale.value, behavior: 'smooth' })
}

/**
 * Smart Animate: every layer that shares a name and parent names with one on the next screen
 * moves and resizes from where it is to where it goes, while everything else cross-fades.
 */
async function smartAnimate(
  from: string,
  to: string,
  transition: Transition,
  options: { toOffset?: Vector; keepFrom?: boolean; reverse?: boolean } = {}
) {
  const frames = renderSmartAnimate(store, from, to, pixelScale(), options.toOffset)
  smartFrames.value = frames
  smartKeepsFrom.value = options.keepFrom ?? false
  await nextTick()
  const root = smartEl.value
  if (!root) return
  const timing: KeyframeAnimationOptions = {
    ...transitionTiming(transition),
    direction: options.reverse ? 'reverse' : 'normal'
  }
  const animations: Animation[] = []
  const back = root.querySelector<HTMLElement>('[data-smart="from"]')
  const front = root.querySelector<HTMLElement>('[data-smart="to"]')
  // Over a screen that stays, as an overlay opens on it, only the overlay fades in.
  if (back && !options.keepFrom)
    animations.push(back.animate([{ opacity: 1 }, { opacity: 0 }], timing))
  if (front && options.keepFrom)
    animations.push(front.animate([{ opacity: 0 }, { opacity: 1 }], timing))
  frames.layers.forEach((layer, index) => {
    if (layer.geometry) {
      // A box tweens its own corners, fill, stroke and shadows while it resizes.
      const box = root.querySelector<HTMLElement>(`[data-smart-box="${index}"]`)
      const slots = Math.max(layer.geometry.from.shadows.length, layer.geometry.to.shadows.length)
      if (box)
        animations.push(
          box.animate(
            [
              geometryKeyframe(layer.geometry.from, scale.value, slots),
              geometryKeyframe(layer.geometry.to, scale.value, slots)
            ],
            { ...timing, fill: 'forwards' }
          )
        )
      return
    }
    const out = root.querySelector<HTMLElement>(`[data-smart-out="${index}"]`)
    const into = root.querySelector<HTMLElement>(`[data-smart-in="${index}"]`)
    const forward = cssMatrix(layer.forward, scale.value)
    const backward = cssMatrix(layer.backward, scale.value)
    // Each image fades over half the tween, so the layer never dims while both cross.
    if (out)
      animations.push(
        out.animate(
          [
            { transform: 'none', opacity: 1 },
            { opacity: 1, offset: 0.5 },
            { transform: forward, opacity: 0 }
          ],
          timing
        )
      )
    if (into)
      animations.push(
        into.animate(
          [
            { transform: backward, opacity: 0 },
            { opacity: 1, offset: 0.5 },
            { transform: 'none', opacity: 1 }
          ],
          timing
        )
      )
  })
  await Promise.all(animations.map((a) => a.finished.catch(() => undefined)))
}

function clearTimers() {
  for (const id of timerIds) window.clearTimeout(id)
  timerIds = []
}

/** Starts the active screen's After-delay timers for this state only. */
function scheduleTimers(current: PlayerState) {
  clearTimers()
  // A live screen runs its own timers, as it runs its other interactions.
  if (liveScreens.value.has(current.screen)) return
  for (const { delay, action } of timers(graph(), current)) {
    timerIds.push(
      window.setTimeout(() => {
        if (state.value !== current) return
        void apply(fire(graph(), current, action))
      }, delay)
    )
  }
}

/** Runs the transition between the two states; resolves when it has finished. */
/**
 * Smart Animate between screens, or for an overlay opening or closing over the screen (or
 * overlay) under it: layers it shares with what is under it move into it and the rest of it
 * fades in, and closing runs the same the other way. Whether it ran.
 */
async function smartTransition(
  before: PlayerState,
  next: PlayerState,
  transition: Transition,
  smartMove: boolean
): Promise<boolean> {
  const run = async (work: () => Promise<void>) => {
    try {
      await work()
    } finally {
      revokeSmartFrames(smartFrames.value)
      smartFrames.value = null
    }
  }
  if (smartMove) {
    await run(() => smartAnimate(before.screen, next.screen, transition))
    return true
  }
  if (transition.type !== 'smart-animate' || next.screen !== before.screen) return false
  const opened = next.overlays.length === before.overlays.length + 1
  const closed = next.overlays.length + 1 === before.overlays.length
  if (!opened && !closed) return false
  const overlay = opened ? next.overlays.at(-1) : before.overlays.at(-1)
  if (!overlay) return false
  const rest = opened ? before.overlays : next.overlays
  const under = rest.at(-1)?.screen ?? next.screen
  const toOffset = overlayOffset(under, overlay.screen, overlay.position)
  await run(() =>
    smartAnimate(under, overlay.screen, transition, { toOffset, keepFrom: true, reverse: closed })
  )
  return true
}

async function animate(before: PlayerState, next: PlayerState, transition: Transition) {
  const screenChanged = next.screen !== before.screen
  const smartMove =
    transition.type === 'smart-animate' &&
    screenChanged &&
    next.overlays.length === 0 &&
    before.overlays.length === 0
  if (await smartTransition(before, next, transition, smartMove)) return
  if (transition.type === 'instant') return
  const frames = transitionFrames(transition)
  const timing = transitionTiming(transition)
  const openedOverlay = next.overlays.length > before.overlays.length
  let incoming: HTMLElement | null | undefined = null
  if (openedOverlay) incoming = overlayEls.value.at(-1)
  else if (screenChanged) incoming = currentEl.value
  const animations = [
    incoming && frames.incoming.length > 0 ? incoming.animate(frames.incoming, timing) : null,
    screenChanged && leavingEl.value && frames.outgoing.length > 0
      ? leavingEl.value.animate(frames.outgoing, timing)
      : null
  ].filter((a): a is Animation => a !== null)
  await Promise.all(animations.map((a) => a.finished.catch(() => undefined)))
}

async function apply(step: Step | null) {
  if (!step || !state.value) return
  if (step.effect?.type === 'open-url') {
    window.open(step.effect.url, '_blank', 'noopener,noreferrer')
    return
  }
  if (step.effect?.type === 'scroll-to') {
    scrollTo(step.effect.node)
    return
  }
  if (step.effect) return
  const before = state.value
  const next = step.state
  const screenChanged = next.screen !== before.screen
  // Render what is about to show before animating, so nothing flashes empty.
  await Promise.all([imageFor(next.screen), ...next.overlays.map((o) => imageFor(o.screen))])
  leaving.value = screenChanged ? before.screen : null
  running.value = step.transition
  state.value = next
  await nextTick()
  if (step.transition) await animate(before, next, step.transition)
  leaving.value = null
  running.value = null
  scheduleTimers(next)
}

function onHotspot(spot: Hotspot, type: TriggerType) {
  if (!state.value || !spot.triggers.includes(type)) return
  void apply(trigger(graph(), state.value, spot.node, type))
}

/** A click that misses every hotspot briefly shows where they are, as Figma does. */
function onMiss() {
  flashHotspots.value = true
  window.setTimeout(() => (flashHotspots.value = false), 600)
}

function onBackdrop() {
  if (state.value) void apply(clickOutside(state.value))
}

async function restart(startId = playerSession.value?.start) {
  if (!startId) return
  clearTimers()
  await imageFor(startId)
  islandRevision.value++
  playVariables.value = new Map()
  state.value = start(startId)
  scheduleTimers(state.value)
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!playerSession.value || !state.value) return
  if (event.key === 'Escape') {
    if (state.value.overlays.length > 0)
      void apply(
        clickOutside({
          ...state.value,
          overlays: state.value.overlays.map((o) => ({ ...o, closeOnOutside: true }))
        })
      )
    else closePlayer()
    event.preventDefault()
    return
  }
  const step = keyPress(graph(), state.value, event.key)
  if (step) {
    event.preventDefault()
    void apply(step)
  }
})

watch(
  () => playerSession.value,
  (session) => {
    clearTimers()
    for (const entry of images.value.values()) revokeScreen(entry)
    images.value = new Map()
    state.value = null
    if (session) void restart(session.start)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearTimers()
  for (const entry of images.value.values()) revokeScreen(entry)
  revokeSmartFrames(smartFrames.value)
})

/** A box in screen units as CSS at the player's scale. */
function boxStyle(rect: Rect) {
  const px = (value: number) => `${value * scale.value}px`
  return { left: px(rect.x), top: px(rect.y), width: px(rect.width), height: px(rect.height) }
}

/** Where an overlay sits over the screen (or overlay) under it, in screen units. */
function overlayOffset(under: string, id: string, position: OverlayState['position']): Vector {
  const o = node(id)
  const s = screen.value
  if (!o || !s) return { x: 0, y: 0 }
  const origin = overlayOrigin(s, o, position)
  // Over another overlay, it is placed on the screen, so measure from that overlay's corner.
  const base = state.value?.overlays.find((item) => item.screen === under)
  const baseNode = base ? node(base.screen) : null
  if (!base || !baseNode) return origin
  const at = overlayOrigin(s, baseNode, base.position)
  return { x: origin.x - at.x, y: origin.y - at.y }
}

function overlayStyle(id: string, position: OverlayState['position']) {
  const o = node(id)
  const s = screen.value
  if (!o || !s) return {}
  const at = overlayOrigin(s, o, position)
  const px = (value: number) => `${value * scale.value}px`
  return { left: px(at.x), top: px(at.y), width: px(o.width), height: px(o.height) }
}

/** Screens the prototype can reach from its start, in reading order, for "Screen X of Y". */
const journey = computed(() => {
  const session = playerSession.value
  if (!session) return []
  const reach = reachable(graph(), session.start, session.pageId)
  return readingOrder(screensOf(graph(), session.pageId)).filter((s) => reach.has(s.id))
})
const screenIndex = computed(() => journey.value.findIndex((s) => s.id === state.value?.screen) + 1)
</script>

<template>
  <div
    v-if="playerSession && state && screen"
    class="fixed inset-0 z-[1000] flex flex-col bg-[#0b0b0f] text-white"
    data-test-id="prototype-player"
    dir="ltr"
  >
    <header class="flex h-12 shrink-0 items-center gap-3 px-4 text-[12px]" :dir="undefined">
      <span class="font-medium" data-test-id="prototype-screen-name">{{ screen.name }}</span>
      <span class="text-white/50">{{
        t.screenOf({ current: screenIndex, total: journey.length })
      }}</span>
      <select
        v-if="flows.length > 1"
        class="rounded bg-white/10 px-2 py-1"
        :aria-label="t.flow"
        @change="restart(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="flow in flows" :key="flow.name" :value="flow.start">{{ flow.name }}</option>
      </select>
      <span class="flex-1" />
      <button
        type="button"
        class="rounded px-2 py-1 hover:bg-white/10"
        data-test-id="prototype-restart"
        @click="restart()"
      >
        {{ t.restart }}
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 hover:bg-white/10"
        data-test-id="prototype-close"
        @click="closePlayer"
      >
        {{ t.close }}
      </button>
    </header>

    <main class="flex flex-1 items-center justify-center overflow-hidden">
      <div
        class="relative overflow-hidden shadow-2xl"
        :style="{ width: `${screen.width * scale}px`, height: `${screen.height * scale}px` }"
        data-test-id="prototype-stage"
      >
        <div
          v-if="leaving"
          ref="leavingEl"
          class="absolute inset-0"
          :style="{ zIndex: outgoingOnTop(running) ? 2 : 0 }"
        >
          <img :src="screenImage(leaving)" alt="" class="size-full select-none" draggable="false" />
        </div>
        <div ref="currentEl" class="absolute inset-0 z-[1]" @click.self="onMiss">
          <div
            v-if="live"
            class="absolute top-0 left-0 origin-top-left"
            data-test-id="prototype-live-screen"
            :style="{ transform: `scale(${scale})` }"
          >
            <PlayIsland
              :root-id="state.screen"
              :revision="islandRevision"
              :tokens="islandTokens"
              @action="onIslandAction"
            />
          </div>
          <img
            v-else
            :src="screenImage(state.screen)"
            :alt="screen.name"
            class="pointer-events-none size-full select-none"
            draggable="false"
          />
          <PrototypeScrollRegion
            v-for="entry in live ? [] : topRegionsFor(state.screen)"
            :key="entry.region.node"
            :entry="entry"
            :regions="regionsFor(state.screen)"
            :scale="scale"
            :flash="flashHotspots"
            :spots-in="(region) => regionSpots(state?.screen ?? '', region)"
            :spots-on-pinned="(region, layer) => pinnedSpots(state?.screen ?? '', region, layer)"
            @hotspot="onHotspot"
            @miss="onMiss"
          />
          <button
            v-for="spot in live ? [] : spotsFor(state.screen)"
            :key="spot.node"
            type="button"
            class="absolute rounded-sm transition-colors"
            :class="
              flashHotspots ? 'bg-[rgb(56_189_248/0.3)] ring-2 ring-[#38bdf8]' : 'bg-transparent'
            "
            :data-hotspot="spot.node"
            :style="{
              left: `${spot.x * scale}px`,
              top: `${spot.y * scale}px`,
              width: `${spot.width * scale}px`,
              height: `${spot.height * scale}px`
            }"
            @click.stop="onHotspot(spot, 'click')"
            @mouseenter="onHotspot(spot, 'hover')"
            @pointerdown="onHotspot(spot, 'press')"
          />
        </div>

        <template v-for="(overlay, index) in state.overlays" :key="overlay.screen + index">
          <div class="absolute inset-0 z-[3] bg-black/40" @click="onBackdrop" />
          <div
            ref="overlayEls"
            class="absolute z-[4] overflow-hidden"
            :class="{
              invisible: !!smartFrames && smartKeepsFrom && index === state.overlays.length - 1
            }"
            :style="overlayStyle(overlay.screen, overlay.position)"
            :data-overlay="overlay.screen"
          >
            <img
              :src="screenImage(overlay.screen)"
              alt=""
              class="pointer-events-none size-full"
              draggable="false"
            />
            <button
              v-for="spot in spotsFor(overlay.screen)"
              :key="spot.node"
              type="button"
              class="absolute"
              :data-hotspot="spot.node"
              :style="{
                left: `${spot.x * scale}px`,
                top: `${spot.y * scale}px`,
                width: `${spot.width * scale}px`,
                height: `${spot.height * scale}px`
              }"
              @click.stop="onHotspot(spot, 'click')"
              @mouseenter="onHotspot(spot, 'hover')"
            />
          </div>
        </template>

        <div
          v-if="smartFrames"
          ref="smartEl"
          class="pointer-events-none absolute inset-0 z-[6]"
          data-test-id="prototype-smart-animate"
        >
          <img
            :src="smartFrames.to"
            alt=""
            class="absolute"
            :style="boxStyle(smartFrames.toBox)"
            data-smart="to"
            draggable="false"
          />
          <img
            :src="smartFrames.from"
            alt=""
            class="absolute"
            :style="boxStyle(smartFrames.fromBox)"
            data-smart="from"
            draggable="false"
          />
          <template v-for="(layer, index) in smartFrames.layers" :key="index">
            <div
              v-if="layer.geometry"
              class="absolute"
              :style="geometryKeyframe(layer.geometry.from, scale)"
              :data-smart-box="index"
            />
            <template v-else>
              <img
                :src="layer.from"
                alt=""
                class="absolute origin-top-left"
                :style="boxStyle(smartFrames.fromBox)"
                :data-smart-out="index"
                draggable="false"
              />
              <img
                :src="layer.to"
                alt=""
                class="absolute origin-top-left opacity-0"
                :style="boxStyle(smartFrames.toBox)"
                :data-smart-in="index"
                draggable="false"
              />
            </template>
          </template>
        </div>
      </div>
    </main>
    <footer class="h-8 shrink-0 text-center text-[11px] text-white/40">{{ t.hintClick }}</footer>
  </div>
</template>
