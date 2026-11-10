import { Mark, mergeAttributes, Node } from '@tiptap/core'

/**
 * Document-editor nodes and marks Tiptap does not ship, named as `@lawha/core/writer` names
 * them so the Word and Google Docs converters read the editor's JSON directly.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    writerPageBreak: { setPageBreak: () => ReturnType }
    writerPageField: { insertPageField: (kind: 'pageNumber' | 'pageCount') => ReturnType }
    writerComment: {
      setComment: (commentId: string) => ReturnType
      unsetComment: (commentId: string) => ReturnType
    }
    writerScript: {
      toggleSuperscript: () => ReturnType
      toggleSubscript: () => ReturnType
    }
    writerFormField: {
      insertFormField: (attrs: { kind: 'text' | 'date' | 'checkbox'; name: string }) => ReturnType
    }
    writerFootnote: { insertFootnote: (id: string) => ReturnType }
    writerTableOfContents: { insertTableOfContents: () => ReturnType }
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'writer-page-break' })
  ],
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent([{ type: this.name }, { type: 'paragraph' }])
            .run()
    }
  }
})

function pageField(name: 'pageNumber' | 'pageCount') {
  return Node.create({
    name,
    group: 'inline',
    inline: true,
    atom: true,
    parseHTML: () => [{ tag: `span[data-page-field="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-page-field': name, class: 'writer-page-field' }),
      '#'
    ],
    renderText: () => '#'
  })
}

export const PageNumber = pageField('pageNumber').extend({
  addCommands() {
    return {
      insertPageField:
        (kind) =>
        ({ commands }) =>
          commands.insertContent({ type: kind })
    }
  }
})
export const PageCount = pageField('pageCount')

export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes: () => ({
    commentId: {
      default: null,
      parseHTML: (element) => element.getAttribute('data-comment-id'),
      renderHTML: (attrs) => ({ 'data-comment-id': attrs.commentId })
    }
  }),
  parseHTML: () => [{ tag: 'span[data-comment-id]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { class: 'writer-comment' }),
    0
  ],
  addCommands() {
    return {
      setComment:
        (commentId) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId }),
      unsetComment:
        (commentId) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks[this.name]
          state.doc.descendants((node, pos) => {
            for (const mark of node.marks) {
              if (mark.type === type && mark.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, mark)
              }
            }
          })
          dispatch?.(tr)
          return true
        }
    }
  }
})

function changeMark(name: 'insertion' | 'deletion', tag: 'ins' | 'del') {
  return Mark.create({
    name,
    inclusive: name === 'insertion',
    excludes: name === 'insertion' ? 'deletion' : 'insertion',
    addAttributes: () => ({
      author: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-author') ?? '',
        renderHTML: (attrs) => ({ 'data-author': attrs.author, title: attrs.author })
      },
      date: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-date') ?? '',
        renderHTML: (attrs) => ({ 'data-date': attrs.date })
      }
    }),
    parseHTML: () => [{ tag }],
    renderHTML: ({ HTMLAttributes }) => [
      tag,
      mergeAttributes(HTMLAttributes, { class: `writer-${name}` }),
      0
    ]
  })
}

export const Insertion = changeMark('insertion', 'ins')
export const Deletion = changeMark('deletion', 'del')

function scriptMark(name: 'superscript' | 'subscript', tag: 'sup' | 'sub', other: string) {
  return Mark.create({
    name,
    excludes: other,
    parseHTML: () => [{ tag }],
    renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0]
  })
}

export const Superscript = scriptMark('superscript', 'sup', 'subscript').extend({
  addCommands() {
    return {
      toggleSuperscript:
        () =>
        ({ commands }) =>
          commands.toggleMark('superscript'),
      toggleSubscript:
        () =>
        ({ commands }) =>
          commands.toggleMark('subscript')
    }
  }
})
export const Subscript = scriptMark('subscript', 'sub', 'superscript')

/** A fillable field: a name or date to type in, or a checkbox. */
export const FormField = Node.create({
  name: 'formField',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({
    kind: { default: 'text' },
    name: { default: '' },
    value: { default: '' },
    checked: { default: false }
  }),
  parseHTML: () => [
    {
      tag: 'span[data-form-field]',
      getAttrs: (element) => ({
        kind: element.getAttribute('data-form-field') ?? 'text',
        name: element.getAttribute('data-name') ?? '',
        value: element.getAttribute('data-value') ?? '',
        checked: element.getAttribute('data-checked') === 'true'
      })
    }
  ],
  renderHTML: ({ node }) => {
    const kind = String(node.attrs.kind)
    const checkbox = node.attrs.checked ? '☒' : '☐'
    const label = kind === 'checkbox' ? checkbox : String(node.attrs.value || node.attrs.name)
    return [
      'span',
      {
        'data-form-field': kind,
        'data-name': node.attrs.name,
        'data-value': node.attrs.value,
        'data-checked': String(node.attrs.checked),
        class: 'writer-form-field'
      },
      label
    ]
  },
  addCommands() {
    return {
      insertFormField:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { ...attrs, value: '', checked: false }
          })
    }
  }
})

/** A footnote reference; its text lives in the document's footnotes, numbered by CSS. */
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ id: { default: '' } }),
  parseHTML: () => [
    {
      tag: 'sup[data-footnote]',
      getAttrs: (element) => ({ id: element.getAttribute('data-footnote') })
    }
  ],
  renderHTML: ({ node }) => ['sup', { 'data-footnote': node.attrs.id, class: 'writer-footnote' }],
  addCommands() {
    return {
      insertFootnote:
        (id) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { id } })
    }
  }
})

/** Lists the headings above and below it; Word refreshes its own copy on open. */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  parseHTML: () => [{ tag: 'nav[data-toc]' }],
  renderHTML: () => ['nav', { 'data-toc': '', class: 'writer-toc' }],
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('nav')
      dom.setAttribute('data-toc', '')
      dom.className = 'writer-toc'
      const render = () => {
        const items: HTMLElement[] = []
        editor.state.doc.descendants((node) => {
          if (node.type.name !== 'heading' || Number(node.attrs.level) > 3) return
          const item = document.createElement('div')
          item.dataset.level = String(node.attrs.level)
          item.textContent = node.textContent
          items.push(item)
        })
        dom.replaceChildren(...items)
      }
      render()
      editor.on('update', render)
      return { dom, destroy: () => editor.off('update', render) }
    }
  },
  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name })
    }
  }
})
