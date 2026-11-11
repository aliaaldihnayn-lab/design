import type { Tool } from './types'

export interface EditorToolDef {
  key: Tool
  label: string
  shortcut: string
  flyout?: Tool[]
}

export const EDITOR_TOOLS: EditorToolDef[] = [
  { key: 'SELECT', label: 'Move', shortcut: 'V' },
  { key: 'FRAME', label: 'Frame', shortcut: 'F', flyout: ['FRAME', 'SECTION'] },
  {
    key: 'RECTANGLE',
    label: 'Rectangle',
    shortcut: 'R',
    flyout: ['RECTANGLE', 'LINE', 'ELLIPSE', 'POLYGON', 'STAR']
  },
  { key: 'PEN', label: 'Pen', shortcut: 'P', flyout: ['PEN', 'PENCIL'] },
  // Illustrator's Shape Builder and its key.
  { key: 'SHAPE_BUILDER', label: 'Shape builder', shortcut: 'Shift+M' },
  // Illustrator's Width tool and its key.
  { key: 'WIDTH', label: 'Width', shortcut: 'Shift+W' },
  { key: 'TEXT', label: 'Text', shortcut: 'T' },
  // Affinity Photo's pixel tools, on Photoshop's keys: B, E, G, and I.
  {
    key: 'BRUSH',
    label: 'Paint brush',
    shortcut: 'B',
    flyout: ['BRUSH', 'ERASER', 'FILL_BUCKET', 'COLOR_PICKER']
  },
  // Selections of a layer's pixels, on Photoshop's M and W.
  {
    key: 'MARQUEE_RECT',
    label: 'Rectangular marquee',
    shortcut: 'M',
    flyout: ['MARQUEE_RECT', 'MARQUEE_ELLIPSE', 'MAGIC_WAND']
  },
  // Retouching, on Photoshop's S and J; Alt-click sets the source.
  { key: 'CLONE_STAMP', label: 'Clone', shortcut: 'S', flyout: ['CLONE_STAMP', 'HEALING_BRUSH'] },
  // Figma's S is Slice, and FigJam's sticky tool has no key in Figma Design.
  { key: 'STICKY', label: 'Sticky note', shortcut: '' },
  // FigJam's R; here R is the rectangle, as in Figma Design.
  { key: 'SHAPE_WITH_TEXT', label: 'Shape', shortcut: '' },
  // FigJam's X; Figma Design has no connector tool to take a key from.
  { key: 'CONNECTOR', label: 'Connector', shortcut: '' },
  { key: 'HAND', label: 'Hand', shortcut: 'H' },
  { key: 'COMMENT', label: 'Comment', shortcut: 'C' }
]

export const TOOL_SHORTCUTS: Partial<Record<string, Tool>> = {
  KeyV: 'SELECT',
  KeyF: 'FRAME',
  KeyA: 'FRAME',
  'Shift+KeyS': 'SECTION',
  KeyR: 'RECTANGLE',
  KeyO: 'ELLIPSE',
  KeyL: 'LINE',
  KeyT: 'TEXT',
  KeyP: 'PEN',
  'Shift+KeyP': 'PENCIL',
  'Shift+KeyM': 'SHAPE_BUILDER',
  'Shift+KeyW': 'WIDTH',
  KeyB: 'BRUSH',
  KeyE: 'ERASER',
  KeyG: 'FILL_BUCKET',
  KeyI: 'COLOR_PICKER',
  // Shift+M stays Illustrator's Shape Builder; M again reaches the elliptical marquee.
  KeyM: 'MARQUEE_RECT',
  KeyW: 'MAGIC_WAND',
  KeyS: 'CLONE_STAMP',
  KeyJ: 'HEALING_BRUSH',
  KeyH: 'HAND',
  KeyC: 'COMMENT'
}

/**
 * Tools that share one key, as in Affinity: the key picks a cycle's first tool, and pressing it
 * again while one of the cycle's tools is active moves to the next.
 */
export const TOOL_KEY_CYCLES: readonly (readonly Tool[])[] = [['MARQUEE_RECT', 'MARQUEE_ELLIPSE']]

/** The tool a key picks while `current` is active: the key's tool, or the next one in its cycle. */
export function cycleToolKey(tool: Tool, current: Tool): Tool {
  const cycle = TOOL_KEY_CYCLES.find((tools) => tools[0] === tool)
  const index = cycle?.indexOf(current) ?? -1
  return cycle && index !== -1 ? (cycle[(index + 1) % cycle.length] ?? tool) : tool
}

/**
 * The tools a board offers, as FigJam's toolbar does: moving and panning, sticky notes, shapes,
 * connectors, sections, text, and comments, without Figma Design's drawing tools.
 */
export const BOARD_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  'SELECT',
  'HAND',
  'STICKY',
  'SHAPE_WITH_TEXT',
  'CONNECTOR',
  'SECTION',
  'TEXT',
  'COMMENT'
])

/** A board's tool keys, as in FigJam: S places a sticky note, R a shape, and X a connector. */
export const BOARD_TOOL_SHORTCUTS: Partial<Record<string, Tool>> = {
  KeyV: 'SELECT',
  KeyH: 'HAND',
  KeyS: 'STICKY',
  'Shift+KeyS': 'SECTION',
  KeyR: 'SHAPE_WITH_TEXT',
  KeyX: 'CONNECTOR',
  KeyT: 'TEXT',
  KeyC: 'COMMENT'
}
