import * as v from 'valibot'

import { pluginManifestSchema, type PluginManifestMenuEntry } from './schema'

export type PluginManifest = v.InferOutput<typeof pluginManifestSchema>

/** A plugin as installed: its manifest and the files it names. */
export interface PluginBundle {
  manifest: PluginManifest
  /** The `main` script. */
  code: string
  /** The `ui` HTML, keyed by the manifest's names; `ui` alone when it names one file. */
  ui: Record<string, string>
}

/** A command a plugin offers in the Plugins menu; `path` holds its submenus' names. */
export interface PluginCommand {
  name: string
  command: string
  path: string[]
}

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; error: string }

/** Reads `manifest.json` text, reporting what is wrong with it. */
export function parsePluginManifest(text: string): ManifestResult {
  const parsed = v.safeParse(v.pipe(v.string(), v.parseJson(), pluginManifestSchema), text)
  if (parsed.success) return { ok: true, manifest: parsed.output }
  const issue = parsed.issues[0]
  const path = issue.path?.map((item) => String(item.key)).join('.')
  return { ok: false, error: path ? `${path}: ${issue.message}` : issue.message }
}

/** The manifest's `ui` as a map of names to file paths. */
export function uiFiles(manifest: PluginManifest): Record<string, string> {
  if (manifest.ui === undefined) return {}
  return typeof manifest.ui === 'string' ? { ui: manifest.ui } : manifest.ui
}

/** The commands a plugin's menu offers, depth first; none when it has no menu. */
export function pluginCommands(manifest: PluginManifest): PluginCommand[] {
  const out: PluginCommand[] = []
  const walk = (entries: PluginManifestMenuEntry[], path: string[]) => {
    for (const entry of entries) {
      if (entry.command && entry.name) out.push({ name: entry.name, command: entry.command, path })
      else if (entry.menu && entry.name) walk(entry.menu, [...path, entry.name])
    }
  }
  walk(manifest.menu ?? [], [])
  return out
}

/**
 * Builds a bundle from a plugin's files, keyed by their paths relative to the manifest, as a
 * folder holds them. Fails naming the file that is missing.
 */
export function bundleFromFiles(
  files: Readonly<Record<string, string>>
): { ok: true; bundle: PluginBundle } | { ok: false; error: string } {
  const normalized = new Map(Object.entries(files).map(([path, text]) => [normalize(path), text]))
  const manifestPath = [...normalized.keys()]
    .filter((path) => path === 'manifest.json' || path.endsWith('/manifest.json'))
    .sort((a, b) => a.length - b.length)
    .at(0)
  if (manifestPath === undefined) return { ok: false, error: 'manifest.json is missing' }
  const read = parsePluginManifest(normalized.get(manifestPath) ?? '')
  if (!read.ok) return { ok: false, error: `manifest.json: ${read.error}` }
  const base = manifestPath.slice(0, -'manifest.json'.length)
  const file = (path: string) => normalized.get(normalize(base + path))
  const code = file(read.manifest.main)
  if (code === undefined) return { ok: false, error: `${read.manifest.main} is missing` }
  const ui: Record<string, string> = {}
  for (const [name, path] of Object.entries(uiFiles(read.manifest))) {
    const html = file(path)
    if (html === undefined) return { ok: false, error: `${path} is missing` }
    ui[name] = html
  }
  return { ok: true, bundle: { manifest: read.manifest, code, ui } }
}

function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}
