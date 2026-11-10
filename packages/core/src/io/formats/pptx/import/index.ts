import type { Element } from '@xmldom/xmldom'

import { SceneGraph, type Fill } from '@lawha/scene-graph'
import { WHITE } from '@lawha/scene-graph/constants'

import { readFills, styleRefColor, visibleSolid, type PaintContext } from './paint'
import { SLIDE_SPACE, walkShapes, type Placeholders, type ShapeContext } from './shapes'
import { EMU_PER_PX } from './text'
import { readTheme, type PPTXTheme } from './theme'
import { attr, child, children, descend, numAttr, OOXMLPackage, relAttr } from './xml'

/**
 * PowerPoint `.pptx` as editable layers: each slide becomes a frame of the slide's size
 * (1 px = 9525 EMU), side by side on one page, holding its shapes, pictures, groups and live text
 * with their fills, lines, shadows, runs, alignment and direction. What its layout and master
 * draw sits underneath, and placeholders take their position and text style from them.
 */
export interface PPTXReadOptions {
  /** Receives what could not be read as layers, by reason, after reading. */
  onSkipped?: (counts: Record<string, number>) => void
}

const SLIDE_GAP = 100
/** 10 × 7.5 in, PowerPoint's size when a file names none. */
const DEFAULT_SLIDE = { cx: 9144000, cy: 6858000 }

function mainPart(pkg: OOXMLPackage): string {
  for (const rel of pkg.rels('').values()) {
    if (rel.type.endsWith('/officeDocument')) return rel.target
  }
  return 'ppt/presentation.xml'
}

function shapeTree(part: Element | null): Element | undefined {
  return descend(part, 'cSld', 'spTree')
}

/** A slide's background: its own, else its layout's, else its master's; white without one. */
function background(
  ctx: PaintContext,
  parts: { part: string; xml: Element | null }[],
  size: { width: number; height: number }
): Fill[] {
  for (const { part, xml } of parts) {
    const bg = descend(xml, 'cSld', 'bg')
    if (!bg) continue
    const props = child(bg, 'bgPr')
    if (props) {
      const fills = readFills({ ...ctx, part }, props, size)
      if (fills !== null) return fills
    }
    const ref = child(bg, 'bgRef')
    if (ref) return visibleSolid(styleRefColor(bg, 'bgRef', ctx.theme))
  }
  return [{ type: 'SOLID', color: { ...WHITE }, opacity: 1, visible: true }]
}

function showsMasterShapes(xml: Element | null): boolean {
  return attr(xml, 'showMasterSp') !== '0'
}

export async function readPPTXDocument(
  bytes: Uint8Array,
  options: PPTXReadOptions = {}
): Promise<SceneGraph> {
  const pkg = new OOXMLPackage(bytes)
  const presentationPart = mainPart(pkg)
  const presentation = pkg.xml(presentationPart)
  if (presentation?.localName !== 'presentation') {
    throw new Error('This file holds no PowerPoint presentation')
  }
  const slideSize = child(presentation, 'sldSz')
  const width = Math.round((numAttr(slideSize, 'cx') ?? DEFAULT_SLIDE.cx) / EMU_PER_PX)
  const height = Math.round((numAttr(slideSize, 'cy') ?? DEFAULT_SLIDE.cy) / EMU_PER_PX)
  const rels = pkg.rels(presentationPart)
  const slideParts = children(child(presentation, 'sldIdLst'), 'sldId')
    .map((slide) => rels.get(relAttr(slide, 'id') ?? '')?.target)
    .filter((part): part is string => part !== undefined)

  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const images = new Map<string, string | null>()
  const themes = new Map<string, PPTXTheme>()
  const skipped = new Map<string, number>()
  let x = 0

  slideParts.forEach((slidePart, index) => {
    const slide = pkg.xml(slidePart)
    if (!slide) return
    const layoutPart = pkg.related(slidePart, 'slideLayout')
    const layout = layoutPart ? pkg.xml(layoutPart) : null
    const masterPart = layoutPart ? pkg.related(layoutPart, 'slideMaster') : null
    const master = masterPart ? pkg.xml(masterPart) : null
    const themePart = masterPart ? pkg.related(masterPart, 'theme') : null
    const themeKey = themePart ?? ''
    let theme = themes.get(themeKey)
    if (!theme) {
      theme = readTheme(themePart ? pkg.xml(themePart) : null, master)
      themes.set(themeKey, theme)
    }
    const placeholders: Placeholders = {
      layout: children(shapeTree(layout)),
      master: children(shapeTree(master)),
      masterRoot: master,
      defaultText: child(presentation, 'defaultTextStyle')
    }
    const base: ShapeContext = {
      graph,
      pkg,
      theme,
      part: slidePart,
      images,
      placeholders,
      drawPlaceholders: true,
      skipped
    }
    const size = { width, height }
    const frame = graph.createNode('FRAME', pageId, {
      name: attr(child(slide, 'cSld'), 'name') || `Slide ${index + 1}`,
      x,
      y: 0,
      width,
      height,
      fills: background(
        base,
        [
          { part: slidePart, xml: slide },
          { part: layoutPart ?? '', xml: layout },
          { part: masterPart ?? '', xml: master }
        ],
        size
      ),
      clipsContent: true
    })
    // What the master and layout draw sits under the slide; their placeholders are prompts.
    const layers: { part: string; tree: Element | undefined }[] = []
    if (showsMasterShapes(slide) && showsMasterShapes(layout) && masterPart) {
      layers.push({ part: masterPart, tree: shapeTree(master) })
    }
    if (showsMasterShapes(slide) && layoutPart) {
      layers.push({ part: layoutPart, tree: shapeTree(layout) })
    }
    for (const { part, tree } of layers) {
      if (tree) walkShapes({ ...base, part, drawPlaceholders: false }, frame.id, tree, SLIDE_SPACE)
    }
    const tree = shapeTree(slide)
    if (tree) walkShapes(base, frame.id, tree, SLIDE_SPACE)
    x += width + SLIDE_GAP
  })

  if (slideParts.length === 0) throw new Error('This presentation has no slides')
  options.onSkipped?.(Object.fromEntries(skipped))
  return graph
}
