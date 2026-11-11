/**
 * The guest half of the plugin membrane, evaluated once in each plugin's QuickJS context before
 * the plugin's code. It is plain JavaScript run inside the interpreter, so it can reach nothing
 * of the host: the host's objects arrive as handles (`{ $: 'L', id }`) it wraps in proxies, and
 * every property read, write, and call on them is one synchronous JSON message through the host
 * function the context starts with. The guest keeps its own objects in a table the host refers
 * to by id the same way. The encoding is shared with `membrane.ts`:
 *
 * - `null`, booleans, strings, and finite numbers are themselves; `{ $: 'u' }` is undefined,
 *   `{ $: 'n', v }` a non-finite number or -0, `{ $: 'i', v }` a bigint;
 * - `{ $: 'a', v }` and `{ $: 'o', v }` are arrays and plain data objects, copied;
 * - `{ $: 'b', v }` is a `Uint8Array`, `{ $: 'e', name, message }` an error, copied;
 * - `{ $: 's', o, id }` is a symbol owned by `o` (`h` host, `g` guest);
 * - `{ $: 'L', id, k }` is an object or function (`k: 'f'`) the sender owns, `{ $: 'R', id }`
 *   one the receiver owns, and `{ $: 'P', id }` a promise the sender settles later.
 *
 * Evaluating the script returns the dispatcher the host calls into; neither it nor the host
 * function stays reachable from the plugin's globals.
 */
