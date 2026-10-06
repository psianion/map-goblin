# P2 spec — token-vision fog: the client mask

Parent plan: `docs/2026-08-15-token-vision-fog-plan.md` (approved). Prereqs on branch
`token-vision-fog`: P1 server truth (12d75c4) + the P1 findings-fix commit. Read the P1
spec's Verified seam facts too (`docs/2026-08-15-token-vision-p1-spec.md`).

Scope: the PLAYER-SEAT mask for `mode === 'vision'` — sweep-lit clear area, region-cell
explored memory, void — plus probe extensions, a small vision e2e spec, and one small
server addendum. Rooms mode stays byte-identical (sprint3-fog 10/10 is the regression
gate). No DM UI (P4), no light gating/darkvision (P3), no per-viewer divergence (P5).
DM seat is never masked.

## Verified client seam facts (scouted 2026-08-15 — build on these)

- `session/client/src/modules/fog/FogRenderer.ts` (846 lines): `mountPlayerFog` builds
  screen-space `layer/scrim/dots/dotsMask/fadeLayer` above the lighting composite;
  `subscribeFogScene` (L484-525) diffs store slices by identity, RAF-coalesced, first
  paint synchronous; `fogScene()` (L435-469) assembles `FogScene` from the REDACTED doc
  (`serverRooms`, `serverDoors`, `fogBounds`, `sceneFog`) — **this is where the
  `mode === 'vision'` branch lives**; `roomViews` (L224-251) runs the same mechanics
  `effectiveFog`+`visibleRooms` the server runs; `rebuild()` (L763) → `drawFog(scrim,
  scene, dotsMask)` once per mutation; `tick()` (L806-821) only mirrors camera +
  advances fades ("No geometry is touched"). Constants: `REVEAL_MS=300`,
  `EXPLORED_TINT=0x0b0e14` alpha 0.7, `FOG_FEATHER=0.4`, `FEATHER_STEPS=6`,
  `BOUNDS_PAD=20`. `__fogProbe` (L708-719): `{fadesStarted, fadesActive(),
  reducedMotion(), viewOf(roomId)}`. `cutLand`/`fillLand` (L583-610) walk `FogRing`
  trees; `redrawDots` (L726-756) is the viewport-bounded batched-Graphics template.
- `fog.ts` (pure, no pixi): `fogRegion(rooms, blocked, pad, feather)` uses
  `clipper2Engine.inflate/union/difference` → `{clear, reach}` polygon sets;
  `ringsWithHoles`; `sceneFog(state, sceneId)` (L267) is where the wire slice is cast —
  the new SceneFog fields arrive automatically (module slices replace wholesale,
  store.ts L194); `fogModeOf`/`autoExploreOn` helpers already exist in mechanics.
- `FogOverlay.ts` is the DM-only tint/tool layer — untouched in P2.
- Segments: client lighting already feeds live door state to `extractWallSegments` by
  writing session door state onto the core store document (`syncDoorsToLighting`,
  `session/client/src/modules/doors/doorLighting.ts`, wired in GameRenderer.tsx:157).
  `resolveWalls`/`resolveDoors` memoize per layer on reference identity, so a second
  `extractWallSegments(layers)` call after lighting's is effectively free. For
  PLAYERS, unfound secret doors are absent from the redacted doc → wall unsplit →
  occludes, consistent with the server sweep. `LightManager.getOrComputePolygon`
  (LightManager.ts:84-103: quadtree AABB query → `clockwiseSweep` → cache by id +
  dirty set) is the exact memo shape to mirror for per-token sweeps.
- Tokens: `session.modules.tokens` cast `as TokensState`; claimed = `ownerId !== null`;
  `Token.sight` nullable — filter like server sweep.ts does. TokenRenderer reconciles
  the token set per tick and destroys/creates instantly (no fade) — server vision
  redaction will pop tokens in/out; ACCEPTED for P2, note it for P6 polish.
