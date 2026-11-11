import { glyph, label, setAttrs, type KitDefinition } from './jsx'
import { tint, type KitTheme } from './theme'
import { DISSOLVE, INSTANT } from './wire'

/** Buttons, toggles, ranges, and indicators: one set each, every state a variant. */

const BUTTON_STATES = ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled', 'Loading'] as const

function buttonVariant(theme: KitTheme, state: (typeof BUTTON_STATES)[number]): string {
  const bg = state === 'Pressed' ? tint(theme.primary, 0.82) : theme.primary
  const ring =
    state === 'Focus'
      ? `stroke=${tint(theme.primary, 0.35)} strokeWidth={3} strokeAlign="outside"`
      : ''
  const lift = state === 'Hover' ? 'shadow="0 4 12 #4F46E540"' : ''
  const content =
    state === 'Loading'
      ? `${glyph('chevronDown', theme.onPrimary, { layer: 'Spinner' })}${label(theme, 'Label', theme.labels.loading, { weight: 600, color: theme.onPrimary })}`
      : label(theme, 'Label', theme.labels.button, { weight: 600, color: theme.onPrimary })
  return `<Component name="State=${state}" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} px={20} py={10} rounded={8} items="center" justify="center" bg=${bg} ${ring} ${lift} opacity={${state === 'Disabled' ? 0.45 : 1}}>${content}</Component>`
}

const button: KitDefinition = {
  kind: 'button',
  name: 'Kit/Button',
  insert: 'State=Default',
  jsx: (theme) =>
    `<ComponentSet ${setAttrs('Kit/Button')}>${BUTTON_STATES.map((state) => buttonVariant(theme, state)).join('')}</ComponentSet>`,
  wire: (w) => {
    w.on(w.layer('State=Default'), { type: 'hover' }, [w.changeTo('State=Hover')])
    w.on(w.layer('State=Default'), { type: 'focus' }, [w.changeTo('State=Focus', INSTANT)])
    w.on(w.layer('State=Focus'), { type: 'blur' }, [w.changeTo('State=Default', INSTANT)])
    w.on(w.layer('State=Hover'), { type: 'press' }, [w.changeTo('State=Pressed', INSTANT)])
    // A click shows Loading for a moment, as a submitting button does.
    for (const state of ['Default', 'Hover', 'Pressed', 'Focus'])
      w.on(w.layer(`State=${state}`), { type: 'click' }, [w.changeTo('State=Loading', DISSOLVE)])
    w.on(w.layer('State=Loading'), { type: 'after-delay', delay: 1200 }, [
      w.changeTo('State=Default', DISSOLVE)
    ])
  }
}

function switchVariant(theme: KitTheme, on: boolean): string {
  const knobX = on !== theme.rtl ? 22 : 2
  return `<Component name="State=${on ? 'On' : 'Off'}" w={44} h={24} rounded={12} bg=${on ? theme.primary : theme.border}>
    <Switch.Thumb name="Thumb" x={${knobX}} y={2} w={20} h={20} rounded={10} bg="#FFFFFF" shadow="0 1 2 #0003" />
  </Component>`
}

const toggle: KitDefinition = {
  kind: 'switch',
  name: 'Kit/Switch',
  insert: 'State=Off',
  jsx: (theme) =>
    `<Switch.Root ${setAttrs('Kit/Switch')} modelValue="State">${switchVariant(theme, false)}${switchVariant(theme, true)}</Switch.Root>`
}

const CHECKBOX_STATES = ['Unchecked', 'Checked', 'Indeterminate'] as const

function checkboxVariant(theme: KitTheme, state: (typeof CHECKBOX_STATES)[number]): string {
  const filled = state !== 'Unchecked'
  const marks = {
    Unchecked: '',
    Checked: glyph('check', theme.onPrimary, { size: 14, layer: 'Mark' }),
    Indeterminate: glyph('minus', theme.onPrimary, { size: 14, layer: 'Mark' })
  }
  const mark = marks[state]
  return `<Component name="State=${state}" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} items="center">
    <Frame name="Box" w={20} h={20} rounded={5} flex="row" items="center" justify="center" bg=${filled ? theme.primary : theme.surface} stroke=${filled ? theme.primary : theme.border} strokeWidth={1.5}>${mark}</Frame>
    ${label(theme, 'Label', theme.labels.agree)}
  </Component>`
}

