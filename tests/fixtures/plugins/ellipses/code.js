// A second sample that runs beside Rectangle Creator: its UI asks for ellipses, and it keeps a
// global count of its own that no other plugin sees.
globalThis.made = 0
figma.showUI(__html__, { width: 220, height: 120 })
figma.ui.onmessage = (msg) => {
  if (msg.type !== 'create-ellipse') return
  const ellipse = figma.createEllipse()
  globalThis.made += 1
  ellipse.name = `Ellipse ${globalThis.made}`
  ellipse.y = 200
  figma.currentPage.appendChild(ellipse)
  // The plugin UI is not a window: this message has no origin to name.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  figma.ui.postMessage({ type: 'made', count: globalThis.made })
}