- Viewer: `you: PlayerInfo` set at session-state; party mode needs no per-viewer
  filtering in P2.
- Frame/cells: `SerializedMapData.frame` (store/types.ts:431) matches mechanics
  `Frame`; region decodes with `toBytes(region.bits)`, row-major from
  `(frame.minX, frame.minY)`, 1 unit = 1 cell. No cell-rect batching helper exists —
  write pattern-identical code to `redrawDots` (viewport-bounded loop, one batched
  `fill()`), or clipper-union cell rects on mutation (preferred, see below).
- e2e: `playwright.sprint3.config.ts` `testMatch: /sprint3-.*\.spec\.ts/` — a new
  `e2e/sprint3-vision.spec.ts` runs under the existing config with zero config change.
  `table.ts` `MapUnderTest`/`hostTable`/`joinTable`/`measureFps` (ratio-vs-DM-control
  pattern, not absolute floors). New fixture already on disk:
  `session/testdata/vision-two-rooms.mapbuilder` — `MapUnderTest.name` must equal the
  file's `mapSettings.name` exactly (read the file). No fog UI exists for vision
  commands yet — e2e sends DM commands via
  `page.evaluate` → `useSessionStore.getState().sendCommand('fog', action, payload)`
  (the store is reachable via the window hooks the sprint3 spec already uses).

## 1. Vision-mode presentation rule (the three tiers)

For a player in a vision-mode scene:

- **Clear (live sight)**: union of party sweep polygons — all claimed, non-hidden
  tokens with `sight`, `clockwiseSweep(center, sight.range, liveSegments)`. Purely
  geometric (light gating is P3; `visionMode` ignored; `ponytail:` note that
  `visionShare: 'individual'` renders as party until P5).
- **Memory (explored wash)**: `EXPLORED_TINT` wash over
  (region cells ∪ rooms whose stored status is `'revealed'`) minus the clear area.
  DM-revealed rooms render as memory, not live — the party knows the layout but isn't
  looking at it; their own sight is what makes anything live. Clip memory to shipped
  geometry (the redacted doc's room polygons) so wash never floats over void.
  ADJUDICATED post-review (F1): `'revealed'` status is reserved for DM acts — server
  auto-explore latches rooms as `{status: 're_hidden', wasEverRevealed: true}` (same
  as the brush latch) so an auto-explored room renders through its region CELLS, not
  a whole-room wash. That is what makes "half-explored room shows its seen half" real.
  The clear tier is ALSO clipped to shipped geometry (F3) — sight escaping into
  unheld map reads as void, dots intact.
  A `'re_hidden'` room contributes nothing extra — bits the party earned still show
  (DM can region-hide cells to fully take memory away; pairing the two is P4 UI).
- **Void**: everything else — existing void fill + dots, unchanged.

Geometry construction on mutation (clipper, like `fogRegion`): union sweep polygons
(feather-inflate by `FOG_FEATHER`); union region-cell rects (merge row-runs before
handing to clipper to keep input small) + revealed-room polygons; difference; render
via existing `ringsWithHoles` + `cutLand`/`fillLand`. Build-on-mutation, draw-per-frame
— `tick()` still touches no geometry.

## 2. Sweeps + dirty tracking (client)

New pure-ish module (e.g. `session/client/src/modules/fog/visionSight.ts`) mirroring
`LightManager`'s cache: per-token memo keyed on (x, y, range) + a door/geometry key;
segments from `extractWallSegments` over the redacted doc's layers (live door state is
already on them via `syncDoorsToLighting`; verify order of operations at mount so fog
doesn't sweep stale door state — both react to the same store, fog's subscription
already includes `modules.doors`). Recompute only moved/dirtied tokens; unmoved
tokens' polygons come from cache. Unit-test the memo (count sweep invocations).

## 3. FogRenderer integration

