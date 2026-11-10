# Lawha · لوحة

Design editor for interfaces, print and social media, with a complete Arabic interface and built-in AI. Runs in the browser, as a desktop app for macOS, Windows and Linux (Tauri v2), and on Android phones and tablets.

> **Status:** active development, not yet released. Preview builds: [web app](https://lawha-aliaaldihnayn-4860.vercel.app) and the [`desktop-preview` release](https://github.com/aliaaldihnayn-lab/design/releases/tag/desktop-preview) (desktop installers and the Android APK).

## What it does

- **Design files:** open, edit and save `.fig` (Figma) and `.pen` files; open Photoshop `.psd`, PDF and Illustrator `.ai` files as editable layers; import HTML, SVG, WebP and draw.io. Export to PNG, JPG, WebP, SVG, PDF, PPTX, PSD, HTML, JSX/Tailwind and design tokens.
- **Arabic first:** full Arabic interface with a mirrored (right-to-left) layout, correct Arabic shaping and bidirectional text, and visual text alignment that matches the alignment buttons. The interface also ships in English, German, Spanish, French, Italian, Japanese, Polish, Russian and Chinese.
- **Google Fonts built in:** the whole Google Fonts catalogue is listed and downloaded on demand, including Arabic families such as Cairo, Tajawal, Almarai, Amiri and IBM Plex Sans Arabic.
- **Adapt a design in one click** (Design panel → _Adapt design_):
  - **Screens:** mobile, tablet and desktop copies resized to each width so auto layout reflows them.
  - **Social media:** Instagram, Story, X, LinkedIn, YouTube and more at each platform's size.
  - **Print, ready for the press:** 23 products (business cards, flyers, posters, folded brochures, cards, stickers, envelope, folder, tuck-end box, roll-up) with real sizes, bleed and safe area. The die-line is generated on a locked layer: cut path `CutContour` in magenta, folds in dashed cyan.
- **Prototypes:** link screens with click, hover, press, delay and key triggers, transitions (dissolve, slide, push, smart animate) and easing; auto-link Next and Back buttons; present full screen.
- **Design system in one click:** turn the colours, type, spacing and radii in use into variables, link them to the layers and document them on their own page.
- **Photo editing:** non-destructive adjustments, levels and curves on image fills; sharpen, film grain and vignette; background removal that runs on the device.
- **Mockups:** present a design inside a phone, tablet, laptop, monitor, browser window or watch.
- **AI and automation:** built-in chat with 100+ editing tools, an [MCP server](packages/mcp/README.md) for coding agents, a CLI, a Figma Plugin API–compatible scripting API, and a Claude Code handoff package with a pixel verifier.
- **Storage and collaboration:** local files, Google Drive (web), S3-compatible storage, and peer-to-peer rooms over WebRTC.
- **Touch:** pinch zoom, two-finger pan, long press for the canvas menu, larger handles, and a bottom toolbar and sheets that clear the notch and home indicator.
- **Updates:** the desktop and Android apps check the `desktop-preview` release and update themselves; the web app always serves the latest build.

## Development

```sh
bun install
bun run build:packages   # once per fresh checkout or worktree
bun run dev              # web editor at http://localhost:1420
bun run tauri dev        # desktop app (requires Rust and the Tauri v2 prerequisites)
```

Quality gates: `bun run check`, `bun run test:unit` and `bun run test`. [AGENTS.md](AGENTS.md) maps the repository and links the guide inside each package; [CONTRIBUTING.md](CONTRIBUTING.md) covers setup and commits. The Android APK is built with `mobile/build-apk.sh`.

### MCP server

`packages/mcp` is the MCP server coding agents use to read and edit the open design. It is prepared for npm as `@lawha/mcp` together with the packages it depends on:

```sh
bun run build:packages
bun tools/release/release-packages/src/cli.ts prepare   # writes .publish/<package>
cd .publish/mcp && npm pack --dry-run
```

### Tech stack

| Layer         | Tech                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| Rendering     | Skia (CanvasKit WASM)                                                             |
| Layout        | Yoga WASM (flex + grid via [fork](https://github.com/open-pencil/yoga/tree/grid)) |
| UI            | Vue 3, Reka UI, Tailwind CSS 4                                                    |
| File format   | Kiwi binary + Zstd + ZIP                                                          |
| Collaboration | Trystero (WebRTC P2P) + Yjs (CRDT)                                                |
| Desktop       | Tauri v2 (also builds the Android app)                                            |
| AI/MCP        | Vercel AI SDK (multi-provider, bring your own key), MCP SDK, Hono                 |

## بالعربية

لوحة محرّر تصميم للواجهات والمطبوعات ووسائل التواصل الاجتماعي، بواجهة عربية كاملة وذكاء اصطناعي مدمج. يعمل في المتصفح، وكتطبيق سطح مكتب على macOS وWindows وLinux، وعلى هواتف Android وأجهزتها اللوحية.

- **العربية أولًا:** واجهة معكوسة من اليمين إلى اليسار، وتشكيل صحيح للحروف العربية، ونصوص ثنائية الاتجاه، ومحاذاة تطابق ما تراه.
- **الملفات:** فتح ملفات Figma (`.fig`) وPhotoshop (`.psd`) وPDF وIllustrator طبقاتٍ قابلة للتعديل، والتصدير إلى PNG وJPG وWebP وSVG وPDF وPPTX وPSD وغيرها.
- **التكييف بنقرة واحدة:** نسخ للجوال واللوحي وسطح المكتب، ومقاسات منصات التواصل، و23 منتجًا مطبوعًا بمقاساتها الحقيقية مع النزف وخطوط القص.
- **النماذج الأولية ونظام التصميم:** ربط الشاشات بالتفاعلات والانتقالات، وتحويل الألوان والخطوط والمسافات المستخدمة إلى متغيرات بنقرة واحدة.
- **تحرير الصور:** تعديلات غير متلفة، ومستويات ومنحنيات، وإزالة الخلفية على الجهاز نفسه.
- **الذكاء الاصطناعي:** محادثة مدمجة بأكثر من 100 أداة تحرير، وخادم MCP لوكلاء البرمجة، وواجهة سطر أوامر.
- **اللمس:** تكبير بإصبعين، وتحريك بإصبعين، وضغط مطوّل لفتح القائمة، ومقابض أكبر، وشريط أدوات سفلي يراعي حواف الشاشة.

للتطوير: `bun install` ثم `bun run build:packages` ثم `bun run dev`.

## Origin and license

Lawha is an independent product built on [OpenPencil](https://github.com/open-pencil/open-pencil) by Danila Poyarkov and the OpenPencil contributors, used under the MIT License. It is not affiliated with or endorsed by the OpenPencil project. The original copyright notice is kept in [LICENSE](./LICENSE), as the license requires.

Lawha is licensed under the [MIT License](./LICENSE). The optional Cloud package (`packages/cloud`) remains under the [Apache License 2.0](./LICENSES/Apache-2.0.txt); [`REUSE.toml`](./REUSE.toml) lists the exact paths.
