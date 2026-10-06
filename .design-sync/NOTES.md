# design-sync notes — map-goblin

Repo-specific gotchas for future syncs. Read this before re-running.

## Environment / how this build is produced

- **Source is `main`, built from a worktree.** The repo usually sits on a feature
  branch, so the sync builds from `.worktrees/ds-main` (created with
  `git worktree add .worktrees/ds-main main`). It needs its own
  `COREPACK_ENABLE_STRICT=0 pnpm i --frozen-lockfile`.
- **Run the converter from the repo ROOT, not the worktree.** `previews/` resolves
  from the process CWD (`package-build.mjs:792`) and `readmeHeader` from the config
  home (`:906`), so running at the root keeps both in the durable
  `D:\Labs\map-goblin\.design-sync\` while the *source* comes from the worktree:

  ```sh
  node .ds-sync/package-build.mjs --config .design-sync/config.json \
    --node-modules .worktrees/ds-main/canvas/node_modules --out ./ds-bundle
  ```

- **`map-builder` must be self-linked.** The converter resolves the package as
  `<node-modules>/<pkg>`, and pnpm never self-links a workspace package, so the
  build dies with `ENOENT .../node_modules/map-builder/package.json`. Fix once per
  worktree (PowerShell, no admin needed):

  ```powershell
  New-Item -ItemType Junction -Path .worktrees\ds-main\canvas\node_modules\map-builder `
           -Target .worktrees\ds-main\canvas
  ```

- **Declarations must be emitted or every contract is empty.** `canvas` is a Vite
  *app* with no `types` entry, so ts-morph finds nothing and all 70 components emit
  `[key: string]: unknown`. Before the converter, run in `.worktrees/ds-main/canvas`:

  ```sh
  npx tsc -p tsconfig.app.json --declaration --emitDeclarationOnly --noEmit false --outDir dist/types
  ```

  `findTypesRoot` auto-detects `dist/types` — no config change needed. This takes
  contracts from 0/70 real to 58/70 (the other 12 genuinely take no props).
- `cfg.buildCmd` (`vite build` + copy `ds-styles.css`) must run in the worktree's
  `canvas/` before the converter, or `cssEntry` is missing.
- **`EBUSY: rmdir ds-bundle`** shows up occasionally on this Windows box (same
  antivirus-flake class as the repo's known EPERM rename issue). No process holds
  the directory — just re-run the driver once.
- Playwright: repo pins `@playwright/test@1.58.2`, which wants chromium build
  **1208**, already in `~/AppData/Local/ms-playwright`. Install the driver into the
  staged scripts with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.58.2`.

## The theme — the single most important fact

The app ships `<html lang="en" class="dark">` hardcoded (`canvas/index.html`) and has
no toggle. `:root` holds the semantic indirections (`--background: var(--surface-0)`)
while `.dark` overrides only the raw tokens, so **`.dark` only works on the same
element as `:root`**. Measured: on a wrapper `<div>`, `bg-background` stays light
(`223 227 222`) while `--surface-0` goes dark (`15 16 14`) — a half-themed mess.

`.design-sync/preview-root.tsx` is the fix: a preview-only `PreviewRoot` wired via
`cfg.provider` + `cfg.extraEntries` that adds `dark` to `documentElement` and paints
the body from the tokens (the card template hardcodes `body{background:#fff}` in an
inline `<style>` that outranks the stylesheet — an element-level style is the only
thing that beats it without forking `lib/emit.mjs`, which is off-limits).

It also re-exports `useStore` and `DUNGEON_STYLE_PRESETS` so previews read **real**
domain objects instead of fabricated fixtures. **`preview-root.tsx` must be copied
into the worktree before each build** — `extraEntries` is package-relative:

```sh
cp .design-sync/preview-root.tsx .worktrees/ds-main/canvas/ds-preview-root.tsx
```

## Authoring gotchas found the hard way

- `ToggleSwitch`'s `label` is **aria-label only** — it renders no visible text. Pair
  it with a `PropertyField` or a sibling span, the way the app does.
- `AssetChild.rotation` is in **radians**. `rotation: 15` renders as `859.4°`.
- Section ids for `openSections` are exact: `grid` `layer` `sublayers` `colors`
  `walls` `rooms` `transform` `texture-fill` `bg` `terrain` `environment`. Guessing
  `texture` or `background` silently yields two identical cells.
- Most sections are `defaultOpen`, so an explicit open set renders the same as the
  default — the meaningful second story is `openSections={new Set()}` (collapsed).
- `PackCard` reads the **canvas store's** `PackSummary` (`name`, `sizeBytes`,
  `bundled`), not the core package's (`bundleSize`, `entryCount`). The wrong shape
  renders `NaN MB` with a blank title. `update` needs
  `currentVersion`/`availableVersion`.
