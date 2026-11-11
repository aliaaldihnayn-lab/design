import type { Element } from '@xmldom/xmldom'

import type { Fill, SceneNode } from '@lawha/scene-graph'
import { BLACK } from '@lawha/scene-graph/constants'
import { parseSVGPath } from '@lawha/scene-graph/parse-path'
import type { Vector } from '@lawha/scene-graph/primitives'

import { addGraphicFrame } from './graphic-frame'
import {
  imageFill,
  readEffects,
  readFills,
  readStrokes,
  styleRefColor,
  visibleSolid
} from './paint'
import {
  ANGLE_UNIT,
  HAIRLINE_PX,
  normalizeAngle,
  placement,
  readBox,
  skip,
  type Box,
  type ShapeContext,
  type Space
} from './space'
import {
  EMU_PER_PX,
  levelStyle,
  masterTextStyle,
  readTextBody,
  textNodeProps,
  type TextStyle
} from './text'
import { attr, boolAttr, child, children, descend, numAttr } from './xml'

// ── Placeholders ─────────────────────────────────────────

interface PlaceholderInfo {
  type: string | null
  idx: string | null
}

function placeholderOf(shape: Element): PlaceholderInfo | null {
  const nv = children(shape).find((el) => (el.localName ?? '').startsWith('nv'))
  const ph = descend(nv, 'nvPr', 'ph')
  if (!ph) return null
  return { type: attr(ph, 'type'), idx: attr(ph, 'idx') }
}

/** Master placeholders match by kind: a subtitle or content box takes the body's place. */
function masterType(type: string | null): string {
  if (type === 'ctrTitle' || type === 'title') return 'title'
  if (type === 'dt' || type === 'ftr' || type === 'sldNum') return type
  return 'body'
}

function findPlaceholder(
  shapes: Element[],
  info: PlaceholderInfo,
  byKind: boolean
): Element | undefined {
  const withInfo = shapes.map((shape) => ({ shape, ph: placeholderOf(shape) }))
  if (!byKind && info.idx !== null) {
    const match = withInfo.find(({ ph }) => ph?.idx === info.idx)
    if (match) return match.shape
  }
  const wanted = byKind ? masterType(info.type) : (info.type ?? 'body')
  return withInfo.find(({ ph }) =>
    byKind ? ph && masterType(ph.type) === wanted : ph && (ph.type ?? 'body') === wanted
  )?.shape
}

function inheritedShapes(ctx: ShapeContext, info: PlaceholderInfo | null): Element[] {
  if (!info) return []
  const layout = findPlaceholder(ctx.placeholders.layout, info, false)
  const master = findPlaceholder(ctx.placeholders.master, info, true)
  return [layout, master].filter((shape): shape is Element => shape !== undefined)
}

function shapeProperties(shape: Element): Element | undefined {
  return child(shape, 'spPr')
}

// ── Geometry ─────────────────────────────────────────────

