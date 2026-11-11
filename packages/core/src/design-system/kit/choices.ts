import type { SceneNode } from '@lawha/scene-graph'

import type { Action } from '#core/prototype/model'

import { glyph, label, setAttrs, type KitDefinition } from './jsx'
import type { KitTheme } from './theme'
import { INSTANT, QUICK, type KitWiring } from './wire'

/**
 * Lists that open in place: a select, a menu, a time picker, a combobox, and a multi-select.
 * Each is one set: `State=Closed`, `State=Open`, and `State=Option n` for the open list with an
 * option highlighted, which the arrow keys move between and Enter picks.
 */

interface ListOptions {
  name: string
  /** What the trigger shows before anything is picked. */
  placeholder: (theme: KitTheme) => string
  options: (theme: KitTheme) => readonly string[]
  /** Picking shows the choice in the trigger and checks it; a menu only closes. */
  picks: boolean
  /** The trigger, when it is not the default button-like one. */
  trigger?: (theme: KitTheme, open: boolean) => string
  /** The text layer that shows the picked value, by path in a variant. */
  valuePath?: string
  /** Whether clicking the open list's trigger closes it; a combobox's field keeps it open. */
  closeOnTrigger?: boolean
  /** Whether focusing the trigger opens the list, as a combobox's field does. */
  openOnFocus?: boolean
}

const OPEN = 'State=Open'
const CLOSED = 'State=Closed'
const highlighted = (index: number) => `State=Option ${index + 1}`

function defaultTrigger(theme: KitTheme, placeholder: string, open: boolean): string {
  return `<Frame name="Trigger" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} px={12} py={10} w="fill" items="center" rounded={8} bg=${theme.surface} stroke=${open ? theme.primary : theme.border} strokeWidth={${open ? 2 : 1}}>
    ${label(theme, 'Value', placeholder, { extra: 'grow={1}' })}
    ${glyph(open ? 'chevronUp' : 'chevronDown', theme.muted, { layer: 'Chevron' })}
  </Frame>`
}

function optionRow(theme: KitTheme, text: string, index: number, active: boolean, picks: boolean) {
  const check = picks
    ? glyph('check', theme.primary, { layer: 'Check' }).replace(
        '<Vector ',
        '<Vector visible={false} '
      )
    : ''
  return `<Frame name="Option ${index + 1}" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} px={12} py={8} w="fill" items="center" rounded={6} bg=${active ? theme.subtle : '"#FFFFFF00"'}>
    ${label(theme, 'Label', text, { extra: 'grow={1}' })}
    ${check}
  </Frame>`
}

function listJSX(list: ListOptions): (theme: KitTheme) => string {
  return (theme) => {
    const options = list.options(theme)
    const trigger = (open: boolean) =>
      list.trigger?.(theme, open) ?? defaultTrigger(theme, list.placeholder(theme), open)
    const menu = (active: number) =>
      `<Frame name="Menu" flex="col" gap={2} p={4} w="fill" rounded={8} bg=${theme.surface} stroke=${theme.border} shadow="0 8 24 #0000001F">${options.map((option, index) => optionRow(theme, option, index, index === active, list.picks)).join('')}</Frame>`
    const variant = (name: string, active: number | null) =>
      `<Component name="${name}" flex="col" gap={4} w={260}>${trigger(active !== null)}${active !== null ? menu(active) : ''}</Component>`
    return `<ComponentSet ${setAttrs(list.name)}>${[
      variant(CLOSED, null),
      variant(OPEN, -1),
      ...options.map((_, index) => variant(highlighted(index), index))
    ].join('')}</ComponentSet>`
  }
}

