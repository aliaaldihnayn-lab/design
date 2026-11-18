import { encodeHistoryValue, hashHistoryText } from './encode'

/**
 * A snapshot of a document as ordered `[key, hash]` pairs. The records themselves live once in a
 * blob table keyed by hash, so a version stores only the records that changed since any version
 * before it, and two manifests compare key by key without reading the records.
 */
export type SnapshotManifest = [key: string, hash: string][]

/** Where record texts are kept, by hash. */
export interface SnapshotBlobs {
  get(hash: string): string | undefined
  set(hash: string, text: string): void
  has(hash: string): boolean
  delete(hash: string): boolean
  keys(): IterableIterator<string>
}

/** Encodes records into the blob table and returns the manifest naming them. */
export function writeSnapshot(
  records: Iterable<[string, unknown]>,
  blobs: SnapshotBlobs
): SnapshotManifest {
  const manifest: SnapshotManifest = []
  for (const [key, value] of records) {
    const text = encodeHistoryValue(value)
    const hash = hashHistoryText(text)
    if (!blobs.has(hash)) blobs.set(hash, text)
    manifest.push([key, hash])
  }
  return manifest
}

/** The texts a manifest names, in order; throws when the blob table lost one. */
export function readSnapshotTexts(
  manifest: SnapshotManifest,
  blobs: SnapshotBlobs
): [string, string][] {
  return manifest.map(([key, hash]) => {
    const text = blobs.get(hash)
    if (text === undefined) throw new Error(`History record ${key} is missing`)
    return [key, text]
  })
}

export interface ManifestDiff {
  added: string[]
  removed: string[]
  changed: string[]
}

/** Which keys appear, disappear, or change between two snapshots. */
export function diffManifests(before: SnapshotManifest, after: SnapshotManifest): ManifestDiff {
  const previous = new Map(before)
  const next = new Map(after)
  const added: string[] = []
  const changed: string[] = []
  for (const [key, hash] of next) {
    const old = previous.get(key)
    if (old === undefined) added.push(key)
    else if (old !== hash) changed.push(key)
  }
  const removed = [...previous.keys()].filter((key) => !next.has(key))
  return { added, removed, changed }
}

/** Hashes every manifest still uses, so a pruned history can drop the rest. */
export function referencedHashes(manifests: Iterable<SnapshotManifest>): Set<string> {
  const used = new Set<string>()
  for (const manifest of manifests) for (const [, hash] of manifest) used.add(hash)
  return used
}
