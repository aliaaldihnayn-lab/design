import { serializeHTML } from '#dom-css/export/html'
import { directionFromAttribute } from '#dom-css/import/direction'
import { INLINE_TAGS } from '#dom-css/import/flow'
import { parseStyleAttribute } from '#dom-css/import/style-attribute'
import type { CSSRuntime, DesignDocument, DesignElement, DesignNode } from '#dom-css/types'
import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5'

import { computeHeadlessStyles } from './styles'

function attrsToRecord(attrs: DefaultTreeAdapterTypes.Element['attrs']): Record<string, string> {
  const result: Record<string, string> = {}
  for (const attr of attrs) result[attr.name] = attr.value
  return result
}

function isTextNode(
  node: DefaultTreeAdapterTypes.ChildNode
): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text'
}

const NON_RENDERED_TAGS = new Set(['head', 'link', 'meta', 'script', 'style', 'template', 'title'])

function isInlineElement(node: DefaultTreeAdapterTypes.ChildNode | undefined): boolean {
  return node !== undefined && 'tagName' in node && INLINE_TAGS.has(node.tagName.toLowerCase())
}

/**
 * Text, and the spaces in or beside inline elements, which CSS draws among their words; spaces
 * between blocks lay nothing out, so they are left out.
 */
function keepsText(
  node: DefaultTreeAdapterTypes.TextNode,
  siblings: readonly DefaultTreeAdapterTypes.ChildNode[],
  index: number,
  inInline: boolean
): boolean {
  if (node.value.trim().length > 0) return true
  return (
    node.value.length > 0 &&
    (inInline || isInlineElement(siblings[index - 1]) || isInlineElement(siblings[index + 1]))
  )
}

function childrenToDesignNodes(
  nodes: readonly DefaultTreeAdapterTypes.ChildNode[],
  inInline: boolean
): DesignNode[] {
  return nodes
    .map((node, index) => childToDesignNode(node, index, nodes, inInline))
    .filter((child): child is DesignNode => child !== null)
}

function childToDesignNode(
  node: DefaultTreeAdapterTypes.ChildNode,
  index: number,
  siblings: readonly DefaultTreeAdapterTypes.ChildNode[],
  inInline: boolean
): DesignNode | null {
  if (isTextNode(node)) {
    return keepsText(node, siblings, index, inInline) ? { type: 'text', text: node.value } : null
  }

  if (!('tagName' in node)) return null
  if (NON_RENDERED_TAGS.has(node.tagName.toLowerCase())) return null

  const attrs = attrsToRecord(node.attrs)
  const element: DesignElement = {
    type: 'element',
    tagName: node.tagName.toLowerCase(),
    attrs,
    children: childrenToDesignNodes(node.childNodes, isInlineElement(node))
  }

  const inlineStyle = parseStyleAttribute(attrs.style)
  if (inlineStyle) element.inlineStyle = inlineStyle

  return element
}

/** The direction a whole page sets with `dir` on its `<html>` or `<body>`; the body's wins. */
function pageDirection(html: string) {
  if (!/<(?:html|body)\b[^>]*\bdir\s*=/iu.test(html)) return undefined
  const root = parse(html).childNodes.find((node) => 'tagName' in node && node.tagName === 'html')
  if (!root || !('tagName' in root)) return undefined
  const body = root.childNodes.find((node) => 'tagName' in node && node.tagName === 'body')
  const dirOf = (node: DefaultTreeAdapterTypes.ChildNode | undefined) =>
    node && 'attrs' in node ? node.attrs.find((attr) => attr.name === 'dir')?.value : undefined
  return directionFromAttribute(dirOf(body)) ?? directionFromAttribute(dirOf(root))
}

function parseHTML(html: string): DesignDocument {
  const fragment = parseFragment(html)
  const dir = pageDirection(html)
  return {
    type: 'document',
    children: childrenToDesignNodes(fragment.childNodes, false),
    ...(dir ? { dir } : {})
  }
}

export function createHeadlessCSSRuntime(): CSSRuntime {
  return {
    kind: 'headless',
    parseHTML,
    serializeHTML(document: DesignDocument) {
      return serializeHTML(document)
    },
    async computeStyles(document: DesignDocument, cssText = '') {
      return computeHeadlessStyles(document, cssText)
    }
  }
}
