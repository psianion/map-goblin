# Asset loading: start fast, load what the map needs, fetch the rest later

Plan written 2026-11-09 against `main` at 624d0f2, revised the same day after a code review. One pass, two builders, one measured test run at the end.

## 1. Problem

Both apps hold the renderer until every bundled pack is downloaded, written to IndexedDB and decoded: 905 webp files, 20.4 MB, with the 18.4 MB props pack (`gg-demo`) installed before the walls and floors (`gg-forge`) every map needs. Returning users read the whole 20 MB back out of IndexedDB and re-decode all 905 textures on every page load. Nothing reports progress. Players at the table install everything. nginx sends no cache headers and has gzip off; each app ships one 2 to 2.6 MB script, and the canvas home screen already pulls Pixi in.

Measured on the live site (2026-11-09, canvas home, no map open): 74 pack files and 2 MB fetched before the editor was usable; opening a map afterwards fetched nothing new, because everything had been front-loaded.

## 2. Decisions (taken)

| # | Decision |
|---|---|
| 1 | Three tiers. Tier 1: app shell, engine, fonts, pack index and manifests. Tier 2: only the asset sets the current map references, behind a determinate loading screen on first open. Tier 3: the rest of the library. |
| 2 | Canvas fetches tier 3 automatically in the background once a map is on screen, `gg-forge` before `gg-demo`, with a status pill. The table never fetches tier 3 on its own: the DM has a "Download the full library" command; players only ever get tier 2. |
| 3 | Textures decode on first use, never all at boot. Blobs live in IndexedDB in their own store so a warm boot reads metadata only. Bundled sets are never evicted. |
| 4 | Static delivery: gzip on, long immutable caching for content-hashed files, no caching for `index.html` and `packs/index.json`. Vite splits the bundles and the canvas home screen stops importing Pixi. |
| 5 | Two shared surfaces in `packages/ui`: `LoadingScreen` (determinate, first load only) and `DownloadPill` (background progress, and scene swaps after the first load). Both apps use them unchanged. |
| 6 | No new runtime dependency. No service worker this pass. Checksums are verified only where `crypto.subtle` exists (HTTPS); the plain-HTTP LAN entrance skips them as today. |

## 3. What exists today (file references)

