import { isEqual } from 'es-toolkit'
import * as v from 'valibot'

import { randomHex } from '@lawha/scene-graph/random'

import { decodeHistoryValue } from './encode'
import {
  DEFAULT_HISTORY_RETENTION,
  HISTORY_SESSION_GAP_MS,
  type HistoryAuthor,
  type HistoryChange,
  type HistoryChangeSummary,
  type HistoryDocumentKind,
  type HistoryRetention,
  type HistoryState,
  type HistoryVersion,
  type HistoryVersionKind
} from './model'
import { historyStateSchema } from './schema'
import {
  diffManifests,
  readSnapshotTexts,
  referencedHashes,
  writeSnapshot,
  type ManifestDiff,
  type SnapshotManifest
} from './snapshot'

export interface DocumentHistoryOptions {
  documentKind: HistoryDocumentKind
  now?: () => number
  sessionGapMs?: number
}

export interface RecordChangeInput {
  author: HistoryAuthor
  summary: HistoryChangeSummary
  /** Folds the change into the newest one when it continues it, as a run of picker changes. */
  coalesce?: boolean
}

export interface SaveVersionInput {
  author: HistoryAuthor
  records: Iterable<[string, unknown]>
  kind?: HistoryVersionKind
  title?: string | null
  description?: string
  restoredFromId?: string | null
}

export type HistoryListener = () => void

/**
 * One document's version history: every recorded change, grouped into sessions, and the versions
 * kept along the way, automatic, named, or made by a restore. Versions are snapshots of records
 * the document kind supplies; records unchanged between versions are stored once.
 */
export class DocumentHistory {
  readonly documentKind: HistoryDocumentKind
  private changes: HistoryChange[] = []
  private versions: HistoryVersion[] = []
  private manifests = new Map<string, SnapshotManifest>()
  private blobs = new Map<string, string>()
  private readonly listeners = new Set<HistoryListener>()
  private readonly now: () => number
  private readonly sessionGapMs: number

  constructor(options: DocumentHistoryOptions) {
    this.documentKind = options.documentKind
    this.now = options.now ?? Date.now
    this.sessionGapMs = options.sessionGapMs ?? HISTORY_SESSION_GAP_MS
  }

  static fromState(
    state: HistoryState,
    options: Omit<DocumentHistoryOptions, 'documentKind'> = {}
  ) {
    const history = new DocumentHistory({ ...options, documentKind: state.documentKind })
    history.changes = structuredClone(state.changes)
    history.versions = structuredClone(state.versions)
    history.manifests = new Map(Object.entries(state.manifests))
    history.blobs = new Map(Object.entries(state.blobs))
    return history
  }

  /** Reads persisted history, or null when the data is not a history this build reads. */
  static parse(
    input: unknown,
    options: Omit<DocumentHistoryOptions, 'documentKind'> = {}
  ): DocumentHistory | null {
    const result = v.safeParse(historyStateSchema, input)
    return result.success ? DocumentHistory.fromState(result.output, options) : null
  }

