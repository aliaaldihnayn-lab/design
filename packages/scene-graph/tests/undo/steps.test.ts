import { expect, test } from 'bun:test'

import { UndoManager, type UndoStepEvent } from '@lawha/scene-graph/undo'

const noop = () => undefined
const entry = (label: string, coalesceKey?: string) => ({
  label,
  forward: noop,
  inverse: noop,
  coalesceKey
})

test('reports committed steps, undos, and redos to step listeners', () => {
  const undo = new UndoManager()
  const events: UndoStepEvent[] = []
  const stop = undo.onStep((event) => events.push(event))

  undo.push(entry('Move'))
  undo.runBatch('Resize', () => undo.push(entry('inner')))
  undo.undo()
  undo.redo()

  expect(events).toEqual([
    { kind: 'record', label: 'Move', coalesced: false },
    { kind: 'record', label: 'Resize', coalesced: false },
    { kind: 'undo', label: 'Resize', coalesced: false },
    { kind: 'redo', label: 'Resize', coalesced: false }
  ])

  stop()
  undo.push(entry('After'))
  expect(events).toHaveLength(4)
})

test('marks a step that coalesced into the one before it', () => {
  const undo = new UndoManager()
  const events: UndoStepEvent[] = []
  undo.onStep((event) => events.push(event))

  undo.push(entry('Color', 'picker'))
  undo.push(entry('Color', 'picker'))

  expect(events.map((event) => event.coalesced)).toEqual([false, true])
})

test('an empty batch reports no step', () => {
  const undo = new UndoManager()
  const events: UndoStepEvent[] = []
  undo.onStep((event) => events.push(event))
  undo.runBatch('Nothing', () => undefined)
  expect(events).toEqual([])
})
