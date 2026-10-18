# Door UX, token feedback, and smoothness pass — plan (2026-07-31)

Branch `door-overhaul`, continuing after P1–P7. Register: product (PRODUCT.md).
Governing principles: the map is the stage; the DM never loses visibility; zero
setup (authored data is play data); motion conveys state at 150–250ms, the
reveal fade (300ms) is the one dramatic beat; reduced-motion cuts instantly.
Art output gated by docs/art-style-guide.md.

## W1 — Canvas: door ghost preview + auto-width to openings (core/editor)

**Problem.** DoorTool's preview is a generic thin blue line drawn by
ToolManager's shared Graphics (`ToolManager.ts:76-100`); stamps get a real
alpha-0.5 sprite ghost in a dedicated `previewContainer`
(`StampScatterTool.ts:243-287`, `sceneGraph.ts:105-107`). Doors are invisible
until committed and never fit the opening they're placed on.

**Design.**
- Give `DoorTool` the `previewContainer` (same constructor wiring as
  StampScatterTool, `registerTools.ts:36-39`). On pointermove with a
  `snapResult`, build a synthetic `ResolvedDoor` from the snap
  (position/angle/width) and render the *actual* door art via the existing
  `doorRenderer` path into the preview container at alpha 0.5 — the exact
  glyph/sprite the committed door will have, x-ray style. Clear on tool exit.
- Invalid placement (overlap with existing door per `DoorTool.ts:153-164`,
  wider than wall per `:166-172`, or no wall in snap range): render the ghost
  red-tinted (invalid) or don't render (no snap). Click does nothing invalid —
  same rules as today, but now visible *before* the click.
- **Auto-width**: when the snapped resolved wall edge is itself an opening-sized
  span (edge length ≤ AUTO_FIT_MAX ≈ 6 grid cells and ≥ door min width), the
  preview and committed door width become the full edge length — a door on a
  doorway edge, cave mouth, or room-mouth stub fills it. Longer edges use the
  tool's width setting as today. The preview always shows the width that will
  commit, so auto-fit is discoverable with zero UI. Panel width field still
  overrides after placement (DD6: no canvas resize handles, unchanged).
