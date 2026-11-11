import { easedKeyframes, transitionDuration, type Transition } from '@lawha/core/prototype'

/**
 * How an island animates an instance into another variant, or an overlay in, in its own DOM:
 * the layers keep their DOM across a variant switch (they are keyed by layer path), so Smart
 * Animate tweens each matched layer from where it was, and the other transitions animate the
 * new variant against a still copy of the old one.
 */

/** Where a layer was before the change, in the island's own pixels. */
interface LayerBox {
  left: number
  top: number
  width: number
  height: number
  opacity: number
}

/** What an instance looked like just before it changed. */
export interface ChangeSnapshot {
  /** The island's untransformed size over its drawn size: the canvas zoom, undone. */
  unscale: number
  /** A still copy of the instance, placed over it while it animates away. */
  ghost: HTMLElement
  ghostBox: LayerBox
  /** Each layer below the instance, by layer path, relative to its parent layer. */
  layers: Map<string, LayerBox>
}

const layerSelector = (path: string) => `[data-layer="${CSS.escape(path)}"]`

function within(path: string, prefix: string): boolean {
  return prefix === '' || path === prefix || path.startsWith(`${prefix}/`)
}

/** A layer's box relative to `origin`, in the island's pixels. */
function boxOf(element: Element, origin: DOMRect, unscale: number): LayerBox {
  const rect = element.getBoundingClientRect()
  return {
    left: (rect.left - origin.left) * unscale,
    top: (rect.top - origin.top) * unscale,
    width: rect.width * unscale,
    height: rect.height * unscale,
    opacity: Number(getComputedStyle(element).opacity)
  }
}

function parentLayer(element: Element): Element | null {
  return element.parentElement?.closest('[data-layer]') ?? null
}

/** Each layer below `prefix` by path, relative to its parent layer's box. */
function layerBoxes(root: ParentNode, prefix: string, unscale: number): Map<string, LayerBox> {
  const boxes = new Map<string, LayerBox>()
  for (const element of root.querySelectorAll('[data-layer]')) {
    const path = element.getAttribute('data-layer') ?? ''
    if (!within(path, prefix) || path === prefix) continue
    const parent = parentLayer(element)
    const origin = (parent ?? element).getBoundingClientRect()
    boxes.set(path, boxOf(element, origin, unscale))
  }
  return boxes
}

/** Takes what an instance looks like before it changes; null when it is not drawn. */
export function snapshotChange(
  root: HTMLElement,
  stage: HTMLElement,
  instancePath: string
): ChangeSnapshot | null {
  const element = root.querySelector(layerSelector(instancePath))
  if (!(element instanceof HTMLElement)) return null
  const drawn = stage.getBoundingClientRect()
  const unscale = drawn.width > 0 ? stage.offsetWidth / drawn.width : 1
  const ghost = element.cloneNode(true)
  if (!(ghost instanceof HTMLElement)) return null
  ghost.removeAttribute('data-layer')
  for (const child of ghost.querySelectorAll('[data-layer]')) child.removeAttribute('data-layer')
  return {
    unscale,
    ghost,
    ghostBox: boxOf(element, drawn, unscale),
    layers: layerBoxes(element, instancePath, unscale)
  }
}

