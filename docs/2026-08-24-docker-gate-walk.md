# Docker gate walk — 2026-08-24

Stack: compose project `map-goblin` at main `a38478a`, images rebuilt same day (editor 5621, game-server 5620, table 5622; bot image built, service profile-gated, not started). Walk done live in the browser on a fresh map authored in the deployed editor, per the fresh-map mandate.

## What was walked

1. **Editor (5621)** — loads clean, pack manifest + `dungeon-classic` pack fetch OK, `/api` proxy answers. Authored "Gate Keep" from scratch: 3 rooms + 2 corridors (rectangle tool), 1 door (top throat), 3 lights, 3 props (campfire, well, stairs), layer texture fill Rectangular Tiles A 01 at scale 4. 54–59 FPS during authoring.
2. **Publish** — new campaign `Gate Keep` created from the publish dialog (admin pass typed by hand), map landed server-side (78 KB, verified in game.db: 5 shapes / 1 door / 3 lights / 4 assets). Republish after the texture change: dialog remembered the session, detected "map changed", propagated to the running table session.
3. **Table, DM seat (5622)** — HostSetup 4-step flow (server pre-filled with proxy origin, D4 copy correct), campaign picked, scene picked, starting room `Room 1`, invite `HEJGFK`. Door toggled from the map (menu + log line synced). Token `Karg` created in library, placed, dragged — position synced. World panel: Day 12:00 paused, indoor tint; Night toggle works ("Night falls." + status bar).
4. **Table, player seat** — joined via invite link as `Borin` (second tab), fog-limited view correct: revealed area textured, living-fog clouds on unrevealed edges, Karg chip above fog, join line in log. First boot froze the tab ~60 s (cold IndexedDB pack install — known cost, e2e config says 30 s is not enough either).
5. **Consoles/network** — zero app console errors on editor and player seats; DM seat has exactly the 5 `[floorWall]` errors below. No failed `/api` calls observed server-side.

## Findings

> **Update (same day):** all six findings root-caused and fixed on branch
> `light-editing` — see the per-finding notes below and
> `2026-08-24-texture-light-fixes.md` for the fix details. The deployed Docker
> images predate the fixes until the next rebuild.

- **F1 — lights don't render under a layer texture fill (table, both seats).** Before the texture republish the 3 authored pools glowed; after it, nothing — including at Night, where authored lights are the only light. Light children verified intact in the published JSON. Likely the layer `backgroundTexture`/mergedFloor draws over the lighting layer. This kills the point of authored lights on any textured map → **worst finding of the walk**.
  **ROOT CAUSE (found via live probe, 2026-08-24): not draw order at all.** The walk's lights were authored at the LightTool default `intensity: 0.2`, a relic of the pre-diffuse lighting model — under the multiply composite that is nearly invisible on real (dark) floor art, and only read as a faint glow on the bright solid fill before the texture landed. Setting the same lights to intensity 1.0 in the live docker table made all three pools render correctly over the texture. Fix: default raised to 0.9 (matches the hand-tuned demo-keep lights). Old maps keep their authored 0.2 — editable per light.
- **F2 — floor texture live-load is broken on the table.** `textureManifest.ts` hardcodes `/textures/floors/...`; those files ship in NO image (by design — pack preferred), but the table's install-by-need doesn't pull the floor family, so the loader falls back to the dead path, nginx SPA-fallback serves index.html, and Pixi logs `InvalidStateError: The source image could not be decoded` ×5 (one per shape). Floor still shows because the baked/embedded copy in the map masks it. Related to the known `mapTextureRefs.ts` skip-gap (goblin-mine notes).
  **ROOT CAUSE: a boot race, proven by timestamps** — a fresh player join logged the 5 dead-path errors at :00 and `[AssetPackManager] Rehydrated 1 pack(s), 185 texture(s)` at :01. The pack DOES hold the floor textures (base atlas, no asset set to fetch); the map's preload just ran before rehydrate registered them, `getTextureOrNull` answered null, and the loader fell through to the dead bundled path — with nothing re-rendering when the pack landed a second later. This is also the editor's cold-texture-race ("no initial load of textures"). Fixed: `textureLoader.load` now waits for pack registration instead of fetching the dead path, and the table installs pack sets before preloading.
- **F3 — File→Open wipes the doc (pre-existing, still in code).** `loadMap()` in `canvas/src/io/saveLoad.ts` calls `createNewMap` AFTER `loadFromFile`; the entry gets the file's name, the doc lands blank. Confirmed live on the Docker editor. Known since goblin-mine (2026-08-22). **Fixed** (entry created first, file loaded into it, then persisted) and verified live: opened Fieldstone Keep, full doc in store, entry survives a reload with real content.
- **F4 — texture picker applies scale 1.00; usable default is 4.** At 1.00 the huge floor sources render as dark micro-noise ("never renders right unless you twitch the settings"). Editor-side only; one default. **Fixed:** new shapes start at `DEFAULT_TEXTURE_SCALE = 4`.
- **F5 — player seat status bar says "No scene"** while rendering the active scene (DM seat shows the map name). Cosmetic. **Root cause:** the server filters a player's scene list to `visibleToPlayers` and the walk's scene was never published, so the ACTIVE scene's entry — the name lookup's source — was missing. **Fixed:** the active scene is always in a player's list; the flag keeps gating the rest of the library.
- **F6 — editor CSP `connect-src` allows `http://localhost:*` but not `127.0.0.1`.** Bit the walk tooling; harmless in prod, surprising in dev. **Fixed.**

## Session leftovers

- Campaign `Gate Keep` (+ session `HEJGFK`, token Karg, world clock back at Noon) left on the `map-goblin_game-server-data` volume alongside the three old gate campaigns.
- `session/testdata/fieldstone-keep.mapbuilder` regenerated (gitignored dir). Editor IndexedDB on 5621 holds the authored map + a blank entry named "Fieldstone Keep" (F3 artifact); the published scene is named "Untitled Map" for the same reason.
