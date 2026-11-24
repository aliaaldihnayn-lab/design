/**
 * Render requests from graph changes, held while an async mutation runs. Each request bumps the
 * reactive versions every panel watches, and a mutation that awaits between its changes, as
 * drawing design JSX does at every layer, would otherwise have the interface update thousands of
 * times before it ends. While one runs, requests are noted and answered with one render when
 * the last running mutation ends.
 */
export function createDeferredRenders(requestRender: () => void) {
  let running = 0
  let pending = false

  function request() {
    if (running > 0) pending = true
    else requestRender()
  }

  async function during<T>(run: () => Promise<T>): Promise<T> {
    running++
    try {
      return await run()
    } finally {
      running--
      if (running === 0 && pending) {
        pending = false
        requestRender()
      }
    }
  }

  return { request, during }
}
