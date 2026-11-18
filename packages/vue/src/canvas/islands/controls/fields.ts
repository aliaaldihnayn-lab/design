import {
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldRoot
} from 'reka-ui'
import { h, type VNode } from 'vue'

import { booleanOf, INPUT_RESET, type ControlModel, type ControlRole } from '@lawha/dom-css/export'
import { numberSettings } from '@lawha/scene-graph/behaviours'

import type { ElementOverride, IslandRenderContext } from '#vue/canvas/islands/render'

import { disabled, interaction, stateOf } from './shared'

type Base = (override?: ElementOverride) => VNode

/**
 * How many characters a field holds, as its counter shows it: against the limit the design
 * writes after a slash, such as `12/80`, or alone.
 */
export function characterCount(text: string, designed: string): string {
  // Characters as a person counts them, so an emoji or a combined letter counts once.
  const count = [...new Intl.Segmenter().segment(text)].length
  const limit = characterLimit(designed)
  return limit ? `${count}/${limit}` : String(count)
}

/** The limit a counter's design writes after a slash, if any. */
function characterLimit(designed: string): number | undefined {
  const limit = /\/\s*(\d+)\s*$/.exec(designed)?.[1]
  return limit ? Number(limit) : undefined
}

/** A text field, textarea, or number field: its root shows focus and drives its look. */
export function fieldRoot(island: IslandRenderContext, control: ControlModel, base: Base): VNode {
  const state = stateOf(island, control)
  const props = interaction(state, true)
  if (control.kind !== 'numberField') return base({ props })
  const settings = numberSettings(control.behaviour, 'value')
  return h(
    NumberFieldRoot,
    {
      asChild: true,
      modelValue: state.number,
      'onUpdate:modelValue': (value: number) => {
        if (Number.isFinite(value)) state.number = value
      },
      min: settings?.min,
      max: settings?.max,
      step: settings?.step,
      disabled: disabled(island, control)
    },
    { default: () => base({ props }) }
  )
}

/** The text layer of a field, as the input it is, or a number field's stepper part. */
export function fieldRole(
  island: IslandRenderContext,
  role: ControlRole,
  base: Base
): VNode | undefined {
  if (role.type === 'part' && role.control.kind === 'numberField') {
    const stepper = role.part === 'increment' ? NumberFieldIncrement : NumberFieldDecrement
    return h(
      stepper,
      { asChild: true },
      { default: () => base({ tag: 'button', props: { type: 'button' } }) }
    )
  }
  if (role.type === 'part' && role.part === 'clear') {
    const state = stateOf(island, role.control)
    return base({
      tag: 'button',
      props: {
        type: 'button',
        'aria-label': 'Clear',
        hidden: (state.texts.value ?? '') === '' || undefined,
        onClick: () => (state.texts.value = '')
      }
    })
  }
  if (role.type !== 'text') return undefined
  const { control, valueId } = role
  const state = stateOf(island, control)
  const off = disabled(island, control)
  if (valueId === 'count') {
    const designed = Object.hasOwn(control.texts, 'count') ? control.texts.count.designed : ''
    return base({ children: () => [characterCount(state.texts.value ?? '', designed)] })
  }
  if (control.kind === 'numberField')
    return h(
      NumberFieldInput,
      { asChild: true },
      {
        default: () =>
          base({ tag: 'input', style: INPUT_RESET, props: { disabled: off }, children: () => [] })
      }
    )
  const text = Object.hasOwn(control.texts, valueId) ? control.texts[valueId] : undefined
  const placeholder = booleanOf(control, 'filled') ? text?.designed : undefined
  return base({
    tag: control.kind === 'textarea' ? 'textarea' : 'input',
    style: INPUT_RESET,
    props: {
      value: state.texts[valueId] ?? '',
      placeholder,
      disabled: off,
      maxlength: characterLimit(
        Object.hasOwn(control.texts, 'count') ? control.texts.count.designed : ''
      ),
      onInput: (event: Event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
          state.texts[valueId] = event.target.value
      }
    },
    children: () => []
  })
}
