// Figma's "Rectangle Creator" sample: the UI asks for a count, the code makes the rectangles,
// selects them, and reports back before closing.
function createRectangles(count) {
  const nodes = []
  for (let i = 0; i < count; i++) {
    const rect = figma.createRectangle()
    rect.name = `Rectangle ${i + 1}`
    rect.x = i * 150
    rect.fills = [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0 } }]
    figma.currentPage.appendChild(rect)
    nodes.push(rect)
  }
  figma.currentPage.selection = nodes
  figma.viewport.scrollAndZoomIntoView(nodes)
  return nodes
}

if (figma.command === 'three') {
  createRectangles(3)
  figma.closePlugin('Created 3 rectangles')
} else {
  figma.showUI(__html__, { width: 240, height: 140, themeColors: true })
  figma.ui.onmessage = (msg) => {
    if (msg.type === 'create-rectangles') {
      const nodes = createRectangles(msg.count)
      figma.ui.postMessage({ type: 'created', count: nodes.length })
    }
    if (msg.type === 'cancel') figma.closePlugin()
  }
}
