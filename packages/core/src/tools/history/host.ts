import type { HistoryDocumentKind, HistoryVersion } from '#core/history/model'
import type { DocumentHistory } from '#core/history/timeline'

/** One open document's version history, as the app keeps it. */
export interface VersionHistoryTarget {
  history: DocumentHistory
  /** The document as it is now, as version records, to compare a version with. */
  currentRecords(): [string, unknown][]
  /** Keeps the document as it is now as a named version. */
  save(title: string, description: string): Promise<HistoryVersion | null>
  /** Brings a version back as an edit of its own; the state before it is kept as a version. */
  restore(versionId: string): Promise<HistoryVersion | null>
}

/**
 * Where the AI tools find version history: the app registers the open design's and document's
 * histories; a host without them (the CLI) registers none, and the tools say so.
 */
export interface VersionHistoryHost {
  target(kind: HistoryDocumentKind): VersionHistoryTarget | null
}

let host: VersionHistoryHost | null = null

/** Registers the app's version history; returns a function that puts back the one before. */
export function setVersionHistoryHost(next: VersionHistoryHost | null): () => void {
  const previous = host
  host = next
  return () => {
    if (host === next) host = previous
  }
}

export function requireVersionHistory(kind: HistoryDocumentKind): VersionHistoryTarget {
  const target = host?.target(kind)
  if (!target) {
    throw new Error(
      kind === 'writer'
        ? 'No document with version history is open in the document editor'
        : 'Version history is not available here; it is kept by the Lawha app for open designs'
    )
  }
  return target
}