  toState(): HistoryState {
    return {
      format: 1,
      documentKind: this.documentKind,
      changes: structuredClone(this.changes),
      versions: structuredClone(this.versions),
      manifests: Object.fromEntries(this.manifests),
      blobs: Object.fromEntries(this.blobs)
    }
  }

  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }

  /** Changes, oldest first. */
  listChanges(): readonly HistoryChange[] {
    return this.changes
  }

  /** Versions, oldest first. */
  listVersions(): readonly HistoryVersion[] {
    return this.versions
  }

  getVersion(id: string): HistoryVersion | undefined {
    return this.versions.find((version) => version.id === id)
  }

  get latestVersion(): HistoryVersion | undefined {
    return this.versions.at(-1)
  }

  get latestChange(): HistoryChange | undefined {
    return this.changes.at(-1)
  }

  /** Changes made since the newest version, which the next automatic version would hold. */
  changesSinceLatestVersion(): HistoryChange[] {
    const changeId = this.latestVersion?.changeId
    if (!this.latestVersion) return [...this.changes]
    const index = changeId ? this.changes.findIndex((change) => change.id === changeId) : -1
    return this.changes.slice(index + 1)
  }

  recordChange(input: RecordChangeInput): HistoryChange {
    const at = this.now()
    const previous = this.changes.at(-1)
    const sameSitting =
      previous !== undefined &&
      previous.author.id === input.author.id &&
      at - previous.at <= this.sessionGapMs
    if (
      input.coalesce &&
      sameSitting &&
      previous.summary.label === input.summary.label &&
      previous.summary.action === input.summary.action &&
      // A version holding the step keeps it as it was.
      this.latestVersion?.changeId !== previous.id
    ) {
      const merged: HistoryChange = { ...previous, at, summary: input.summary }
      this.changes[this.changes.length - 1] = merged
      this.changed()
      return merged
    }
    const change: HistoryChange = {
      id: randomHex(12),
      at,
      author: input.author,
      summary: input.summary,
      sessionId: sameSitting ? previous.sessionId : randomHex(8)
    }
    this.changes.push(change)
    this.changed()
    return change
  }

  /**
   * Keeps the document as it is now. An automatic version of the same content as the newest
   * version is skipped (null), since it would show nothing new.
   */
  saveVersion(input: SaveVersionInput): HistoryVersion | null {
    const kind = input.kind ?? (input.title ? 'named' : 'auto')
    const manifest = writeSnapshot(input.records, this.blobs)
    const latest = this.latestVersion
    if (kind === 'auto' && latest && isEqual(this.manifests.get(latest.id), manifest)) {
      this.collectGarbage()
      return null
    }
    const version: HistoryVersion = {
      id: randomHex(12),
      at: this.now(),
      author: input.author,
      kind,
      title: input.title?.trim() || null,
      description: input.description?.trim() ?? '',
      changeId: this.changes.at(-1)?.id ?? null,
      restoredFromId: input.restoredFromId ?? null
    }
    this.versions.push(version)
    this.manifests.set(version.id, manifest)
    this.changed()
    return version
  }

  /**
   * Names a version or changes its name and description, as Figma's Edit version info. A version
   * given a name is kept as named; an automatic one whose name is cleared goes back to automatic.
   */
  renameVersion(id: string, info: { title: string | null; description?: string }): HistoryVersion {
    const index = this.versions.findIndex((version) => version.id === id)
    if (index === -1) throw new Error(`No version ${id}`)
    const version = this.versions[index]
    const title = info.title?.trim() || null
    const named: HistoryVersionKind = title ? 'named' : 'auto'
    const kind: HistoryVersionKind = version.kind === 'restore' ? 'restore' : named
    const renamed = { ...version, title, kind, description: info.description?.trim() ?? '' }
    this.versions[index] = renamed
    this.changed()
    return renamed
  }

  /** Removes a version; its records go once nothing else uses them. */
  deleteVersion(id: string): void {
    const before = this.versions.length
    this.versions = this.versions.filter((version) => version.id !== id)
    if (this.versions.length === before) return
    this.manifests.delete(id)
    this.collectGarbage()
    this.changed()
  }

  /** The records a version holds, decoded, in the order they were saved. */
  versionRecords(id: string): [string, unknown][] {
    const manifest = this.manifests.get(id)
    if (!manifest) throw new Error(`No version ${id}`)
    return readSnapshotTexts(manifest, this.blobs).map(([key, text]) => [
      key,
      decodeHistoryValue(text)
    ])
  }

  versionManifest(id: string): SnapshotManifest | undefined {
    return this.manifests.get(id)
  }

  /** Which records differ between two versions, by key. */
  diffVersions(beforeId: string, afterId: string): ManifestDiff {
    const before = this.manifests.get(beforeId)
    const after = this.manifests.get(afterId)
    if (!before || !after) throw new Error('No such version')
    return diffManifests(before, after)
  }

  /** Which records differ between a version and the document as `records` hold it now. */
  diffWithCurrent(versionId: string, records: Iterable<[string, unknown]>): ManifestDiff {
    const before = this.manifests.get(versionId)
    if (!before) throw new Error(`No version ${versionId}`)
    // Scratch blobs: comparing must not store the current document.
    const scratch = new Map<string, string>()
    return diffManifests(before, writeSnapshot(records, scratch))
  }

  /** Drops automatic versions and changes past the limits, then the records nothing uses. */
  prune(retention: HistoryRetention = DEFAULT_HISTORY_RETENTION): boolean {
    const cutoff = this.now() - retention.maxAutoAgeMs
    const autos = this.versions.filter((version) => version.kind === 'auto')
    // The newest version stays, whatever its age: it is what the next one compares against.
    const newest = this.versions.at(-1)
    const keep = new Set(
      autos
        .slice(-retention.maxAutoVersions)
        .filter((version) => version.at >= cutoff)
        .map((version) => version.id)
    )
    const dropped = autos.filter((version) => !keep.has(version.id) && version !== newest)
    const droppedChanges = Math.max(0, this.changes.length - retention.maxChanges)
    if (dropped.length === 0 && droppedChanges === 0) return false
    const droppedIds = new Set(dropped.map((version) => version.id))
    this.versions = this.versions.filter((version) => !droppedIds.has(version.id))
    for (const id of droppedIds) this.manifests.delete(id)
    if (droppedChanges > 0) this.changes = this.changes.slice(droppedChanges)
    this.collectGarbage()
    this.changed()
    return true
  }

  /** Bytes of record text kept, a measure of what the history costs to store. */
  get storedTextLength(): number {
    let length = 0
    for (const text of this.blobs.values()) length += text.length
    return length
  }

  private collectGarbage() {
    const used = referencedHashes(this.manifests.values())
    for (const hash of this.blobs.keys()) if (!used.has(hash)) this.blobs.delete(hash)
  }
}
