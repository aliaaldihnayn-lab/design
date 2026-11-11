import { glyph, setAttrs, type KitDefinition } from './jsx'
import { tint, type KitTheme } from './theme'

/**
 * Fields that take real typing: each runs as its Reka UI control in preview and the player,
 * with focus, error, and disabled drawn as variants, a placeholder while empty, and a counter.
 */

const FIELD_STATES = ['Default', 'Focus', 'Error', 'Disabled'] as const
type FieldState = (typeof FIELD_STATES)[number]

function border(theme: KitTheme, state: FieldState): string {
  if (state === 'Error') return `stroke=${theme.danger} strokeWidth={1.5}`
  if (state === 'Focus') return `stroke=${theme.primary} strokeWidth={2}`
  return `stroke=${theme.border} strokeWidth={1}`
}

function fieldVariant(
  theme: KitTheme,
  state: FieldState,
  kind: 'TextField' | 'Textarea',
  options: { placeholder: string; height?: number; limit: number; search?: boolean },
  filled: boolean
): string {
  const dir = theme.rtl ? 'flow="rtl"' : ''
  const icon = options.search ? glyph('search', theme.muted, { layer: 'Icon' }) : ''
  const clear = options.search
    ? `<TextField.Clear name="Clear" w={16} h={16}>${glyph('close', theme.muted, { layer: 'Glyph' })}</TextField.Clear>`
    : ''
  const counter = `<${kind}.Count name="Counter" size={12} font="${theme.font}" color=${state === 'Error' ? theme.danger : theme.muted} ${theme.rtl ? 'dir="rtl"' : ''}>{"0/${options.limit}"}</${kind}.Count>`
  const height = options.height ? `h={${options.height}} items="start"` : 'items="center"'
  return `<Component name="State=${state}, Filled=${filled}" flex="col" gap={6} w={280} opacity={${state === 'Disabled' ? 0.5 : 1}}>
    <Frame name="Field" flex="row" ${dir} gap={8} px={12} py={10} w="fill" ${height} rounded={8} bg=${state === 'Disabled' ? theme.subtle : theme.surface} ${border(theme, state)} ${state === 'Focus' ? `shadow="0 0 0 3 ${JSON.parse(tint('"#4F46E5"', 0.2))}"` : ''}>
      ${icon}
      <${kind}.Input name="Value" grow={1} size={14} font="${theme.font}" color=${theme.text} ${theme.rtl ? 'dir="rtl" textAlign="right"' : ''}>{${JSON.stringify(options.placeholder)}}</${kind}.Input>
      ${clear}
    </Frame>
    ${options.search ? '' : counter}
  </Component>`
}

function field(
  kind: 'TextField' | 'Textarea',
  name: string,
  options: (theme: KitTheme) => {
    placeholder: string
    height?: number
    limit: number
    search?: boolean
  }
): (theme: KitTheme) => string {
  return (theme) =>
    `<${kind}.Root ${setAttrs(name)} filled={{ property: "Filled", on: "true", off: "false" }} states="State">${FIELD_STATES.flatMap((state) => [false, true].map((filled) => fieldVariant(theme, state, kind, options(theme), filled))).join('')}</${kind}.Root>`
}

const textInput: KitDefinition = {
  kind: 'text-input',
  name: 'Kit/Text input',
  insert: 'State=Default, Filled=false',
  jsx: field('TextField', 'Kit/Text input', (theme) => ({
    placeholder: theme.labels.email,
    limit: 60
  }))
}

const textarea: KitDefinition = {
  kind: 'textarea',
  name: 'Kit/Textarea',
  insert: 'State=Default, Filled=false',
  jsx: field('Textarea', 'Kit/Textarea', (theme) => ({
    placeholder: theme.labels.message,
    height: 96,
    limit: 280
  }))
}

const search: KitDefinition = {
  kind: 'search',
  name: 'Kit/Search',
  insert: 'State=Default, Filled=false',
  jsx: field('TextField', 'Kit/Search', (theme) => ({
    placeholder: theme.labels.search,
    limit: 100,
    search: true
  }))
}

const numberStepper: KitDefinition = {
  kind: 'number-stepper',
  name: 'Kit/Number stepper',
  insert: 'Number stepper',
  jsx: (theme) => {
    const button = (part: 'Decrement' | 'Increment') =>
      `<NumberField.${part} name="${part}" w={36} h={36} flex="row" items="center" justify="center" bg=${theme.subtle} rounded={6}>${glyph(part === 'Increment' ? 'plus' : 'minus', theme.text, { layer: 'Glyph' })}</NumberField.${part}>`
    return `<NumberField.Root name="Kit/Number stepper" min={0} max={10} step={1} defaultValue={1}>
      <Component name="Number stepper" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={4} p={4} items="center" rounded={8} stroke=${theme.border} bg=${theme.surface}>
        ${button('Decrement')}
        <NumberField.Input name="Value" w={48} size={16} weight={600} textAlign="center" font="${theme.font}" color=${theme.text}>1</NumberField.Input>
        ${button('Increment')}
      </Component>
    </NumberField.Root>`
  }
}

export const FIELD_KITS: readonly KitDefinition[] = [textInput, textarea, search, numberStepper]
