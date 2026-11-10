import { i18n } from '#vue/i18n/create'

export const toolMessageDefaults = {
  move: 'Move',
  frame: 'Frame',
  section: 'Section',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  polygon: 'Polygon',
  star: 'Star',
  pen: 'Pen',
  pencil: 'Pencil',
  shapeBuilder: 'Shape builder',
  text: 'Text',
  sticky: 'Sticky note',
  shape: 'Shape',
  connector: 'Connector',
  hand: 'Hand',
  comment: 'Comment',
  brush: 'Paint brush',
  eraser: 'Eraser',
  fillBucket: 'Fill bucket',
  colorPicker: 'Color picker',
  marqueeRect: 'Rectangular marquee',
  marqueeEllipse: 'Elliptical marquee',
  magicWand: 'Magic wand',
  cloneStamp: 'Clone',
  healingBrush: 'Healing brush'
} as const

export const toolMessages = i18n('tools', toolMessageDefaults)
