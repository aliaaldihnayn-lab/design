import { describe, expect, test } from 'bun:test'

import { createEditor, liveComponentScreens } from '@lawha/core'
import type { Interaction } from '@lawha/core/prototype'

/** Two screens, and on the first a button whose one interaction has the given trigger. */
function screensWith(trigger: Interaction['trigger']) {
  const editor = createEditor()
  const graph = editor.graph
  const pageId = editor.state.currentPageId
  const first = graph.createNode('FRAME', pageId, { name: 'First', width: 390, height: 844 })
  const second = graph.createNode('FRAME', pageId, {
    name: 'Second',
    x: 500,
    width: 390,
    height: 844
  })
  const button = graph.createNode('FRAME', first.id, { name: 'Button', width: 120, height: 40 })
  const interaction: Interaction = {
    trigger,
    action: {
      type: 'navigate',
      destination: second.id,
      transition: { type: 'instant', direction: 'left', duration: 0, easing: 'linear' }
    }
  }
  graph.updateNode(button.id, {
    pluginData: [
      { pluginId: 'lawha', key: 'prototype.interactions', value: JSON.stringify([interaction]) }
    ]
  })
  return { graph, first: first.id, second: second.id }
}

describe('the screens the player runs live', () => {
  test('a screen with a trigger its drawn image cannot answer, such as drag, runs live', () => {
    for (const trigger of [
      { type: 'mouse-enter' },
      { type: 'mouse-leave' },
      { type: 'mouse-down' },
      { type: 'mouse-up' },
      { type: 'drag' },
      { type: 'focus' },
      { type: 'blur' }
    ] as const) {
      const { graph, first, second } = screensWith(trigger)
      expect(liveComponentScreens(graph, [first, second])).toEqual([first])
    }
  })

  test('a screen with only clicks, hovers, presses, keys, and delays keeps its drawn image', () => {
    for (const trigger of [
      { type: 'click' },
      { type: 'hover' },
      { type: 'press' },
      { type: 'key', key: 'k' },
      { type: 'after-delay', delay: 500 }
    ] as const) {
      const { graph, first, second } = screensWith(trigger)
      expect(liveComponentScreens(graph, [first, second])).toEqual([])
    }
  })
})
