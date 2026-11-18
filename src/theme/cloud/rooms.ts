/** Rooms on Home: the tree of rooms beside the open room, its files, sub-rooms, and people. */
export default {
  slots: {
    root: '@container/rooms flex min-w-0 flex-col gap-4',
    split: 'flex min-w-0 gap-6',
    tree: 'flex w-60 shrink-0 flex-col gap-2',
    treeFull: 'flex min-w-0 flex-1 flex-col gap-2',
    treeHeader: 'flex items-center gap-2',
    treeTitle: 'min-w-0 flex-1 truncate text-xs font-medium text-muted',
    treeList: 'flex flex-col',
    treeItem:
      'flex h-8 w-full min-w-0 items-center gap-1.5 rounded px-1.5 text-start text-xs text-surface hover:bg-hover data-[active=true]:bg-panel-selected-muted',
    treeToggle:
      'flex size-5 shrink-0 items-center justify-center rounded text-muted hover:text-surface',
    treeSpacer: 'size-5 shrink-0',
    treeIcon: 'size-3.5 shrink-0 text-muted',
    treeLabel: 'min-w-0 flex-1 truncate',
    treeMeta: 'shrink-0 text-[11px] text-muted tabular-nums',
    page: 'flex min-w-0 flex-1 flex-col gap-5',
    header: 'flex flex-wrap items-start gap-3',
    heading: 'flex min-w-0 flex-1 flex-col gap-1',
    breadcrumbs: 'flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-muted',
    crumb: 'truncate hover:text-surface',
    title: 'flex min-w-0 items-center gap-2 text-base font-semibold',
    actions: 'flex shrink-0 flex-wrap items-center gap-1',
    presence: 'flex items-center -space-x-1.5',
    section: 'flex flex-col gap-2',
    sectionTitle: 'text-[11px] font-medium text-muted',
    grid: 'grid grid-cols-1 gap-2 @lg/rooms:grid-cols-2 @3xl/rooms:grid-cols-3',
    card: 'flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-start text-xs hover:bg-hover',
    cardLabel: 'min-w-0 flex-1 truncate',
    list: 'flex flex-col divide-y divide-border rounded-lg border border-border',
    file: 'flex min-w-0 items-center gap-2 px-3 py-2',
    fileOpen: 'flex min-w-0 flex-1 items-center gap-2 text-start text-xs',
    fileName: 'min-w-0 flex-1 truncate',
    fileMeta: 'shrink-0 text-[11px] text-muted',
    choice: 'flex flex-col gap-1',
    choiceItem:
      'flex h-8 w-full min-w-0 items-center gap-1.5 rounded px-2 text-start text-xs hover:bg-hover data-[active=true]:bg-panel-selected-muted disabled:opacity-50',
    activity: 'flex flex-col gap-1.5',
    activityRow: 'flex items-baseline gap-2 text-[11px]',
    activityText: 'min-w-0 flex-1 text-pretty text-surface',
    activityDate: 'shrink-0 text-muted'
  }
} as const
