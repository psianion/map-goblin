# P1 spec — token-vision fog: mechanics + server truth

Parent plan: `docs/2026-08-15-token-vision-fog-plan.md` (approved v2). This phase ships
server truth only — zero rendering, zero UI. Everything is behind
`SceneFog.mode === 'vision'`; `'rooms'` stays the default and its behavior must remain
byte-identical (the sprint3-fog e2e suite is the regression gate).

Branch: `token-vision-fog` (already checked out; base 9cd3e1d). Never touch main.
Ponytail full: smallest correct diffs, reuse what exists, no speculative abstraction.
NOTE: `session/server` has unrelated uncommitted modifications (waitlist work in
api.test.ts, db.test.ts, migrations.ts, stores.ts, http.ts) — leave them exactly as
they are; do not revert or entangle them. Everything below is additive around them.

## Verified seam facts (scouted 2026-08-15 — build on these, don't rediscover)

- `SceneFog = { rooms: Record<string, RoomFog>; concealBehindDoors: boolean }` with
  default-filling `sceneFogOf`/`roomFogOf` (fog/types.ts). `fogModule(roomsOf)` commands
  are all DM-only; `redact()` returns state identity for DM, else drops
  non-`wasEverRevealed` rooms whole and filters the log (fog/module.ts L54-75).
- Module wiring: `GameModule` contract in `packages/mechanics/src/contract.ts`;
  registration in `session/server/src/modules/registry.ts` (`ModuleRegistry.register`),
  wired at boot in `session/server/src/index.ts` L98-109. `ctx.setState` →
  `stores.moduleState.put` (bumps in-memory `revision`) → raw `state-update` broadcast →
  per-viewer redaction ONLY at `session/server/src/ws/Broadcaster.ts` `buildRedactor`.
  `RETRACTS` (registry.ts L39-42): fog writes re-send tokens+doors; doors writes
  re-send tokens+fog (re-sends are broadcasts only, handlers do NOT re-run — no loops).
- D5 delta: Broadcaster special-cases `msg.module === 'fog'` for non-DM viewers and
  attaches `vision.revealDelta(sceneId)` — any fog write that reveals rooms gets its
  geometry delta for free. Auto-explore MUST reveal through a fog-module write so this
  rides along; do not invent a second reveal path.
- `session/server/src/fog/vision.ts` `createVision(stores)`: per-scene lazy cache keyed
  on global `stores.moduleState.revision` (in-memory, resets on restart — cache key
  only). `compute()` derives party rooms, effectiveFog, explored, visibleRooms (BFS),
  occupiable, and the incremental `delta`.
- `session/server/src/fog/sceneMap.ts` `SceneMap`: parsed `rooms`, `doors`, `zones`,
  `roomAt(x,y)`, full DM `data`; LRU cap 3; NO wall-segment extraction yet.
- Pure sweep subtree (verified pixi-free, importable server-side):
  `packages/core/src/engine/lighting/ClockwiseSweep.ts` (`clockwiseSweep(origin,
  radius, segments)`), `SegmentQuadtree.ts`, `raycaster.ts` (`extractWallSegments
  (dungeonLayers)` + its transitive deps occlusion.ts/wallResolve.ts — all pure).
  `session/server` eslint bans runtime `@dnd/core` imports (D3, no pixi) with ONE
  existing per-line waiver pattern: `redactMap.ts` L10-11 imports `computeMapFrame`
  from `@dnd/core/src/shared/mapBounds`. Use the same targeted per-line waiver style
  for the sweep imports, with a comment stating the file is pixi-free by design. D3
  stays intact.
- Grid: 1 world unit == 1 grid cell (D13, tokens/types.ts L10). No explicit grid-size
  field exists; scene bounds come from `computeMapFrame(layers, terrainBounds)`
  (`@dnd/core/src/shared/mapBounds`, already waivered) — cell-snapped
  `{minX, minY, maxX, maxY}`.
