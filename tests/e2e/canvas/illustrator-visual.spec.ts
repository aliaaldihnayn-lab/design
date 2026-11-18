import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { illustratorDriver } from '#tests/helpers/canvas/illustrator/driver'

const editor = useEditorSetup('/?test&no-chrome&no-rulers')
const illustrator = illustratorDriver(() => editor.page)

test.beforeEach(async () => {
  await illustrator.clearPage()
})

const BLUE = { r: 0.23, g: 0.51, b: 0.96 }
const RED = { r: 0.96, g: 0.35, b: 0.35 }
const TEAL = { r: 0.08, g: 0.73, b: 0.73 }
const INK = { r: 0.1, g: 0.12, b: 0.2 }

async function expectCanvas(name: string) {
  // A tool call shows where the agent worked for a moment; the snapshot waits until it is gone.
  await expect.poll(() => illustrator.presenceCount(), { timeout: 15_000 }).toBe(0)
  await illustrator.endFlashes()
  // Following an agent frames the view while it works; the frame goes once it has finished.
  await expect(editor.page.getByTestId('follow-frame')).toHaveCount(0, { timeout: 15_000 })
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()
  const buffer = await editor.canvas.screenshotCanvasRegion(640, 420)
  expect(buffer).toMatchSnapshot(`${name}.png`)
}

/** The id of what a path tool made, from its result as an MCP call returns it. */
function madeId(result: unknown): string {
  const text = JSON.stringify(result)
  const match = /"(?:id|created)":\s*(?:\[\{"id":)?"([^"]+)"/.exec(text)
  if (!match) throw new Error(`The tool made nothing: ${text}`)
  return match[1]
}

test('Shape Builder shades the region under the pointer', async () => {
  const ids = await illustrator.addShapes([
    { type: 'RECTANGLE', name: 'Left', x: 80, y: 80, width: 200, height: 160, color: BLUE },
    { type: 'ELLIPSE', name: 'Right', x: 180, y: 100, width: 200, height: 200, color: RED }
  ])
  await illustrator.select(ids)
  await editor.canvas.pressKey('Shift+M')
  await editor.canvas.hover(230, 170)
  await expectCanvas('shape-builder-highlight')
  await editor.canvas.pressKey('v')
})

test('a live warp bends the layer and can be bent again from its outline', async () => {
  const [rect] = await illustrator.addShapes([
    { type: 'RECTANGLE', name: 'Banner', x: 80, y: 120, width: 360, height: 90, color: TEAL }
  ])
  const warped = madeId(
    await illustrator.runTool('warp_shape', { ids: [rect], preset: 'arc', bend: 0.3 })
  )
  await illustrator.runTool('edit_path_effect', { id: warped, preset: 'flag', bend: 0.6 })
  await expectCanvas('live-warp-flag')
})

test('an envelope mesh shows its handles, and dragging a point reshapes the layer', async () => {
  const [rect] = await illustrator.addShapes([
    { type: 'RECTANGLE', name: 'Card', x: 120, y: 100, width: 240, height: 180, color: TEAL }
  ])
  const meshed = madeId(
    await illustrator.runTool('envelope_mesh', { id: rect, rows: 2, columns: 2 })
  )
  await illustrator.select([meshed])
  // The top right point of the mesh, dragged out and up.
  await editor.canvas.drag(360, 100, 400, 70)
  await expect.poll(() => illustrator.box(meshed)).toEqual([120, 70, 280, 210])
  await expectCanvas('envelope-mesh-handles')
})

test('the Width tool drags out a width point along a stroke', async () => {
  const line = await illustrator.addLine({
    name: 'Stroke',
    points: [
      { x: 80, y: 200 },
      { x: 480, y: 200 }
    ],
    weight: 12,
    color: INK
  })
  await illustrator.select([line])
  await editor.canvas.pressKey('Shift+W')
  // Pressed on the line's middle and pulled 30 px away: 60 px wide there.
  await editor.canvas.drag(280, 200, 280, 170)
  const [layer] = await illustrator.pageLayerIds()
  await expect.poll(() => illustrator.box(layer)).toEqual([80, 170, 400, 60])
  await expectCanvas('width-tool-profile')
  await editor.canvas.pressKey('v')
})

test('a live blend steps between two shapes along a spine', async () => {
  const [from, to] = await illustrator.addShapes([
    { type: 'ELLIPSE', name: 'From', x: 70, y: 260, width: 40, height: 40, color: RED },
    { type: 'RECTANGLE', name: 'To', x: 470, y: 260, width: 60, height: 60, color: BLUE }
  ])
  const spine = await illustrator.addLine({
    name: 'Spine',
    points: [
      { x: 90, y: 280 },
      { x: 300, y: 80 },
      { x: 500, y: 290 }
    ],
    weight: 1,
    color: INK
  })
  const blend = madeId(
    await illustrator.runTool('blend_shapes', {
      from_id: from,
      to_id: to,
      steps: 6,
      spine_id: spine
    })
  )
  await illustrator.runTool('edit_blend', { id: blend, steps: 8 })
  await expectCanvas('live-blend-spine')
})

test('a pattern fill tiles a component, spaced, moved, and turned', async () => {
  const [tile, target] = await illustrator.addShapes([
    { type: 'COMPONENT', name: 'Dot', x: 520, y: 40, width: 20, height: 20, color: RED },
    { type: 'RECTANGLE', name: 'Patterned', x: 80, y: 80, width: 360, height: 260, color: TEAL }
  ])
  await illustrator.runTool('set_pattern_fill', {
    ids: [target],
    source_id: tile,
    scale: 1,
    spacing_x: 0.5,
    spacing_y: 0.5,
    offset_x: 8,
    offset_y: 4,
    rotation: 30
  })
  await expectCanvas('pattern-fill-placed')
})
