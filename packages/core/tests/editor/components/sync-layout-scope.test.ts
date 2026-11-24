import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SceneGraph } from '@lawha/scene-graph'

import { createComponentSyncScheduler } from '#core/editor/component-sync'
import { layoutNodeAndAncestors } from '#core/layout/mutations'

function createGraph() {
  const graph = new SceneGraph()
  const componentPage = graph.getPages()[0]
  const instancePage = graph.addPage('Instances')
  const unrelatedPage = graph.addPage('Unrelated')

  const component = graph.createNode('COMPONENT', componentPage.id, {
    name: 'Button',
    width: 200,
    height: 40,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 8,
    paddingLeft: 16
  })
  const label = graph.createNode('TEXT', component.id, { name: 'Label', text: 'Label', x: 0, y: 0 })
  const instance = expectDefined(
    graph.createInstance(component.id, instancePage.id, { x: 0, y: 0 }),
    'instance'
  )
  const unrelated = graph.createNode('FRAME', unrelatedPage.id, {
    name: 'Dashboard',
    width: 300,
    height: 200,
    layoutMode: 'VERTICAL',
    itemSpacing: 4
  })
  graph.createNode('TEXT', unrelated.id, { name: 'Title', text: 'Title', x: 0, y: 0 })

  return {
    graph,
    componentPage,
    instancePage,
    unrelatedPage,
    component,
    label,
    instance,
    unrelated
  }
}

describe('component sync layout scope', () => {
  test('lays out only the synced component and its instances, including cross-page ones', async () => {
    const {
      graph,
      componentPage,
      instancePage,
      unrelatedPage,
      unrelated,
      label,
      component,
      instance
    } = createGraph()
    const scopes: string[] = []
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined,
      (innerGraph, nodeId) => {
        scopes.push(nodeId)
        layoutNodeAndAncestors(innerGraph, nodeId)
      }
    )

    graph.updateNode(label.id, { text: 'Renamed label' })
    scheduleComponentSync(label.id)

    await Promise.resolve()
    expect([...scopes].sort()).toEqual([component.id, instance.id].sort())
    for (const page of [componentPage, instancePage, unrelatedPage, unrelated])
      expect(scopes).not.toContain(page.id)
  })

  test('an instance inside a synced component is laid out with it, once', async () => {
    const { graph, component, label } = createGraph()
    const card = graph.createNode('COMPONENT', graph.getPages()[0].id, {
      name: 'Card',
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    const nested = expectDefined(graph.createInstance(component.id, card.id, {}), 'nested')
    const scopes: string[] = []
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined,
      (innerGraph, nodeId) => {
        scopes.push(nodeId)
        layoutNodeAndAncestors(innerGraph, nodeId)
      }
    )

    graph.updateNode(label.id, { text: 'A much longer label than before' })
    scheduleComponentSync(label.id)

    await Promise.resolve()
    expect(scopes).toContain(card.id)
    expect(scopes).not.toContain(nested.id)
    // The card hugs the nested button, which follows its component.
    expect(graph.getNode(nested.id)?.width).toBe(graph.getNode(component.id)?.width)
    expect(graph.getNode(card.id)?.width).toBe(graph.getNode(nested.id)?.width)
  })

  test('an edit outside any component does no layout work', async () => {
    const { graph, unrelated } = createGraph()
    const scopes: string[] = []
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined,
      (innerGraph, nodeId) => {
        scopes.push(nodeId)
        layoutNodeAndAncestors(innerGraph, nodeId)
      }
    )

    graph.updateNode(unrelated.id, { width: 400 })
    scheduleComponentSync(unrelated.id)

    await Promise.resolve()
    expect(scopes).toEqual([])
  })

  test('layout writing its own results schedules no sync', async () => {
    const { graph, label } = createGraph()
    const scopes: string[] = []
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined,
      (innerGraph, nodeId) => {
        scopes.push(nodeId)
        layoutNodeAndAncestors(innerGraph, nodeId)
      }
    )

    graph.withLayoutMutations(() => {
      graph.updateNode(label.id, { width: 120 })
      scheduleComponentSync(label.id)
    })

    await Promise.resolve()
    expect(scopes).toEqual([])
  })

  test('a cross-page instance still receives the component layout', async () => {
    const { graph, instance, component } = createGraph()
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined
    )

    // Widen the component's padding, which moves its label; the instance must follow.
    const label = graph.getChildren(component.id)[0]
    if (!label) throw new Error('Expected a component child')
    graph.updateNode(label.id, { text: 'A much longer label' })
    scheduleComponentSync(label.id)

    await Promise.resolve()
    const instanceLabel = graph.getChildren(instance.id)[0]
    const componentLabel = graph.getChildren(component.id)[0]
    expect(instanceLabel).toBeDefined()
    expect(instanceLabel?.x).toBe(componentLabel?.x)
    expect(instanceLabel?.width).toBe(componentLabel?.width)
  })
})
