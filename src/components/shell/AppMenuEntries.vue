<script setup lang="ts">
import {
  MenubarCheckboxItem,
  MenubarItem,
  MenubarItemIndicator,
  MenubarPortal,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger
} from 'reka-ui'
import IconChevronRight from '~icons/lucide/chevron-right'

import type { MenuEntry } from '@lawha/vue/editor/menu-model'

import {
  hasMenuSubItems,
  isMenuCheckbox,
  isMenuSeparator,
  menuChecked,
  menuDisabled,
  menuLabel,
  menuShortcut,
  menuSubItems,
  runMenuAction,
  updateMenuChecked
} from '@/app/shell/menu/entry'
import AppShortcutText from '@/components/ui/menu/AppShortcutText.vue'
import { useMenuUI } from '@/components/ui/menu/menu'
import MenuScrollArea from '@/components/ui/menu/MenuScrollArea.vue'

/**
 * A menu's entries, each submenu holding its own entries the same way, to any depth: a
 * plugin's manifest nests its commands as deep as it likes.
 */
const { items } = defineProps<{ items: readonly MenuEntry[] }>()

const menuCls = useMenuUI()
const subMenuCls = useMenuUI({ content: 'min-w-44' })
</script>

<template>
  <template v-for="(item, i) in items" :key="i">
    <MenubarSeparator v-if="isMenuSeparator(item)" :class="menuCls.separator" />
    <MenubarSub v-else-if="hasMenuSubItems(item)">
      <MenubarSubTrigger :class="menuCls.item" :disabled="menuDisabled(item)">
        <span class="flex-1"
          ><bdi>{{ menuLabel(item) }}</bdi></span
        >
        <IconChevronRight class="size-3 text-muted rtl:-scale-x-100" />
      </MenubarSubTrigger>
      <MenubarPortal>
        <MenubarSubContent :side-offset="4" :class="subMenuCls.content">
          <MenuScrollArea>
            <AppMenuEntries :items="menuSubItems(item)" />
          </MenuScrollArea>
        </MenubarSubContent>
      </MenubarPortal>
    </MenubarSub>
    <MenubarCheckboxItem
      v-else-if="isMenuCheckbox(item)"
      :model-value="menuChecked(item)"
      :class="menuCls.item"
      @update:model-value="updateMenuChecked(item, $event as boolean)"
    >
      <span class="flex-1"
        ><bdi>{{ menuLabel(item) }}</bdi></span
      >
      <MenubarItemIndicator class="text-surface">
        <icon-lucide-check class="size-3.5" />
      </MenubarItemIndicator>
    </MenubarCheckboxItem>
    <MenubarItem
      v-else
      :class="menuCls.item"
      :disabled="menuDisabled(item)"
      @select="runMenuAction(item)"
    >
      <span class="flex-1"
        ><bdi>{{ menuLabel(item) }}</bdi></span
      >
      <AppShortcutText v-if="menuShortcut(item)">{{ menuShortcut(item) }}</AppShortcutText>
    </MenubarItem>
  </template>
</template>
