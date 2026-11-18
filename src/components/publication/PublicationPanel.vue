<script setup lang="ts">
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger
} from 'reka-ui'
import { tv } from 'tailwind-variants'
import { computed, type ComponentPublicInstance } from 'vue'

import type { PageNumberFormat, PublicationPage, PublicationSettings } from '@lawha/core'
import { usePageMessages } from '@lawha/vue/i18n'
import { useFlatReorderDrag } from '@lawha/vue/shared/drag'

import { useEditorStore } from '@/app/editor/active-store'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { useMenuUI } from '@/components/ui/menu/menu'
import MenuScrollArea from '@/components/ui/menu/MenuScrollArea.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import SegmentedControl from '@/components/ui/select/SegmentedControl.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'
import pageListTheme from '@/theme/page-list'

const store = useEditorStore()
const t = usePageMessages()
const menuCls = useMenuUI({ content: 'min-w-44', item: 'justify-start gap-2' })
const pageListStyles = tv(pageListTheme)
const baseStyles = pageListStyles()

/** The publication on the current canvas page, read again whenever the document changes. */
const pages = computed<PublicationPage[]>(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  return store.publicationPageList()
})
const settings = computed<PublicationSettings>(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  return store.getPublicationSettings()
})
const masters = computed(() => {
  void store.state.sceneVersion
  return store.listMasterPages()
})
const selectedIds = computed(() => store.state.selectedIds)

const reorder = useFlatReorderDrag<PublicationPage>({
  items: () => pages.value,
  onMove: (pageId, index) => store.movePublicationPage(pageId, index)
})

const formatOptions = computed(() => [
  { value: 'western', label: t.value.numberFormatWestern },
  { value: 'arabic-indic', label: t.value.numberFormatArabicIndic },
  { value: 'roman', label: t.value.numberFormatRoman },
  { value: 'roman-upper', label: t.value.numberFormatRomanUpper }
])
const directionOptions = computed(() => [
  { value: 'ltr', label: t.value.leftToRight },
  { value: 'rtl', label: t.value.rightToLeft }
])

const numberFormat = computed({
  get: (): string => settings.value.numberFormat,
  set: (value: string) => {
    if (isNumberFormat(value)) store.setPublicationSettings({ numberFormat: value })
  }
})
const direction = computed({
  get: (): string => settings.value.direction,
  set: (value: string) => {
    if (value === 'ltr' || value === 'rtl') store.setPublicationSettings({ direction: value })
  }
})
const numberStart = computed({
  get: (): number => settings.value.numberStart,
  set: (value: string | number) => {
    const start = Math.round(Number(value))
    if (Number.isFinite(start) && start >= 0 && start !== settings.value.numberStart)
      store.setPublicationSettings({ numberStart: start })
  }
})

function isNumberFormat(value: string): value is PageNumberFormat {
  return formatOptions.value.some((option) => option.value === value)
}

function setSpreads(value: boolean) {
  store.setPublicationSettings({ spreads: value })
}

function dropPosition(page: PublicationPage): 'before' | 'after' | undefined {
  if (reorder.instructionTargetId.value !== page.id) return undefined
  const operation = reorder.instruction.value?.operation
  if (operation === 'reorder-before') return 'before'
  if (operation === 'reorder-after') return 'after'
  return undefined
}

function rowStyles(page: PublicationPage) {
  return pageListStyles({
    active: selectedIds.value.has(page.id),
    dragging: reorder.draggingId.value === page.id,
    dropPosition: dropPosition(page)
  })
}

function setupRow(value: Element | ComponentPublicInstance | null, page: PublicationPage) {
  reorder.setupItem(value instanceof HTMLElement ? value : null, () => ({ id: page.id }))
}

function openPage(page: PublicationPage) {
  store.select([page.id])
  store.zoomToSelection()
}

function addPage(after?: PublicationPage) {
  const id = store.addPublicationPage(
    after?.id,
    t.value.pageName({ number: String(pages.value.length + 1) })
  )
  store.select([id])
}
</script>

