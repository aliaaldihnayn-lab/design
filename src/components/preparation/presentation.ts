import type { useFileMessages } from '@lawha/vue/i18n'

import type { EditorPreparation, EditorPreparationProgress } from '@/app/editor/preparation/types'

type FilesMessages = ReturnType<typeof useFileMessages>['value']

/** The message naming each step a document goes through as it opens. */
const PREPARATION_PHASE_MESSAGES = {
  reading: 'preparationReading',
  decoding: 'preparationDecoding',
  materializing: 'preparationMaterializing',
  'populating-page': 'preparationPopulatingPage',
  'resolving-fonts': 'preparationResolvingFonts',
  'resolving-fallbacks': 'preparationResolvingFallbacks',
  layout: 'preparationLayout',
  'drawing-shaders': 'preparationDrawingShaders',
  'preparing-render': 'preparationPreparingRender'
} as const satisfies Record<EditorPreparation['phase'], keyof FilesMessages>

export function preparationLabel(
  preparation: EditorPreparation | null,
  files: FilesMessages
): string {
  return preparation
    ? files[PREPARATION_PHASE_MESSAGES[preparation.phase]]
    : files.preparationLoading
}

export function preparationPercent(progress: EditorPreparationProgress | null): number | null {
  if (!progress || progress.total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((progress.completed / progress.total) * 100)))
}
