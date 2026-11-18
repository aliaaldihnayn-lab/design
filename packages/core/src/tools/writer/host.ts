import type { WriterDocument } from '#core/writer/model'

/**
 * The document editor the AI tools work on. The app registers its open document here; a host
 * without a document editor (the CLI) registers none, and the tools say so.
 */
export interface WriterHost {
  read(): WriterDocument
  /** Replaces the document; the editor shows it and it counts as unsaved. */
  write(next: WriterDocument): void
}

let host: WriterHost | null = null

/** Registers the open document editor; returns a function that puts back the one before. */
export function setWriterHost(next: WriterHost | null): () => void {
  const previous = host
  host = next
  return () => {
    if (host === next) host = previous
  }
}

export function requireWriterHost(): WriterHost {
  if (!host) throw new Error('No document is open in the document editor (Documents in Lawha)')
  return host
}