- Boot: `canvas/src/canvas/CanvasHost.tsx:75-152` ("Initializing…" at `:334`, awaits `packBootPromise` at `:147`; needs manifests before the engine for `setManifest` `:103-107`, `applyAssetNameShim` `:112`, `isBandSet` `:115-117`); `session/client/src/renderer/GameRenderer.tsx:90-151` (serial: Pixi, `rehydrate()`, `ensureBundledPack()`, scene; status text `:265-280`). `canvas/src/App.tsx` always mounts `EditorHost` under `HomeScreen`; home imports `engine/assetPackInstance`, which imports `pixi.js` (`assetPackManager.ts:2`).
- Install: `packages/core/src/engine/firstBootInstall.ts` (`ensureBundledPack`, serial packs, 8 fetches at a time, `registerPack` with every set marked installed, no checksums).
- Manager: `packages/core/src/engine/assetPackManager.ts`: `registerPack` `:415`, `loadPackTextures` `:463` (decodes everything, `catalogVersion++` at `:545`, blob URLs never revoked), `ensureAssetSets` `:726` (per-set fetch from `config.cdnBaseUrl`, which already defaults to `/packs` per `config/cdnConfig.ts:14`; checksums; LRU; no in-flight dedupe), `ensureTexturesForMap` `:807`, `rehydrate` `:877` (reads all blobs, decodes all), `waitForTexture` `:195` (30 s), `getPack` readers `:154, :737, :832`.
- Storage: `packages/core/src/engine/assetPackDB.ts`: one store keyed by `packId`; record holds `manifest`, `blobs` inline, `installedAssetSets`, `assetSetBytes`, `assetSetFiles`, `dynamicAssetSets` (`:28-36`); `mergeAssetSetBlobs` and `evictAssetSet` rewrite `blobs` (`:142-180`); no `onversionchange` handler (`:78-92`). Pack-file import `canvas/src/editor/surfaces/PacksSheet.tsx:224` → `packIO.ts:16` → `registerPack`.
- Per-map resolution: `packages/core/src/engine/mapTextureRefs.ts` (`collectMapTextureIds`): covers terrain palette, level/room/area looks, shapes, walls and bands, door portals, background. Misses `AssetChild.assetId` (props and scatter, `shared/types.ts:251`), `PathwayChild.pieceId` (`:232`), plateau `edgeArt` (`:212`, `plateauKit.ts:68`), door kits (`doorRenderer.ts:319ff`), `layer.materials` (`materialRenderer.ts:31`), table tokens' `packAsset`. Callers: `canvas/src/editor/EditorHost.tsx:122` (not gated on boot), `canvas/src/home/openMap.ts:28` (commits the map before installing), `canvas/src/io/saveLoad.ts:310`, `session/client/src/session/loadSceneMap.ts:255` (`warmSceneTextures`, awaited before `setMapData` at `:309-312`).
- Texture readers that draw the fallback and never retry: props `subscribeToAssets.ts:133`, tokens `TokenRenderer.ts:223`, door leaves, endings and portals `doorRenderer.ts:163, :444, :697`, tool ghosts `propPlacement.ts:33`, `StampScatterTool.ts:325`. Readers that wait once then stop: `floorWallRenderer.ts:55`, `roomFillRenderer.ts:221`, `plateauRenderer.ts:219, :473` (30 s), `materialRenderer.ts:35` and `pathRenderer.ts:21` (`asked` sets never cleared), `PackThumbnailCanvas.tsx:37-45` (`load()`). Readers that recover: walls and bands (`subscribeToStore.ts:880, :1129`), glows (`LightingRenderer.ts:1047`). `catalogVersion` is a plain field (`:84`) read only by `packCatalog.ts:176`, and each bump rebuilds all 959 catalog entries.
- Join prefetch: `session/client/src/session/prepareTableForJoin.ts` runs before `rehydrate`, so its `ensureTexturesForMap` sees an empty manifest cache and waits up to 10 s for nothing.
- Manifests: `canvas/public/packs/index.json`; `gg-demo` 17 sets (`demo-furniture` 1.71 MB, `demo-clutter` 1.0 MB, `demo-nature` 4.9 MB …), 829 loose files; `gg-forge` sets `GG_Fieldstone`, `GG_Palisade` (one atlas each, json plus webp), `GG_Cave_Ink`, `GG_Cave_Floor`, `GG_Door_Kits`. Every entry has a `set`; no atlas is shared across sets; no loose file maps to two entries. Loose entries have no file field: the file is found by `loosePrefixFor(entry)` against file names of the form `<prefix>-<hash>.webp`. Manifests total 0.55 MB raw, 74 KB gzipped.
- Delivery: `nginx.conf`, `session/client/nginx.conf` (no `gzip`, no `expires`; stock nginx:alpine supports `gzip` and `gzip_static`); `canvas/vite.config.ts`, `session/client/vite.config.ts` (no `manualChunks`); dist JS canvas 2.62 MB (791 KB gzipped), table 2.01 MB (614 KB gzipped), single chunk each. `@dnd/core` is source-only and imported by deep path, so `manualChunks` must be the function form matching on the module path. `@dnd/ui` does not import Pixi.
- UI kit: `packages/ui` has `StatusChip`, Sonner `notify`, no progress surface.

## 4. Design

### 4.1 Core: storage split, lazy decode, tiers, signals (Builder A)

**Storage v2** (`assetPackDB.ts`). Database version bump. Two stores: `packs` (`packId` → everything the v1 record held except `blobs`: `version, bundleSize, manifest, installedAssetSets, assetSetBytes, assetSetFiles, dynamicAssetSets, lastUsed, bundled`) and `files` (`"<packId>/<file>"` → `Uint8Array`). The upgrade handler creates `files` and deletes every v1 record through a cursor without reading its blobs; nothing is migrated, and sets re-download on demand from `/packs` (same origin, cheap). Add an `onversionchange` handler that closes the connection so an old tab cannot block the upgrade, and a `blocked` log line. New methods: `getPackMeta`, `getAllPackMeta`, `getFile`, `getFiles(packId, files[])`, `putFiles`, `deleteFiles`. `mergeAssetSetBlobs`, `evictAssetSet`, `evictLRU`, `getCacheUsage` move to the split layout; eviction skips packs with `bundled: true`. Every `getPack` caller in the manager (`:154, :737, :832`) and `packIO.ts` switch to the meta and files methods.