<template>
  <div data-test-id="publication-panel" :class="baseStyles.panel()">
    <div :class="baseStyles.header()">
      <span :class="baseStyles.title()">{{ t.publicationPages }}</span>
      <IconButton
        :label="t.addPublicationPage"
        data-test-id="publication-add-page"
        @click="addPage()"
      >
        <icon-lucide-plus class="size-3.5" />
      </IconButton>
    </div>
    <div class="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 pb-2">
      <PanelFieldGroup :label="t.pageDirection">
        <SegmentedControl
          v-model="direction"
          :options="directionOptions"
          :label="t.pageDirection"
          data-test-id="publication-direction"
        />
      </PanelFieldGroup>
      <label class="flex items-center gap-1.5 text-[11px] text-muted">
        <AppCheckbox
          :model-value="settings.spreads"
          :ariaLabel="t.facingPages"
          data-test-id="publication-spreads"
          @update:model-value="setSpreads"
        />
        {{ t.facingPages }}
      </label>
      <div class="grid grid-cols-[1fr_4rem] gap-1.5">
        <PanelFieldGroup :label="t.pageNumberFormat">
          <AppSelect
            v-model="numberFormat"
            :label="t.pageNumberFormat"
            :options="formatOptions"
            data-test-id="publication-number-format"
          />
        </PanelFieldGroup>
        <PanelFieldGroup :label="t.pageNumberStart">
          <AppInput
            v-model.lazy="numberStart"
            type="number"
            :min="0"
            :step="1"
            :ariaLabel="t.pageNumberStart"
            data-test-id="publication-number-start"
          />
        </PanelFieldGroup>
      </div>
    </div>
    <div :class="baseStyles.body()">
      <div :class="baseStyles.viewport()" :dir="settings.direction">
        <p v-if="pages.length === 0" class="px-2 py-3 text-[11px] text-muted" dir="auto">
          {{ t.noPublicationPages }}
        </p>
        <ContextMenuRoot v-for="page in pages" :key="page.id" :modal="false">
          <ContextMenuTrigger as-child>
            <div
              :ref="(value) => setupRow(value, page)"
              data-test-id="publication-page-row"
              :data-page-id="page.id"
              :data-side="page.side"
              :data-drop-position="dropPosition(page)"
              :class="rowStyles(page).row()"
            >
              <div
                v-if="dropPosition(page) === 'before'"
                :class="rowStyles(page).dropIndicator()"
              />
              <button
                data-test-id="publication-page"
                :class="rowStyles(page).item()"
                dir="auto"
                @click="openPage(page)"
              >
                <span
                  data-test-id="publication-page-number"
                  class="w-6 shrink-0 text-end tabular-nums opacity-70"
                >
                  {{ page.number }}
                </span>
                <span :class="rowStyles(page).label()">{{ page.name }}</span>
                <span v-if="page.masterName" :class="rowStyles(page).trailing()" class="opacity-60">
                  {{ page.masterName }}
                </span>
              </button>
              <div v-if="dropPosition(page) === 'after'" :class="rowStyles(page).dropIndicator()" />
            </div>
          </ContextMenuTrigger>
          <ContextMenuPortal>
            <ContextMenuContent :class="menuCls.content" :side-offset="2" align="start">
              <MenuScrollArea>
                <ContextMenuItem
                  data-test-id="publication-context-add"
                  :class="menuCls.item"
                  @select="addPage(page)"
                >
                  <icon-lucide-plus :class="menuCls.icon" />
                  <span>{{ t.addPublicationPage }}</span>
                </ContextMenuItem>
                <ContextMenuItem
                  data-test-id="publication-context-duplicate"
                  :class="menuCls.item"
                  @select="store.duplicatePublicationPage(page.id)"
                >
                  <icon-lucide-copy :class="menuCls.icon" />
                  <span>{{ t.duplicatePublicationPage }}</span>
                </ContextMenuItem>
                <ContextMenuItem
                  data-test-id="publication-context-delete"
                  :class="menuCls.item"
                  :disabled="pages.length <= 1"
                  @select="store.deletePublicationPage(page.id)"
                >
                  <icon-lucide-trash-2 :class="menuCls.icon" />
                  <span>{{ t.deletePublicationPage }}</span>
                </ContextMenuItem>
                <ContextMenuSeparator :class="menuCls.separator" />
                <ContextMenuItem
                  v-for="master in masters"
                  :key="master.id"
                  data-test-id="publication-context-master"
                  :class="menuCls.item"
                  @select="store.setPublicationPageMaster(page.id, master.id)"
                >
                  <icon-lucide-layout-template :class="menuCls.icon" />
                  <span>{{ t.applyMasterPage({ name: master.name }) }}</span>
                </ContextMenuItem>
                <ContextMenuItem
                  v-if="page.masterId"
                  data-test-id="publication-context-no-master"
                  :class="menuCls.item"
                  @select="store.setPublicationPageMaster(page.id, null)"
                >
                  <icon-lucide-square-dashed :class="menuCls.icon" />
                  <span>{{ t.noMasterPage }}</span>
                </ContextMenuItem>
                <ContextMenuItem
                  v-if="page.masterId"
                  data-test-id="publication-context-detach"
                  :class="menuCls.item"
                  @select="store.detachFromMasterPage([page.id])"
                >
                  <icon-lucide-unlink :class="menuCls.icon" />
                  <span>{{ t.detachFromMaster }}</span>
                </ContextMenuItem>
                <ContextMenuItem
                  data-test-id="publication-context-convert"
                  :class="menuCls.item"
                  @select="store.convertToMasterPage(page.id)"
                >
                  <icon-lucide-component :class="menuCls.icon" />
                  <span>{{ t.convertToMasterPage }}</span>
                </ContextMenuItem>
              </MenuScrollArea>
            </ContextMenuContent>
          </ContextMenuPortal>
        </ContextMenuRoot>
      </div>
    </div>
    <div v-if="masters.length > 0" class="shrink-0 border-t border-border px-3 py-1.5">
      <div :class="baseStyles.title()">{{ t.masterPages }}</div>
      <button
        v-for="master in masters"
        :key="master.id"
        data-test-id="publication-master"
        :class="pageListStyles({ active: selectedIds.has(master.id) }).item()"
        dir="auto"
        @click="store.select([master.id])"
      >
        <icon-lucide-layout-template class="size-3 shrink-0 opacity-70" />
        <span class="min-w-0 flex-1 truncate">{{ master.name }}</span>
      </button>
    </div>
  </div>
</template>
