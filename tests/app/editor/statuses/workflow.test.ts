import { describe, expect, test } from 'bun:test'

import { STATUS_WORKFLOW_PRESETS } from '@lawha/scene-graph/statuses'

import { statusStateName } from '@/app/editor/statuses/workflow'

const arabic = { readyForDev: 'جاهز للتطوير', completed: 'مكتمل' }

describe('statusStateName', () => {
  test("shows Figma's statuses in the interface's language while they keep their first names", () => {
    expect(STATUS_WORKFLOW_PRESETS.handoff.states.map((s) => statusStateName(s, arabic))).toEqual([
      arabic.readyForDev,
      arabic.completed
    ])
  })

  test('keeps the names a team chose', () => {
    const [ready] = STATUS_WORKFLOW_PRESETS.handoff.states
    expect(statusStateName({ ...ready, name: 'Handed off' }, arabic)).toBe('Handed off')
    // The review preset's Completed state is renamed Shipped.
    const shipped = STATUS_WORKFLOW_PRESETS.review.states.at(-1)
    expect(shipped && statusStateName(shipped, arabic)).toBe(shipped?.name)
    const draft = STATUS_WORKFLOW_PRESETS.simple.states[0]
    expect(statusStateName(draft, arabic)).toBe(draft.name)
  })
})