- `fogScene()` gains the vision branch: when `fogModeOf(sceneFog) === 'vision'` and
  `isPlayer`, carry mode + region + sweep inputs on `FogScene` (extend the interface);
  rooms path when mode is rooms/absent — byte-identical, zero behavior drift.
- `rebuild()`/`drawFog()`: vision path draws per §1. ADJUDICATED post-review (F2):
  vision mode runs NO reveal fades at all — the room-fade mechanism paints dark
  washes over live sight on every transition; all vision-mode changes are immediate,
  and a vision-appropriate transition is P6 polish. Rooms mode keeps its fades and
  reduced-motion path untouched.
- DM seat: no mask (existing `isPlayer` gating); FogOverlay untouched.

## 4. Probe extensions (`__fogProbe`)

Add: `mode` (current fog mode the mask drew with), `sweepSources()` (count of tokens
contributing sight), `rebuilds` (counter incremented per `rebuild()`),
`lastRebuildMs` (performance.now around the geometry build), `memoryCells()` (count of
set bits drawn). Keep the existing four fields untouched (sprint3-fog e2e reads them).

## 5. Server addendum (small, one commit-worthy change)

`region-set { op: 'reveal' }` must also latch the containing rooms so their geometry
ships: any room containing ≥1 newly revealed cell gets `wasEverRevealed: true` (status
stays as-is unless never_revealed → then to 're_hidden'? NO — pick the smallest
correct semantics: never_revealed rooms with brushed cells become
`{ status: 'revealed', wasEverRevealed: true }`? A brushed-but-never-entered room
rendering as memory needs only shipping + bits, and 'revealed' would whole-room-wash
it in §1's rule. So: latch `wasEverRevealed: true` and set status `'re_hidden'` for
never_revealed rooms — geometry ships, presentation stays cell-gated). `op: 'hide'`
never un-ships. Room containment via the injected room data the fog module already
has… if `roomsOf` (ids only) is insufficient for containment, extend the injected
provider minimally (the server has `SceneMap.rooms` polygons + `roomAt`). Wire test:
brush cells in an unexplored room → player receives that room's geometry (mapDelta)
and the region bits, but NOT other rooms.

## 6. Tests (phase gate)

- Unit (vitest, client): mask-geometry builder — given rooms/doors/tokens/region
  fixtures: clear = sweep union (wall occludes, closed door occludes, open door
  passes); memory = bits + revealed rooms minus clear, clipped to shipped geometry;
  rooms-mode path untouched (existing tests unmodified). Sweep memo: unmoved token
  not recomputed; door toggle dirties. Row-run cell merging correctness.
- e2e (`e2e/sprint3-vision.spec.ts`, runs under the sprint3 config): host
  `vision-two-rooms.mapbuilder`, DM flips vision mode via `sendCommand`, player joins
  and claims a sighted token. Rows: (1) sweep-gated first frame — player canvas draws
  the token's room area, second room stays void while the door is closed (pixel-mean
  checks in the sprint3 style + `__fogProbe.mode`); (2) door opens → clear area grows
  on BOTH contexts live (probe/pixel delta); (3) memory — move the token away; swept
  cells render as wash, not void, and survive a reload; (4) perf smoke — `[metric]`
  log of `lastRebuildMs` after a move (assert a generous < 16ms bound; the strict
  <2ms/60fps budget is pinned on the gate map in P6) plus a `measureFps` ratio row
  vs the DM seat like sprint3's.
- Full gate: mechanics + server + client unit + `pnpm -r typecheck` + sprint3-fog
  10/10 + the new sprint3-vision rows green. Real runs, exact numbers.

## 7. Non-goals (P2)

Light gating, token light, darkvision look (P3); any DM UI incl. brush/mode toggle
surfaces (P4 — e2e drives commands directly); per-viewer masks/link groups (P5);
token appear/disappear softening (note for P6 polish); texture-caching the mask
(only if P6 profiling demands).