- `PresetGrid` tiles are **swatches derived from `preset.dungeonStyle`**; the label
  is only a tooltip. Stub presets render six identical blank tiles — use the real
  `DUNGEON_STYLE_PRESETS`.
- `TransformSection` resolves the child's parent layer from the store and returns
  `null` if it can't, so the child must be seeded via `addChild` first.
- `RibbonHead` only renders as a child of `DayRibbon`.
- Changing `cfg.overrides` requires a full `package-build.mjs` — scoped
  `preview-rebuild.mjs` fails with `[CONFIG_STALE]`.
- `cfg.overrides.<C>.skip` takes an **array of story names**, not `true`
  (`new Set(true)` throws). And skipping *every* story empties the card root, which
  turns a soft blank warning into a hard `[RENDER] root empty` error — don't.

## Known render warns (all confirmed benign — do not re-chase)

- `[RENDER_THIN] ... rendered height is 0px` on **every dialog** (`Dialog`,
  `DialogBackdrop`, `DialogClose`, `DialogContent`, `DialogDescription`,
  `DialogPortal`, `DialogTitle`, `ConfirmDialog`, `ExportDialog`, `PublishDialog`,
  `ShortcutHelpDialog`). Portals + fixed positioning collapse the measured height;
  every one of these screenshots was confirmed to render fully.
- `[FONT_REMOTE]` for IBM Plex Sans / IBM Plex Mono / Newsreader — served at runtime
  from a font host. No action.
- `tokens: 2 missing` — below threshold, non-blocking.

## Deliberate floor cards (cannot render statically)

Four components ship the typographic floor card by design. All were tried and
reverted; don't burn time re-authoring them without a harness that can drive input:

- **`CanvasContextMenu`** — payload is local state opened imperatively via
  `openCanvasMenuRef` on button-2. Exporting the ref and firing it from an effect
  (both `useEffect` and `useLayoutEffect`) does not survive the static capture. It is
  the one component still flagged `bad` (blank card, PNG < 5 KB); the render check
  reports 69/70 clean.
- **`FloatingActionBar`** — only visible when `activeTool === 'select'` *and*
  something is selected.
- **`StatusBar`** — its content is live FPS/pointer telemetry driven by a rAF loop;
  the bar's chrome renders but every field is empty. Also needs a ≥1200px container
  (`left: 308px` / `right: 300px` insets when both docks are open).
- **`RecoveryDialog`** — returns `null` until an async IndexedDB autosave lookup
  resolves; nothing to seed within a screenshot.

## Deliberately not done

- **The store is not seeded with a demo map.** `createNewMap` is async and
  IndexedDB-backed, so it can't settle before a screenshot. Panels therefore show
  their genuine first-run/empty states (`MapsSidePanel`, `PackListPanel`,
  `AssetBrowserPanel`, `CatalogBrowserPanel`, `TexturePicker`,
  `PackThumbnailCanvas`). Upgrade path if richer panels are ever wanted: build the
  document synchronously through `addLayer`/`addChild`/`addWall` (all plain zustand
  `set` calls, already proven for doors/walls/zones) instead of `createNewMap`.

## Re-sync risks — what can go stale

- **`dist/types` is not regenerated by `cfg.buildCmd`.** If a future sync skips the
  `tsc --emitDeclarationOnly` step, contracts silently collapse back to
  `[key: string]: unknown` for all 70 components. This is the single easiest
  regression to miss.
- **`ds-preview-root.tsx` lives in the worktree and is disposable.** The canonical
  copy is `.design-sync/preview-root.tsx`; forget the copy step and the build fails
  with `[PROVIDER_UNEXPORTED]`, or worse, every card silently renders light.
- **Hand-composed domain objects will rot** — `LightChild`, `TextChild`,
  `AssetChild`, `WallSegment`, `DoorChild`, the zone shape, `MapMeta`,
  `PackSummary`, `CatalogEntry`. They were written against main @ a0c76b1. A schema
  change won't fail the build (esbuild strips types without checking); the card will
  just render wrong. Re-read the interfaces when a panel looks off.
- **`dtsPropsFor` is hand-written for 15 components** (Button, ContextMenu,
  RibbonHead, PackThumbnailCanvas, the four SectionControl panels, TransformSection
  and the seven Dialog parts). These do not track upstream prop changes. Re-check
  them after any refactor of those components.
- **The source branch is a choice, not a default.** This run synced `main`
  (a0c76b1). The `table-shell-redesign` branch adds `PrepPanel` and reworks
  `ZoneProperties`; a sync from there yields a different component set.
- **`.design-sync/` and `.ds-sync/` are excluded in `.git/info/exclude`** (a
  deliberate local choice, matching how `docs/` and `PRODUCT.md` are kept untracked).
  Nothing here is committed, so **a fresh clone loses all 66 authored previews, the
  config, the conventions header and these notes.** That is the biggest single risk
  to future syncs.
