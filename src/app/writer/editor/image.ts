import Image from '@tiptap/extension-image'

/**
 * Images, such as placed signatures, resized by their corner handles. Tiptap's resizable view
 * sizes the picture from its attributes only when it is created, so an undone or redone resize
 * changed the document but left the picture at its last dragged size; this view also sizes it
 * on every update.
 */
export const WriterImage = Image.extend({
  addNodeView() {
    const create = this.parent?.()
    if (!create) return null
    return (props) => {
      const view = create(props)
      const update = view.update?.bind(view)
      if (!update) return view
      view.update = (node, decorations, innerDecorations) => {
        if (!update(node, decorations, innerDecorations)) return false
        const picture = view.dom instanceof HTMLElement ? view.dom.querySelector('img') : null
        if (picture) {
          const { width, height } = node.attrs
          picture.style.width = typeof width === 'number' ? `${width}px` : ''
          picture.style.height = typeof height === 'number' ? `${height}px` : ''
        }
        return true
      }
      return view
    }
  }
})
