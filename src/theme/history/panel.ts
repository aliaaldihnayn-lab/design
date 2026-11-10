/** Version history in the right sidebar: days, sessions of edits, and versions on a timeline. */
export default {
  slots: {
    panel: 'flex min-h-0 flex-1 flex-col',
    list: 'scrollbar-thin min-h-0 flex-1 overflow-y-auto py-1',
    day: 'px-3 pt-3 pb-1 text-[11px] font-semibold text-muted uppercase',
    item: 'group/item relative px-2',
    itemButton:
      'grid w-full cursor-pointer grid-cols-[24px_minmax(0,1fr)] gap-x-2 rounded-md px-1 py-1.5 pe-8 text-start text-xs outline-none hover:bg-hover focus-visible:bg-hover data-[selected]:bg-panel-selected-muted',
    marker: 'relative flex justify-center pt-0.5',
    ring: 'relative z-10 size-4 rounded-full border-2 border-muted bg-panel group-data-[selected]/item:border-accent',
    dot: 'relative z-10 mt-1 size-2 rounded-full bg-muted group-data-[selected]/item:bg-accent',
    body: 'flex min-w-0 flex-col gap-0.5',
    title: 'min-w-0 truncate font-semibold text-surface',
    current: 'min-w-0 truncate font-semibold text-surface group-data-[selected]/item:text-accent',
    description: 'line-clamp-3 min-w-0 break-words text-surface/80',
    meta: 'flex min-w-0 items-center gap-1.5 text-[11px] text-muted',
    avatar:
      'inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-semibold text-white',
    avatarImage: 'size-full object-cover',
    actions:
      'invisible absolute top-1.5 end-3 group-focus-within/item:visible group-hover/item:visible group-data-[selected]/item:visible',
    session: 'px-2',
    sessionButton:
      'flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-start text-xs text-surface outline-none hover:bg-hover focus-visible:bg-hover',
    changes: 'ms-9 flex flex-col gap-1 pb-2 text-[11px] text-surface/80',
    change: 'flex min-w-0 items-baseline gap-2',
    changeText: 'min-w-0 truncate',
    changeTime: 'shrink-0 text-muted',
    status: 'px-4 py-3 text-xs text-muted',
    comparison: 'flex flex-col gap-1 border-t border-border px-3 py-2 text-xs',
    comparisonHeader: 'flex items-center justify-between gap-2 font-semibold text-surface',
    comparisonList: 'scrollbar-thin flex max-h-48 flex-col gap-0.5 overflow-y-auto',
    comparisonRow: 'flex min-w-0 items-center gap-2',
    badge:
      'shrink-0 rounded px-1 text-[10px] font-semibold data-[change=added]:text-success data-[change=changed]:bg-warning-bg data-[change=changed]:text-warning data-[change=removed]:bg-error-bg data-[change=removed]:text-error',
    side: 'flex w-72 shrink-0 flex-col border-s border-border bg-panel',
    writerPreview:
      'mx-auto min-h-full w-full max-w-3xl rounded-sm bg-white px-12 py-10 text-black shadow-md',
    writerDiff: 'flex flex-col gap-2 text-sm leading-relaxed',
    writerBlock:
      'min-h-5 whitespace-pre-wrap rounded px-1 data-[change=added]:bg-warning-bg data-[change=removed]:bg-error-bg data-[change=removed]:text-error data-[change=removed]:line-through data-[change=same]:opacity-60',
    writerInsert: 'bg-warning-bg text-warning no-underline',
    writerDelete: 'bg-error-bg text-error',
    form: 'flex flex-col gap-3',
    label: 'sr-only'
  }
} as const
