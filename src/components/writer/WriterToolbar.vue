<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { computed } from 'vue'

import { useWriterMessages } from '@lawha/vue/i18n'

import { WRITER_FONTS, WRITER_FONT_SIZES } from '@/app/writer/fonts'
import IconButton from '@/components/ui/button/IconButton.vue'
import Tip from '@/components/ui/overlay/Tip.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { writer } from './ui'
import WriterInsertTools from './WriterInsertTools.vue'

const { editor } = defineProps<{ editor: Editor }>()
const t = useWriterMessages()
const ui = writer()

const DEFAULT_STYLE = 'paragraph'
type StyleValue = 'paragraph' | `h${1 | 2 | 3 | 4 | 5 | 6}`
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const

const styleOptions = computed(() => [
  { value: DEFAULT_STYLE, label: t.value.normalText },
  ...HEADING_LEVELS.map((level) => ({
    value: `h${level}` as StyleValue,
    label: t.value.heading({ level: String(level) })
  }))
])

const paragraphStyle = computed<StyleValue>(() => {
  const level = HEADING_LEVELS.find((candidate) => editor.isActive('heading', { level: candidate }))
  return level ? `h${level}` : DEFAULT_STYLE
})

function setParagraphStyle(value: string) {
  const chain = editor.chain().focus()
  const level = HEADING_LEVELS.find((candidate) => value === `h${candidate}`)
  if (level) chain.setHeading({ level }).run()
  else chain.setParagraph().run()
}

const fontOptions = computed(() => WRITER_FONTS.map((font) => ({ value: font, label: font })))
const fontFamily = computed(() => {
  const value: unknown = editor.getAttributes('textStyle').fontFamily
  return typeof value === 'string' ? value.split(',')[0].replace(/["']/g, '').trim() : ''
})

const sizeOptions = computed(() =>
  WRITER_FONT_SIZES.map((size) => ({ value: String(size), label: String(size) }))
)
const fontSize = computed(() => {
  const value: unknown = editor.getAttributes('textStyle').fontSize
  return typeof value === 'string' ? value.replace(/pt$/, '') : ''
})

const textColor = computed(() => {
  const value: unknown = editor.getAttributes('textStyle').color
  return typeof value === 'string' && value.startsWith('#') ? value : '#000000'
})
const highlightColor = computed(() => {
  const value: unknown = editor.getAttributes('highlight').color
  return typeof value === 'string' && value.startsWith('#') ? value : '#ffff00'
})

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : ''
}

const inList = computed(() => editor.isActive('listItem'))
const direction = computed(() => {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const dir: unknown = $from.node(depth).attrs.dir
    if (dir === 'rtl' || dir === 'ltr') return dir
  }
  return null
})
</script>