const checkbox: KitDefinition = {
  kind: 'checkbox',
  name: 'Kit/Checkbox',
  insert: 'State=Unchecked',
  jsx: (theme) =>
    `<ComponentSet ${setAttrs('Kit/Checkbox')}>${CHECKBOX_STATES.map((state) => checkboxVariant(theme, state)).join('')}</ComponentSet>`,
  wire: (w) => {
    const checked = w.variable('Checkbox/checked', 'BOOLEAN', false)
    w.on(w.layer('State=Unchecked'), { type: 'click' }, [
      { type: 'set-variable', variable: checked, value: true },
      w.changeTo('State=Checked', INSTANT)
    ])
    w.on(w.layer('State=Indeterminate'), { type: 'click' }, [
      { type: 'set-variable', variable: checked, value: true },
      w.changeTo('State=Checked', INSTANT)
    ])
    w.on(w.layer('State=Checked'), { type: 'click' }, [
      { type: 'set-variable', variable: checked, value: false },
      w.changeTo('State=Unchecked', INSTANT)
    ])
  }
}

function radioItem(theme: KitTheme, on: boolean, text: string): string {
  return `<Component name="Checked=${on}" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} items="center">
    <Frame name="Dot" w={20} h={20} rounded={10} bg=${theme.surface} stroke=${on ? theme.primary : theme.border} strokeWidth={${on ? 6 : 1.5}} />
    <Text name="Label" size={14} font="${theme.font}" color=${theme.text} ${theme.rtl ? 'dir="rtl"' : ''} text={property("Label", ${JSON.stringify(text)})} />
  </Component>`
}

const radioGroup: KitDefinition = {
  kind: 'radio-group',
  name: 'Kit/Radio group',
  insert: 'Kit/Radio group',
  jsx: (theme) => {
    const [first, ...rest] = theme.labels.plans
    const items = [first, ...rest]
      .map(
        (plan, index) =>
          `<RadioGroup.Item of={radio} name=${JSON.stringify(plan)} Checked=${index === 0 ? '"true"' : '"false"'} Label=${JSON.stringify(plan)} />`
      )
      .join('')
    return `const radio = ref()
return <Frame name="Kit radio" flex="col" gap={24}>
  <RadioGroup.Item ref={radio} ${setAttrs('Kit/Radio')} modelValue="Checked">${radioItem(theme, false, first)}${radioItem(theme, true, first)}</RadioGroup.Item>
  <RadioGroup.Root name="Kit/Radio group" flex="col" gap={12}>${items}</RadioGroup.Root>
</Frame>`
  }
}

function sliderVariant(theme: KitTheme, range: boolean): string {
  const start = theme.rtl ? 'x={80}' : 'x={0}'
  return `<Component name="Range=${range}" w={240} h={20}>
    <Slider.Track name="Track" x={0} y={8} w={240} h={4} rounded={2} bg=${theme.border}>
      <Slider.Range name="Range" ${start} y={0} w={160} h={4} rounded={2} bg=${theme.primary} />
    </Slider.Track>
    <Slider.Thumb name="Thumb" x={${theme.rtl ? 70 : 150}} y={0} w={20} h={20} rounded={10} bg="#FFFFFF" stroke=${theme.primary} strokeWidth={2} />
  </Component>`
}

const slider: KitDefinition = {
  kind: 'slider',
  name: 'Kit/Slider',
  insert: 'Range=false',
  jsx: (theme) =>
    `<Slider.Root ${setAttrs('Kit/Slider')} min={0} max={100} step={1} defaultValue={66}>${sliderVariant(theme, false)}</Slider.Root>`
}

/**
 * Two thumbs on one track: a range slider, each end dragged continuously or moved with the
 * arrow keys in steps, the lower end never passing the upper.
 */
