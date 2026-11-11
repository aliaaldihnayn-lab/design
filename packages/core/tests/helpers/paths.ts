import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The workspace root, found by its lockfile rather than by counting directories. */
export function workspaceRoot(from = dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'bun.lock'))) return dir
    if (dirname(dir) === dir) throw new Error(`No workspace root above ${from}`)
  }
}

/** Fixtures shared across the repository; a module import would escape the package root. */
export const FIXTURES = join(workspaceRoot(), 'tests/fixtures')

/** A file inside this package, for assets that are not modules. */
export function corePackagePath(...segments: string[]): string {
  return join(dirname(Bun.resolveSync('@lawha/core/package.json', import.meta.dir)), ...segments)
}

const LFS_POINTER = 'version https://git-lfs.github.com/spec/'

/**
 * A font from `tests/fixtures/fonts`. Most are Git LFS files, which a checkout without
 * `git lfs pull` holds as pointers, which parse as no font and fail tests far from the cause;
 * reading one says so instead.
 */
export async function fontFixture(name: string): Promise<ArrayBuffer> {
  const data = await readFile(join(FIXTURES, 'fonts', name))
  if (new TextDecoder().decode(data.subarray(0, LFS_POINTER.length)) === LFS_POINTER) {
    throw new Error(`tests/fixtures/fonts/${name} is a Git LFS pointer: run \`git lfs pull\``)
  }
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
}
