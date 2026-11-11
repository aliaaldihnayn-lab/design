<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed } from 'vue'

import {
  mmToTwips,
  PAGE_SIZE_IDS,
  PAGE_SIZES,
  pageSizeId,
  twipsToMM,
  type PageMargins,
  type PageSizeId,
  type WriterNode
} from '@lawha/core/writer'
import { useWriterMessages } from '@lawha/vue/i18n'

import { setWriterRegion, updateWriterDocument, writerDocument } from '@/app/writer/session'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { usePopoverUI } from '@/components/ui/overlay/popover'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { writer } from './ui'

/** Page size, orientation, margins, and page numbers, as Word's Page Setup sets them. */
const t = useWriterMessages()
const ui = writer()
const popover = usePopoverUI({ content: 'z-50 w-80 p-3' })

const SIZE_LABELS: Record<PageSizeId, string> = {
  a4: 'A4',
  a5: 'A5',
  a3: 'A3',
  letter: 'Letter',
  legal: 'Legal'
}
const CUSTOM = 'custom'

const page = computed(() => writerDocument.value.page)
const landscape = computed(() => page.value.width > page.value.height)
const sizeOptions = computed(() => [
  ...PAGE_SIZE_IDS.map((id) => ({ value: id as string, label: SIZE_LABELS[id] })),
  { value: CUSTOM, label: t.value.custom, disabled: true }
])
const size = computed(() => pageSizeId(page.value) ?? CUSTOM)
const orientationOptions = computed(() => [
  { value: 'portrait', label: t.value.portrait },
  { value: 'landscape', label: t.value.landscape }
])

function setSize(id: string) {
  const preset = PAGE_SIZE_IDS.find((candidate) => candidate === id)
  if (!preset) return
  const { width, height } = PAGE_SIZES[preset]
  updateWriterDocument({
    page: landscape.value
      ? { ...page.value, width: height, height: width }
      : { ...page.value, width, height }
  })
}

function setOrientation(value: string) {
  if ((value === 'landscape') === landscape.value) return
  updateWriterDocument({
    page: { ...page.value, width: page.value.height, height: page.value.width }
  })
}

type MarginSide = 'top' | 'bottom' | 'left' | 'right'
const MARGIN_SIDES: Array<{
  side: MarginSide
  label: 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight'
}> = [
  { side: 'top', label: 'marginTop' },
  { side: 'bottom', label: 'marginBottom' },
  { side: 'left', label: 'marginLeft' },
  { side: 'right', label: 'marginRight' }
]

const marginMM = (side: MarginSide) =>
  String(Math.round(twipsToMM(page.value.margins[side]) * 10) / 10)

function setMargin(side: MarginSide, value: string | number) {
  const mm = Number(value)
  if (!Number.isFinite(mm) || mm < 0 || mm > 100) return
  const margins: PageMargins = { ...page.value.margins, [side]: mmToTwips(mm) }
  updateWriterDocument({ page: { ...page.value, margins } })
}

/** A centered "page / pages" footer, keeping a footer the document already has. */
function addPageNumbers() {
  const field: WriterNode = {
    type: 'paragraph',
    attrs: { textAlign: 'center', dir: 'auto' },
    content: [{ type: 'pageNumber' }, { type: 'text', text: ' / ' }, { type: 'pageCount' }]
  }
  const footer = writerDocument.value.footer
  setWriterRegion('footer', {
    type: 'doc',
    content: [...(footer?.content ?? []), field]
  })
}
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <IconButton :label="t.pageSetup" data-test-id="writer-page-setup">
        <icon-lucide-file-cog class="size-3.5" />
      </IconButton>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent :class="popover.content" :side-offset="6" align="end">
        <div :class="ui.form()">
          <div :class="ui.formRow()">
            <span :class="ui.formLabel()">{{ t.pageSize }}</span>
            <AppSelect
              :model-value="size"
              :options="sizeOptions"
              :label="t.pageSize"
              size="sm"
              @update:model-value="setSize"
            />
          </div>
          <div :class="ui.formRow()">
            <span :class="ui.formLabel()">{{ t.orientation }}</span>
            <AppSelect
              :model-value="landscape ? 'landscape' : 'portrait'"
              :options="orientationOptions"
              :label="t.orientation"
              size="sm"
              data-test-id="writer-orientation"
              @update:model-value="setOrientation"
            />
          </div>
          <span :class="ui.formLabel()">{{ t.margins }}</span>
          <div :class="ui.formGrid()">
            <label v-for="margin in MARGIN_SIDES" :key="margin.side" class="flex flex-col gap-1">
              <span :class="ui.formLabel()">{{ t[margin.label] }}</span>
              <AppInput
                type="number"
                :min="0"
                :max="100"
                :step="0.5"
                :model-value="marginMM(margin.side)"
                :data-test-id="`writer-margin-${margin.side}`"
                @update:model-value="(value: string | number) => setMargin(margin.side, value)"
              />
            </label>
          </div>
          <AppButton
            size="sm"
            variant="outline"
            data-test-id="writer-page-numbers"
            @click="addPageNumbers"
          >
            <template #leading><icon-lucide-hash class="size-3.5" /></template>
            {{ t.addPageNumbers }}
          </AppButton>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
