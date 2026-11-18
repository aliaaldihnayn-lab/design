import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule
} from 'quickjs-emscripten-core'

import { createCodec, errorOf, guestError, isRecord, SymbolTable, type Encoded } from './codec'
import { GUEST_BOOTSTRAP } from './guest'

/** What one plugin's interpreter may use; each plugin gets its own runtime and heap. */
export interface SandboxLimits {
  /** Bytes the plugin's heap may hold. */
  memoryBytes: number
  /** Bytes of interpreter stack, which bounds recursion. */
  stackBytes: number
  /** How long one synchronous run of plugin code may take before it is stopped. */
  turnMilliseconds: number
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  memoryBytes: 256 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  turnMilliseconds: 10_000
}

/** Plugin code running in its own QuickJS context, reachable only through the values it was given. */
export interface PluginSandbox {
  /** Defines globals the plugin's code sees; host objects among them arrive as handles. */
  define(globals: Readonly<Record<string, unknown>>): void
  /** Runs a script's body as an async function; settles when that function does. */
  run(body: string): Promise<unknown>
  /** Why the interpreter was stopped for good (a runaway turn, exhausted memory), or null. */
  readonly failed: string | null
  /** Frees the interpreter; later calls into it throw. Safe to call while plugin code runs. */
  dispose(): void
}

export interface CreateSandboxOptions {
  limits?: Partial<SandboxLimits>
  /** Called once when the interpreter has to stop, for example after an endless loop. */
  onFatal?: (message: string) => void
}

/**
 * Property names a plugin never reads or writes on a host object. The constructor and
 * prototype chain lead to the host's `Function`, which would evaluate code in the host realm;
 * names starting with `_` and the listed members are Lawha's internals, not the Plugin API.
 */
const DENIED_KEYS = new Set([
  'constructor',
  'prototype',
  'caller',
  'callee',
  'arguments',
  'graph',
  'setRenderer'
])

function deniedKey(key: string): boolean {
  return DENIED_KEYS.has(key) || key.startsWith('_')
}

/** Host functions that evaluate strings as code, and the global object: never handed out. */
function refusedValues(): Set<unknown> {
  const out = new Set<unknown>([
    globalThis,
    Function,
    Reflect.get(globalThis, 'eval'),
    globalThis.setTimeout,
    globalThis.setInterval
  ])
  const samples = [
    async () => undefined,
    function* () {
      yield undefined
    },
    async function* () {
      yield undefined
    }
  ] as const
  for (const sample of samples) out.add(Object.getPrototypeOf(sample).constructor)
  return out
}

const FATAL = /interrupted|out of memory|stack overflow|memory access/i

type Reply = { ok: true; v: Encoded } | { ok: false; e: Encoded }

type HostFunction = (...args: unknown[]) => unknown

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function keyOf(key: unknown): string {
  if (typeof key !== 'string') throw new TypeError('Property names must be strings')
  return key
}

/**
 * Starts a plugin interpreter in `quickjs`. The host and the guest pass values as JSON with
 * handles for objects (`guest.ts` describes the encoding), so the plugin holds no host object,
 * prototype, or function: it reaches the host only by asking for named properties of the values
 * it was given, which `DENIED_KEYS` and `refusedValues` keep inside the Plugin API.
 */
