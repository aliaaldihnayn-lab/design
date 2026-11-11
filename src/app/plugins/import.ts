import { bundleFromFiles, type PluginBundle } from '@lawha/core/figma-api/plugins'

/** The most a plugin's text files may hold together: Figma's own limit for a plugin. */
const MAX_PLUGIN_BYTES = 10 * 1024 * 1024
const TEXT_FILE = /\.(json|js|mjs|cjs|html|htm|css|txt)$/i

export type PluginImportResult = { ok: true; bundle: PluginBundle } | { ok: false; error: string }

/**
 * Reads a plugin from the files of its folder (a directory pick keeps their relative paths) or
 * from `manifest.json` picked with the files it names.
 */
export async function bundleFromPickedFiles(files: readonly File[]): Promise<PluginImportResult> {
  const text = files.filter((file) => TEXT_FILE.test(file.name))
  const size = text.reduce((sum, file) => sum + file.size, 0)
  if (size > MAX_PLUGIN_BYTES) return { ok: false, error: 'the plugin is larger than 10 MB' }
  const entries = await Promise.all(
    text.map(async (file) => [file.webkitRelativePath || file.name, await file.text()] as const)
  )
  return bundleFromFiles(Object.fromEntries(entries))
}
