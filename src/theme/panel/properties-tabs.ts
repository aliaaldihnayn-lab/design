/**
 * Tabs across the top of the right panel. The active tab shows its icon and label, the others
 * their icon alone with the label in a tooltip and for screen readers; tabs that do not fit go
 * into the More menu. The row clips rather than scrolls, so focusing a control never shifts the
 * panel. The Dev tab's views sit in a second, quieter row below it.
 */
export default {
  slots: {
    list: 'flex h-10 shrink-0 items-center gap-0.5 overflow-x-clip border-b border-border px-2',
    trigger:
      'group relative flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded px-1.5 text-[11px] text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-panel-focus data-[state=active]:font-semibold data-[state=active]:text-surface data-[state=active]:hover:bg-transparent after:absolute after:inset-x-1.5 after:-bottom-[6px] after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent',
    icon: 'size-3.5 shrink-0 data-[severity=error]:text-error data-[severity=warning]:text-warning',
    label: 'max-w-24 truncate group-data-[state=inactive]:sr-only',
    more: 'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-panel-focus data-[state=open]:bg-hover data-[state=open]:text-surface',
    zoom: 'ms-auto flex shrink-0',
    subList: 'flex h-8 shrink-0 items-center gap-1 border-b border-border px-2',
    subTrigger:
      'flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11px] text-muted outline-none hover:text-surface focus-visible:ring-1 focus-visible:ring-panel-focus data-[state=active]:bg-hover data-[state=active]:font-semibold data-[state=active]:text-surface',
    content: 'flex min-h-0 flex-1 flex-col'
  }
} as const

/** Room an icon-only tab takes in the row: its 28px square and the 2px gap after it. */
export const PROPERTIES_ICON_TAB_WIDTH = 30
