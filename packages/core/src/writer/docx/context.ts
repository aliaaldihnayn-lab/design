import { strFromU8 } from 'fflate'

import { readStyleSheet, type StyleSheet } from './styles'
import { attrOf, kids, parseXML, valOf } from './xml'

/** The package's parts by path; a path the package lacks reads as undefined. */
export type PackageFiles = Readonly<Partial<Record<string, Uint8Array>>>

export interface Relationship {
  type: string
  target: string
  external: boolean
}

export interface ListLevel {
  ordered: boolean
  start: number
}

export interface Numbering {
  /** numId → abstract levels. */
  levels: Map<string, ListLevel[]>
}

/** Everything a part's content refers to: its relationships and the package's shared parts. */
export interface ReadContext {
  files: PackageFiles
  rels: Map<string, Relationship>
  /** Directory of the part, for resolving relative targets. */
  base: string
  styles: StyleSheet
  numbering: Numbering
}

export function readText(files: PackageFiles, path: string): string | null {
  const bytes = files[path]
  return bytes ? strFromU8(bytes) : null
}

export function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base ? base.split('/') : []
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop()
    else if (segment !== '.') parts.push(segment)
  }
  return parts.join('/')
}

export function readRels(files: PackageFiles, partPath: string): Map<string, Relationship> {
  const slash = partPath.lastIndexOf('/')
  const relsPath = `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`
  const root = parseXML(readText(files, relsPath) ?? '')
  const rels = new Map<string, Relationship>()
  for (const rel of kids(root, 'Relationship')) {
    const id = attrOf(rel, 'Id')
    if (!id) continue
    rels.set(id, {
      type: attrOf(rel, 'Type') ?? '',
      target: attrOf(rel, 'Target') ?? '',
      external: attrOf(rel, 'TargetMode') === 'External'
    })
  }
  return rels
}

export function readStyles(files: PackageFiles): StyleSheet {
  return readStyleSheet(readText(files, 'word/styles.xml'))
}

export function readNumbering(files: PackageFiles): Numbering {
  const root = parseXML(readText(files, 'word/numbering.xml') ?? '')
  const abstracts = new Map<string, ListLevel[]>()
  for (const abstract of kids(root, 'abstractNum')) {
    const id = attrOf(abstract, 'abstractNumId')
    if (id === null) continue
    const levels: ListLevel[] = []
    for (const lvl of kids(abstract, 'lvl')) {
      const index = Number(attrOf(lvl, 'ilvl') ?? 0)
      const format = valOf(lvl, 'numFmt') ?? 'decimal'
      levels[index] = {
        ordered: format !== 'bullet' && format !== 'none',
        start: Number(valOf(lvl, 'start') ?? 1)
      }
    }
    abstracts.set(id, levels)
  }
  const levels = new Map<string, ListLevel[]>()
  for (const num of kids(root, 'num')) {
    const id = attrOf(num, 'numId')
    const abstract = valOf(num, 'abstractNumId')
    const base = abstract === null ? undefined : abstracts.get(abstract)
    if (id === null || !base) continue
    const copy = [...base]
    for (const override of kids(num, 'lvlOverride')) {
      const index = Number(attrOf(override, 'ilvl') ?? 0)
      const start = valOf(override, 'startOverride')
      if (start !== null && copy[index]) copy[index] = { ...copy[index], start: Number(start) }
    }
    levels.set(id, copy)
  }
  return { levels }
}

export function partContext(base: ReadContext, path: string): ReadContext {
  return { ...base, rels: readRels(base.files, path), base: path.slice(0, path.lastIndexOf('/')) }
}
