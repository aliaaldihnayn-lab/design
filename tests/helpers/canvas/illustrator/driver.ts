import type { Page } from '@playwright/test'

import type { Fill } from '@lawha/scene-graph'
import type { Vector } from '@lawha/scene-graph/primitives'

/** A layer the Illustrator scenes place, by its page box and paint. */
export interface IllustratorShape {
  type: 'RECTANGLE' | 'ELLIPSE' | 'COMPONENT'
  name: string
  x: number
  y: number
  width: number
  height: number
  color: { r: number; g: number; b: number }
}

/** A stroked open path the Width tool and blend spines take, from point to point. */
export interface IllustratorLine {
  name: string
  points: Vector[]
  weight: number
  color: { r: number; g: number; b: number }
}

/**
 * Drives the Illustrator features through the app: builds layers on the current page, runs the
 * path tools as the AI and MCP do, and reads back what a tool made.
 */
export function illustratorDriver(page: () => Page) {
  return {
    /** Removes every layer on the current page, so each scene starts empty. */
    clearPage() {
      return page().evaluate(() => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        store.setTool('SELECT')
        store.clearSelection()
        const ids = store.graph.getNode(store.state.currentPageId)?.childIds ?? []
        // Deleting a layer takes it out of the list, so the loop walks a copy.
        for (const id of ids.slice()) store.graph.deleteNode(id)
        store.requestRender()
      })
    },

    /** Adds shapes and returns their ids, in order. */
    addShapes(shapes: IllustratorShape[]) {
      return page().evaluate((list) => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        const ids = list.map(
          ({ type, color, ...box }) =>
            store.graph.createNode(type, store.state.currentPageId, {
              ...box,
              fills: [{ type: 'SOLID', color: { ...color, a: 1 }, opacity: 1, visible: true }]
            }).id
        )
        store.clearSelection()
        store.requestRender()
        return ids
      }, shapes)
    },

    /** Adds a stroked line through `points` and returns its id. */
    addLine(line: IllustratorLine) {
      return page().evaluate(({ name, points, weight, color }) => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        const xs = points.map((p) => p.x)
        const ys = points.map((p) => p.y)
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        const node = store.graph.createNode('VECTOR', store.state.currentPageId, {
          name,
          x,
          y,
          width: Math.max(...xs) - x,
          height: Math.max(...ys) - y,
          vectorNetwork: {
            vertices: points.map((p) => ({ x: p.x - x, y: p.y - y })),
            segments: points.slice(1).map((_, i) => ({
              start: i,
              end: i + 1,
              tangentStart: { x: 0, y: 0 },
              tangentEnd: { x: 0, y: 0 }
            })),
            regions: []
          },
          fills: [],
          strokes: [
            {
              type: 'SOLID',
              color: { ...color, a: 1 },
              opacity: 1,
              visible: true,
              weight,
              align: 'CENTER'
            }
          ],
          strokeWeight: weight
        })
        store.requestRender()
        return node.id
      }, line)
    },

    /** Gives a layer a fill, such as a pattern tiled from another layer. */
    setFills(id: string, fills: Fill[]) {
      return page().evaluate(
        ({ id, fills }) => {
          const store = window.lawha?.getStore?.()
          if (!store) throw new Error('Lawha store not initialized')
          store.graph.updateNode(id, { fills })
          store.requestRender()
        },
        { id, fills }
      )
    },

    /** Runs a Lawha tool as an MCP call arrives, and returns its result. */
    runTool(name: string, args: Record<string, unknown>) {
      return page().evaluate(
        ({ name, args }) => window.lawha?.test?.automation?.('tool', { name, args }),
        { name, args }
      )
    },

    select(ids: string[]) {
      return page().evaluate((ids) => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        store.select(ids)
        store.requestRender()
      }, ids)
    },

    /** The page box of a layer, rounded. */
    box(id: string) {
      return page().evaluate((id) => {
        const node = window.lawha?.getStore?.().graph.getNode(id)
        return node ? [node.x, node.y, node.width, node.height].map(Math.round) : null
      }, id)
    },

    /** The ids of the layers on the current page, bottom first. */
    pageLayerIds() {
      return page().evaluate(() => {
        const store = window.lawha?.getStore?.()
        return store?.graph.getNode(store.state.currentPageId)?.childIds ?? []
      })
    }
  }
}
