/** User stories: the Stories tab in the right panel and the story pins on the canvas. */
export default {
  slots: {
    panel: 'scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto',
    header:
      'flex min-h-10 shrink-0 items-center gap-1 border-b border-border px-3 py-1.5 text-xs font-semibold text-surface',
    headerTitle: 'min-w-0 flex-1 truncate',
    section: 'flex flex-col gap-2 border-b border-border px-3 py-2',
    sectionTitle: 'flex items-center gap-1 text-[11px] font-semibold text-surface',
    card: 'flex flex-col rounded-md border border-border bg-panel data-[focused]:border-accent',
    cardHeader:
      'flex w-full cursor-pointer items-center gap-1.5 px-2 py-1.5 text-start text-xs text-surface outline-none focus-visible:ring-1 focus-visible:ring-panel-focus',
    cardTitle: 'min-w-0 flex-1 truncate',
    cardBody: 'flex flex-col gap-2 border-t border-border px-2 py-2',
    field: 'flex flex-col gap-1',
    label: 'text-[11px] text-muted',
    narrative: 'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1',
    criterion:
      'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded border border-border/60 p-1.5',
    criterionHeader: 'col-span-2 flex items-center justify-between text-[11px] text-muted',
    row: 'grid grid-cols-2 gap-2',
    chip: 'inline-flex max-w-32 shrink-0 items-center gap-1 truncate rounded-full border border-border px-1.5 text-[10px] leading-4 text-muted data-[category=done]:border-success data-[category=done]:text-success data-[category=indeterminate]:border-accent data-[category=indeterminate]:text-accent',
    jiraKey: 'shrink-0 font-mono text-[10px] text-muted',
    epic: 'flex flex-col gap-1 rounded-md border border-border p-2',
    epicStory:
      'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-start text-[11px] text-surface hover:bg-hover focus-visible:bg-hover focus-visible:outline-none',
    gap: 'size-1.5 shrink-0 rounded-full bg-warning',
    // Pins sit at their zoomed canvas positions in here; panning only moves this layer.
    layer: 'pointer-events-none absolute inset-0 z-0',
    pins: 'absolute top-0 left-0',
    pin: 'pointer-events-auto absolute flex h-5 -translate-x-full -translate-y-1/2 cursor-pointer items-center gap-1 rounded-full bg-panel px-1.5 text-[10px] font-semibold text-surface shadow-md ring-1 ring-black/10 outline-none select-none hover:shadow-lg focus-visible:ring-2 focus-visible:ring-accent data-[selected]:ring-2 data-[selected]:ring-accent',
    pinIcon: 'size-3 shrink-0 text-accent',
    pinStatus:
      'size-2 shrink-0 rounded-full bg-muted data-[category=done]:bg-success-fill data-[category=indeterminate]:bg-accent data-[category=new]:bg-muted'
  }
} as const
