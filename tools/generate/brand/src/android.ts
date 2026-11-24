import sharp from 'sharp'

import { appArtwork, foregroundArtwork, loadArtwork, roundArtwork } from './artwork.ts'
import { androidDensities, brand } from './config.ts'
import type { BrandFiles } from './web.ts'

/** Android adaptive-icon foreground canvas relative to the legacy icon (108dp over 48dp). */
const FOREGROUND_RATIO = 108 / 48

function adaptiveIcon(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`
}

/**
 * Launcher resources for the Android app: an adaptive icon (black mark over a peach background
 * color, plus the same layer as Android 13's themed monochrome icon) and the legacy square and
 * round icons older launchers use. `mobile/build-apk.sh` copies them into the generated project.
 */
export async function generateAndroid(root: string): Promise<BrandFiles> {
  const { adapter, main } = await loadArtwork(root)
  const square = Buffer.from(appArtwork(main, adapter, 'tile'))
  const round = Buffer.from(roundArtwork(main, adapter))
  const foreground = Buffer.from(foregroundArtwork(main, adapter))
  const files: BrandFiles = new Map()
  const png = (svg: Buffer, size: number) => sharp(svg).resize(size, size).png().toBuffer()
  for (const [density, size] of Object.entries(androidDensities)) {
    files.set(`mipmap-${density}/ic_launcher.png`, await png(square, size))
    files.set(`mipmap-${density}/ic_launcher_round.png`, await png(round, size))
    files.set(
      `mipmap-${density}/ic_launcher_foreground.png`,
      await png(foreground, Math.round(size * FOREGROUND_RATIO))
    )
  }
  files.set('mipmap-anydpi-v26/ic_launcher.xml', Buffer.from(adaptiveIcon()))
  files.set('mipmap-anydpi-v26/ic_launcher_round.xml', Buffer.from(adaptiveIcon()))
  files.set(
    'values/ic_launcher_background.xml',
    Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">${brand.background}</color>
</resources>
`)
  )
  return files
}
