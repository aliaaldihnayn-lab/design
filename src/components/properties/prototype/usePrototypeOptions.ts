import { computed, type MaybeRefOrGetter, toValue } from 'vue'

import {
  DIRECTIONS,
  EASINGS,
  TRANSITION_TYPES,
  TRIGGERS,
  changeDestinations,
  readFlows,
  screenOf,
  screensOf,
  type Action,
  type Transition
} from '@lawha/core/prototype'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'

export const DEFAULT_TRANSITION: Transition = {
  type: 'dissolve',
  direction: 'left',
  duration: 300,
  easing: 'ease-out'
}

/** Actions a conditional's branches can run: any but another conditional. */
export type SimpleAction = Exclude<Action, { type: 'conditional' }>

/**
 * What the prototype panel's controls choose from for the selected layer: triggers, actions,
 * transitions, the page's screens, the variants a Change to can show, and the variables a
 * prototype sets and compares, each labelled in the interface's language.
 */
export function usePrototypeOptions(nodeId: MaybeRefOrGetter<string | null>) {
  const store = useEditorStore()
  const t = usePrototypeMessages()
  // Re-read after every edit: the graph is not reactive, the scene version is.
  const version = computed(() => store.state.sceneVersion)
  const pageId = computed(() => store.state.currentPageId)

  const camel = (s: string) => s.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())
  const label = (prefix: string, value: string) => {
    const key = `${prefix}${camel(value)}`
    return Object.hasOwn(t.value, key) ? String(t.value[key as keyof typeof t.value]) : value
  }
  const options = (prefix: string, values: readonly string[]) =>
    values.map((value) => ({ value, label: label(prefix, value) }))

  const screens = computed(() => {
    void version.value
    return screensOf(store.graph, pageId.value)
  })
  /** Where Present starts: the selected screen, else the first flow, else the first screen. */
  const startScreen = computed(() => {
    void version.value
    const id = toValue(nodeId)
    if (id) {
      const own = screenOf(store.graph, id, pageId.value)
      if (own) return own.id
    }
    const page = store.graph.getNode(pageId.value)
    return (page ? readFlows(page).at(0)?.start : undefined) ?? screens.value.at(0)?.id ?? null
  })
  /** The variants a Change to on the layer can show, when it sits in an interactive component. */
  const variantOptions = computed(() => {
    void version.value
    const id = toValue(nodeId)
    return id
      ? changeDestinations(store.graph, id).map((s) => ({ value: s.id, label: s.name }))
      : []
  })
  const screenOptions = computed(() => screens.value.map((s) => ({ value: s.id, label: s.name })))
  /** Variables a prototype can set and compare: text, numbers, and true and false. */
  const variables = computed(() => {
    void version.value
    return [...store.graph.variables.values()].filter((variable) => variable.type !== 'COLOR')
  })

  /** The actions an action select offers. */
  const actionOptions = () =>
    options('action', [
      'navigate',
      'back',
      'overlay',
      'close-overlay',
      'open-url',
      'set-variable',
      ...(variantOptions.value.length > 1 ? ['change-to'] : [])
    ])

  function nextScreen(): string | null {
    const here = startScreen.value
    const list = screens.value
    const index = list.findIndex((s) => s.id === here)
    return (list.at(index + 1) ?? list.find((s) => s.id !== here))?.id ?? null
  }

  function defaultSimpleAction(type: SimpleAction['type'], transition: Transition): SimpleAction {
    const destination = nextScreen() ?? ''
    switch (type) {
      case 'navigate':
        return { type, destination, transition }
      case 'overlay':
        return { type, destination, position: 'center', closeOnOutside: true, transition }
      case 'back':
        return { type, transition }
      case 'open-url':
        return { type, url: 'https://example.com' }
      case 'scroll-to':
        return { type, destination }
      case 'set-variable': {
        const variable = variables.value.at(0)
        return { type, variable: variable?.id ?? '', toggle: variable?.type === 'BOOLEAN' }
      }
      case 'change-to': {
        // Another variant than the one the layer sits in.
        const id = toValue(nodeId)
        const other = variantOptions.value.find(
          (option) => !id || !store.graph.closest(id, (node) => node.id === option.value)
        )
        return { type, destination: other?.value ?? destination, transition }
      }
      default:
        return { type: 'close-overlay' }
    }
  }

  /** A new action of a type, keeping the transition the one before it had. */
  function defaultAction(type: Action['type'], transition: Transition): Action {
    if (type !== 'conditional') return defaultSimpleAction(type, transition)
    const variable = variables.value.at(0)
    return {
      type,
      when: [{ variable: variable?.id ?? '', op: 'truthy' }],
      actions: [defaultSimpleAction('navigate', transition)]
    }
  }

  return {
    pageId,
    screens,
    startScreen,
    variables,
    label,
    triggerOptions: computed(() => options('trigger', TRIGGERS)),
    transitionOptions: computed(() => options('transition', TRANSITION_TYPES)),
    directionOptions: computed(() => options('direction', DIRECTIONS)),
    easingOptions: computed(() => options('easing', EASINGS)),
    variableOptions: computed(() =>
      variables.value.map((variable) => ({ value: variable.id, label: variable.name }))
    ),
    screenOptions,
    variantOptions,
    actionOptions,
    destinationOptions: (action: Action) =>
      action.type === 'change-to' ? variantOptions.value : screenOptions.value,
    nextScreen,
    defaultAction
  }
}