- No new geometry analysis beyond the resolved edge span (no room-adjacency
  graph — YAGNI; the resolver's per-edge walls are the opening data we have).

**Files.** `packages/core/src/engine/tools/DoorTool.ts`, `registerTools.ts`,
`packages/core/src/engine/doorRenderer.ts` (export a single-door render
helper), constants near `wallResolve.ts`.

**Accept.** Ghost follows cursor snapped to walls at alpha 0.5 with true door
art; red/absent when invalid; a door placed on a ≤6-cell edge fills it (both
floor-ring and standalone walls); unit tests for the auto-width rule; workspace
green.

## W2 — Session: secret-door reveal beat + DoorPanel usability

**Problem.** Reveal exists end-to-end (`DoorPanel.tsx:107-117`,
`doors/module.ts:110-112`; geometry rides the fog resend, `registry.ts:39-42`)
but: the door pops in with no beat; Reveal and Open are two decoupled actions
with zero cue (occlusion ignores `isSecret` — correct, but the panel doesn't
say the revealed door is still closed); rows don't navigate the camera
(contract doc calls this "the biggest QA friction in every walk so far");
locked-door refusal for players is undefined.

**Design.**
- **Reveal beat (player view):** when a door child newly appears in the door
  mark layer (revealed secret arriving via mapDelta), fade its mark in over
  300ms (same REVEAL_MS as fog), instant under `prefers-reduced-motion`. Walls
  already auto-gap via the document reload — no server change. DM view keeps
  full-opacity + badge (principle 3); on the DM view the badge flips to
  "secret, revealed" as today.
- **Reveal→Open cue:** after a successful reveal the door stays selected and the
  action bar's Toggle is adjacent; add one line of status copy in the panel for
  a revealed-but-closed secret door ("Revealed — still closed") so the two-step
  is explicit. No combined "reveal & open" button — the DM may want the reveal
  without the swing.
- **Row → camera:** clicking a DoorPanel row selects *and* pans/zooms the
  session camera to the door (~200ms ease-out, instant under reduced motion).
- **Locked refusal (player):** define it — player toggling a locked door gets
  the existing toast path (`useDoorFeedback`, `doorRefusal`) with clear copy
  ("The door is locked."); verify DOOR_LOCKED actually reaches players and add
  the missing test.

**Files.** `session/client/src/modules/doors/` (DoorPanel.tsx, DoorRenderer.ts,
doors.ts), camera helper in `session/client/src/renderer/`. Server untouched.

**Accept.** Player sees the door fade in on reveal; DM panel states
revealed-but-closed; row click frames the door; locked refusal toasts for
players; module tests green.

## W3 — Tokens: refusal feedback + flagship flow verified

**Problem.** A server-rejected token move silently rubber-bands after 600ms
(`TokenRenderer.ts:266-282`) — no feedback, unlike doors. The flagship flow
(claim → open door → walk through → room reveals) has never run end-to-end.

**Design.**
- On rubber-band revert, surface one quiet toast ("You can't move there.") via
  the same feedback pattern doors use; no server change if the refusal can be
  detected client-side (revert is the signal); dedupe so a drag doesn't stack
  toasts.
- Playwright e2e for the flagship flow on the fixture map
  (`session/testdata/emberhold-crypt-floor-doors.mapbuilder`): player claims a
  token, closed door blocks movement + vision into the next room, DM/player
  opens it, token walks through, room reveals (visible), walking back leaves it
  explored-dim. Ports: E2E_SERVER_PORT=8790 E2E_CLIENT_PORT=5178.

**Accept.** Rejected move toasts once; flagship e2e green and in the suite.

## W4 — Smoothness: audited quick wins (ranked, all fixed or tracked)

From the perf audit (verified against the call graph). Small diffs only:

1. `subscribeToStore.ts:103-106` — union all floor shapes in one Clipper2 call
   (kills quadratic WASM marshalling; the ~280ms noted at `:258`). HIGH.
2. `subscribeToStore.ts:222,261-262` — key floor/room unions on geometry-only
   digests so texture/tint/offset edits stop re-unioning the map and
   re-detecting rooms per pointermove. HIGH.
3. rAF-coalesce `rebuildDungeonLayer`/`redrawDoors` in `subscribeToStore`
   (pending-set flushed once per frame) — stops 3–8 full stone rebuilds per
   frame during drags from coalesced pointer events. HIGH.
4. `PixiRenderEngine.ts:19-27` — disable Pixi event features (all input is DOM;
   fog layers already `eventMode='none'`); stops full-tree hit-testing per
   pointermove. MED-HIGH.
5. `LightingRenderer.ts:115-156` — signature-guard `updateIcons` so idle editor
   stops rebuilding light-icon Graphics at 60Hz. MED-HIGH.
6. `wallNodeRenderer`/`floorWallRenderer.ts:314-317` — pool stone sprites
   (reassign texture/transform by index) instead of destroy+realloc per
   rebuild. MED-HIGH (after #3).
7. `geometryDigest` WeakMap cache keyed on immer identity
   (`subscribeToStore.ts:211-249`). MED.
8. `wallSnap.ts:60-92` — AABB early-reject per segment when maxDistance finite
   (helps DoorTool pointermove + `nearestWall` re-resolve). MED.
9. `subscribeToStore.ts:317` — gate `lightManager.invalidateAll()` on a
   lighting-relevant key instead of any render change. MED.
10. `FogRenderer.ts:277-304` — rAF-coalesce fog scene rebuilds (currently ~4×
    per reveal via three `layers` identity changes). MED.
11. `roomSync.ts:40,60` — fold room write + door binding into one setState.
    LOW-MED.
12. `subscribeToStore.ts:460-475` — extract `redrawGrid` so grid toggle stops
    re-laying every stone (mirror of `redrawDoors`). LOW-MED.
13. `subscribeToStore.ts:349-358` — equalityFn on the lights selector. LOW-MED.

**Accept.** Each fix lands with the behavior it optimizes intact; pinned timing
test `32-door-toggle-timing` stays green; workspace unit/type/lint green.

## Tracked, not done now

- Incremental mapDelta merge (today: full `loadFromFile` per reveal,
  `GameRenderer.tsx:270-293`) — large refactor; the W4 fixes cut most of its
  felt cost. Track for S4/S5.
- Targeted light invalidation on door flips (#19, 65–95ms full re-sweep).
- Real door sprite art (forge F1); per-player LOS (V3); canvas width handles
  (DD6, still YAGNI); occlusion M11 (multi-point polyline door spans); token
  rotation/HP (S4.2).

## Execution

Wave 1 (parallel, disjoint trees): W4 (packages/core + FogRenderer) ∥ W2
(session/client doors). Wave 2 (parallel): W1 (core tools/renderer) ∥ W3
(session/client tokens + e2e). Scoped implementation agents edit and test but
do not commit — commits happen per-workstream after review, plain imperative
subjects. Gate after both waves: full workspace green, then Docker rebuild +
the standing in-browser sprint gate walk on the dressed demo map.