/** Keyframes for one property tweened from `from` to `to` along the transition's easing. */
function tween(transition: Transition, values: (progress: number) => Keyframe): Keyframe[] {
  return easedKeyframes(transition).map(({ offset, progress }) => ({
    offset,
    ...values(progress)
  }))
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k

/** How far a screen-sized slide travels, as a CSS translate, for a direction it comes from. */
function offsetFrom(direction: Transition['direction'], width: number, height: number) {
  switch (direction) {
    case 'left':
      return { x: width, y: 0 }
    case 'right':
      return { x: -width, y: 0 }
    case 'up':
      return { x: 0, y: height }
    case 'down':
      return { x: 0, y: -height }
  }
  return { x: 0, y: 0 }
}

function placeGhost(stage: HTMLElement, snapshot: ChangeSnapshot): HTMLElement {
  const { ghost, ghostBox } = snapshot
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${ghostBox.left}px`,
    top: `${ghostBox.top}px`,
    width: `${ghostBox.width}px`,
    height: `${ghostBox.height}px`,
    margin: '0',
    pointerEvents: 'none',
    transform: 'none'
  })
  stage.append(ghost)
  return ghost
}

/** Smart Animate: each layer both variants draw tweens from its old box to its new one. */
function smartAnimate(
  element: HTMLElement,
  instancePath: string,
  snapshot: ChangeSnapshot,
  stage: HTMLElement,
  transition: Transition,
  duration: number
): Animation[] {
  const animations: Animation[] = []
  const after = layerBoxes(element, instancePath, snapshot.unscale)
  const timing = { duration, fill: 'none' as const }
  for (const layer of element.querySelectorAll('[data-layer]')) {
    if (!(layer instanceof HTMLElement)) continue
    const path = layer.getAttribute('data-layer') ?? ''
    const from = snapshot.layers.get(path)
    const to = after.get(path)
    if (!to) continue
    if (!from) {
      animations.push(
        layer.animate(
          tween(transition, (k) => ({ opacity: String(k * to.opacity) })),
          timing
        )
      )
      continue
    }
    const dx = from.left - to.left
    const dy = from.top - to.top
    if (
      dx === 0 &&
      dy === 0 &&
      from.width === to.width &&
      from.height === to.height &&
      from.opacity === to.opacity
    )
      continue
    animations.push(
      layer.animate(
        tween(transition, (k) => ({
          translate: `${mix(dx, 0, k)}px ${mix(dy, 0, k)}px`,
          width: `${mix(from.width, to.width, k)}px`,
          height: `${mix(from.height, to.height, k)}px`,
          opacity: String(mix(from.opacity, to.opacity, k))
        })),
        timing
      )
    )
  }
  // Layers only the old variant drew fade out on its copy, the matched ones hidden there.
  const ghost = placeGhost(stage, snapshot)
  for (const layer of ghost.querySelectorAll('*'))
    if (layer instanceof HTMLElement) layer.style.visibility = 'hidden'
  const removed = [...snapshot.layers.keys()].filter((path) => !after.has(path))
  if (removed.length === 0) ghost.remove()
  else {
    ghost.style.visibility = 'visible'
    animations.push(
      ghost.animate(
        tween(transition, (k) => ({ opacity: String(1 - k) })),
        timing
      )
    )
  }
  return animations
}

/**
 * Animates an instance that just changed variant from how `snapshot` saw it. Resolves when
 * the transition ends; an instant change, or reduced motion, ends at once.
 */
export async function animateChange(
  root: HTMLElement,
  stage: HTMLElement,
  instancePath: string,
  snapshot: ChangeSnapshot | null,
  transition: Transition,
  reducedMotion: boolean
): Promise<void> {
  const duration = transitionDuration(transition)
  const element = root.querySelector(layerSelector(instancePath))
  if (!snapshot || !(element instanceof HTMLElement) || duration === 0 || reducedMotion) return
  const timing = { duration, fill: 'none' as const }
  const { width, height } = snapshot.ghostBox
  const animations: Animation[] = []
  let ghost: HTMLElement | null = null
  switch (transition.type) {
    case 'smart-animate':
      animations.push(...smartAnimate(element, instancePath, snapshot, stage, transition, duration))
      break
    case 'dissolve':
      ghost = placeGhost(stage, snapshot)
      animations.push(
        ghost.animate(
          tween(transition, (k) => ({ opacity: String(1 - k) })),
          timing
        )
      )
      animations.push(
        element.animate(
          tween(transition, (k) => ({ opacity: String(k) })),
          timing
        )
      )
      break
    case 'move-in':
    case 'slide-in':
    case 'push': {
      const from = offsetFrom(transition.direction, width, height)
      ghost = placeGhost(stage, snapshot)
      // The new variant comes in over the old; Push moves the old one out ahead of it.
      ghost.style.zIndex = '0'
      animations.push(
        element.animate(
          tween(transition, (k) => ({
            translate: `${mix(from.x, 0, k)}px ${mix(from.y, 0, k)}px`
          })),
          timing
        )
      )
      if (transition.type === 'push')
        animations.push(
          ghost.animate(
            tween(transition, (k) => ({
              translate: `${mix(0, -from.x, k)}px ${mix(0, -from.y, k)}px`
            })),
            timing
          )
        )
      else animations.push(ghost.animate([{ opacity: '1' }, { opacity: '0' }], timing))
      break
    }
    case 'move-out':
    case 'slide-out': {
      // The old variant leaves the way the direction points, uncovering the new one.
      const to = offsetFrom(transition.direction, width, height)
      ghost = placeGhost(stage, snapshot)
      animations.push(
        ghost.animate(
          tween(transition, (k) => ({ translate: `${mix(0, -to.x, k)}px ${mix(0, -to.y, k)}px` })),
          timing
        )
      )
      break
    }
    case 'instant':
      break
  }
  await Promise.allSettled(animations.map((animation) => animation.finished))
  ghost?.remove()
}

/** Animates an overlay in as its transition says: from a side, fading, or at once. */
export async function animateOverlayIn(
  element: HTMLElement,
  transition: Transition,
  reducedMotion: boolean
): Promise<void> {
  const duration = transitionDuration(transition)
  if (duration === 0 || reducedMotion || transition.type === 'instant') return
  const timing = { duration, fill: 'none' as const }
  if (transition.type === 'dissolve' || transition.type === 'smart-animate') {
    await element.animate(
      tween(transition, (k) => ({ opacity: String(k) })),
      timing
    ).finished
    return
  }
  const from = offsetFrom(transition.direction, element.offsetWidth, element.offsetHeight)
  await element.animate(
    tween(transition, (k) => ({ translate: `${mix(from.x, 0, k)}px ${mix(from.y, 0, k)}px` })),
    timing
  ).finished
}