export function createPluginSandbox(
  quickjs: QuickJSWASMModule,
  options: CreateSandboxOptions = {}
): PluginSandbox {
  const limits = { ...DEFAULT_SANDBOX_LIMITS, ...options.limits }
  const runtime: QuickJSRuntime = quickjs.newRuntime()
  runtime.setMemoryLimit(limits.memoryBytes)
  runtime.setMaxStackSize(limits.stackBytes)
  const state = {
    deadline: Number.POSITIVE_INFINITY,
    depth: 0,
    disposed: false,
    freed: false,
    failed: null as string | null
  }
  runtime.setInterruptHandler(() => Date.now() > state.deadline)
  const context: QuickJSContext = runtime.newContext()
  const refused = refusedValues()

  // Host values the guest holds, by id, and the bound methods read from them.
  const local = new Map<number, { value: unknown; kind: 'f' | 'o' }>()
  const localIds = new Map<unknown, number>()
  const forwarded = new WeakSet<Promise<unknown>>()
  const methods = new WeakMap<object, Map<string, HostFunction>>()
  // Guest values the host holds, as proxies.
  const remote = new Map<number, unknown>()
  const remoteIds = new WeakMap<object, number>()
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  // Guest promises that settled before the reply naming them was read.
  const early = new Map<number, { ok: true; value: unknown } | { ok: false; error: Error }>()

  const fatal = (message: string) => {
    if (state.failed !== null) return
    state.failed = message
    options.onFatal?.(message)
  }

  const closed = () => state.disposed || state.freed

  const codec = createCodec(
    {
      own(value, kind) {
        let id = localIds.get(value)
        if (id === undefined) {
          id = localIds.size + 1
          localIds.set(value, id)
          local.set(id, { value, kind })
        }
        return id
      },
      owned(id) {
        const entry = local.get(id)
        if (!entry) throw new TypeError('The plugin passed an unknown value')
        return entry.value
      },
      remoteId: (value) => remoteIds.get(value),
      remote: (id, kind) => remote.get(id) ?? remoteProxy(id, kind),
      forward(id, promise) {
        if (forwarded.has(promise)) return
        forwarded.add(promise)
        promise
          .then(
            (result: unknown) => settleGuest(id, true, codec.encode(result)),
            (error: unknown) => settleGuest(id, false, errorOf(error))
          )
          .catch((error: unknown) => settleGuest(id, false, errorOf(error)))
      },
      awaitGuest(id) {
        const settled = early.get(id)
        early.delete(id)
        if (settled?.ok === true) return Promise.resolve(settled.value)
        if (settled) return Promise.reject(settled.error)
        return new Promise<unknown>((resolve, reject) => {
          pending.set(id, { resolve, reject })
        })
      },
      refused: (value) => refused.has(value)
    },
    new SymbolTable()
  )

  function settleGuest(id: number, ok: boolean, value: Encoded): void {
    if (closed() || state.failed !== null) return
    try {
      guestCall('settle', [id, ok, value])
    } catch (error) {
      console.warn('[Plugins]', error)
    }
  }

  /** A host proxy for a guest object or function; every use calls into the interpreter. */
  function remoteProxy(id: number, kind: 'f' | 'o'): unknown {
    const target = kind === 'f' ? () => undefined : {}
    const keys = (): string[] => {
      const out = guestCall('keys', [id])
      return Array.isArray(out) ? out.filter((key): key is string => typeof key === 'string') : []
    }
    const proxy = new Proxy(target, {
      get: (_, key) => (typeof key === 'string' ? guestCall('get', [id, key]) : undefined),
      set: (_, key, value) => {
        if (typeof key !== 'string') return false
        guestCall('set', [id, key, codec.encode(value)])
        return true
      },
      has: (_, key) => typeof key === 'string' && guestCall('has', [id, key]) === true,
      ownKeys: () => [...keys(), ...Reflect.ownKeys(target)],
      getOwnPropertyDescriptor: (_, key) => {
        const mine = Reflect.getOwnPropertyDescriptor(target, key)
        if (mine) return mine
        if (typeof key !== 'string' || !keys().includes(key)) return undefined
        return {
          value: guestCall('get', [id, key]),
          writable: true,
          enumerable: true,
          configurable: true
        }
      },
      deleteProperty: () => false,
      defineProperty: () => false,
      apply: (_, __, args: unknown[]) =>
        guestCall('apply', [id, args.map((arg) => codec.encode(arg))])
    })
    remote.set(id, proxy)
    remoteIds.set(proxy, id)
    return proxy
  }

  const hostEntry = (id: unknown) => {
    const entry = local.get(Number(id))
    if (!entry) throw new TypeError('The plugin no longer has this value')
    return entry
  }

  const objectTarget = (id: unknown): object => {
    const entry = hostEntry(id)
    if (entry.kind === 'f' || !isRecord(entry.value))
      throw new TypeError('Properties of host functions are not available to plugins')
    return entry.value
  }

  /** A host method read off `target`, bound to it, the same function each read. */
  const boundMethod = (target: object, key: string, fn: HostFunction): HostFunction => {
    let byKey = methods.get(target)
    if (!byKey) methods.set(target, (byKey = new Map()))
    const cached = byKey.get(key)
    if (cached && Reflect.get(cached, 'original') === fn) return cached
    const bound = Object.assign((...args: unknown[]) => Reflect.apply(fn, target, args), {
      original: fn
    })
    byKey.set(key, bound)
    return bound
  }

  const settleHost = (id: number, ok: boolean, value: unknown) => {
    const waiting = pending.get(id)
    pending.delete(id)
    if (ok) {
      const decoded = codec.decode(value)
      if (waiting) waiting.resolve(decoded)
      else early.set(id, { ok: true, value: decoded })
      return
    }
    const error = guestError(value)
    if (waiting) waiting.reject(error)
    else early.set(id, { ok: false, error })
  }

  const hostOps: Record<string, (args: unknown[]) => unknown> = {
    get([id, rawKey]) {
      const target = objectTarget(id)
      const key = keyOf(rawKey)
      if (deniedKey(key)) return undefined
      const value: unknown = Reflect.get(target, key)
      return typeof value === 'function' ? boundMethod(target, key, value as HostFunction) : value
    },
    set([id, rawKey, value]) {
      const target = objectTarget(id)
      const key = keyOf(rawKey)
      if (deniedKey(key) || typeof Reflect.get(target, key) === 'function')
        throw new TypeError(`Cannot assign to ${key}`)
      if (!Reflect.set(target, key, codec.decode(value)))
        throw new TypeError(`Cannot assign to ${key}`)
      return undefined
    },
    has([id, rawKey]) {
      const key = keyOf(rawKey)
      return !deniedKey(key) && Reflect.has(objectTarget(id), key)
    },
    keys([id]) {
      return Object.keys(objectTarget(id)).filter((key) => !deniedKey(key))
    },
    apply([id, args]) {
      const entry = hostEntry(id)
      if (entry.kind !== 'f' || typeof entry.value !== 'function')
        throw new TypeError('This value is not a function')
      const decoded = Array.isArray(args) ? args.map((arg) => codec.decode(arg)) : []
      return Reflect.apply(entry.value as HostFunction, undefined, decoded)
    },
    settle([id, ok, value]) {
      settleHost(Number(id), ok === true, value)
      return undefined
    }
  }

  const hostFunction = context.newFunction('__lawha_host', (opHandle, payloadHandle) => {
    let reply: Reply
    try {
      const op = context.getString(opHandle)
      const payload: unknown = JSON.parse(context.getString(payloadHandle))
      const handler = Object.hasOwn(hostOps, op) ? hostOps[op] : undefined
      if (!handler || !Array.isArray(payload)) throw new TypeError(`Unknown request: ${op}`)
      reply = { ok: true, v: codec.encode(handler(payload)) }
    } catch (error) {
      reply = { ok: false, e: errorOf(error) }
    }
    return context.newString(JSON.stringify(reply))
  })
  context.setProp(context.global, '__lawha_host', hostFunction)
  hostFunction.dispose()

  const booted = context.evalCode(GUEST_BOOTSTRAP, 'lawha-plugin-bootstrap.js')
  if (booted.error) {
    const message = String(context.dump(booted.error))
    booted.error.dispose()
    context.dispose()
    runtime.dispose()
    throw new Error(`The plugin sandbox did not start: ${message}`)
  }
  const dispatcher: QuickJSHandle = booted.value

  const free = () => {
    if (state.freed || state.depth > 0) return
    state.freed = true
    for (const waiting of pending.values()) waiting.reject(new Error('The plugin has closed'))
    pending.clear()
    try {
      dispatcher.dispose()
      context.dispose()
      runtime.dispose()
    } catch (error) {
      // A heap left inconsistent by an interrupted turn can refuse to free; the interpreter is
      // unreachable either way.
      console.warn('[Plugins] The plugin sandbox did not free cleanly', error)
    }
  }

  /** Runs the queued promise jobs; plugin code continuing after an await runs here. */
  const drainJobs = () => {
    const jobs = runtime.executePendingJobs()
    if (!jobs.error) return
    const message = String(context.dump(jobs.error))
    jobs.error.dispose()
    if (FATAL.test(message)) fatal(`The plugin was stopped: ${message}`)
  }

  const stopped = () => closed() || state.failed !== null

  /**
   * Every entry into the interpreter goes through here: the outermost one starts the turn's
   * deadline, runs the jobs it queued, and frees the interpreter if the plugin closed during it.
   */
  function enter<T>(work: () => T): T {
    if (closed()) throw new Error('The plugin has closed')
    if (state.failed !== null) throw new Error(state.failed)
    const outermost = state.depth === 0
    if (outermost) state.deadline = Date.now() + limits.turnMilliseconds
    state.depth++
    try {
      const out = work()
      if (outermost && !stopped()) drainJobs()
      return out
    } catch (error) {
      const message = errorText(error)
      if (FATAL.test(message)) fatal(`The plugin was stopped: ${message}`)
      throw error
    } finally {
      state.depth--
      if (outermost) {
        state.deadline = Number.POSITIVE_INFINITY
        if (stopped()) {
          state.disposed = true
          free()
        }
      }
    }
  }

  /** Calls the guest dispatcher; the only way host code asks the interpreter for something. */
  function guestCall(op: string, args: unknown[]): unknown {
    const text = enter(() => {
      const opHandle = context.newString(op)
      const payloadHandle = context.newString(JSON.stringify(args))
      const result = context.callFunction(dispatcher, context.undefined, opHandle, payloadHandle)
      opHandle.dispose()
      payloadHandle.dispose()
      if (result.error) {
        const message = String(context.dump(result.error))
        result.error.dispose()
        throw new Error(message)
      }
      const out = context.getString(result.value)
      result.value.dispose()
      return out
    })
    const reply: unknown = JSON.parse(text)
    if (!isRecord(reply)) throw new Error('The plugin sandbox sent an unreadable reply')
    if (reply.ok === true) return codec.decode(reply.v)
    throw guestError(reply.e)
  }

  return {
    define(globals) {
      const encoded: Record<string, Encoded> = {}
      for (const [name, value] of Object.entries(globals)) encoded[name] = codec.encode(value)
      guestCall('define', [encoded])
    },
    async run(body) {
      return await guestCall('run', [`(async () => {\n${body}\n})`])
    },
    get failed() {
      return state.failed
    },
    dispose() {
      if (state.disposed) return
      state.disposed = true
      free()
    }
  }
}
