import type { DBSchema } from 'idb'
import * as v from 'valibot'
import { shallowRef } from 'vue'

import {
  pluginManifestSchema,
  type PluginBundle,
  type PluginClientStorage
} from '@lawha/core/figma-api/plugins'

import { APP_DATABASE_NAMES, connectAppDatabase, defineAppDatabase } from '@/app/storage/idb'

/** A plugin as the library keeps it. */
interface StoredPlugin {
  id: string
  bundle: PluginBundle
  installedAt: number
}

interface PluginDatabase extends DBSchema {
  plugins: { key: string; value: StoredPlugin }
  /** Each plugin's `figma.clientStorage`, keyed by plugin id and key. */
  storage: { key: [string, string]; value: { pluginId: string; key: string; value: unknown } }
}

const database = connectAppDatabase(
  defineAppDatabase<PluginDatabase>({
    name: APP_DATABASE_NAMES.plugins,
    version: 1,
    callbacks: {
      upgrade(db) {
        if (!db.objectStoreNames.contains('plugins'))
          db.createObjectStore('plugins', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('storage'))
          db.createObjectStore('storage', { keyPath: ['pluginId', 'key'] })
      }
    }
  })
)

const storedBundleSchema = v.object({
  manifest: pluginManifestSchema,
  code: v.string(),
  ui: v.record(v.string(), v.string())
})

/** Installed plugins, oldest first; loaded by `loadInstalledPlugins`. */
export const installedPlugins = shallowRef<PluginBundle[]>([])

export async function loadInstalledPlugins(): Promise<void> {
  const rows = await (await database.open()).getAll('plugins')
  installedPlugins.value = rows
    .sort((a, b) => a.installedAt - b.installedAt)
    .flatMap((row) => {
      // Rows written by an older build, or edited by hand, are skipped rather than run.
      const parsed = v.safeParse(storedBundleSchema, row.bundle)
      return parsed.success ? [parsed.output] : []
    })
}

/** Installs a plugin, replacing one with the same id. */
export async function installPlugin(bundle: PluginBundle): Promise<void> {
  const db = await database.open()
  const existing = await db.get('plugins', bundle.manifest.id)
  await db.put('plugins', {
    id: bundle.manifest.id,
    bundle,
    installedAt: existing?.installedAt ?? Date.now()
  })
  await loadInstalledPlugins()
}

export async function removePlugin(id: string): Promise<void> {
  const db = await database.open()
  const tx = db.transaction(['plugins', 'storage'], 'readwrite')
  await tx.objectStore('plugins').delete(id)
  const storage = tx.objectStore('storage')
  for (const key of await storage.getAllKeys(IDBKeyRange.bound([id, ''], [id, '￿'])))
    await storage.delete(key)
  await tx.done
  await loadInstalledPlugins()
}

/** `figma.clientStorage` for one plugin, kept in IndexedDB as Figma keeps it on the device. */
export function pluginClientStorage(pluginId: string): PluginClientStorage {
  return {
    async getAsync(key) {
      return (await (await database.open()).get('storage', [pluginId, key]))?.value
    },
    async setAsync(key, value) {
      await (await database.open()).put('storage', { pluginId, key, value })
    },
    async deleteAsync(key) {
      await (await database.open()).delete('storage', [pluginId, key])
    },
    async keysAsync() {
      const keys = await (
        await database.open()
      ).getAllKeys('storage', IDBKeyRange.bound([pluginId, ''], [pluginId, '￿']))
      return keys.map(([, key]) => key)
    }
  }
}
