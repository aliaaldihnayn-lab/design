# Lawha — handoff for continuing the work

Branch with all finished work: `feat/arabic-rtl-mockups` (this branch). Each agent below works on
its own branch cut from it, then the branches are merged back.

## Where things stand

- **Web**: https://lawha-aliaaldihnayn-4860.vercel.app (Vercel project `lawha`, builds with Bun
  1.4.4 — see the project's install/build commands).
- **Desktop + Android**: `.github/workflows/desktop-preview.yml` builds on every push to this
  branch and publishes release `desktop-preview` with `latest.json` (desktop auto-update) and
  `android.json` (phone update check). Secrets set: `TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`.
  Windows, Linux and Android build and update; **macOS** runners were moved to `macos-15` /
  `macos-13` after `macos-latest` (capacity) and `macos-14` (unsupported) were cancelled — check
  that run.
- **Google Drive storage** (web): `src/app/integrations/storage/google-drive/`, OAuth client
  `1513535845-1u9552fr7236r6hrllnngv4p7jivnj4c.apps.googleusercontent.com`. Owner still has to
  press "Publish app" in Google Auth Platform → Audience. Desktop/phone sign-in (system browser
  flow) is deferred by the owner.

- **Document editor (Google Docs)**: opening and saving Google Docs in the document editor
  (`/writer`, `src/app/integrations/storage/google-drive/docs.ts`) asks the same OAuth client for
  the additional scope `https://www.googleapis.com/auth/documents` (sensitive). The owner must add
  it in Google Auth Platform → Data Access → Add or remove scopes, enable the **Google Docs API**
  for the project in the Cloud console, and list it in the app's verification request before
  publishing; until then only test users can grant it. Drive storage keeps asking for
  `drive.file` alone, with its own token.

Done in this branch (all tested): Arabic/RTL UI and Google Fonts; mockups; print library and
dielines; frame presets and multi-screen adapt; interactive prototype; one-click design system;
WebP; image adjustments, levels, curves, sharpen/grain/vignette; on-device background removal;
Claude Code handoff export with pixel verifier; open/export PSD; open PDF and AI; Android app;
auto-update for web, desktop and Android; Google Drive storage.

## Rules every agent follows

- Read root `AGENTS.md` and the `AGENTS.md` of every folder you touch first; follow them.
- `bun install`, then `bun run build:packages` before type checks.
- Checks: `npx tsc --noEmit -p packages/core`,
  `NODE_OPTIONS=--max-old-space-size=8192 npx vue-tsc --noEmit -p tsconfig.json`,
  `npx oxfmt --write <files>`, `npx oxlint -c oxlint.json --type-aware <files>`,
  `bun run check:i18n`, targeted `bun test`.
- UI strings in `packages/vue/src/i18n/messages/*.ts` and all 9 locales (real Arabic in `ar`).
- AI/MCP access: new operations are `defineTool`s registered in
  `packages/core/src/tools/registry/extended.ts`.
- Commit and push after every step; one commit per feature; never fake test results; never push
  to `feat/arabic-rtl-mockups` or `master` directly; no deploys.

## Agent tasks

### 1. Formats — branch `feat/formats-complete`
1. Open PowerPoint `.pptx` as editable layers (export already exists in
   `packages/core/src/io/formats/pptx/`): slides → frames (1 px = 9525 EMU), shapes, text runs
   (size = sz/100·96/72 px, bold, colour, alignment, RTL), pictures from `ppt/media`, groups.
   Round-trip test with the exporter.
2. CMYK + PDF/X print export (`packages/core/src/io/formats/pdf/`): DeviceCMYK colours,
   OutputIntent (e.g. FOGRA39), TrimBox/BleedBox, bleed, crop marks, spot colours as Separation;
   export id `pdf-print`, added to `EXPORT_FORMAT_IDS` and the export menu labels.
3. PDF import: real text colour and font family/weight
   (`packages/core/src/io/formats/pdf/import/`).
4. PSD import: layer effects (shadows, stroke, glow) and fill/shape layers as editable layers
   (`packages/core/src/io/formats/psd/read.ts`).

### 2. Affinity — branch `feat/affinity-pixels`
1. Pixel painting: brush, eraser, fill bucket, colour picker on image layers (non-destructive
   paint layer), toolbar tools and shortcuts.
2. Selections (rectangle, ellipse, magic wand) and layer masks from a selection (invert, feather).
3. Clone stamp and healing brush.
4. Publisher: master pages, threaded text frames, automatic page numbers.

### 3. Illustrator — branch `feat/illustrator-tools`
1. Shape Builder (merge/delete regions of overlapping shapes), on the boolean geometry in
   `packages/core/src/editor/structure/`.
2. Warp/Envelope presets (arc, arch, bulge, flag, wave, fish, rise, squeeze, twist) and mesh.
3. On-device Image Trace (colour quantisation, contour tracing, curve fitting) as an offline
   provider next to `src/app/editor/vectorize/`.
4. Missing basics: width tool, blend tool, offset path, outline stroke, pattern fills.

### 4. Figma — branch `feat/figma-parity`
1. Run Figma plugins (`manifest.json` + `code.js` + `ui.html`) in a sandbox over the existing
   `figma` API emulation (`packages/core/src/figma-api/`), with `figma.ui` message bridging and a
   Plugins menu; sample plugin under `tests/fixtures/plugins/`.
2. Prototype: true Smart Animate (match layers by name, tween), scrolling frames, canvas
   noodles (drag to link screens, arrows) — `packages/core/src/prototype/`.
3. Design system: components with variants, dark-mode variables, text styles —
   `packages/core/src/design-system/`.
4. Dev-mode inspect panel (CSS/iOS/Android), component properties, auto-layout min/max if
   missing.

### 5. General — branch `feat/general-polish`
1. Mobile touch: pinch zoom, two-finger pan, long-press menu, larger handles, bottom toolbar and
   sheets, safe areas (`mobile/`, `IS_MOBILE_APP`, `isMobile`).
2. Translate every untranslated or hardcoded UI string.
3. Fix pre-existing failures: `bun run lint` (lint:structure in test files) and the 5 failing
   tests in `tests/app/shell/updater/check.test.ts`; run `bun run test:unit`.
4. Make `packages/mcp` publishable (`npm pack --dry-run`), without publishing.
5. Update `README.md` (English plus a short Arabic section).

## Merging

When a branch is done: rebase or merge it onto `feat/arabic-rtl-mockups`, run the checks above
and `bun run test:unit`, then push. Desktop/Android builds and the Vercel deploy follow
automatically from pushes to `feat/arabic-rtl-mockups` (Vercel production needs a redeploy of
that branch with target production).
