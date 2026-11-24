import type { ReadWarning } from '@lawha/core/io'

import { notificationMessages } from '@/app/i18n/notifications'
import { toast } from '@/app/shell/ui'

/** Says what a file held that did not come in, in the app's language. */
export function warnReadDocument(warnings: readonly ReadWarning[] = []): void {
  for (const warning of warnings) {
    if (warning.code === 'pdf-page-limit') {
      const [read = '', total = ''] = (warning.subject ?? '').split('/')
      toast.warning(notificationMessages.get().pdfPageLimit({ read, total }))
    }
  }
}
