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
  KeyB: 'BRUSH',
  KeyE: 'ERASER',
  KeyG: 'FILL_BUCKET',
  KeyI: 'COLOR_PICKER',
  KeyM: 'MARQUEE_RECT',
  'Shift+KeyM': 'MARQUEE_ELLIPSE',
  KeyW: 'MAGIC_WAND',
  KeyS: 'CLONE_STAMP',
  KeyJ: 'HEALING_BRUSH',
  KeyH: 'HAND',
  KeyC: 'COMMENT'
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