function presetPath(preset: string, w: number, h: number): string | null {
  switch (preset) {
    case 'triangle':
      return `M${w / 2} 0L${w} ${h}L0 ${h}Z`
    case 'rtTriangle':
      return `M0 0L0 ${h}L${w} ${h}Z`
    case 'diamond':
      return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`
    case 'parallelogram': {
      const offset = Math.min(w, h) * 0.25
      return `M${offset} 0L${w} 0L${w - offset} ${h}L0 ${h}Z`
    }
    case 'hexagon': {
      const offset = Math.min(w, h) * 0.25
      return `M${offset} 0L${w - offset} 0L${w} ${h / 2}L${w - offset} ${h}L${offset} ${h}L0 ${h / 2}Z`
    }
    default:
      return null
  }
}

/** An `a:arcTo` from `current`: OOXML gives radii and angles, SVG the arc's end. */
function arcCommand(command: Element, sx: number, sy: number, current: Vector) {
  const rx = (numAttr(command, 'wR') ?? 0) * sx
  const ry = (numAttr(command, 'hR') ?? 0) * sy
  const start = (((numAttr(command, 'stAng') ?? 0) / ANGLE_UNIT) * Math.PI) / 180
  const sweep = (((numAttr(command, 'swAng') ?? 0) / ANGLE_UNIT) * Math.PI) / 180
  const cx = current.x - rx * Math.cos(start)
  const cy = current.y - ry * Math.sin(start)
  const end = { x: cx + rx * Math.cos(start + sweep), y: cy + ry * Math.sin(start + sweep) }
  const large = Math.abs(sweep) > Math.PI ? 1 : 0
  return { d: `A${rx} ${ry} 0 ${large} ${sweep > 0 ? 1 : 0} ${end.x} ${end.y}`, end }
}

const PATH_COMMANDS: Partial<Record<string, { letter: string; points: number }>> = {
  moveTo: { letter: 'M', points: 1 },
  lnTo: { letter: 'L', points: 1 },
  cubicBezTo: { letter: 'C', points: 3 },
  quadBezTo: { letter: 'Q', points: 2 }
}

/** A custom geometry's paths as one SVG path in a `w` × `h` box. */
function customPath(geometry: Element, w: number, h: number): string | null {
  const parts: string[] = []
  for (const path of children(child(geometry, 'pathLst'), 'path')) {
    const sx = w / (numAttr(path, 'w') || w || 1)
    const sy = h / (numAttr(path, 'h') || h || 1)
    let current: Vector = { x: 0, y: 0 }
    for (const command of children(path)) {
      if (command.localName === 'close') {
        parts.push('Z')
        continue
      }
      if (command.localName === 'arcTo') {
        const arc = arcCommand(command, sx, sy, current)
        parts.push(arc.d)
        current = arc.end
        continue
      }
      const kind = PATH_COMMANDS[command.localName ?? '']
      const points = children(command, 'pt').map((pt) => ({
        x: (numAttr(pt, 'x') ?? 0) * sx,
        y: (numAttr(pt, 'y') ?? 0) * sy
      }))
      const last = points.at(-1)
      if (!kind || points.length !== kind.points || !last) continue
      parts.push(`${kind.letter}${points.map((p) => `${p.x} ${p.y}`).join(' ')}`)
      current = last
    }
  }
  return parts.length > 0 ? parts.join('') : null
}

// ── Shapes ───────────────────────────────────────────────

/** The layer for a shape's own geometry and paint, or null for a shape that paints nothing. */
function createGeometry(
  ctx: ShapeContext,
  parentId: string,
  spPr: Element | undefined,
  inherited: Element[],
  base: Partial<SceneNode>,
  paint: Pick<SceneNode, 'fills' | 'strokes' | 'effects'>
): SceneNode | null {
  const width = base.width ?? 0
  const height = base.height ?? 0
  const geometries = [spPr, ...inherited.map(shapeProperties)]
  const preset = geometries
    .map((el) => attr(child(el, 'prstGeom'), 'prst'))
    .find((value) => value !== null)
  const custom = geometries.map((el) => child(el, 'custGeom')).find((el) => el !== undefined)
  const props = { ...base, ...paint }
  if (custom || (preset && presetPath(preset, width, height))) {
    const d = custom ? customPath(custom, width, height) : presetPath(preset ?? '', width, height)
    if (!d) return null
    return ctx.graph.createNode('VECTOR', parentId, {
      ...props,
      vectorNetwork: parseSVGPath(d, 'NONZERO', {
        includeOpenRegions: paint.fills.length > 0 && paint.strokes.length === 0
      })
    })
  }
  if (preset === 'ellipse') return ctx.graph.createNode('ELLIPSE', parentId, props)
  if (preset && preset !== 'rect' && preset !== 'roundRect') skip(ctx, `shape ${preset}`)
  const gd = child(child(child(spPr, 'prstGeom'), 'avLst'), 'gd')
  const adjust = Number(/val\s+(-?\d+)/.exec(attr(gd, 'fmla') ?? '')?.[1] ?? 16667)
  return ctx.graph.createNode('RECTANGLE', parentId, {
    ...props,
    cornerRadius:
      preset === 'roundRect'
        ? Math.round(((Math.min(width, height) * adjust) / 100000) * 100) / 100
        : 0
  })
}

/** A line's ends in its parent's pixels: OOXML draws it corner to corner, flipped, then turned. */
function createLine(
  ctx: ShapeContext,
  parentId: string,
  lineBox: Box,
  props: Partial<SceneNode>
): SceneNode {
  // Writers give a straight line a hairline of extent so its box is not empty.
  const flatX = lineBox.width < HAIRLINE_PX
  const flatY = lineBox.height < HAIRLINE_PX
  const box = {
    ...lineBox,
    x: flatX ? lineBox.x + lineBox.width / 2 : lineBox.x,
    y: flatY ? lineBox.y + lineBox.height / 2 : lineBox.y,
    width: flatX ? 0 : lineBox.width,
    height: flatY ? 0 : lineBox.height
  }
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const start = { x: box.flipH ? box.width : 0, y: box.flipV ? box.height : 0 }
  const end = { x: box.flipH ? 0 : box.width, y: box.flipV ? 0 : box.height }
  const angle = (box.rotation * Math.PI) / 180
  const turn = (p: Vector) => {
    const dx = p.x - box.width / 2
    const dy = p.y - box.height / 2
    return {
      x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: cy + dx * Math.sin(angle) + dy * Math.cos(angle)
    }
  }
  const a = turn(start)
  const b = turn(end)
  const round = (v: number) => Math.round(v * 100) / 100
  return ctx.graph.createNode('LINE', parentId, {
    ...props,
    x: round(a.x),
    y: round(a.y),
    width: round(Math.hypot(b.x - a.x, b.y - a.y)),
    height: 0,
    rotation: normalizeAngle((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI),
    fills: []
  })
}

function textInherited(
  ctx: ShapeContext,
  info: PlaceholderInfo | null,
  inherited: Element[]
): (level: number) => TextStyle {
  const { masterRoot, defaultText } = ctx.placeholders
  const lists = [
    info ? masterTextStyle(masterRoot, info.type) : defaultText,
    ...inherited.map((shape) => child(child(shape, 'txBody'), 'lstStyle')).reverse()
  ]
  // Text that names no font is set in the theme's body font.
  const fonts: TextStyle = { latin: ctx.theme.fonts.minor }
  if (ctx.theme.fonts.minorCS) fonts.cs = ctx.theme.fonts.minorCS
  return (level) =>
    lists.reduce<TextStyle>(
      (style, list) => ({ ...style, ...levelStyle(list, level, ctx.theme) }),
      fonts
    )
}

/**
 * Shadows the text itself casts (`a:rPr/a:effectLst`: inner and outer shadows on the letters),
 * from the first run that sets them; a text layer has one set of effects for all its runs.
 */
function textEffects(ctx: ShapeContext, txBody: Element | undefined) {
  for (const paragraph of children(txBody, 'p')) {
    for (const run of children(paragraph, 'r')) {
      const effects = readEffects(ctx, child(run, 'rPr'))
      if (effects.length > 0) return effects
    }
  }
  return []
}

function isLine(preset: string | null | undefined, kind: string): boolean {
  return (
    preset === 'line' ||
    preset === 'straightConnector1' ||
    (kind === 'cxnSp' && (preset ?? '').includes('Connector'))
  )
}

function addShape(ctx: ShapeContext, parentId: string, shape: Element, space: Space): void {
  const nv = children(shape).find((el) => (el.localName ?? '').startsWith('nv'))
  const cNvPr = child(nv, 'cNvPr')
  const info = placeholderOf(shape)
  if (info && !ctx.drawPlaceholders) return
  const inherited = inheritedShapes(ctx, info)
  const spPr = shapeProperties(shape)
  const xfrm = [spPr, ...inherited.map(shapeProperties)]
    .map((el) => child(el, 'xfrm'))
    .find((el) => el !== undefined)
  const box = readBox(xfrm, space)
  if (!box) {
    skip(ctx, 'shape without position')
    return
  }
  const style = child(shape, 'style')
  const size = { width: box.width, height: box.height }
  const fills =
    [spPr, ...inherited.map(shapeProperties)]
      .map((el) => readFills(ctx, el, size))
      .find((value) => value !== null) ?? visibleSolid(styleRefColor(style, 'fillRef', ctx.theme))
  const ln = [spPr, ...inherited.map(shapeProperties)]
    .map((el) => child(el, 'ln'))
    .find((el) => el !== undefined)
  const strokes = readStrokes(ctx, ln, style)
  const effects = readEffects(ctx, spPr)
  const name = attr(cNvPr, 'name') || 'Shape'
  const visible = !(boolAttr(cNvPr, 'hidden') ?? false)
  const preset = [spPr, ...inherited.map(shapeProperties)]
    .map((el) => attr(child(el, 'prstGeom'), 'prst'))
    .find((value) => value !== null)

  if (isLine(preset, shape.localName ?? '')) {
    if (strokes.length > 0) createLine(ctx, parentId, box, { name, visible, strokes, effects })
    return
  }

  const txBody = child(shape, 'txBody')
  const body = txBody
    ? readTextBody(
        txBody,
        ctx.theme,
        textInherited(ctx, info, inherited),
        inherited.map((shape) => child(shape, 'txBody')).filter((el) => el !== undefined)
      )
    : null
  const hasPaint = fills.length > 0 || strokes.length > 0
  if (!hasPaint && !body) return

  const turn = placement(box)
  const fontColor = styleRefColor(style, 'fontRef', ctx.theme) ?? BLACK
  if (!body) {
    createGeometry(
      ctx,
      parentId,
      spPr,
      inherited,
      { name, visible, x: box.x, y: box.y, width: box.width, height: box.height, ...turn },
      { fills, strokes, effects }
    )
    return
  }

  const [left, top, right, bottom] = body.insets.map((v) => v / EMU_PER_PX)
  const textBox = {
    width: Math.max(1, box.width - left - right),
    height: Math.max(1, box.height - top - bottom)
  }
  if (!hasPaint) {
    // A text box: the text turns with its box but is never mirrored.
    const angle = (box.rotation * Math.PI) / 180
    const dx = (left - right) / 2
    const dy = (top - bottom) / 2
    const cx = box.x + box.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle)
    const cy = box.y + box.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)
    ctx.graph.createNode('TEXT', parentId, {
      ...textNodeProps(body, fontColor),
      name,
      visible,
      effects: [...effects, ...textEffects(ctx, txBody)],
      x: Math.round((cx - textBox.width / 2) * 100) / 100,
      y: Math.round((cy - textBox.height / 2) * 100) / 100,
      ...textBox,
      rotation: normalizeAngle(box.rotation)
    })
    return
  }
  // A shape with text: a group turns both, the shape alone is flipped.
  const group = ctx.graph.createNode('GROUP', parentId, {
    name,
    visible,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: normalizeAngle(box.rotation)
  })
  createGeometry(
    ctx,
    group.id,
    spPr,
    inherited,
    {
      name: `${name} shape`,
      x: 0,
      y: 0,
      width: box.width,
      height: box.height,
      flipX: box.flipH,
      flipY: box.flipV
    },
    { fills, strokes, effects }
  )
  ctx.graph.createNode('TEXT', group.id, {
    ...textNodeProps(body, fontColor),
    name: `${name} text`,
    effects: textEffects(ctx, txBody),
    x: Math.round(left * 100) / 100,
    y: Math.round(top * 100) / 100,
    ...textBox
  })
}

function addPicture(ctx: ShapeContext, parentId: string, picture: Element, space: Space): void {
  const cNvPr = descend(picture, 'nvPicPr', 'cNvPr')
  const info = placeholderOf(picture)
  const inherited = inheritedShapes(ctx, info)
  const spPr = shapeProperties(picture)
  const xfrm = [spPr, ...inherited.map(shapeProperties)]
    .map((el) => child(el, 'xfrm'))
    .find((el) => el !== undefined)
  const box = readBox(xfrm, space)
  if (!box) {
    skip(ctx, 'picture without position')
    return
  }
  const fill = imageFill(ctx, child(picture, 'blipFill'))
  if (!fill) {
    skip(ctx, 'picture format')
    return
  }
  const fills: Fill[] = [fill]
  createGeometry(
    ctx,
    parentId,
    spPr,
    inherited,
    {
      name: attr(cNvPr, 'name') || 'Picture',
      visible: !(boolAttr(cNvPr, 'hidden') ?? false),
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      ...placement(box)
    },
    {
      fills,
      strokes: readStrokes(ctx, child(spPr, 'ln'), child(picture, 'style')),
      effects: readEffects(ctx, spPr)
    }
  )
}

function addGroup(ctx: ShapeContext, parentId: string, groupShape: Element, space: Space): void {
  const cNvPr = descend(groupShape, 'nvGrpSpPr', 'cNvPr')
  const xfrm = descend(groupShape, 'grpSpPr', 'xfrm')
  const box = readBox(xfrm, space)
  if (!box) {
    walkShapes(ctx, parentId, groupShape, space)
    return
  }
  const chOff = child(xfrm, 'chOff')
  const chExt = child(xfrm, 'chExt')
  const ext = child(xfrm, 'ext')
  const ratio = (outer: number | null, inner: number | null) => (outer && inner ? outer / inner : 1)
  const group = ctx.graph.createNode('GROUP', parentId, {
    name: attr(cNvPr, 'name') || 'Group',
    visible: !(boolAttr(cNvPr, 'hidden') ?? false),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    ...placement(box)
  })
  walkShapes(ctx, group.id, groupShape, {
    originX: numAttr(chOff, 'x') ?? 0,
    originY: numAttr(chOff, 'y') ?? 0,
    scaleX: space.scaleX * ratio(numAttr(ext, 'cx'), numAttr(chExt, 'cx')),
    scaleY: space.scaleY * ratio(numAttr(ext, 'cy'), numAttr(chExt, 'cy'))
  })
  if (ctx.graph.getChildren(group.id).length === 0) ctx.graph.deleteNode(group.id)
}

/** Every drawable child of a shape tree (`p:spTree`) or group, back to front. */
export function walkShapes(ctx: ShapeContext, parentId: string, tree: Element, space: Space): void {
  for (const el of children(tree)) {
    switch (el.localName) {
      case 'sp':
      case 'cxnSp':
        addShape(ctx, parentId, el, space)
        break
      case 'pic':
        addPicture(ctx, parentId, el, space)
        break
      case 'grpSp':
        addGroup(ctx, parentId, el, space)
        break
      case 'AlternateContent': {
        // The fallback is what every reader draws.
        const fallback = child(el, 'Fallback')
        if (fallback) walkShapes(ctx, parentId, fallback, space)
        break
      }
      case 'graphicFrame':
        addGraphicFrame(ctx, parentId, el, space, walkShapes)
        break
      default:
        break
    }
  }
}