- Tokens: `Token.sight`/`Token.light` already in schema ("Schema only until S3") — S3
  is NOW; wire `sight`, leave `light` for P3. Claims are inline `token.ownerId`
  (no reverse map). `tokensModule(visionOf)` already injects `SceneVision`
  (`{ roomAt, visible, occupiable, blockedEdge? }`, tokens/types.ts L63-80);
  `redact()` drops hidden tokens and tokens failing `inSight` (own claimed always
  visible). This is THE token-redaction seam — extend it, don't bypass it.
- Zones: `ZoneChild` in `packages/core/src/shared/types.ts` L257-285 (`shape`:
  point | circle | rect). Zones are ALWAYS stripped from player-bound docs
  (redactMap.ts) — a zone flag is DM/server-only by construction, no redaction work.
  New optional fields round-trip through map JSON automatically. Server reads zones
  via `SceneMap.zones` (also see triggers/prepResolver.ts for shape handling).
- Persistence: `module_state` JSON TEXT, no size cap; keep the region blob small
  (base64 bytes; a 100×100 scene ≈ 1.7KB — fine).
- Wire-test pattern: `session/server/src/integration.test.ts` — real `withServer` +
  real WS sockets, every raw frame captured as string, negative assertions are plain
  `expect(frame).not.toContain(id)` byte searches.

## 1. Schema + state (packages/mechanics/src/fog)

Extend `SceneFog` (all optional/additive — old persisted states and absent fields must
load unchanged through `sceneFogOf` defaults; no migration):

- `mode?: 'rooms' | 'vision'` — absent ≡ `'rooms'`.
- `visionShare?: 'party' | 'individual'` — absent ≡ `'party'`. P1 stores/validates both
  but behaves as party either way; divergence is P5. Mark with a `ponytail:` comment.
- `autoExplore?: boolean` — absent ≡ `true` (only meaningful in vision mode).
- `region?: { minX: number; minY: number; cols: number; rows: number; bits: string }` —
  region memory, one bit per grid cell, row-major from (minX, minY), base64 bytes.
  Absent until first write. Sized from the scene frame at first write.

Bitmask helpers (pure, in mechanics so client P2 reuses them; no new deps): base64 ↔
`Uint8Array`, `getCell`, `setCells`/`clearCells` (batch), and
`cellsCoveredByPolygon(polygon, frame)` via cell-center point-in-polygon. Bytes and ORs
only.

`fogModule.redact()` must carry the new fields through for non-DM viewers (mode,
visionShare, autoExplore, region ship whole — region is low-secret presentation
memory; rooms filtering stays exactly as today).

## 2. Commands (DM-only, same validation/Reject/log patterns as existing fog commands)

- `set-mode { sceneId?, mode }` — never destroys either record on flip.
- `set-share { sceneId?, visionShare }`
- `set-auto-explore { sceneId?, autoExplore }`
- `region-set { sceneId?, op: 'reveal' | 'hide', cells: [col, row][] }` — server truth
  for the P4 brush. Validates bounds against the scene frame; lazily creates `region`.
  Needs scene bounds → extend the `fogModule` factory with an injected provider
  (e.g. `frameOf(campaignId, sceneId): Frame | null`) alongside `roomsOf`, wired from
  the server (computeMapFrame over the DM-side `SceneMap.data.layers`; cache it on or
  beside SceneMap). Mechanics stays pure — injection, not import.

Existing commands keep today's semantics in both modes. Every mutation goes through
`ctx.setState` as today (revision bump → vision cache invalidation for free). Include
`sceneId` in payloads so the SceneTagged stamp targets the right scene.

## 3. Server sweep service (new: session/server/src/fog/sweep.ts)

Runtime-import `clockwiseSweep`, `SegmentQuadtree` (if useful), and
`extractWallSegments` from `@dnd/core` pure files using the redactMap-style targeted
eslint waivers. Service:

- Extract static wall segments once per scene from `SceneMap.data.layers`; cache
  per sceneId (invalidate with sceneMap's existing invalidate path).
- Combine with live CLOSED doors as occluders (open doors don't occlude; secret doors
  occlude like walls until revealed — check how the occlusion/door helpers in
  raycaster.ts/wallResolve.ts model door state and reuse them).
- `sightPolygon(origin, rangeInCells, sceneId, doors)` → polygon. Purely geometric in
  P1: no light gating (P3); `visionMode: 'darkvision'` behaves identically to normal
  for now; `sight: null` tokens contribute nothing; `sight.angle` ignored (non-goal).
- Memoize per token on (x, y, range, closed-door key, scene geometry version) so a
  token's sweep recomputes only when it moved / a door toggled / geometry changed.
  Simple keyed memo is enough for P1 — no premature generalization.

Party sweep set = all claimed (`ownerId !== null`), non-hidden tokens with `sight` in
the active scene.

## 4. Party-mode auto-explore (server-side)

Trigger: after a SUCCESSFUL `tokens` `move`/`place` or `doors` `toggle` (also
`reveal-secret`) command — hook at the smallest seam (CommandRouter post-run or a
registry post-write hook; implementer's choice, one seam only). When the active
scene's fog has `mode === 'vision'` and `autoExplore`:

1. Compute the party sweep union (service above).
2. Region: OR in covered cells, EXCEPT cells inside a zone with `blocksAutoExplore`
   (circle/rect zones only; point zones cannot lock).
3. Rooms: any room whose polygon the sweep touches on ≥1 non-locked cell auto-reveals.
4. Diff against current fog state; if nothing changed, write nothing. If changed,
   apply ONE fog-module write through the registry so persistence, broadcast, D5
   mapDelta attachment, and RETRACTS all ride the existing path. No loops: fog's
   RETRACTS re-sends don't re-run handlers, and the hook only fires on tokens/doors
   commands.

`autoExplore` off: sweeps still drive redaction (§6) but write nothing. DM manual
reveals (room buttons, region-set, reveal-all, starting room) always work — locks only
block auto-explore.

## 5. Explore locks (zones)

Additive optional `blocksAutoExplore?: boolean` on `ZoneChild` (schema stays 3.1; old
maps load unchanged). Server-side check only in P1 (point/cell inside a flagged
circle/rect zone); editor checkbox is P4. Zones are already stripped from player docs
— no redaction work.

## 6. Token redaction by vision

Extend `SceneVision` with an optional point test, e.g. `canSee?(x, y): boolean`.
`tokensModule.redact`/`inSight`: when `canSee` is present (server supplies it only in
vision mode), a non-own, non-hidden token is visible iff `canSee(token.x, token.y)`;
own claimed tokens always visible; hidden tokens DM-only as today. Rooms mode: `canSee`
absent → existing room-granular path byte-identical.

Server side: `vision.ts` `compute()` gains a vision-mode branch that builds the party
sweep union (cached like everything else in that computed record) and exposes `canSee`.
Re-evaluation on token move / door toggle is free: those writes bump revision and
RETRACTS re-sends tokens under fresh redaction.

## 7. Tests (the phase gate — no skipping, no false positives)

- Mechanics unit: defaults + old-state loading; each new command (authorization,
  validation incl. bounds, revision of behavior on mode flip preserving both records);
  bitmask helpers (round-trip, OR, clear, bounds, polygon coverage on a known shape);
  redact carries new fields and still drops unrevealed rooms; `canSee`-based token
  redaction (visible inside polygon, dropped outside, own-token exemption, hidden
  exemption).
- Server unit: move in vision+autoExplore writes region bits and auto-reveals touched
  rooms via the existing reveal path (assert the D5 delta fires); locked zone blocks
  bits AND room reveal; autoExplore off writes nothing; door toggle extends the sweep
  and reveals through it; rooms-mode paths untouched (existing tests stay green
  unmodified).
- Wire test (integration.test.ts byte-search pattern): vision-mode session; a token id
  outside the player's sweep NEVER appears in any frame the player receives; move it
  into sight → appears; door between them closes → it stops appearing in subsequent
  state; player's own claimed token always present. Raw byte search, not parsed.
- Full gate: mechanics + server + client unit suites green, `tsc` clean across
  workspaces, and the sprint3-fog e2e suite (rooms mode) 10/10 — run all of them for
  real and report exact numbers.

## 8. Non-goals (P1)

Client rendering (P2); light gating, token-carried light, darkvision treatment (P3);
any UI (P4); sight links (P4/P5); individual-share divergence (P5); vision cones;
server-side geometry clipping to regions; migrations (everything is additive).
