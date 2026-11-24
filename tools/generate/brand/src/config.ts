import { fileURLToPath } from 'node:url'

import { resolveWorkspaceRoot } from '@lawha/package-artifacts-tools/workspace'

export const repositoryRoot = await resolveWorkspaceRoot(fileURLToPath(import.meta.url))
export const targets = ['web', 'docs', 'desktop', 'android'] as const
export type BrandTarget = (typeof targets)[number]

export const brand = {
  /** The peach tile behind the mark in every app icon, favicon, and Android adaptive icon. */
  background: '#FFE9D7',
  /** The mark on light surfaces and on the peach tile. */
  ink: '#000000',
  /** The mark on dark surfaces. */
  paper: '#FFFFFF',
  tileInset: 64,
  tileRadius: 200,
  /**
   * Scales of the 100-unit master inside each composition. The master already carries the owner's
   * margin around the mark, so the tiles draw it at full size.
   */
  appScale: 1,
  tileScale: 1,
  maskableScale: 0.92,
  /** Android adaptive foregrounds keep the mark inside the 66dp safe circle of the 108dp canvas. */
  androidForegroundScale: 0.78,
  androidRoundScale: 0.92
} as const

export const webFiles = [
  'brand/favicon.svg',
  'brand/favicon-96x96.png',
  'favicon.ico',
  'apple-touch-icon.png',
  'brand/app-icon.svg',
  'brand/app-icon-1024.png',
  'brand/mark.svg',
  'brand/mark-dark.svg',
  'brand/mark-micro.svg',
  'brand/mark-micro-dark.svg',
  'brand/mark-mono.svg',
  'brand/mark-mono-dark.svg',
  'brand/mark-1024.png',
  'brand/mark-dark-1024.png'
] as const

export const pwaFiles = [
  'brand/pwa-192.png',
  'brand/pwa-512.png',
  'brand/pwa-maskable-512.png'
] as const

export const desktopFiles = [
  '32x32.png',
  '128x128.png',
  '128x128@2x.png',
  'icon.png',
  'icon.icns',
  'icon.ico',
  'Square30x30Logo.png',
  'Square44x44Logo.png',
  'Square71x71Logo.png',
  'Square89x89Logo.png',
  'Square107x107Logo.png',
  'Square142x142Logo.png',
  'Square150x150Logo.png',
  'Square284x284Logo.png',
  'Square310x310Logo.png',
  'StoreLogo.png'
] as const

/** Launcher densities: legacy icon size in pixels; the adaptive foreground is 108/48 of it. */
export const androidDensities = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192
} as const

export const androidFiles = [
  ...Object.keys(androidDensities).flatMap((density) =>
    ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground'].map(
      (name) => `mipmap-${density}/${name}.png`
    )
  ),
  'mipmap-anydpi-v26/ic_launcher.xml',
  'mipmap-anydpi-v26/ic_launcher_round.xml',
  'values/ic_launcher_background.xml'
] as const

export function targetDirectory(target: BrandTarget): string {
  switch (target) {
    case 'web':
      return 'public'
    case 'docs':
      return 'packages/docs/public'
    case 'desktop':
      return 'desktop/icons'
    case 'android':
      return 'mobile/icons/android'
  }
}

export function targetFiles(target: BrandTarget): readonly string[] {
  if (target === 'desktop') return desktopFiles
  if (target === 'android') return androidFiles
  if (target === 'web') return [...webFiles, ...pwaFiles]
  return webFiles
}
