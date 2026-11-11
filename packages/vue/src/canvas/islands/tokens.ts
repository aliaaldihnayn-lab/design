import { computedAsync } from '@vueuse/core'
import { watch, type Ref } from 'vue'

import { tokenStylesheet } from '@lawha/dom-css/export'

import { useEditor } from '#vue/editor/context'

/**
 * The document's variables as custom properties, which islands' `var()` references read in the
 * modes their layers set. Built once for every island of a view while `live` holds; an island is
 * a shadow root, so the stylesheet's `:root` is its host.
 */
export function useIslandTokens(live: Readonly<Ref<boolean>>): CSSStyleSheet {
  const editor = useEditor()
  const tokens = new CSSStyleSheet()
  const css = computedAsync(async () => {
    // Nothing reads the editor until something runs live: a player may mount before it opens.
    if (!live.value) return ''
    void editor.state.sceneVersion
    const { css: sheet } = await tokenStylesheet(editor.graph, { format: 'css' })
    return sheet.replaceAll(':root', ':host')
  }, '')
  watch(css, (value) => tokens.replaceSync(value), { immediate: true })
  return tokens
}
