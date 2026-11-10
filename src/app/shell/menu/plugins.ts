import { useFileDialog } from '@vueuse/core'
import { computed } from 'vue'

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

  const removeEntries = computed<MenuEntry[]>(() =>
    installedPlugins.value.map((bundle) => ({
      label: bundle.manifest.name,
      action: () => {
        void removePlugin(bundle.manifest.id).then(() =>
          toast.info(t.value.removed({ name: bundle.manifest.name }))
        )
      }
    }))
  )

  return { importPlugin: () => dialog.open(), installedEntries, removeEntries }
}
