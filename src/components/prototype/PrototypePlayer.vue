<script setup lang="ts">
import { useEventListener, useWindowSize } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { playIslandRoots } from '@lawha/core'
import {
  clickOutside,
  fire,
  hotspots,
  keyPress,
  readFlows,
  reachable,
  readingOrder,
  screensOf,
  scrollRegions,
  scrollTarget,
  start,
  timers,
  trigger,
  type Action,
  type Hotspot,
  type PlayerState,
  type Step,
  type Transition,
  type TriggerType
} from '@lawha/core/prototype'
import { PlayIsland, providePlayVariables, useIslandTokens } from '@lawha/vue/canvas'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import {
  cssMatrix,
  renderScreen,
  renderSmartAnimate,
  revokeSmartFrames,
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
const smart = shallowRef<SmartFrames | null>(null)
const smartEl = ref<HTMLElement | null>(null)
const regionEls = ref<HTMLElement[]>([])
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
 */
const liveScreens = computed(() => {
  void store.state.sceneVersion
  const session = playerSession.value
  return new Set(session ? playIslandRoots(store.graph, session.pageId) : [])
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
  for (const url of [entry.screen, ...entry.regions.map((r) => r.image)])
    if (url) URL.revokeObjectURL(url)
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

/** The screen's hotspots, less those inside a scrolling frame, which scroll with its content. */
function spotsFor(id: string): Hotspot[] {
  const regions = scrollRegions(graph(), id)
  return hotspots(graph(), id).filter((spot) => !scrollTarget(graph(), regions, spot.node))
}

/** Hotspots inside a scrolling frame, placed in its content. */
function regionSpots(screenId: string, regionNode: string): Hotspot[] {
  const regions = scrollRegions(graph(), screenId)
  return hotspots(graph(), screenId).flatMap((spot) => {
    const target = scrollTarget(graph(), regions, spot.node)
    return target?.region.node === regionNode ? [{ ...spot, x: target.x, y: target.y }] : []
  })
}

function scrollTo(nodeId: string) {
  const current = state.value
  if (!current) return
  const target = scrollTarget(graph(), scrollRegions(graph(), current.screen), nodeId)
  const el = target && regionEls.value.find((e) => e.dataset.scroll === target.region.node)
  if (!target || !el) return
  el.scrollTo({ left: target.x * scale.value, top: target.y * scale.value, behavior: 'smooth' })
}

/**
 * Smart Animate: every layer that shares a name and parent names with one on the next screen
 * moves and resizes from where it is to where it goes, while everything else cross-fades.
 */
async function smartAnimate(from: string, to: string, transition: Transition) {
  const frames = renderSmartAnimate(store, from, to, pixelScale())
  smart.value = frames
  await nextTick()
  const root = smartEl.value
  if (!root) return
  const timing = transitionTiming(transition)
  const animations: Animation[] = []
  const back = root.querySelector<HTMLElement>('[data-smart="from"]')
  if (back) animations.push(back.animate([{ opacity: 1 }, { opacity: 0 }], timing))
  frames.layers.forEach((layer, index) => {
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
async function animate(before: PlayerState, next: PlayerState, transition: Transition) {
  const screenChanged = next.screen !== before.screen
  const smartMove =
    transition.type === 'smart-animate' &&
    screenChanged &&
    next.overlays.length === 0 &&
    before.overlays.length === 0
  if (smartMove) {
    try {
      await smartAnimate(before.screen, next.screen, transition)
    } finally {
      revokeSmartFrames(smart.value)
      smart.value = null
    }
    return
  }
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
  revokeSmartFrames(smart.value)
})

function overlayStyle(id: string, position: string) {
  const o = node(id)
  const s = screen.value
  if (!o || !s) return {}
  const w = o.width * scale.value
  const h = o.height * scale.value
  const W = s.width * scale.value
  const H = s.height * scale.value
  const at = {
    center: [(W - w) / 2, (H - h) / 2],
    top: [(W - w) / 2, 0],
    bottom: [(W - w) / 2, H - h],
    left: [0, (H - h) / 2],
    right: [W - w, (H - h) / 2]
  }[position] ?? [(W - w) / 2, (H - h) / 2]
  return { left: `${at[0]}px`, top: `${at[1]}px`, width: `${w}px`, height: `${h}px` }
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
          <div
            v-for="{ region, image } in live ? [] : regionsFor(state.screen)"
            :key="region.node"
            ref="regionEls"
            class="absolute"
            :class="{
              'overflow-y-auto overflow-x-hidden': region.direction === 'vertical',
              'overflow-x-auto overflow-y-hidden': region.direction === 'horizontal',
              'overflow-auto': region.direction === 'both'
            }"
            :data-scroll="region.node"
            :style="{
              left: `${region.x * scale}px`,
              top: `${region.y * scale}px`,
              width: `${region.width * scale}px`,
              height: `${region.height * scale}px`
            }"
            @click.self="onMiss"
          >
            <div
              class="relative"
              :style="{
                width: `${region.contentWidth * scale}px`,
                height: `${region.contentHeight * scale}px`
              }"
              @click.self="onMiss"
            >
              <img
                :src="image"
                alt=""
                class="pointer-events-none size-full select-none"
                draggable="false"
              />
              <button
                v-for="spot in regionSpots(state.screen, region.node)"
                :key="spot.node"
                type="button"
                class="absolute rounded-sm transition-colors"
                :class="
                  flashHotspots
                    ? 'bg-[rgb(56_189_248/0.3)] ring-2 ring-[#38bdf8]'
                    : 'bg-transparent'
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
          </div>
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
          v-if="smart"
          ref="smartEl"
          class="pointer-events-none absolute inset-0 z-[6]"
          data-test-id="prototype-smart-animate"
        >
          <img :src="smart.to" alt="" class="absolute inset-0 size-full" draggable="false" />
          <img
            :src="smart.from"
            alt=""
            class="absolute inset-0 size-full"
            data-smart="from"
            draggable="false"
          />
          <template v-for="(layer, index) in smart.layers" :key="index">
            <img
              :src="layer.from"
              alt=""
              class="absolute inset-0 size-full origin-top-left"
              :data-smart-out="index"
              draggable="false"
            />
            <img
              :src="layer.to"
              alt=""
              class="absolute inset-0 size-full origin-top-left opacity-0"
              :data-smart-in="index"
              draggable="false"
            />
          </template>
        </div>
      </div>
    </main>
    <footer class="h-8 shrink-0 text-center text-[11px] text-white/40">{{ t.hintClick }}</footer>
  </div>
</template>