<template>
  <div :class="ui.bar()" role="toolbar" :aria-label="t.format">
    <div :class="ui.group()">
      <IconButton
        :label="t.undo"
        :disabled="!editor.can().undo()"
        @click="editor.chain().focus().undo().run()"
      >
        <icon-lucide-undo-2 class="size-3.5 rtl:-scale-x-100" />
      </IconButton>
      <IconButton
        :label="t.redo"
        :disabled="!editor.can().redo()"
        @click="editor.chain().focus().redo().run()"
      >
        <icon-lucide-redo-2 class="size-3.5 rtl:-scale-x-100" />
      </IconButton>
    </div>
    <div :class="ui.group()">
      <AppSelect
        :model-value="paragraphStyle"
        :options="styleOptions"
        :label="t.paragraphStyle"
        :ui="{ trigger: 'w-32' }"
        data-test-id="writer-paragraph-style"
        @update:model-value="setParagraphStyle"
      />
      <AppSelect
        :model-value="fontFamily"
        :options="fontOptions"
        :label="t.font"
        :placeholder="t.font"
        :ui="{ trigger: 'w-40' }"
        @update:model-value="(font: string) => editor.chain().focus().setFontFamily(font).run()"
      />
      <AppSelect
        :model-value="fontSize"
        :options="sizeOptions"
        :label="t.fontSize"
        placeholder="11"
        :ui="{ trigger: 'w-16' }"
        @update:model-value="
          (size: string) => editor.chain().focus().setFontSize(`${size}pt`).run()
        "
      />
    </div>
    <div :class="ui.group()">
      <IconButton
        :label="t.bold"
        toggle
        :active="editor.isActive('bold')"
        @click="editor.chain().focus().toggleBold().run()"
      >
        <icon-lucide-bold class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.italic"
        toggle
        :active="editor.isActive('italic')"
        @click="editor.chain().focus().toggleItalic().run()"
      >
        <icon-lucide-italic class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.underline"
        toggle
        :active="editor.isActive('underline')"
        @click="editor.chain().focus().toggleUnderline().run()"
      >
        <icon-lucide-underline class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.strikethrough"
        toggle
        :active="editor.isActive('strike')"
        @click="editor.chain().focus().toggleStrike().run()"
      >
        <icon-lucide-strikethrough class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.superscript"
        toggle
        :active="editor.isActive('superscript')"
        @click="editor.chain().focus().toggleSuperscript().run()"
      >
        <icon-lucide-superscript class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.subscript"
        toggle
        :active="editor.isActive('subscript')"
        @click="editor.chain().focus().toggleSubscript().run()"
      >
        <icon-lucide-subscript class="size-3.5" />
      </IconButton>
      <Tip :label="t.textColor">
        <label :class="ui.colorLabel()">
          <icon-lucide-baseline class="size-3.5" />
          <span :class="ui.colorSwatch()" :style="{ background: textColor }" />
          <input
            type="color"
            :class="ui.colorInput()"
            :value="textColor"
            :aria-label="t.textColor"
            @input="editor.chain().focus().setColor(inputValue($event)).run()"
          />
        </label>
      </Tip>
      <Tip :label="t.highlightColor">
        <label :class="ui.colorLabel()">
          <icon-lucide-highlighter class="size-3.5" />
          <span :class="ui.colorSwatch()" :style="{ background: highlightColor }" />
          <input
            type="color"
            :class="ui.colorInput()"
            :value="highlightColor"
            :aria-label="t.highlightColor"
            @input="
              editor
                .chain()
                .focus()
                .setHighlight({ color: inputValue($event) })
                .run()
            "
          />
        </label>
      </Tip>
      <IconButton :label="t.clearFormatting" @click="editor.chain().focus().unsetAllMarks().run()">
        <icon-lucide-remove-formatting class="size-3.5" />
      </IconButton>
    </div>
    <div :class="ui.group()">
      <IconButton
        :label="t.alignLeft"
        toggle
        :active="editor.isActive({ textAlign: 'left' })"
        @click="editor.chain().focus().setTextAlign('left').run()"
      >
        <icon-lucide-align-left class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.alignCenter"
        toggle
        :active="editor.isActive({ textAlign: 'center' })"
        @click="editor.chain().focus().setTextAlign('center').run()"
      >
        <icon-lucide-align-center class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.alignRight"
        toggle
        :active="editor.isActive({ textAlign: 'right' })"
        @click="editor.chain().focus().setTextAlign('right').run()"
      >
        <icon-lucide-align-right class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.justify"
        toggle
        :active="editor.isActive({ textAlign: 'justify' })"
        @click="editor.chain().focus().setTextAlign('justify').run()"
      >
        <icon-lucide-align-justify class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.rightToLeft"
        toggle
        :active="direction === 'rtl'"
        data-test-id="writer-rtl"
        @click="editor.chain().focus().setTextDirection('rtl').run()"
      >
        <icon-lucide-pilcrow-left class="size-3.5" />
      </IconButton>
      <IconButton
        :label="t.leftToRight"
        toggle
        :active="direction === 'ltr'"
        data-test-id="writer-ltr"
        @click="editor.chain().focus().setTextDirection('ltr').run()"
      >
        <icon-lucide-pilcrow-right class="size-3.5" />
      </IconButton>
    </div>
    <div :class="ui.group()">
      <IconButton
        :label="t.bulletList"
        toggle
        :active="editor.isActive('bulletList')"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        <icon-lucide-list class="size-3.5 rtl:-scale-x-100" />
      </IconButton>
      <IconButton
        :label="t.numberedList"
        toggle
        :active="editor.isActive('orderedList')"
        @click="editor.chain().focus().toggleOrderedList().run()"
      >
        <icon-lucide-list-ordered class="size-3.5 rtl:-scale-x-100" />
      </IconButton>
      <IconButton
        :label="t.outdent"
        :disabled="!inList"
        @click="editor.chain().focus().liftListItem('listItem').run()"
      >
        <icon-lucide-indent-decrease class="size-3.5 rtl:-scale-x-100" />
      </IconButton>
      <IconButton
        :label="t.indent"
        :disabled="!inList"
        @click="editor.chain().focus().sinkListItem('listItem').run()"
      >
        <icon-lucide-indent-increase class="size-3.5 rtl:-scale-x-100" />
      </IconButton>
    </div>
    <WriterInsertTools :editor="editor" />
    <slot />
  </div>
</template>
