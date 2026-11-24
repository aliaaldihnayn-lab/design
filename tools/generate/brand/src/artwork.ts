import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { stringToSvg as stringToSVG } from '@realfavicongenerator/generate-favicon'
import type { ImageAdapter } from '@realfavicongenerator/generate-favicon'
import { getNodeImageAdapter } from '@realfavicongenerator/image-adapter-node'

import { brand } from './config.ts'

export async function loadArtwork(root: string) {
  const adapter = await getNodeImageAdapter()
  const main = await readFile(join(root, 'assets/brand/mark.svg'), 'utf8')
  const micro = await readFile(join(root, 'assets/brand/mark-micro.svg'), 'utf8')
  return { adapter, main, micro }
}

/** The mark in one flat color: `ink` for light surfaces, `paper` for dark ones. */
export function recolor(source: string, adapter: ImageAdapter, mode: 'ink' | 'paper') {
  const svg = stringToSVG(source, adapter)
  for (const path of svg.find('[data-part]')) path.fill(mode === 'ink' ? brand.ink : brand.paper)
  return svg.svg()
}

/** Shared rounded app icon; touch and maskable variants leave cropping to the platform. */
export function appArtwork(
  source: string,
  adapter: ImageAdapter,
  kind: 'web' | 'maskable' | 'tile' | 'desktop'
): string {
  const svg = adapter.createSvg().size(1024, 1024).viewbox(0, 0, 1024, 1024)
  const rounded = kind === 'tile' || kind === 'desktop'
  const inset = kind === 'desktop' ? brand.tileInset : 0
  const background = svg
    .rect(1024 - inset * 2, 1024 - inset * 2)
    .move(inset, inset)
    .fill(brand.background)
  if (rounded) background.radius(brand.tileRadius)
  const regularScale = kind === 'tile' ? brand.tileScale : brand.appScale
  const scale = kind === 'maskable' ? brand.maskableScale : regularScale
  const mark = stringToSVG(source, adapter).size(1024 * scale, 1024 * scale)
  mark.move((1024 * (1 - scale)) / 2, (1024 * (1 - scale)) / 2)
  svg.add(mark)
  return svg.svg()
}

/** The mark alone on a transparent square, for Android's adaptive foreground layer. */
export function foregroundArtwork(source: string, adapter: ImageAdapter): string {
  const svg = adapter.createSvg().size(1024, 1024).viewbox(0, 0, 1024, 1024)
  const scale = brand.androidForegroundScale
  const mark = stringToSVG(recolor(source, adapter, 'ink'), adapter).size(
    1024 * scale,
    1024 * scale
  )
  mark.move((1024 * (1 - scale)) / 2, (1024 * (1 - scale)) / 2)
  svg.add(mark)
  return svg.svg()
}

/** The mark on a peach circle, for launchers that ask for a round legacy icon. */
export function roundArtwork(source: string, adapter: ImageAdapter): string {
  const svg = adapter.createSvg().size(1024, 1024).viewbox(0, 0, 1024, 1024)
  svg.circle(1024).fill(brand.background)
  const scale = brand.androidRoundScale
  const mark = stringToSVG(source, adapter).size(1024 * scale, 1024 * scale)
  mark.move((1024 * (1 - scale)) / 2, (1024 * (1 - scale)) / 2)
  svg.add(mark)
  return svg.svg()
}
