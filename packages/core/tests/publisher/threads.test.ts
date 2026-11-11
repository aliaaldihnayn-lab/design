import { describe, expect, test } from 'bun:test'

import { composeStory, flowText, sliceRuns } from '#core/publisher/threads'

/** A frame that holds `chars` characters. */
const holds = (chars: number[]) => (frame: number, text: string) => text.length <= chars[frame]

describe('flowing a story through frames', () => {
  test('each frame takes whole words that fit; the last takes the rest', () => {
    const frames = flowText('one two three four five', 3, holds([8, 10, 3]))
    expect(frames).toEqual([
      { text: 'one two', lead: '', start: 0 },
      { text: 'three four', lead: ' ', start: 8 },
      { text: 'five', lead: ' ', start: 19 }
    ])
  })

  test('keeps the white space of each break, so the frames give the story back', () => {
    const story = 'alpha beta\n\ngamma delta'
    const frames = flowText(story, 2, holds([10, 100]))
    expect(frames[1].lead).toBe('\n\n')
    const joined = frames.map((f, i) => (i > 0 ? f.lead : '') + f.text).join('')
    expect(joined).toBe(story)
  })

  test('breaks a word only when not even one fits', () => {
    expect(flowText('abcdefghij', 2, holds([4, 100]))[0].text).toBe('abcd')
  })

  test('frames after the story ends are empty', () => {
    expect(flowText('short', 3, holds([50, 50, 50]))).toEqual([
      { text: 'short', lead: '', start: 0 },
      { text: '', lead: '', start: 5 },
      { text: '', lead: '', start: 5 }
    ])
  })

  test('composeStory reads nothing from an empty list', () => {
    expect(composeStory([])).toEqual({ text: '', runs: [] })
  })
})

describe('style runs across a story', () => {
  test('sliceRuns clips runs to a range and moves them to its start', () => {
    const bold = { fontWeight: 700 }
    expect(sliceRuns([{ start: 2, length: 6, style: bold }], 4, 10)).toEqual([
      { start: 0, length: 4, style: bold }
    ])
    expect(sliceRuns([{ start: 2, length: 2, style: bold }], 4, 10)).toEqual([])
  })
})
