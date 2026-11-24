# Lawha brand sources

- `mark.svg` is the owner's Lawha mark, copied unchanged from the approved 100 × 100 artwork: one black (`#000000`) polygon, a zigzag of two bands with a notch opening to the left. The approved artwork's peach (`#FFE9D7`) background square is not in the master; the generator draws it as the app tile. Do not redraw or retouch the polygon.
- `mark-micro.svg` is the same polygon with a tighter `10 10 80 80` viewBox, so the mark fills more of a 16px favicon tile. Only the framing differs; `tools/generate/brand/tests/generation.test.ts` checks that both masters carry the same path.
- The main master uses the full `0 0 100 100` viewBox, so the owner's margin around the mark is part of every composition that draws it at full size.
- Brand colors are black and peach. The mark is black on light surfaces and on the peach tile, and white (`#FFFFFF`) on dark surfaces; there is no other palette. The interface accent derived from them lives in `src/app/shell/accent/palette.ts` (`lawha` preset).
- Keep the `data-part="body"` attribute: the generator recolors it for the white and monochrome variants.

Edit these SVGs, not generated files. Platform backgrounds, padding, and colors live in `tools/generate/brand/src/config.ts`. The official app-icon variant puts the black mark on a peach rounded tile that fills the image, with transparency only at the rounded corners. Native desktop assets retain their platform-specific outer margin. Desktop icons, any-purpose PWA icons, and larger in-app branding share this composition. The tile stays peach in both themes; use `BrandMark` with `variant="app-icon"` for larger placements. The editor header uses a 24px tile. Favicons use the same tile with the micro master inside, in both browser themes. Generated `brand/app-icon.svg` and `brand/app-icon-1024.png` are suitable for profile images, and `brand/mark-1024.png` / `brand/mark-dark-1024.png` are the mark alone, black and white on transparency. Apple Touch keeps an opaque square for platform rounding; maskable artwork stays opaque and inside the central 80%-diameter safe circle. The Android adaptive icon is the black mark on a transparent foreground inside the 66dp safe circle, over a peach background color, with the same layer as its themed monochrome icon.

## Generation

```sh
bun run generate:icons                    # All targets
bun run generate:icons --target web       # App/browser/PWA
bun run generate:icons --target docs      # Documentation
bun run generate:icons --target desktop   # Native PNG/ICO/ICNS
bun run generate:icons --target android   # Android launcher icons (mobile/icons/android)
bun run generate:icons --force            # Ignore the content cache
bun run check:icons                       # Fresh generation, contracts, reproducibility, types
bun test tools/generate/brand/tests
```

Generation is local using pinned RealFaviconGenerator/Sharp and Tauri versions; no hosted generator or credentials are needed. Generated assets and the cache are ignored by Git. Only the two artwork masters, settings, code, tests, and the normal Playwright visual baseline are tracked.

Vite ensures web assets before app dev/build. VitePress ensures docs assets before docs dev/build. Storybook prepares the assets for its stories. Tauri's dev/build hooks prepare native icons before compilation. Direct Cargo commands bypass those hooks: run `bun run generate:icons --target desktop` before `cargo check` or `cargo build` on a fresh checkout. CI's native-contract job does this explicitly. No icon generation runs in the shipped application.

Outputs are owned by `tools/generate/brand/src/config.ts`: `public/brand/`, `packages/docs/public/brand/`, the root ICO/Apple Touch files in each public directory, `desktop/icons/`, and `mobile/icons/android/`, which `mobile/build-apk.sh` generates and copies into the Android project. The app's manifest remains in `vite/pwa.ts`; docs intentionally do not receive an installable-app manifest. Web assets never symlink into desktop output.

Preparation fingerprints the artwork, generator code/settings, lockfile and runtime/tool versions, verifies output hashes, and skips unchanged targets. Missing or corrupted outputs regenerate. A cross-process lock serializes concurrent builds; each file is published atomically and the cache is written last. Destination symlinks are rejected. Native ICNS frame ordering is normalized without re-encoding images.

## Review

Use the **Brand/Mark** Storybook stories for main, micro, dark (white), and monochrome appearances. `tests/e2e/brand/icons.spec.ts` checks the browser assets, app theme selection, and the main mark's visual baseline. Review intentional changes before updating its snapshot. Run at actual 16/24/32 pixel sizes as well as large sizes.

Do not mechanically replace generic pencil/tool icons or historical screenshots. Social artwork, external profile avatars, and Apple Icon Composer layered icons are separate design/export tasks.
