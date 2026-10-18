# M3 gate walk — publish to library + host from dropdown (2026-08-06)

Deployment: all three images rebuilt from `worktree-publish-library` @ `ceb5b79` (stacked on M2 `60c1585`), compose project `publish-library`, fresh `game-server-data` volume (old `map-goblin_game-server-data` volume untouched; old deployment stopped to free ports). Editor 8080, game-server internal :8787, table 8090.

## Walk

1. **Editor (8080)** — existing fully-dressed 4-layer demo map (Passages / Bone Crypt / Great Hall, textures, 6 lights, doors) from the origin's IndexedDB. Authored prep on it with the zone tool:
   - Point zone placed over another layer's room → **"NOT INSIDE A ROOM" badge shown**; dragged into a Great Hall room → badge cleared. (Per-layer room resolution behaving.)
   - Trigger "Great Hall reveal" (room-revealed, once, enabled) with show-text action, player-visible.
2. **Publish dialog** — Good Goblin branding; admin pass (never stored) → empty-server campaign step → created "Emberhold" → **"Published 'Untitled Map' to Emberhold — first publish"**.
3. **Server verified via REST** — campaign listed; scene `9bcc0de9…` in library (scene id = map id on first publish); `GET /api/scenes/:id/prep` returns the trigger; DM map doc is `3.1`, carries the zone child and `prep`.
4. **Reopened dialog** — stored-state summary (campaign, scene id) with **"No changes since your last publish."** — map-hash + prep-hash no-op path (review findings F1/N5 fixed and live).
5. **Table (8090) HostSetup** — Campaign step lists **Emberhold (Created 8/6/2026)** as "HOST AN EXISTING CAMPAIGN" above the create form; picking it minted a dm-token and advanced.
6. **Map step library-first** — "CHOOSE A SCENE FROM THE LIBRARY" radio for the published scene; upload demoted to "OR IMPORT A MAP FILE — a backup path". Picking the scene surfaced the **STARTING ROOM select populated from the fetched scene doc** (review F2 fixed and live; 5 rooms across 3 layers listed). Chose a room, no file touched.
7. **Session opened** — invite code minted; DM table rendered the library map with the chosen starting room revealed; **no zone markers on the table** (zones are editor-only).
8. **Player join** — Borin joined via the code; sees only the revealed room (fog holding). **Player map payload: no `prep` key, zero `zone` children** (childTypes: shape/light/text/asset) while the DM doc carries both — redaction correct in production.
9. **Console** — zero errors on all three origins, including across table reloads (seats survived reload).

## Verdict: PASS

## Suite state at gate

Typecheck + lint clean workspace-wide. Unit: core 924, canvas 242, client 281, server 150, mechanics 186. E2E: canvas publish-dialog 4/4; session publish-library 4/4; sprint2-scenes green after tightening its scene-count locator (`button[data-scene-id]`) — the old bare-button count went stale when scene rows grew management controls (pre-existing, not an M3 regression); session-flow green.

## Notes / deferred

- The dm-token endpoint reuses the campaign's existing non-banned DM identity (review N10); admin-pass routes are rate-limited (N9); prep PUT stores only the validated shape (N3); `"prep": null` stores SQL NULL (N4).
- Editor nginx resolves `game-server` per-request (`resolver 127.0.0.11`) so a game-server restart with a new container IP no longer 502s until reload (N11).
- Docker-compose note: bringing the stack up while the old project held 8787 required stopping the old project first; a half-created network from the failed first `up` also crash-looped session-client ("host not found in upstream") until `down`/`up` recreated it. Worth remembering for future gate walks.
- Multi-campaign publish state is per-campaign (N6); prep edits at the editor take the quiet `PUT /prep` path (no `scene-changed`), to be exercised live in M4's runtime walk.
- Scene stays "Hidden" to players by default; the player sidebar reads "The DM hasn't published a scene yet" while the active scene still renders — existing visibility semantics, unchanged by M3.
