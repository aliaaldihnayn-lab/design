import { useEventListener, usePreferredReducedMotion } from '@vueuse/core'
import { nextTick, onBeforeUnmount, shallowRef, watch, type Ref, type ShallowRef } from 'vue'

import type { InstanceState } from '@lawha/core'
import {
  applyStateChanges,
  boundInstanceStates,
  dispatchStateEvent,
  dispatchStateKey,
  interactionsOf,
  runInteraction,
  stateTimers,
  variantValues,
  type Action,
  type ComponentStates,
  type Interaction,
  type PlayVariables,
  type StateChange,
  type StateDispatch,
  type StateHold,
  type Transition
} from '@lawha/core/prototype'
import type { SceneGraph } from '@lawha/scene-graph'
import { findLayerByPath } from '@lawha/scene-graph/behaviours'

import { animateChange, snapshotChange } from './transitions'

type TriggerType = Interaction['trigger']['type']

/** An overlay an island shows over its root, as an Open overlay action opened it. */
export interface IslandOverlay {
  /** Counts up, so an overlay opened again mounts afresh. */
  key: number
  destination: string
  position: Extract<Action, { type: 'overlay' }>['position']
  closeOnOutside: boolean
  background?: string
  transition: Transition
}

/** How far a press moves before it is a drag, in the island's pixels. */
const DRAG_DISTANCE = 4

interface Options {
  rootId: () => string
  /** The document, which the variants an instance changes to belong to. */
  document: () => SceneGraph
  /** The root as it shows now, every instance in its state. */
  showing: () => SceneGraph
  /** The element the island's layers render into. */
  root: Readonly<Ref<HTMLElement | null>>
  /** The positioned element still copies of changing layers are laid over. */
  stage: Readonly<Ref<HTMLElement | null>>
  /** Actions the island leaves to its host: navigation, links, and overlays it cannot hold. */
  onAction: (action: Action) => void
  /** The prototype variables the running view shares. */
  variables: ShallowRef<PlayVariables>
  /** Registers a handler for keys the host offers before its own shortcuts. */
  onLiveKey?: (handler: (key: string) => boolean) => () => void
}

/**
 * The layer path of the layer an event happened on, or null outside the island's layers,
 * including on an overlay, whose own island answers it.
 */
function eventPath(event: Event): string | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue
    if (target.hasAttribute('data-island-overlays')) return null
    if (target.hasAttribute('data-layer')) return target.getAttribute('data-layer') ?? ''
  }
  return null
}

/** The layer paths from `path` up to the root, deepest first. */
function chainOf(path: string | null): string[] {
  if (path === null) return []
  const segments = path ? path.split('/') : []
  return segments.map((_, i) => segments.slice(0, segments.length - i).join('/')).concat('')
}

function editable(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0]
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  )
}

/**
 * Runs an island's prototype interactions in place: Change to switches instances between
 * their variants with the transition they ask for, While hovering and While pressing hold until
 * the pointer leaves or lifts, timers and keys follow the variants on show, and overlays open
 * over the root. The document never changes.
 */