export const GUEST_BOOTSTRAP = String.raw`(() => {
  'use strict'
  const hostCall = globalThis.__lawha_host
  delete globalThis.__lawha_host
  const MAX_DEPTH = 64
  const local = new Map()
  const localIds = new WeakMap()
  let nextLocal = 1
  const remote = new Map()
  const remoteIds = new WeakMap()
  const pending = new Map()
  const hostSymbols = new Map()
  const ownSymbols = new Map()
  const ownSymbolIds = new Map()
  let nextSymbol = 1

  const own = (value) => {
    let id = localIds.get(value)
    if (id === undefined) {
      id = nextLocal++
      localIds.set(value, id)
      local.set(id, value)
    }
    return id
  }

  const errorOf = (error) =>
    error instanceof Error
      ? { $: 'e', name: String(error.name), message: String(error.message) }
      : { $: 'e', name: 'Error', message: String(error) }

  const isPlain = (value) => {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return false
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value === 'function')
        return false
    }
    return true
  }

  const settleWith = (id, value) => {
    value.then(
      (result) => hostCall('settle', JSON.stringify([id, true, encode(result, 0)])),
      (error) => hostCall('settle', JSON.stringify([id, false, errorOf(error)]))
    )
  }

  const encode = (value, depth) => {
    if (depth > MAX_DEPTH) throw new TypeError('The value is nested too deeply to pass')
    switch (typeof value) {
      case 'undefined':
        return { $: 'u' }
      case 'boolean':
      case 'string':
        return value
      case 'number':
        if (Object.is(value, -0)) return { $: 'n', v: '-0' }
        return Number.isFinite(value) ? value : { $: 'n', v: String(value) }
      case 'bigint':
        return { $: 'i', v: String(value) }
      case 'symbol': {
        for (const [id, symbol] of hostSymbols) if (symbol === value) return { $: 's', o: 'h', id }
        let id = ownSymbolIds.get(value)
        if (id === undefined) {
          id = nextSymbol++
          ownSymbolIds.set(value, id)
          ownSymbols.set(id, value)
        }
        return { $: 's', o: 'g', id }
      }
      case 'function': {
        const id = remoteIds.get(value)
        return id === undefined ? { $: 'L', id: own(value), k: 'f' } : { $: 'R', id }
      }
    }
    if (value === null) return null
    const remoteId = remoteIds.get(value)
    if (remoteId !== undefined) return { $: 'R', id: remoteId }
    if (value instanceof Promise) {
      const known = localIds.has(value)
      const id = own(value)
      if (!known) settleWith(id, value)
      return { $: 'P', id }
    }
    if (value instanceof Uint8Array) return { $: 'b', v: Array.from(value) }
    if (value instanceof Error) return errorOf(value)
    if (Array.isArray(value)) return { $: 'a', v: value.map((item) => encode(item, depth + 1)) }
    if (isPlain(value)) {
      const out = {}
      for (const key of Object.keys(value)) out[key] = encode(value[key], depth + 1)
      return { $: 'o', v: out }
    }
    return { $: 'L', id: own(value), k: 'o' }
  }

  const fail = (error) => {
    const out = new Error(String(error && error.message))
    if (error && typeof error.name === 'string' && error.name !== 'Error') out.name = error.name
    return out
  }

  const call = (op, args) => {
    const reply = JSON.parse(hostCall(op, JSON.stringify(args)))
    if (reply.ok) return decode(reply.v)
    throw fail(reply.e)
  }

  const handleOf = (id, kind) => {
    const cached = remote.get(id)
    if (cached) return cached
    const target = kind === 'f' ? () => undefined : {}
    const keys = () => call('keys', [id])
    const proxy = new Proxy(target, {
      get: (_, key) => (typeof key === 'string' ? call('get', [id, key]) : undefined),
      set: (_, key, value) => {
        if (typeof key !== 'string') return false
        call('set', [id, key, encode(value, 0)])
        return true
      },
      has: (_, key) => typeof key === 'string' && call('has', [id, key]),
      deleteProperty: () => false,
      defineProperty: () => false,
      ownKeys: () => [...keys(), ...Reflect.ownKeys(target)],
      getOwnPropertyDescriptor: (_, key) => {
        const mine = Reflect.getOwnPropertyDescriptor(target, key)
        if (mine) return mine
        if (typeof key !== 'string' || !keys().includes(key)) return undefined
        return { value: call('get', [id, key]), writable: true, enumerable: true, configurable: true }
      },
      apply: (_, __, args) => call('apply', [id, args.map((arg) => encode(arg, 0))]),
      construct: () => {
        throw new TypeError('Host functions cannot be called with new')
      }
    })
    remote.set(id, proxy)
    remoteIds.set(proxy, id)
    return proxy
  }

  const decode = (value) => {
    if (value === null || typeof value !== 'object') return value
    switch (value.$) {
      case 'u':
        return undefined
      case 'n':
        return Number(value.v)
      case 'i':
        return BigInt(value.v)
      case 'b':
        return new Uint8Array(value.v)
      case 'e':
        return fail(value)
      case 'a':
        return value.v.map(decode)
      case 'o': {
        const out = {}
        for (const key of Object.keys(value.v))
          Object.defineProperty(out, key, {
            value: decode(value.v[key]),
            writable: true,
            enumerable: true,
            configurable: true
          })
        return out
      }
      case 's': {
        if (value.o === 'g') return ownSymbols.get(value.id)
        let symbol = hostSymbols.get(value.id)
        if (!symbol) hostSymbols.set(value.id, (symbol = Symbol('figma.mixed')))
        return symbol
      }
      case 'L':
        return handleOf(value.id, value.k)
      case 'R':
        if (!local.has(value.id)) throw new TypeError('The host passed back an unknown value')
        return local.get(value.id)
      case 'P':
        return new Promise((resolve, reject) => pending.set(value.id, { resolve, reject }))
    }
    throw new TypeError('The host passed an unreadable value')
  }

  const target = (id) => {
    if (!local.has(id)) throw new TypeError('The plugin no longer has this value')
    return local.get(id)
  }

  const ops = {
    define: ([globals]) => {
      for (const [name, value] of Object.entries(globals))
        Object.defineProperty(globalThis, name, {
          value: decode(value),
          writable: true,
          enumerable: false,
          configurable: true
        })
    },
    run: ([source]) => (0, eval)(source)(),
    get: ([id, key]) => target(id)[key],
    set: ([id, key, value]) => {
      target(id)[key] = decode(value)
    },
    has: ([id, key]) => key in target(id),
    keys: ([id]) => Object.keys(target(id)),
    apply: ([id, args]) => Reflect.apply(target(id), undefined, args.map(decode)),
    settle: ([id, ok, value]) => {
      const waiting = pending.get(id)
      if (!waiting) return
      pending.delete(id)
      if (ok) waiting.resolve(decode(value))
      else waiting.reject(decode(value))
    }
  }

  return (op, payload) => {
    try {
      const handler = ops[op]
      if (!handler) throw new TypeError('Unknown request: ' + op)
      return JSON.stringify({ ok: true, v: encode(handler(JSON.parse(payload)), 0) })
    } catch (error) {
      return JSON.stringify({ ok: false, e: errorOf(error) })
    }
  }
})()`
