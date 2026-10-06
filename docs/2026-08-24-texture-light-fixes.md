# Texture + light fix batch — 2026-08-24 (branch `light-editing`)

User-reported cluster ("no initial load of textures; changing the texture from the
sidebar changes every room") plus gate-walk findings F1–F6
(`2026-08-24-docker-gate-walk.md`). All fixed on `light-editing`, riding with the
light-editing feature work. Full checks green: core 1095, canvas 277,
session-client 838, session-server 238 tests, lint + typecheck all four.

## Per-room texture edits (user report)

`ShapeTextureProperties` ("TEXTURE FILL" sidebar panel) deliberately patched
**every** shape on the layer — picker, scale, offsets, rotation, tint alike.
Now selection-scoped: with shapes selected, edits apply only to those shapes
(a per-room override; the layer default is left alone), with nothing selected
the old whole-layer behaviour stands (every shape + the layer default the next
drawn shape inherits). Scope is resolved at call time (`targetShapeIds`) so a
drag and its commit agree even if the selection changes mid-drag; undo restores
each shape its own prior value, unchanged. The panel says which scope it is in
("Applies to N selected shapes" / "Applies to all shapes — select shapes to
edit just those").

Verified live on the dev editor: one selected room repainted to grass, its 13
neighbours untouched, single undo entry restored it. 3 new panel tests.

## No initial load of textures (user report = F2's root)

`textureLoader.load()` preferred the installed pack but fell back to the
bundled `/textures/...` path — which ships in no build — whenever the pack
texture wasn't registered *yet*. On a cold boot the map render raced pack
rehydrate (proven live: 5 dead-path decode errors at :00, "Rehydrated 185
texture(s)" at :01), the fallback fetched index.html as a JPEG, and nothing
re-rendered when the pack landed. Fix:

- `AssetPackManager.waitForTexture(entryId)` — resolves when the entry lands in
  the texture cache (flushed at the end of every pack texture load), null after
  a 30s timeout.
- `load()` waits on it for legacy-mapped ids and never fetches the dead bundled
  path for them; on timeout it returns `Texture.EMPTY` uncached so a later
  rebuild retries. The existing `preloadLayerTextures → scheduleRebuild`
  plumbing then repaints — no new wiring.
- Table (`warmSceneTextures`): pack sets install BEFORE per-layer preload, so
  the map swap lands with textures actually resident.

Verified live: dev editor cold load paints textures on the first frame, zero
`[floorWall]` errors.

## F1 — "lights don't render under a texture fill"

Not draw order. The LightTool default `intensity: 0.2` predates the
diffuse-lighting rework and is invisible on dark floor art under the multiply
composite; it only ever read as a glow on the bright pre-texture solid fill.
Proven live on the docker table: same lights at intensity 1.0 pool correctly
over the texture. Default raised to 0.9 (matches the hand-tuned demo-keep
lights). Authored 0.2 lights in old maps keep their value — per-light edit.

## F3 — File→Open wiped the doc

`loadMap()` ran `createNewMap` (which saves the outgoing map and **resets to
blank**) *after* `loadFromFile`. Reordered: create the entry first, load the
file into it, install missing pack sets, then `saveCurrentMap()` persists the
real content over the blank blob createNewMap wrote. Verified live: Fieldstone
Keep opened with all 98 children, and after a reload the entry still holds the
full map.

## F4 — texture scale default

New shapes start at `DEFAULT_TEXTURE_SCALE = 4` (shared/types.ts, used by all
four draw tools). The panel's display fallback for scale now matches the
renderer's own fallback (1) instead of lying with 0.25.

## F5 — player status bar "No scene"

Server-side: a player's scene list was filtered to `visibleToPlayers`, which
could drop the ACTIVE scene's entry — the exact row the status-bar name lookup
reads. The active scene is now always included for players; the flag still
gates which *other* scenes they can tell exist. One api.test expectation
updated to the new contract + a new SessionManager test.

## F6 — editor CSP

`connect-src` now includes `http://127.0.0.1:*` alongside `localhost:*`.

## Chip-through-fog leak — FOUND AND FIXED (same day, follow-up to the check below)

The "no leak" verdict below was too broad. Pressing on it found a real one: the
chip stencil (`SIGHT_MASK`) was filled with `earned ∪ memory`, so token chips —
and the turn ring — rendered at full strength in rooms the party had merely
explored. Reproduced live: a hostile moved ~20 cells from every party eye into a
remembered room, and the player's canvas drew its chip and turn ring in the
dark. Fix: the stencil is LIVE sight only (`drawFog`), pinned by a new test — a
remembered room shows what it looked like, never who is standing in it now.
Re-verified live both ways: out of sight → no chip; dragged into Karlach's
sight → chip appears.

Two adjacent facts worth knowing:

- **The server half is sound**: unclaimed tokens out of party sight are not even
  sent to player clients. The live position reached the player at all only
  because the test goblin was still **claimed by a departed player seat**
  ("Someone who left") — claimed tokens are party eyes and ship
  unconditionally, and their own sweep keeps their tile "live". A dangling
  owner on a hostile therefore both reveals it and grants the party its
  darkvision. The Fieldstone goblin is now deliberately left unclaimed.
- Consider a follow-up: warn (or auto-unclaim) when a token's owner leaves the
  campaign, so a stale claim can't quietly turn an NPC into a party sensor.

## Post-fix check (same day): light "leak", perf, sync

A zoomed screenshot of the player seat raised a light/shadow-leak question at the
fog boundary. Verified live with a two-seat session (DM + player, Fieldstone at
Night, vision-mode fog):

- **No leak.** The dark-but-visible rooms are the explored **memory tier** (2155
  cells, party walked the keep in the prior session): by design (#101), explored
  = the live torchlit render dimmed, so faded pools and moon shadows show there
  on purpose. Under actual never-seen fog the cloud interior is clean — no
  pools, no shadows (the fog mounts above the lighting composite, so light
  cannot paint over it); only the cloud's soft rim blends into explored pixels.
  The bright white dots are door markers on explored walls — they disclose
  nothing unseen, though their full-brightness chrome over a night scene is a
  polish candidate.
- **Not this branch.** The render-path diff vs main is the DM-only icon radius
  and which lights count as "on" for fog — the compositing/memory/penumbra/
  shadow pipeline is untouched from a38478a.
- **Sync** (all via live module-state diffs on the player while acting on the
  DM): join line, door close→open round-trip (state + fog mask rebuild + log
  both ways), token drag (position + vision reveal followed, restored exactly).
  Latency 1–24 ms.
- **Perf:** both table seats steady 60 FPS (16.6–16.7 ms) through every action;
  fog mask rebuild 40–54 ms and only on mutation; editor full-render of the
  98-child keep 6.9 ms/frame (the status bar's idle "1 FPS" is render-on-demand,
  not jank).

## Leftovers / notes

- Docker images still predate all of this — rebuild on next ship.
- Dev editor IndexedDB gained a "Fieldstone Keep" entry from the F3 live
  verification (harmless).
- The docker volume's Gate Keep lights remain authored at 0.2 — expected;
  editable at the table once the light-editing branch ships.
