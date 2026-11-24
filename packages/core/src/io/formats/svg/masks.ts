import type { SceneNode } from '@lawha/scene-graph'

import { nextDefId, type SVGExportContext } from './defs'
import { svg, type SVGNode } from './node'

/** Elements a `<clipPath>` may hold: shapes and text, never groups. */
const CLIP_SHAPES = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'text'
])

/**
 * The shapes of a rendered layer, each carrying the transforms of the groups around it, as a clip
 * path needs them: it takes only shapes, and only their geometry counts.
 */
function clipShapes(node: SVGNode, transform = ''): SVGNode[] {
  const own = typeof node.attrs.transform === 'string' ? node.attrs.transform : ''
  const combined = [transform, own].filter(Boolean).join(' ')
  if (CLIP_SHAPES.has(node.tag)) {
    const attrs: Record<string, string | number> = {}
    for (const [key, value] of Object.entries(node.attrs)) {
      if (!/^(?:fill|stroke|opacity|filter|style|clip-path|mask)/.test(key)) attrs[key] = value
    }
    if (combined) attrs.transform = combined
    return [{ tag: node.tag, attrs, children: node.tag === 'text' ? node.children : [] }]
  }
  if (node.tag !== 'g' && node.tag !== 'svg') return []
  return node.children.flatMap((child) =>
    typeof child === 'string' ? [] : clipShapes(child, combined)
  )
}

/** A mask layer as a definition, and the attribute that applies it to the layers it masks. */
function maskDefinition(
  mask: SceneNode,
  rendered: SVGNode,
  ctx: SVGExportContext
): Record<string, string> | null {
  // An outline mask clips to the mask's shape, which every PDF and SVG reader draws as a clip;
  // alpha and luminance masks keep the mask's paint.
  if (mask.maskType === 'VECTOR' || !mask.maskType) {
    const shapes = clipShapes(rendered)
    if (shapes.length === 0) return null
    const id = nextDefId(ctx, 'mask')
    ctx.defs.push(svg('clipPath', { id }, ...shapes))
    return { 'clip-path': `url(#${id})` }
  }
  const id = nextDefId(ctx, 'mask')
  const type = mask.maskType === 'LUMINANCE' ? 'luminance' : 'alpha'
  ctx.defs.push(
    svg('mask', { id, maskUnits: 'userSpaceOnUse', style: `mask-type: ${type}` }, rendered)
  )
  return { mask: `url(#${id})` }
}

/**
 * Children as Figma draws them with masks: a mask layer is not drawn itself but masks the layers
 * after it, up to the next mask, and masks in a row mask together.
 */
export function renderMaskedChildren(
  children: readonly SceneNode[],
  ctx: SVGExportContext,
  render: (node: SceneNode) => SVGNode | null
): SVGNode[] {
  const out: SVGNode[] = []
  let masks: Record<string, string>[] = []
  let masked: SVGNode[] = []
  let previousWasMask = false
  const close = () => {
    let content = masked
    for (const attrs of [...masks].reverse()) content = [svg('g', attrs, ...content)]
    out.push(...content)
    masks = []
    masked = []
  }
  for (const child of children) {
    if (child.visible && child.isMask) {
      if (!previousWasMask) close()
      previousWasMask = true
      const rendered = render({ ...child, isMask: false, opacity: 1 })
      const attrs = rendered ? maskDefinition(child, rendered, ctx) : null
      if (attrs) masks.push(attrs)
      continue
    }
    previousWasMask = false
    const rendered = render(child)
    if (!rendered) continue
    if (masks.length > 0) masked.push(rendered)
    else out.push(rendered)
  }
  close()
  return out
}
