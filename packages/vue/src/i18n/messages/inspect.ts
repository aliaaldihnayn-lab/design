import { i18n } from '#vue/i18n/create'

/** Dev Mode's inspect panel. */
export const inspectMessageDefaults = {
  tab: 'Inspect',
  noSelection: 'Select a layer to see its properties and code',
  size: 'Size',
  limits: 'Min / max',
  layout: 'Auto layout',
  radius: 'Corner radius',
  colors: 'Colors',
  typography: 'Typography',
  code: 'Code',
  copy: 'Copy code',
  sizingFixed: 'Fixed',
  sizingHug: 'Hug',
  sizingFill: 'Fill'
} as const

export const inspectMessages = i18n('inspect', inspectMessageDefaults)
