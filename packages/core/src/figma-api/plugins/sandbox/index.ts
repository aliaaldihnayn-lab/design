import type { QuickJSWASMModule } from 'quickjs-emscripten-core'

let quickjs: Promise<QuickJSWASMModule> | null = null

/**
 * Loads the QuickJS interpreter plugins run in, once per process. It is a WebAssembly build
 * only sessions that run a plugin need, so it loads on first use.
 */
export function loadPluginInterpreter(): Promise<QuickJSWASMModule> {
  quickjs ??= (async () => {
    const [{ newQuickJSWASMModuleFromVariant }, variant] = await Promise.all([
      import('quickjs-emscripten-core'),
      import('@jitl/quickjs-wasmfile-release-sync')
    ])
    return newQuickJSWASMModuleFromVariant(variant.default)
  })()
  quickjs.catch(() => {
    quickjs = null
  })
  return quickjs
}

export {
  createPluginSandbox,
  DEFAULT_SANDBOX_LIMITS,
  type CreateSandboxOptions,
  type PluginSandbox,
  type SandboxLimits
} from './membrane'