const rangeSlider: KitDefinition = {
  kind: 'range-slider',
  name: 'Kit/Range slider',
  insert: 'Range slider',
  jsx: (theme) => {
    // 25 to 75 of 0 to 100, drawn on a 240 wide track whose thumbs are 20 wide.
    const at = (value: number) => (theme.rtl ? 220 - value * 2.2 : value * 2.2)
    const thumb = (part: 'Thumb' | 'EndThumb', name: string, value: number) =>
      `<Slider.${part} name="${name}" x={${at(value)}} y={0} w={20} h={20} rounded={10} bg="#FFFFFF" stroke=${theme.primary} strokeWidth={2} />`
    return `<Slider.Root ${setAttrs('Kit/Range slider')} min={0} max={100} step={5} defaultValue={25} defaultEnd={75}>
      <Component name="Range slider" w={240} h={20}>
        <Slider.Track name="Track" x={0} y={8} w={240} h={4} rounded={2} bg=${theme.border}>
          <Slider.Range name="Range" x={${Math.min(at(25), at(75)) + 10}} y={0} w={110} h={4} rounded={2} bg=${theme.primary} />
        </Slider.Track>
        ${thumb('Thumb', 'Start', 25)}
        ${thumb('EndThumb', 'End', 75)}
      </Component>
    </Slider.Root>`
  }
}

const progress: KitDefinition = {
  kind: 'progress',
  name: 'Kit/Progress',
  insert: 'Progress',
  jsx: (theme) =>
    `<Progress.Root ${setAttrs('Kit/Progress')} min={0} max={100} defaultValue={60}>
      <Component name="Progress" flex="col" gap={6} w={240}>
        ${label(theme, 'Label', theme.labels.progress, { size: 12, color: theme.muted })}
        <Progress.Track name="Track" w={240} h={8} rounded={4} bg=${theme.subtle}>
          <Progress.Indicator name="Indicator" ${theme.rtl ? 'x={96}' : 'x={0}'} y={0} w={144} h={8} rounded={4} bg=${theme.primary} />
        </Progress.Track>
      </Component>
    </Progress.Root>`
}

const SPINNER_FRAMES = 8

const spinner: KitDefinition = {
  kind: 'spinner',
  name: 'Kit/Spinner',
  insert: 'Frame=1',
  jsx: (theme) => {
    const frames = Array.from({ length: SPINNER_FRAMES }, (_, index) => {
      const turn = (index * 360) / SPINNER_FRAMES
      return `<Component name="Frame=${index + 1}" w={32} h={32}>
        <Ellipse name="Ring" x={2} y={2} w={28} h={28} stroke=${theme.subtle} strokeWidth={4} />
        <Ellipse name="Arc" x={2} y={2} w={28} h={28} startAngle={${turn}} endAngle={${turn + 90}} innerRadius={0.75} bg=${theme.primary} />
      </Component>`
    })
    return `<ComponentSet ${setAttrs('Kit/Spinner')}>${frames.join('')}</ComponentSet>`
  },
  wire: (w) => {
    // Each frame hands over to the next, so the arc turns for as long as it shows.
    for (let index = 1; index <= SPINNER_FRAMES; index++)
      w.on(w.layer(`Frame=${index}`), { type: 'after-delay', delay: 90 }, [
        w.changeTo(`Frame=${(index % SPINNER_FRAMES) + 1}`, INSTANT)
      ])
  }
}

const RATINGS = [0, 1, 2, 3, 4, 5] as const

const rating: KitDefinition = {
  kind: 'rating',
  name: 'Kit/Rating',
  insert: 'Rating=3',
  jsx: (theme) => {
    const variants = RATINGS.map((value) => {
      const stars = Array.from({ length: 5 }, (_, index) =>
        glyph('star', index < value ? '"#F59E0B"' : theme.border, {
          size: 24,
          layer: `Star ${index + 1}`,
          filled: true
        })
      ).join('')
      return `<Component name="Rating=${value}" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={4}>${stars}</Component>`
    })
    return `<ComponentSet ${setAttrs('Kit/Rating')}>${variants.join('')}</ComponentSet>`
  },
  wire: (w) => {
    const value = w.variable('Rating/value', 'FLOAT', 3)
    for (const shown of RATINGS)
      for (let star = 1; star <= 5; star++) {
        const layer = w.layer(`Rating=${shown}`, `Star ${star}`)
        w.on(layer, { type: 'click' }, [
          { type: 'set-variable', variable: value, value: star },
          w.changeTo(`Rating=${star}`, INSTANT)
        ])
      }
  }
}

export const CONTROL_KITS: readonly KitDefinition[] = [
  button,
  toggle,
  checkbox,
  radioGroup,
  slider,
  rangeSlider,
  progress,
  spinner,
  rating
]
