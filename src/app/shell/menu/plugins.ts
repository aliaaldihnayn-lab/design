import { invoke } from '@tauri-apps/api/core'
import { useFileDialog } from '@vueuse/core'
import { computed, watch } from 'vue'

import {
  pluginCommands,
  type PluginBundle,
  type PluginCommand
} from '@lawha/core/figma-api/plugins'
import type { MenuEntry } from '@lawha/vue/editor/menu-model'
import { usePluginMessages } from '@lawha/vue/i18n'

import type { EditorStore } from '@/app/editor/active-store'
import { bundleFromPickedFiles } from '@/app/plugins/import'
import {
  installPlugin,
  installedPlugins,
  loadInstalledPlugins,
  removePlugin
} from '@/app/plugins/library'
import { runPlugin } from '@/app/plugins/session'
import { toast } from '@/app/shell/ui'
import { isTauri } from '@/app/tauri/env'

/** The event the desktop menu sends to remove a plugin; running one sends its browser menu id. */
const REMOVE_EVENT_PREFIX = 'plugin-remove:'

/** An installed plugin as `set_native_menu_plugins` takes it. */
interface NativeMenuPlugin {
  id: string
  name: string
  commands: PluginCommand[]
}

/** Keeps the desktop Plugins menu listing the installed plugins and their commands. */
function watchNativePluginMenu(): void {
  watch(
    installedPlugins,
    (bundles) => {
      if (!isTauri()) return
      const plugins: NativeMenuPlugin[] = bundles.map((bundle) => ({
        id: bundle.manifest.id,
        name: bundle.manifest.name,
        commands: pluginCommands(bundle.manifest)
      }))
      invoke('set_native_menu_plugins', { plugins }).catch((error: unknown) => {
        console.warn('[Plugins] Failed to update the native menu', error)
      })
    },
    { immediate: true }
  )
}

/** The Plugins menu: importing a plugin folder, each installed plugin's commands, removal. */
export function usePluginMenu(store: EditorStore) {
  const t = usePluginMessages()
  void loadInstalledPlugins().catch((error: unknown) => console.warn('[Plugins]', error))

  const dialog = useFileDialog({ multiple: true, directory: true, reset: true })
  dialog.onChange((files) => {
    if (!files || files.length === 0) return
    void (async () => {
      const read = await bundleFromPickedFiles([...files])
      if (!read.ok) {
        toast.error(t.value.importFailed({ error: read.error }))
        return
      }
      await installPlugin(read.bundle)
      toast.info(t.value.imported({ name: read.bundle.manifest.name }))
    })().catch((error: unknown) => toast.error(t.value.importFailed({ error: String(error) })))
  })

  function run(bundle: PluginBundle, command: string) {
    runPlugin(store, bundle, command, {
      notify: (message, error) => (error ? toast.error(message) : toast.info(message)),
      failed: (name, error) => toast.error(t.value.failed({ name, error }))
    })
  }

  /** A plugin's menu entries, nested as its manifest nests them. */
  function commandEntries(
    bundle: PluginBundle,
    commands: PluginCommand[],
    depth: number
  ): MenuEntry[] {
    const out: MenuEntry[] = []
    const submenus = new Map<string, PluginCommand[]>()
    for (const command of commands) {
      const folder = command.path.at(depth)
      if (folder === undefined)
        out.push({
          menuId: `plugin:${bundle.manifest.id}:${command.command}`,
          label: command.name,
          action: () => run(bundle, command.command)
        })
      else submenus.set(folder, [...(submenus.get(folder) ?? []), command])
    }
    for (const [label, nested] of submenus)
      out.push({ label, sub: commandEntries(bundle, nested, depth + 1) })
    return out
  }

  const installedEntries = computed<MenuEntry[]>(() =>
    installedPlugins.value.map((bundle) => {
      const commands = pluginCommands(bundle.manifest)
      return commands.length === 0
        ? {
            menuId: `plugin:${bundle.manifest.id}`,
            label: bundle.manifest.name,
            action: () => run(bundle, '')
          }
        : { label: bundle.manifest.name, sub: commandEntries(bundle, commands, 0) }
    })
  )

  function remove(bundle: PluginBundle) {
    void removePlugin(bundle.manifest.id).then(() =>
      toast.info(t.value.removed({ name: bundle.manifest.name }))
    )
  }

  const removeEntries = computed<MenuEntry[]>(() =>
    installedPlugins.value.map((bundle) => ({
      label: bundle.manifest.name,
      action: () => remove(bundle)
    }))
  )

  /**
   * What a desktop menu event for a plugin does: `plugin:<id>[:<command>]` runs it, as the
   * browser menu's ids do, and `plugin-remove:<id>` removes it.
   */
  function nativeAction(eventId: string): (() => void) | undefined {
    for (const bundle of installedPlugins.value) {
      const { id } = bundle.manifest
      if (eventId === `${REMOVE_EVENT_PREFIX}${id}`) return () => remove(bundle)
      if (eventId === `plugin:${id}`) return () => run(bundle, '')
      const command = pluginCommands(bundle.manifest).find(
        (item) => eventId === `plugin:${id}:${item.command}`
      )
      if (command) return () => run(bundle, command.command)
    }
    return undefined
  }

  return {
    importPlugin: () => dialog.open(),
    installedEntries,
    removeEntries,
    nativeAction,
    watchNativeMenu: watchNativePluginMenu
  }
}