**Blob access.** The manager keeps `files: Map<key, Uint8Array>` filled on demand from the `files` store or a fresh download, `blobUrls: Map<key, string>` created once per file and revoked on uninstall, eviction and `clearCache`, and `fileOfEntry: Map<entryId, file>` built once per manifest (atlas entries: `entry.atlas`; loose entries: `loosePrefixFor(entry)` matched against file names with the `-<hash>.webp` suffix stripped).

**Lazy decode.** `loadPackTextures` becomes `decodeFile(packId, file)`: one loose file (registers its entry) or one atlas (json plus image, registers every frame), capped by `downloadLimit`, memoised in `decoding: Map<key, Promise>`. `registerPack`, `ensureAssetSets` and `rehydrate` decode nothing. `getTextureOrNull(entryId)` and `waitForTexture(entryId)` call `requestTexture(entryId)`, which starts the decode when the file is present locally and is a no-op otherwise. `getTexture` keeps returning the fallback and also requests.

**Two signals.** `catalogVersion` keeps its meaning (manifests changed) and is bumped by the metadata-only rehydrate and by `installBundledIndex`. New `textureVersion` with `subscribeTextures(cb)`, bumped once per decoded file (coalesced to one notification per animation frame). Renderers that today draw the fallback forever subscribe and re-resolve their texture: props (`subscribeToAssets.ts:133`, re-run `applyTexture` for sprites still on the fallback), tokens (`TokenRenderer.ts:223`), door leaves, endings and portals (`doorRenderer.ts:163, :444, :697`), material and path renderers (clear their `asked` sets on the signal). Tool ghosts are short-lived and are left alone. Waiters (`floorWallRenderer`, `roomFillRenderer`, `plateauRenderer`) need no change because `waitForTexture` now triggers the decode. `PackThumbnailCanvas` uses `load()`, which does too.

**Tier functions** (`firstBootInstall.ts`, rewritten):

```ts
installBundledIndex(pm): Promise<void>
// index + every manifest; new pack records with installedAssetSets: []; version and content-key staleness logic kept
// (a stale pack drops its files and keeps nothing); retired packs removed; no file downloads; bumps catalogVersion.
ensureMapAssets(pm, ids: string[], onProgress?): Promise<void>
// tier 2: resolve ids → sets (assetSetsForTextureIds) → ensureAssetSets per pack, with progress; never throws.
installLibrary(pm, order: string[], onProgress?, signal?): Promise<void>
// tier 3: every set not yet installed, packs in `order`, sets by byte size ascending inside a pack so small sets
// land first; each set committed as it lands so a reload resumes; honours an AbortSignal for Pause.
bootAssets(pm): Promise<void>   // in a new boot.ts: rehydrate (metadata) then installBundledIndex; module-level promise so apps and remounts share one run
```

`ensureAssetSets` gains in-flight dedupe per `(packId, set)` so a second caller awaits the first download instead of racing `mergeAssetSetBlobs`, verifies checksums only when `crypto.subtle` exists, and reports progress per file from manifest sizes.