export function useIslandInteractions(options: Options) {
  /** The variant each changed instance shows, by layer path below the root. */
  const variants: ShallowRef<ComponentStates> = shallowRef(new Map())
  const overlays = shallowRef<IslandOverlay[]>([])
  const holds: (StateHold & { layer: string; transition: Transition })[] = []
  const reducedMotion = usePreferredReducedMotion()
  let overlayKey = 0
  let hovered: string[] = []
  let press: { x: number; y: number; path: string | null; dragged: boolean } | null = null
  let disposed = false

  function reset(): void {
    variants.value = new Map()
    overlays.value = []
    holds.length = 0
  }

  async function applyChanges(changes: readonly StateChange[]): Promise<void> {
    if (changes.length === 0) return
    const root = options.root.value
    const stage = options.stage.value
    const snapshots =
      root && stage
        ? changes.map((change) => snapshotChange(root, stage, change.instance))
        : changes.map(() => null)
    variants.value = applyStateChanges(variants.value, changes)
    await nextTick()
    if (!root || !stage || disposed) return
    await Promise.all(
      changes.map((change, index) =>
        animateChange(
          root,
          stage,
          change.instance,
          snapshots[index] ?? null,
          change.transition,
          reducedMotion.value === 'reduce'
        )
      )
    )
  }

  function runActions(actions: readonly Action[]): void {
    for (const action of actions) {
      if (action.type === 'overlay') {
        overlays.value = [
          ...overlays.value,
          {
            key: overlayKey++,
            destination: action.destination,
            position: action.position,
            closeOnOutside: action.closeOnOutside,
            background: action.background,
            transition: action.transition
          }
        ]
      } else if (
        (action.type === 'close-overlay' || action.type === 'back') &&
        overlays.value.length > 0
      )
        overlays.value = overlays.value.slice(0, -1)
      else options.onAction(action)
    }
  }

  function run(result: StateDispatch): boolean {
    if (!result.handledBy && result.changes.length === 0 && result.actions.length === 0)
      return false
    if (result.variables !== options.variables.value) options.variables.value = result.variables
    for (const hold of result.holds) {
      const change = result.changes.find((item) => item.instance === hold.instance)
      if (change)
        holds.push({ ...hold, layer: result.handledBy ?? '', transition: change.transition })
    }
    void applyChanges(result.changes)
    runActions(result.actions)
    return true
  }

  /** An event that goes to the layer and up its ancestors, the nearest answering it. */
  function bubble(path: string | null, type: TriggerType): boolean {
    if (path === null) return false
    return run(
      dispatchStateEvent(options.showing(), options.rootId(), path, type, options.variables.value)
    )
  }

  /** An event only the layer itself answers, as entering or leaving it. */
  function at(path: string, type: TriggerType): void {
    const graph = options.showing()
    const layer = findLayerByPath(graph, options.rootId(), path)
    if (!layer) return
    const interaction = interactionsOf(graph, layer).find((item) => item.trigger.type === type)
    if (!interaction) return
    const delay = 'delay' in interaction.trigger ? (interaction.trigger.delay ?? 0) : 0
    if (delay > 0) window.setTimeout(() => fireLater(path, interaction), delay)
    else fireLater(path, interaction)
  }

  /** Runs an interaction of the layer at `path` against the root as it shows by then. */
  function fireLater(path: string, interaction: Interaction): void {
    if (disposed) return
    run(
      runInteraction(
        options.showing(),
        options.rootId(),
        path,
        interaction,
        options.variables.value
      )
    )
  }

  /** Puts back the instances a hold changed, with the change's own transition. */
  function release(kind: StateHold['release'], layer?: string): void {
    const released = holds.filter(
      (hold) => hold.release === kind && (!layer || hold.layer === layer)
    )
    if (released.length === 0) return
    for (const hold of released) holds.splice(holds.indexOf(hold), 1)
    void applyChanges(
      released.map((hold) => ({
        instance: hold.instance,
        from: variants.value.get(hold.instance) ?? hold.variant,
        to: hold.variant,
        // It goes back the way it came, as Figma reverses a While hovering or pressing change.
        transition: hold.transition
      }))
    )
  }

  function pointerOver(event: PointerEvent): void {
    const chain = chainOf(eventPath(event))
    const left = hovered.filter((path) => !chain.includes(path))
    const entered = chain.filter((path) => !hovered.includes(path))
    hovered = chain
    for (const path of left) {
      release('hover', path)
      at(path, 'mouse-leave')
    }
    for (const path of entered.reverse()) {
      at(path, 'mouse-enter')
      at(path, 'hover')
    }
  }

  function pointerLeave(): void {
    for (const path of hovered) {
      release('hover', path)
      at(path, 'mouse-leave')
    }
    hovered = []
  }

  function pointerDown(event: PointerEvent): void {
    const path = eventPath(event)
    press = { x: event.clientX, y: event.clientY, path, dragged: false }
    bubble(path, 'mouse-down')
    bubble(path, 'press')
  }

  function pointerMove(event: PointerEvent): void {
    if (!press || press.dragged) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_DISTANCE) return
    press.dragged = true
    bubble(press.path, 'drag')
  }

  function pointerUp(event: PointerEvent): void {
    if (!press) return
    release('press')
    bubble(eventPath(event), 'mouse-up')
  }

  function click(event: MouseEvent): void {
    // A drag that ran an interaction is not also a click.
    const dragged = press?.dragged ?? false
    press = null
    if (!dragged) bubble(eventPath(event), 'click')
  }

  function focusIn(event: FocusEvent): void {
    bubble(eventPath(event), 'focus')
  }

  function focusOut(event: FocusEvent): void {
    bubble(eventPath(event), 'blur')
  }

  const answerKey = (key: string) => run(dispatchStateKey(options.showing(), options.rootId(), key))
  // Keys the preview has shortcuts for come through the editor, which offers them to the
  // running design first, so Escape closes an open dropdown before a second press leaves the
  // preview; the others come straight here. Typing in a field keeps its keys.
  const stopLiveKeys = options.onLiveKey?.(answerKey)
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (event.defaultPrevented || (event.key.length === 1 && editable(event))) return
    if (answerKey(event.key)) event.preventDefault()
  })
  useEventListener(window, 'pointerup', () => release('press'))

  // After delay timers start when the variant they belong to shows, and stop when it goes.
  const timers = new Map<string, number>()
  watch(
    () => stateTimers(options.showing(), options.rootId()),
    (current) => {
      const keys = new Set(current.map((timer) => timer.key))
      for (const [key, id] of timers)
        if (!keys.has(key)) {
          window.clearTimeout(id)
          timers.delete(key)
        }
      for (const timer of current) {
        if (timers.has(timer.key)) continue
        timers.set(
          timer.key,
          window.setTimeout(fireLater, timer.delay, timer.path, timer.interaction)
        )
      }
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    disposed = true
    stopLiveKeys?.()
    for (const id of timers.values()) window.clearTimeout(id)
  })

  /**
   * The instance states the changes and the variables ask for, merged under the controls' own:
   * a property bound to a variable shows its running value.
   */
  function mergeStates(controls: Map<string, InstanceState>): Map<string, InstanceState> {
    const merged = new Map(controls)
    const bound = boundInstanceStates(options.document(), options.rootId(), options.variables.value)
    for (const [path, state] of bound) {
      const own = merged.get(path)
      merged.set(path, {
        ...own,
        variants: { ...own?.variants, ...state.variants },
        properties: { ...own?.properties, ...state.properties }
      })
    }
    for (const [path, variant] of variants.value) {
      const own = merged.get(path)
      const values = variantValues(options.document(), variant)
      merged.set(path, { ...own, variants: { ...values, ...own?.variants } })
    }
    return merged
  }

  return {
    variants,
    overlays,
    reset,
    runActions,
    mergeStates,
    closeOverlay: (key: number) =>
      (overlays.value = overlays.value.filter((overlay) => overlay.key !== key)),
    /** Event listeners for the island's stage, as `v-on` takes them. */
    listeners: {
      pointerover: pointerOver,
      pointerleave: pointerLeave,
      pointerdown: pointerDown,
      pointermove: pointerMove,
      pointerup: pointerUp,
      click,
      focusin: focusIn,
      focusout: focusOut
    }
  }
}
