export default {
  base: 'flex h-7 cursor-pointer items-center gap-1.5 rounded border-none px-3 text-[11px] font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-panel-focus',
  variants: {
    connection: {
      idle: 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-pressed',
      joining:
        'animate-pulse motion-reduce:animate-none border border-warning-border bg-warning-bg text-warning',
      // Still a share action when connected; your avatar shows the room is live.
      connected: 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-pressed'
    }
  },
  defaultVariants: { connection: 'idle' }
} as const
