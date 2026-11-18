import type { Page } from '@playwright/test'

import type { PixelToolSettings, Tool } from '@lawha/core'

import type * as PhotoScenes from '#tests/helpers/canvas/photo/scene'

/** The canvas sits 40 screen pixels in from its corner at 100%, so specs click in page units. */
export const PHOTO_PAN = 40

/** Builds the pixel tool and threaded text scenes and reads back what the tools made. */
export function photoDriver(page: () => Page) {
  return {
    /** The photo on an otherwise empty page; a pixel tool keeps Select All for its pixels. */
    showPhoto() {
      return page().evaluate(async (pan) => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        store.setTool('SELECT')
        const canvas = store.graph.getNode(store.state.currentPageId)
        for (const id of canvas?.childIds.slice() ?? []) store.graph.deleteNode(id)
        const url = '/tests/helpers/canvas/photo/scene.ts'
        const scenes: typeof PhotoScenes = await import(url)
        const { photo } = scenes.createPhotoScene(store.graph, store.state.currentPageId)
        store.state.zoom = 1
        store.state.panX = pan
        store.state.panY = pan
        store.select([photo])
        store.requestRender()
        return photo
      }, PHOTO_PAN)
    },

    showThread() {
      return page().evaluate(async (pan) => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        const url = '/tests/helpers/canvas/photo/scene.ts'
        const scenes: typeof PhotoScenes = await import(url)
        const scene = scenes.createThreadScene(store.graph, store.state.currentPageId)
        store.state.zoom = 1
        store.state.panX = pan
        store.state.panY = pan
        store.select(scene.frames)
        await store.loadFontsForNodes(scene.frames)
        store.linkTextFrames()
        store.clearSelection()
        store.requestRender()
        return scene
      }, PHOTO_PAN)
    },

    setTool(tool: Tool, settings: Partial<PixelToolSettings> = {}) {
      return page().evaluate(
        ({ tool, settings }) => {
          const store = window.lawha?.getStore?.()
          if (!store) throw new Error('Lawha store not initialized')
          store.setTool(tool)
          store.setPixelTools(settings)
        },
        { tool, settings }
      )
    },

    /** Masks the selection's layer with the selection, as the tool options bar's button does. */
    maskFromSelection() {
      return page().evaluate(() => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        return store.pixelMaskFromSelection()
      })
    },

    /** Resizes a layer, as dragging its handles ends. */
    resize(id: string, width: number, height: number) {
      return page().evaluate(
        ({ id, width, height }) => {
          const store = window.lawha?.getStore?.()
          if (!store) throw new Error('Lawha store not initialized')
          store.graph.updateNode(id, { width, height })
          store.requestRender()
        },
        { id, width, height }
      )
    },

    /** How many fills a layer has, its paint layer included. */
    fillCount(id: string) {
      return page().evaluate((id) => window.lawha?.getStore?.().graph.getNode(id)?.fills.length, id)
    },

    /** The type of the layer `id` sits in, which a mask from a selection makes a group. */
    parentType(id: string) {
      return page().evaluate((id) => {
        const graph = window.lawha?.getStore?.().graph
        const parentId = graph?.getNode(id)?.parentId
        return parentId ? graph.getNode(parentId)?.type : undefined
      }, id)
    },

    /** Each text frame's text and style runs. */
    frameTexts(ids: readonly string[]) {
      return page().evaluate((ids) => {
        const graph = window.lawha?.getStore?.().graph
        return ids.map((id) => {
          const node = graph?.getNode(id)
          return { text: node?.text ?? '', runs: node?.styleRuns.length ?? 0 }
        })
      }, ids)
    },

    deleteLayer(id: string) {
      return page().evaluate((id) => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        store.select([id])
        store.deleteSelected()
      }, id)
    }
  }
}
