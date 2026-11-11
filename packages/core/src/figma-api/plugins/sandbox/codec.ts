/**
 * The host half of the value encoding `guest.ts` describes: how host values become JSON for the
 * plugin's interpreter and how its JSON becomes host values. Objects are never copied with
 * their prototype; anything that is not plain data crosses as a handle the other side asks
 * about property by property.
 */
export type Encoded =
  | null
  | boolean
  | number
  | string
  | { $: 'u' }
  | { $: 'n' | 'i'; v: string }
  | { $: 'b'; v: number[] }
  | { $: 'e'; name: string; message: string }
  | { $: 'a'; v: Encoded[] }
  | { $: 'o'; v: Record<string, Encoded> }
  | { $: 's'; o: 'h' | 'g'; id: number }
  | { $: 'L'; id: number; k: 'f' | 'o' }
  | { $: 'R'; id: number }
  | { $: 'P'; id: number }

/** What the codec asks of the sandbox: its tables of handles, promises and symbols. */
export interface CodecTables {
  /** The guest's id for a host object or function, given to it once. */
  own(value: unknown, kind: 'f' | 'o'): number
  /** The host value the guest refers to by `id`. */
  owned(id: number): unknown
  /** The guest id of a host proxy for a guest value, if it is one. */
  remoteId(value: object): number | undefined
  /** A host proxy for the guest value `id`. */
  remote(id: number, kind: 'f' | 'o'): unknown
  /** Reports a host promise's outcome to the guest once it settles. */
  forward(id: number, promise: Promise<unknown>): void
  /** A host promise for the guest promise `id`. */
  awaitGuest(id: number): Promise<unknown>
  /** Values never handed to a plugin, such as the host's code evaluators. */
  refused(value: unknown): boolean
}

const MAX_DEPTH = 64

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function errorOf(error: unknown): Encoded {
  return error instanceof Error
    ? { $: 'e', name: error.name, message: error.message }
    : { $: 'e', name: 'Error', message: String(error) }
}

/** An `Error` of this realm from the guest's `{ name, message }`. */
export function guestError(error: unknown): Error {
  const out = new Error(isRecord(error) ? String(error.message) : 'The plugin failed')
  if (isRecord(error) && typeof error.name === 'string' && error.name !== 'Error')
    out.name = error.name
  return out
}

/** Data with no prototype of its own, accessors, or functions: copied rather than handled. */
function isPlainData(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return false
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return (
      descriptor !== undefined && 'value' in descriptor && typeof descriptor.value !== 'function'
    )
  })
}

/** Symbols shared with the guest, such as `figma.mixed`, by the side that made them. */
export class SymbolTable {
  readonly #host = new Map<symbol, number>()
  readonly #hostById = new Map<number, symbol>()
  readonly #guest = new Map<number, symbol>()

  encode(value: symbol): Encoded {
    for (const [id, symbol] of this.#guest) if (symbol === value) return { $: 's', o: 'g', id }
    let id = this.#host.get(value)
    if (id === undefined) {
      id = this.#host.size + 1
      this.#host.set(value, id)
      this.#hostById.set(id, value)
    }
    return { $: 's', o: 'h', id }
  }

  decode(origin: unknown, id: number): symbol | undefined {
    if (origin === 'h') return this.#hostById.get(id)
    let symbol = this.#guest.get(id)
    if (!symbol) this.#guest.set(id, (symbol = Symbol('plugin')))
    return symbol
  }
}

function encodeNumber(value: number): Encoded {
  if (Object.is(value, -0)) return { $: 'n', v: '-0' }
  return Number.isFinite(value) ? value : { $: 'n', v: String(value) }
}

export function createCodec(tables: CodecTables, symbols: SymbolTable) {
  function encodeObject(value: object, level: number): Encoded {
    const remoteId = tables.remoteId(value)
    if (remoteId !== undefined) return { $: 'R', id: remoteId }
    if (tables.refused(value)) throw new TypeError('This value is not available to plugins')
    if (value instanceof Promise) {
      const id = tables.own(value, 'o')
      tables.forward(id, value)
      return { $: 'P', id }
    }
    if (value instanceof Uint8Array) return { $: 'b', v: Array.from(value) }
    if (value instanceof ArrayBuffer) return { $: 'b', v: Array.from(new Uint8Array(value)) }
    if (value instanceof Error) return errorOf(value)
    if (Array.isArray(value)) return { $: 'a', v: value.map((item) => encode(item, level + 1)) }
    if (isPlainData(value)) {
      const out: Record<string, Encoded> = {}
      for (const [key, item] of Object.entries(value)) out[key] = encode(item, level + 1)
      return { $: 'o', v: out }
    }
    return { $: 'L', id: tables.own(value, 'o'), k: 'o' }
  }

  function encode(value: unknown, level = 0): Encoded {
    if (level > MAX_DEPTH) throw new TypeError('The value is nested too deeply to pass')
    if (value === null) return null
    switch (typeof value) {
      case 'boolean':
      case 'string':
        return value
      case 'number':
        return encodeNumber(value)
      case 'bigint':
        return { $: 'i', v: String(value) }
      case 'symbol':
        return symbols.encode(value)
      case 'function': {
        const id = tables.remoteId(value)
        if (id !== undefined) return { $: 'R', id }
        if (tables.refused(value)) throw new TypeError('This value is not available to plugins')
        return { $: 'L', id: tables.own(value, 'f'), k: 'f' }
      }
      case 'object':
        return encodeObject(value, level)
      default:
        return { $: 'u' }
    }
  }

  function decodeObject(value: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (!isRecord(value)) return out
    // Defined rather than assigned, so a key named `__proto__` stays a key.
    for (const [key, item] of Object.entries(value))
      Object.defineProperty(out, key, {
        value: decode(item),
        writable: true,
        enumerable: true,
        configurable: true
      })
    return out
  }

  const tagged: Record<string, (value: Record<string, unknown>) => unknown> = {
    u: () => undefined,
    n: (value) => Number(value.v),
    i: (value) => BigInt(String(value.v)),
    b: (value) => (Array.isArray(value.v) ? Uint8Array.from(value.v, Number) : new Uint8Array()),
    e: (value) => guestError(value),
    a: (value) => (Array.isArray(value.v) ? value.v.map(decode) : []),
    o: (value) => decodeObject(value.v),
    s: (value) => symbols.decode(value.o, Number(value.id)),
    L: (value) => tables.remote(Number(value.id), value.k === 'f' ? 'f' : 'o'),
    R: (value) => tables.owned(Number(value.id)),
    P: (value) => tables.awaitGuest(Number(value.id))
  }

  function decode(value: unknown): unknown {
    if (!isRecord(value)) return value
    const tag = typeof value.$ === 'string' && Object.hasOwn(tagged, value.$) ? value.$ : null
    if (tag === null) throw new TypeError('The plugin passed an unreadable value')
    return tagged[tag](value)
  }

  return { encode, decode }
}
