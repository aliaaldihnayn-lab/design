import { SkiaRenderer } from '#core/canvas'
import { buildParagraph } from '#core/canvas/text'
import { initCanvasKit } from '#core/io/formats/raster'
import { SceneGraph } from '@lawha/scene-graph'
const ck = await initCanvasKit()
const r = new SkiaRenderer(ck, ck.MakeSurface(1, 1)!)
await r.loadFonts()
const g = new SceneGraph()
const n = g.createNode('TEXT', g.getPages()[0].id, { text: process.argv[2] ?? 'لوحة Lawha ٢٠٢٦ — تصميم', fontFamily: 'Noto Naskh Arabic', fontSize: 30, textDirection: 'RTL', textAutoResize: 'WIDTH_AND_HEIGHT', width: 400, height: 50 })
const p = buildParagraph(r, n)
p.layout(1000)
for (const line of p.getShapedLines()) for (const run of line.runs) console.log('run', run.textRange ?? '', [...run.offsets], [...run.positions].filter((_, i) => i % 2 === 0).map((v) => v.toFixed(1)))
for (let i = 0; i < 6; i++) console.log(i, JSON.stringify(p.getRectsForRange(i, i + 1, ck.RectHeightStyle.Tight, ck.RectWidthStyle.Tight).map((x) => [x.rect[0].toFixed(1), x.rect[2].toFixed(1)])))
process.exit(0)