**Map texture ids.** `collectMapTextureIds` adds `AssetChild.assetId`, `PathwayChild.pieceId`, plateau `edgeArt` pieces through `plateauKit`, door kit pieces for every door (`kit` or the wall's kit) through the same lookup `doorRenderer` uses, and `layer.materials` fill and band art. A new optional second argument `extraIds` lets the table pass its tokens' `packAsset` ids. A test maps a fixture that uses each of these and asserts the resolved set list.

**Progress.** One observable on the manager:

```ts
interface AssetProgress { phase: 'idle' | 'map' | 'library'; packId?: string; filesDone: number; filesTotal: number; bytesDone: number; bytesTotal: number }
subscribeProgress(cb: (p: AssetProgress) => void): () => void
```

Totals come from manifest file sizes, so they are known before the first fetch.

**Rehydrate.** Reads `packs` only, fills `installedPacks` and `manifestCache`, bumps `catalogVersion`, decodes nothing.

### 4.2 Shared surfaces (Builder B, `packages/ui`)

- `LoadingScreen`: full-surface, desk-coloured, centred card with a title, a step list with the current step live, a determinate bar, and a detail line "12 of 40 files · 3.1 MB of 7.8 MB". Indeterminate while `filesTotal` is 0. Test for both states.
- `DownloadPill`: compact pill for a top bar: ring or bar, label ("Library · 62%" or "Map · 3 of 12"), a chevron opening a popover with per-pack lines and Pause / Resume, and an × that hides it for this session (download continues). Test.
- `formatBytes` in `lib/format.ts`.

### 4.3 Canvas wiring (Builder B)

- `App.tsx`: `EditorHost` becomes `React.lazy`; the home screen must not import anything that reaches `pixi.js` (move `assetPackInstance` usage out of the home path; home needs no pack data). Checked by the A2 bundle script, not by eye.
- `CanvasHost`: Pixi init and `bootAssets()` in parallel; the engine is handed over when both finish with no wait for textures. The "Initializing…" overlay becomes `LoadingScreen` (steps Engine · Library index · Map textures).
- Opening a map (`openMap.ts`, `EditorHost.tsx:122`, gated on `bootAssets()`): first open runs `ensureMapAssets(collectMapTextureIds(map))` with progress behind `LoadingScreen` in phase `map`; the map is committed to the store at the same time so the renderer builds behind the overlay and textures land as they decode. Opening another map later shows `DownloadPill` in phase `map` instead of the full screen. Offline or a failed set: toast, map draws with fallbacks.
- After the first map is on screen, `installLibrary(['gg-forge', 'gg-demo'])` starts on `requestIdleCallback`; `DownloadPill` at the right end of the top bar while `phase === 'library'`. Packs sheet shows installed sets per pack and a "Download everything now" button on the same function.

### 4.4 Table wiring (Builder B)

- `GameRenderer`: Pixi init and `bootAssets()` in parallel; the status strings become `LoadingScreen` steps (Waiting for the DM · Loading map · Map textures) for the first scene only.
- `swapSceneMap`: keeps the old map on screen; replaces the wait inside `warmSceneTextures` with `ensureMapAssets(collectMapTextureIds(map, tokenPackAssets))` with progress shown in `DownloadPill` (phase `map`), then `setMapData` as today. `preloadLayerTextures` stays (it triggers the decodes).
- `prepareTableForJoin`: `bootAssets()` first, then `ensureMapAssets` on the prefetched map so the install happens during "Preparing map…"; the 10 s cap stays as a guard only.
- Session menu (DM only): "Download the full library · 20 MB" → `installLibrary(['gg-forge', 'gg-demo'])` with `DownloadPill`; players never see either.

### 4.5 Delivery (Builder A)

- Both `nginx.conf`: `gzip on; gzip_comp_level 6; gzip_min_length 1024; gzip_types application/javascript text/css application/json application/wasm image/svg+xml;` (woff2 and webp are already compressed). `location ~* ^/assets/` and `location ~* ^/packs/.+-[0-9a-f]{8}\.(webp|json)$` → `add_header Cache-Control "public, max-age=31536000, immutable"`. `location = /index.html` and `location = /packs/index.json` → `add_header Cache-Control "no-cache"`. `try_files` and the proxies unchanged. `scripts/smoke.sh` gains header checks on one hashed asset and on `index.html`.
- Vite, both apps: `build.rollupOptions.output.manualChunks(id)` returning `pixi` for `/node_modules/pixi.js/` and `/node_modules/@pixi/`, `react` for react, react-dom and scheduler, `ui` for `/packages/ui/` and its deps (base-ui, lucide, sonner), `core` for `/packages/core/`. A small script run in A2 (`scripts/bundle-report.mjs`, dev only) prints each chunk's gzipped size and which chunks `index.html` loads eagerly; the canvas home shell must load without the `pixi` chunk.

## 5. Ownership

| Builder | Owns | Does not touch |
|---|---|---|
| **A** core and delivery | `packages/core` (storage, manager, install, boot, `mapTextureRefs`, `textureLoader`, the renderer re-resolve hooks listed in 4.1, `packIO`), both `nginx.conf`, both `vite.config.ts`, `scripts/smoke.sh`, `scripts/bundle-report.mjs` | app components |
| **B** surfaces and wiring | `packages/ui` new components; `canvas/src/App.tsx`, `canvas/CanvasHost.tsx`, `home/openMap.ts`, `editor/EditorHost.tsx`, `surfaces/PacksSheet.tsx`, the editor top bar; `session/client/src/renderer/GameRenderer.tsx`, `session/loadSceneMap.ts`, `session/prepareTableForJoin.ts`, the Session menu | core, nginx, vite |

B codes against the interfaces in 4.1 from the start with a mocked manager and switches to A's commit once A1 lands; A1 is the only ordering dependency and is committed first.

## 6. Steps

| Step | Owner | Done when |
|---|---|---|
| A1 | A | storage v2 with upgrade test (v1 record present → `files` store exists, record gone, app boots, a set re-downloads on demand); lazy decode with `requestTexture`, `textureVersion` and the renderer hooks; `installBundledIndex`, `ensureMapAssets`, `installLibrary`, `bootAssets`, `subscribeProgress`; dedupe and conditional checksums in `ensureAssetSets`; bundled packs never evicted; `collectMapTextureIds` gaps closed with a fixture test; blob URLs revoked; `pnpm -C packages/core check` green; tests prove `bootAssets` fetches no pack file and that a map using two sets fetches exactly those sets' files |
| A2 | A | nginx gzip and cache rules; `manualChunks`; `bundle-report.mjs`; both builds green; the report shows the canvas home shell without the `pixi` chunk (requires B's lazy `EditorHost`: A2 is finished after B2 lands, or A adds the lazy import if B has not yet); smoke header checks |
| B1 | B | `LoadingScreen`, `DownloadPill`, `formatBytes` with tests; gallery entries |
| B2 | B | canvas: lazy editor, home free of Pixi, boot, first-open screen, later-open pill, background library, Packs sheet; unit tests with a mocked manager; `pnpm -C canvas check` green |
| B3 | B | table: boot, first-scene screen, swap pill, join prefetch, DM library command; unit tests; `pnpm -C session/client check` green |
| T | tester | section 7 |

Rules as in the table v2 plan: typecheck, lint, unit tests and build at each step; no browser until T; commit per step with the step id; no pushes; ask before any dependency.

## 7. Testing, once, with numbers

One Playwright run by one tester through context mode, each spec run first against `main` (before) and then against the branch (after):

- `canvas/tests/e2e/boot-timing.spec.ts` (@boot): fresh context, open `/`, record time to the recent-maps grid and bytes fetched; open the sample map, record time to first rendered frame and bytes; reload warm, record both again. Asserts: no `gg-demo` file is fetched before the map opens; the library pill appears and finishes; warm reload reaches the grid under 1.5 s on the Playwright box.
- `session/client/e2e/boot-timing.spec.ts` (@boot): host Goblin Warren, join as a player in a fresh context, record time and bytes to first frame; assert only files of the sets the map uses were fetched; the DM's Session menu has the library command and the player's does not.
- Existing suites: canvas home and publish specs, table `shell` and `host-join` specs.
- Headers: `curl -I` on a hashed asset, `index.html` and `packs/index.json` against the built nginx image via `scripts/smoke.sh`.

The report tabulates before and after seconds and bytes for: cold canvas home, cold canvas first map, warm canvas reload, cold player join.

## 8. Expected change (estimate; section 7 replaces it with measurements)

Assumptions: 10 Mbps connection, mid-range laptop, a map using one wall set, one floor and two prop sets (about 3.1 MB).

| Case | Today | After | Change |
|---|---|---|---|
| New user, canvas home grid | ~3–4 s (2.6 MB raw script, Pixi in the home path) | ~1 s (shell chunk gzipped, no Pixi) | about −70% |
| New user, first map drawn | ~25–30 s (20.4 MB download, 905 decodes, 18 MB IndexedDB write) | ~4–6 s (scripts, 74 KB of manifests, 3.1 MB of sets, decode only those) | about −80% |
| Returning user, canvas map open | ~4–7 s (20 MB IndexedDB read, 905 decodes) | under 1.5 s (metadata read, decode what the map uses) | about −75% |
| New player joining a table | ~25–30 s | ~4–6 s | about −80% |
| Full library on the canvas | at boot, blocking | 20 MB in the background, 20–40 s unattended, resumable | off the critical path |

A map that uses `demo-nature` (4.9 MB) sits at the slow end of the "after" ranges; splitting that set is out of scope.

## 9. Out of scope

Service worker and offline; atlases for `gg-demo`; resizing or re-encoding art; splitting large sets; CDN; the bot.
