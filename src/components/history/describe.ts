import type { HistoryChangeSummary } from '@lawha/core/history'
import type { useHistoryMessages } from '@lawha/vue/i18n'

type Messages = ReturnType<typeof useHistoryMessages>['value']

const ACTION_MESSAGES = {
  create: 'actionCreate',
  delete: 'actionDelete',
  move: 'actionMove',
  resize: 'actionResize',
  rotate: 'actionRotate',
  reorder: 'actionReorder',
  rename: 'actionRename',
  'edit-text': 'actionEditText',
  restyle: 'actionRestyle'
} as const

/**
 * A change in the reader's language: what it did to which layers or paragraphs, as "Moved Card"
 * or "Edited text in 3 layers"; edits that name nothing say what kind they were.
 */
export function describeHistoryChange(
  summary: HistoryChangeSummary,
  t: Messages,
  unit: 'layers' | 'paragraphs' = 'layers'
): string {
  switch (summary.action) {
    case 'undo':
      return t.actionUndo
    case 'redo':
      return t.actionRedo
    case 'restore':
      return t.actionRestore
    case 'edit':
      return t.actionEdit
    default: {
      if (summary.count === 0) return t.actionEdit
      const [first] = summary.names
      const target = summary.count === 1 && first ? first : t[unit](summary.count)
      return t[ACTION_MESSAGES[summary.action]]({ target })
    }
  }
}

/** Two letters for an author's avatar. */
export function authorInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '')
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]]
  return letters
    .map((word) => (word ? Array.from(word)[0] : ''))
    .join('')
    .toLocaleUpperCase()
}

const AVATAR_HUES = [210, 280, 330, 20, 45, 150, 180, 250]

/** A colour picked from the name, so one author keeps one colour. */
export function authorColor(name: string, color: string | null): string {
  if (color) return color
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return `hsl(${AVATAR_HUES[hash % AVATAR_HUES.length]} 55% 45%)`
}
