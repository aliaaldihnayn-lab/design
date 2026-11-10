import { EXPORT_EVERY_TARGET, FIXED_SIZE_EXPORT, resolveExportNodes } from '#core/io/targets'
import type { ExportRequest, IOFormatAdapter } from '#core/io/types'
import { storiesToCSV, storiesToMarkdown } from '#core/stories/export'

/** Text the stories export writes; a byte order mark lets spreadsheets read Arabic as UTF-8. */
const UTF8_BOM = '\uFEFF'

function storyExportTitle(request: ExportRequest, nodeIds: string[]): string {
  const whole = request.target.scope === 'page' || request.target.scope === 'document'
  let named: string | null = null
  if (whole) named = request.graph.pageOf(nodeIds[0] ?? '')
  else if (nodeIds.length === 1) named = nodeIds[0]
  const name = named ? request.graph.getNode(named)?.name : undefined
  return name ? `User stories: ${name}` : 'User stories'
}

/** A document export covers every page's stories, not only the first page's layers. */
function storyRoots(request: ExportRequest, nodeIds: string[]): string[] | undefined {
  if (request.target.scope === 'document') return undefined
  // The page itself, so an empty page exports no stories rather than the whole document's.
  if (request.target.scope === 'page') return [request.target.pageId]
  return nodeIds
}

/** The user stories, epics and Jira links of the target as a Markdown spec. */
export const storiesMarkdownFormat: IOFormatAdapter<'stories-markdown'> = {
  id: 'stories-markdown',
  label: 'User stories (Markdown)',
  role: 'derived-export',
  category: 'document',
  extensions: ['md'],
  mimeTypes: ['text/markdown'],
  support: EXPORT_EVERY_TARGET,
  exportOptions: FIXED_SIZE_EXPORT,
  exportContent(request) {
    const target = resolveExportNodes(request)
    if (!target) return Promise.reject(new Error('Nothing to export'))
    const data = storiesToMarkdown(request.graph, storyRoots(request, target.nodeIds), {
      title: storyExportTitle(request, target.nodeIds),
      keepEmptyEpics: request.target.scope === 'document'
    })
    return Promise.resolve({
      format: 'stories-markdown',
      mimeType: 'text/markdown',
      extension: 'md',
      data,
      encoding: 'utf8'
    })
  }
}

/** The user stories of the target as CSV, one row per story, for spreadsheets and importers. */
export const storiesCSVFormat: IOFormatAdapter<'stories-csv'> = {
  id: 'stories-csv',
  label: 'User stories (CSV)',
  role: 'derived-export',
  category: 'document',
  extensions: ['csv'],
  mimeTypes: ['text/csv'],
  support: EXPORT_EVERY_TARGET,
  exportOptions: FIXED_SIZE_EXPORT,
  exportContent(request) {
    const target = resolveExportNodes(request)
    if (!target) return Promise.reject(new Error('Nothing to export'))
    return Promise.resolve({
      format: 'stories-csv',
      mimeType: 'text/csv',
      extension: 'csv',
      data: UTF8_BOM + storiesToCSV(request.graph, storyRoots(request, target.nodeIds)),
      encoding: 'utf8'
    })
  }
}
