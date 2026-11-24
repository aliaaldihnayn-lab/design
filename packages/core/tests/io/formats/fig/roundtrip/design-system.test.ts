import { expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { exportFigFile, parseFigFile, populateAllFigPages } from '@lawha/core/io/formats/fig'
import { ALL_TOOLS } from '@lawha/core/tools'
import { initCodec } from '@lawha/kiwi/fig/codec'
import { SceneGraph } from '@lawha/scene-graph'
import { pixelLength } from '@lawha/scene-graph/text'

const solid = (r: number, g: number, b: number) => [
  { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true }
]

/** What the build makes, by name: variables per mode, sets with their variants, text styles. */
function system(graph: SceneGraph) {
  const name = (id: string | undefined) => (id ? graph.variables.get(id)?.name : undefined)
  const nodes = [...graph.nodes.values()]
  return {
    modes: [...graph.variableCollections.values()].map((c) => c.modes.map((m) => m.name)),
    variables: [...graph.variables.values()]
      .map((v) => [v.name, v.type, Object.keys(v.valuesByMode).length])
      .sort(),
    sets: nodes
      .filter((n) => n.type === 'COMPONENT_SET')
      .map((n) => [
        n.name,
        graph.getChildren(n.id).map((c) => c.name),
        n.componentPropertyDefinitions.map((d) => [d.name, d.type, d.variantOptions ?? null])
      ]),
    textStyles: nodes
      .filter((n) => n.sharedStyleType === 'TEXT')
      .map((n) => [
        n.name,
        n.fontSize,
        Object.fromEntries(Object.entries(n.boundVariables).map(([k, id]) => [k, name(id)]))
      ])
  }
}

test('a built design system keeps its modes, variables, component sets and text styles in .fig', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const screen = graph.createNode('FRAME', graph.getPages()[0].id, {
    name: 'Home',
    width: 390,
    height: 700,
    fills: solid(1, 1, 1)
  })
  for (const size of [28, 16, 12])
    graph.createNode('TEXT', screen.id, {
      name: `Text ${size}`,
      text: 'مرحبا Hello',
      fontFamily: 'Inter',
      fontSize: size,
      lineHeight: pixelLength(size * 1.5),
      fills: solid(0.07, 0.09, 0.15)
    })
  graph.createNode('FRAME', screen.id, {
    name: 'Button',
    width: 342,
    height: 52,
    cornerRadius: 12,
    fills: solid(0.05, 0.62, 0.43)
  })
  const build = ALL_TOOLS.find((tool) => tool.name === 'build_design_system')
  if (!build) throw new Error('build_design_system is not registered')
  await build.execute(new FigmaAPI(graph), {})
  const built = system(graph)
  expect(built.sets).toHaveLength(3)
  expect(built.textStyles.length).toBeGreaterThan(1)
  for (const [, , bound] of built.textStyles)
    expect(Object.keys(bound).toSorted()).toEqual([
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight'
    ])

  const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
  populateAllFigPages(reopened)
  expect(system(reopened)).toEqual(built)
})