/** The variables a picking list shares: its value and whether each option is the one picked. */
function pickVariables(
  w: KitWiring,
  list: ListOptions,
  options: readonly string[],
  placeholder: string
) {
  const short = list.name.replace(/^Kit\//, '')
  return {
    value: w.variable(`${short}/value`, 'STRING', placeholder),
    picked: options.map((option) => w.variable(`${short}/is ${option}`, 'BOOLEAN', false))
  }
}

function wireList(list: ListOptions) {
  return (w: KitWiring, theme: KitTheme) => {
    const options = list.options(theme)
    const variables = list.picks
      ? pickVariables(w, list, options, list.placeholder(theme))
      : undefined
    const pick = (index: number): Action[] => [
      ...(variables
        ? [
            { type: 'set-variable' as const, variable: variables.value, value: options[index] },
            ...variables.picked.map((variable, other) => ({
              type: 'set-variable' as const,
              variable,
              value: other === index
            }))
          ]
        : []),
      w.changeTo(CLOSED, QUICK)
    ]
    const openNames = [OPEN, ...options.map((_, index) => highlighted(index))]
    const bindTrigger = (variant: string) => {
      if (!variables) return
      const value = w.layer(variant, list.valuePath ?? 'Trigger/Value')
      if (value.type === 'TEXT') w.bind(value, 'text', variables.value)
    }
    bindTrigger(CLOSED)
    w.on(w.layer(CLOSED, 'Trigger'), { type: 'click' }, [w.changeTo(OPEN, QUICK)])
    if (list.openOnFocus)
      w.on(w.layer(CLOSED, 'Trigger'), { type: 'focus' }, [w.changeTo(OPEN, QUICK)])
    for (const [position, name] of openNames.entries()) {
      bindTrigger(name)
      const active = position - 1
      const root = w.layer(name)
      if (list.closeOnTrigger ?? true)
        w.on(w.layer(name, 'Trigger'), { type: 'click' }, [w.changeTo(CLOSED, QUICK)])
      w.on(root, { type: 'key', key: 'Escape' }, [w.changeTo(CLOSED, QUICK)])
      w.on(root, { type: 'key', key: 'ArrowDown' }, [
        w.changeTo(highlighted((active + 1) % options.length), INSTANT)
      ])
      w.on(root, { type: 'key', key: 'ArrowUp' }, [
        w.changeTo(highlighted((active - 1 + options.length) % options.length), INSTANT)
      ])
      if (active >= 0) w.on(root, { type: 'key', key: 'Enter' }, pick(active))
      for (const [index] of options.entries()) {
        const option = w.layer(name, `Menu/Option ${index + 1}`)
        w.on(option, { type: 'click' }, pick(index))
        if (index !== active)
          w.on(option, { type: 'mouse-enter' }, [w.changeTo(highlighted(index), INSTANT)])
        if (variables) {
          const check = w.layer(name, `Menu/Option ${index + 1}/Check`)
          w.bind(check, 'visible', variables.picked[index])
        }
      }
    }
  }
}

function listKit(kind: KitDefinition['kind'], list: ListOptions): KitDefinition {
  return { kind, name: list.name, insert: CLOSED, jsx: listJSX(list), wire: wireList(list) }
}

const select = listKit('select', {
  name: 'Kit/Select',
  placeholder: (theme) => theme.labels.choose,
  options: (theme) => theme.labels.options,
  picks: true
})

const menu = listKit('menu', {
  name: 'Kit/Menu',
  placeholder: (theme) => theme.labels.menu,
  options: (theme) => theme.labels.actions,
  picks: false,
  trigger: (theme, open) =>
    `<Frame name="Trigger" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={6} px={14} py={8} items="center" rounded={8} bg=${open ? theme.subtle : theme.surface} stroke=${theme.border}>${label(theme, 'Value', theme.labels.menu, { weight: 600 })}${glyph('chevronDown', theme.text, { layer: 'Chevron' })}</Frame>`
})

const TIMES = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30'] as const

const timePicker = listKit('time-picker', {
  name: 'Kit/Time picker',
  placeholder: (theme) => theme.labels.pickTime,
  options: () => TIMES,
  picks: true
})

/**
 * A combobox: the trigger is a real text field, which takes typing, and focusing it opens the
 * suggestions; picking one shows it in the field's caption.
 */
const COMBOBOX: ListOptions = {
  name: 'Kit/Combobox',
  placeholder: (theme) => theme.labels.choose,
  options: (theme) => theme.labels.options,
  picks: true,
  valuePath: 'Trigger/Caption/Value',
  closeOnTrigger: false,
  openOnFocus: true,
  trigger: (theme) =>
    `<Frame name="Trigger" flex="col" gap={4} w="fill"><Instance of={field} name="Field" w="fill" /><Frame name="Caption" flex="row" w="fill">${label(theme, 'Value', theme.labels.choose, { size: 12, color: theme.muted })}</Frame></Frame>`
}

/** The combobox's field as one variant of its Filled property. */
function comboboxField(theme: KitTheme, filled: boolean): string {
  return `<Component name="Filled=${filled}" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} px={12} py={10} w={260} items="center" rounded={8} bg=${theme.surface} stroke=${theme.border}>
      ${glyph('search', theme.muted, { layer: 'Icon' })}
      <TextField.Input name="Value" grow={1} size={14} font="${theme.font}" color=${theme.text} ${theme.rtl ? 'dir="rtl"' : ''}>{${JSON.stringify(theme.labels.search)}}</TextField.Input>
    </Component>`
}

const combobox: KitDefinition = {
  kind: 'combobox',
  name: 'Kit/Combobox',
  insert: CLOSED,
  jsx: (theme) => `const field = ref()
return <Frame name="Kit combobox" flex="col" gap={24}>
  <TextField.Root ref={field} name="Kit/Combobox field" filled={{ property: "Filled", on: "true", off: "false" }}>
    ${comboboxField(theme, false)}
    ${comboboxField(theme, true)}
  </TextField.Root>
  ${listJSX(COMBOBOX)(theme)}
</Frame>`,
  wire: wireList(COMBOBOX)
}

/** A multi-select: each option toggles a chip in the trigger, and the list stays open. */
const multiSelect: KitDefinition = {
  kind: 'multi-select',
  name: 'Kit/Multi-select',
  insert: CLOSED,
  jsx: (theme) => {
    const options = theme.labels.options
    const chips = options
      .map(
        (option, index) =>
          `<Frame name="Chip ${index + 1}" visible={false} flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={4} px={8} py={4} items="center" rounded={999} bg=${theme.subtle}>${label(theme, 'Label', option, { size: 12 })}${glyph('close', theme.muted, { size: 12, layer: 'Remove' })}</Frame>`
      )
      .join('')
    const trigger = (open: boolean) =>
      `<Frame name="Trigger" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} wrap gap={6} rowGap={6} px={8} py={8} w="fill" items="center" rounded={8} bg=${theme.surface} stroke=${open ? theme.primary : theme.border} strokeWidth={${open ? 2 : 1}}>${chips}${label(theme, 'Placeholder', theme.labels.tags, { color: theme.muted })}</Frame>`
    const menu = `<Frame name="Menu" flex="col" gap={2} p={4} w="fill" rounded={8} bg=${theme.surface} stroke=${theme.border} shadow="0 8 24 #0000001F">${options.map((option, index) => optionRow(theme, option, index, false, true)).join('')}</Frame>`
    return `<ComponentSet ${setAttrs('Kit/Multi-select')}>
      <Component name="${CLOSED}" flex="col" gap={4} w={300}>${trigger(false)}</Component>
      <Component name="${OPEN}" flex="col" gap={4} w={300}>${trigger(true)}${menu}</Component>
    </ComponentSet>`
  },
  wire: (w, theme) => {
    const options = theme.labels.options
    const has = options.map((option) => w.variable(`Multi-select/has ${option}`, 'BOOLEAN', false))
    for (const variant of [CLOSED, OPEN]) {
      for (const [index, variable] of has.entries()) {
        const chip: SceneNode = w.layer(variant, `Trigger/Chip ${index + 1}`)
        w.bind(chip, 'visible', variable)
        w.on(w.layer(variant, `Trigger/Chip ${index + 1}/Remove`), { type: 'click' }, [
          { type: 'set-variable', variable, value: false }
        ])
      }
    }
    w.on(w.layer(CLOSED, 'Trigger'), { type: 'click' }, [w.changeTo(OPEN, QUICK)])
    w.on(w.layer(OPEN, 'Trigger'), { type: 'click' }, [w.changeTo(CLOSED, QUICK)])
    w.on(w.layer(OPEN), { type: 'key', key: 'Escape' }, [w.changeTo(CLOSED, QUICK)])
    for (const [index, variable] of has.entries()) {
      w.on(w.layer(OPEN, `Menu/Option ${index + 1}`), { type: 'click' }, [
        { type: 'set-variable', variable, toggle: true }
      ])
      w.bind(w.layer(OPEN, `Menu/Option ${index + 1}/Check`), 'visible', variable)
    }
  }
}

export const CHOICE_KITS: readonly KitDefinition[] = [
  select,
  menu,
  combobox,
  multiSelect,
  timePicker
]
