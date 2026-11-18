import type { SceneGraph } from '@lawha/scene-graph'

/**
 * A 300 × 200 "photo" at the page origin for the pixel tool specs: a left-to-right blue
 * gradient, so a patch that does not blend in shows, built in the browser.
 */
export function createPhotoScene(graph: SceneGraph, pageId: string) {
  const photo = graph.createNode('RECTANGLE', pageId, {
    name: 'Photo',
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    fills: [
      {
        type: 'GRADIENT_LINEAR',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        gradientStops: [
          { position: 0, color: { r: 0.1, g: 0.2, b: 0.45, a: 1 } },
          { position: 1, color: { r: 0.65, g: 0.8, b: 1, a: 1 } }
        ],
        gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      }
    ]
  })
  return { photo: photo.id }
}

/**
 * Three linked text frames on a page frame, the story's second sentence bold and its last red,
 * for the threaded text spec.
 */
export function createThreadScene(graph: SceneGraph, pageId: string) {
  const page = graph.createNode('FRAME', pageId, {
    name: 'Page',
    x: 0,
    y: 0,
    width: 560,
    height: 220,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
  })
  const story =
    'Linked frames pour one story from frame to frame. Bold words stay bold as they travel. ' +
    'Each frame takes whole words that fit and passes the rest on. The last words are red.'
  const bold = 'Bold words stay bold as they travel.'
  const red = 'The last words are red.'
  const frames = [20, 200, 380].map((x, index) =>
    graph.createNode('TEXT', page.id, {
      name: `Frame ${index + 1}`,
      x,
      y: 20,
      width: 160,
      height: 80,
      fontSize: 16,
      text: index === 0 ? story : '',
      textAutoResize: 'NONE',
      styleRuns:
        index === 0
          ? [
              { start: story.indexOf(bold), length: bold.length, style: { fontWeight: 700 } },
              {
                start: story.indexOf(red),
                length: red.length,
                style: {
                  fills: [
                    {
                      type: 'SOLID',
                      color: { r: 0.85, g: 0.1, b: 0.1, a: 1 },
                      opacity: 1,
                      visible: true
                    }
                  ]
                }
              }
            ]
          : []
    })
  )
  return { page: page.id, frames: frames.map((frame) => frame.id) }
}
