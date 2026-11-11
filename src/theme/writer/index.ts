/**
 * The document editor: toolbar, the paper with its header, body and footer, and the side panel.
 * Paper stays white with black text in both themes, as printed pages are.
 */
const content = [
  '[&_.ProseMirror]:min-h-[2em] [&_.ProseMirror]:outline-none min-h-full text-[11pt] leading-[1.4] text-black',
  '[&_p]:mt-0 [&_p]:mb-[8pt] [&_p]:min-h-[1.4em]',
  '[&_h1]:mt-[18pt] [&_h1]:mb-[4pt] [&_h1]:text-[16pt] [&_h1]:font-bold',
  '[&_h2]:mt-[12pt] [&_h2]:mb-[4pt] [&_h2]:text-[13pt] [&_h2]:font-bold',
  '[&_h3]:mt-[12pt] [&_h3]:mb-[4pt] [&_h3]:text-[12pt] [&_h3]:font-bold',
  '[&_h4]:mt-[10pt] [&_h4]:text-[11pt] [&_h4]:font-bold',
  '[&_h5]:mt-[10pt] [&_h5]:text-[11pt] [&_h5]:font-bold [&_h6]:mt-[10pt] [&_h6]:text-[11pt] [&_h6]:font-bold',
  '[&_ul]:list-disc [&_ul]:ps-[0.25in] [&_ol]:list-decimal [&_ol]:ps-[0.25in] [&_li_p]:my-0',
  '[&_a]:text-[#0563c1] [&_a]:underline',
  '[&_table]:my-[6pt] [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse',
  '[&_td]:border [&_td]:border-black [&_td]:px-[5.4pt] [&_td]:align-top [&_th]:border [&_th]:border-black [&_th]:bg-black/5 [&_th]:px-[5.4pt] [&_th]:align-top [&_th]:font-bold',
  '[&_td_p]:my-0 [&_th_p]:my-0 [&_.selectedCell]:bg-accent/15 [&_.column-resize-handle]:absolute [&_.column-resize-handle]:-end-px [&_.column-resize-handle]:top-0 [&_.column-resize-handle]:bottom-0 [&_.column-resize-handle]:w-1 [&_.column-resize-handle]:bg-accent [&_td]:relative [&_th]:relative',
  '[&_img]:inline [&_img]:max-w-full [&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-accent',
  '[&_.writer-page-break]:my-[12pt] [&_.writer-page-break]:h-0 [&_.writer-page-break]:border-t-2 [&_.writer-page-break]:border-dashed [&_.writer-page-break]:border-black/30',
  '[&_.writer-page-field]:rounded-sm [&_.writer-page-field]:bg-black/10 [&_.writer-page-field]:px-0.5',
  '[&_.writer-comment]:bg-warning/30 [&_.writer-comment]:border-b-2 [&_.writer-comment]:border-warning',
  '[&_.writer-insertion]:text-chart-1 [&_.writer-insertion]:underline [&_.writer-deletion]:text-error-fill [&_.writer-deletion]:line-through',
  '[&_.writer-form-field]:rounded-sm [&_.writer-form-field]:border [&_.writer-form-field]:border-dashed [&_.writer-form-field]:border-chart-1 [&_.writer-form-field]:bg-chart-1/10 [&_.writer-form-field]:px-1',
  '[&_.writer-form-input]:bg-transparent [&_.writer-form-input]:outline-none [&_.writer-form-input]:text-black',
  '[counter-reset:footnote] [&_.writer-footnote]:[counter-increment:footnote] [&_.writer-footnote]:after:content-[counter(footnote)] [&_.writer-footnote]:text-chart-1',
  '[&_.writer-toc]:my-[8pt] [&_.writer-toc]:border-y [&_.writer-toc]:border-black/20 [&_.writer-toc]:py-[6pt] [&_.writer-toc_[data-level="2"]]:ps-[16pt] [&_.writer-toc_[data-level="3"]]:ps-[32pt]',
  '[&_.find-match]:bg-warning/40 [&_.find-current]:bg-warning',
  '[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-start [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-black/40 [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]'
].join(' ')

export default {
  slots: {
    root: 'flex h-full min-h-0 flex-col bg-canvas text-surface',
    bar: 'flex flex-wrap items-center gap-1 border-b border-border bg-panel px-2 py-1.5',
    titleRow: 'flex items-center gap-2 border-b border-border bg-panel px-2 py-1.5',
    title: 'min-w-0 flex-1 truncate bg-transparent text-sm font-medium text-surface outline-none',
    status: 'shrink-0 text-xs text-muted',
    group: 'flex items-center gap-0.5 border-e border-border pe-1 last:border-e-0',
    colorInput: 'sr-only',
    colorLabel:
      'relative flex size-6 cursor-pointer items-center justify-center rounded text-surface hover:bg-hover',
    colorSwatch: 'absolute inset-x-1 bottom-0.5 h-0.5 rounded-full',
    workspace: 'flex min-h-0 flex-1',
    scroller: 'min-w-0 flex-1 overflow-auto py-6',
    paper:
      'relative mx-auto flex flex-col bg-white text-black shadow-[0_1px_4px_rgb(0_0_0/0.25)] print:shadow-none',
    region:
      'group/region relative text-[9pt] text-black/70 outline-none hover:bg-black/[0.03] focus-within:bg-black/[0.03]',
    regionTools:
      'absolute -top-7 end-0 z-10 hidden items-center gap-0.5 rounded bg-panel p-0.5 shadow group-focus-within/region:flex',
    regionLabel:
      'pointer-events-none absolute -top-4 start-0 hidden text-[10px] text-black/50 group-focus-within/region:block',
    body: 'flex-1',
    footnotes:
      'mt-[12pt] text-[9pt] before:mb-[4pt] before:block before:w-1/3 before:border-t before:border-black/60',
    footnote: 'group/note flex items-start gap-1',
    footnoteNumber: 'mt-px min-w-[1.5em] shrink-0 text-[8pt] leading-[1.4] text-chart-1',
    footnoteText: 'min-w-0 flex-1 text-[9pt] [&_p]:mb-0',
    footnoteRemove: 'opacity-0 group-hover/note:opacity-100 group-focus-within/note:opacity-100',
    watermark:
      'pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden select-none',
    watermarkText: '-rotate-45 text-[72pt] font-bold whitespace-nowrap text-black/10',
    content,
    side: 'flex w-72 shrink-0 flex-col border-s border-border bg-panel',
    sideHeader:
      'flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold',
    card: 'flex flex-col gap-1 rounded-md border border-border bg-panel-secondary p-2 data-[resolved]:opacity-60',
    findBar:
      'flex flex-wrap items-center gap-1.5 border-b border-border bg-panel px-2 py-1.5 text-xs',
    form: 'flex flex-col gap-2 text-xs',
    formRow: 'grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2',
    formGrid: 'grid grid-cols-2 gap-2',
    formLabel: 'text-muted',
    sideBody: 'scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-xs'
  }
}
