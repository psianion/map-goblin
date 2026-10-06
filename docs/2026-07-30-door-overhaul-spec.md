# Door Overhaul — Spec & Plan

2026-07-30. Standalone workstream, runs alongside Sprint 4. Absorbs two items pulled
out of the Sprint 4 spec (`2026-07-30-sprint4-spec-plan.md`, amended same day): door
sprites (was §2.3 E1) and #18 door-toggle hitch (was §2.4 T1). Planning was done on
Fable (user directive); execution follows the standard routing (Fable
plans/reviews-agent-work, Opus implements/debugs, Sonnet for reading/shell lanes; no
Haiku).

## §1 Why

The wall tool got its through-and-through pass (PR #37). Doors are next, and the sweep
found they are broken at the foundation, not the surface: a door placed on a
floor-derived wall — the most common wall on a finished map — does not render, does not
gap the wall stones, and does not pass light when open. The door features that *do* work
(occlusion split, table live-state, redaction, vision BFS) only work because every demo
map is authored with standalone walls, a trick the DM shouldn't have to know.

## §2 Inventory — what exists today

### Editor (canvas + core)

| Piece | State |
|---|---|
| `DoorTool` (`packages/core/src/engine/tools/DoorTool.ts`) | Click-place with wall snap, click cycles state, hover+Delete removes, overlap/too-wide rejection, auto-naming, ghost preview |
| `DoorChild` (`shared/types.ts`) | `{ wallId, position, angle, width, style, state, isSecret, roomA/B }` — position/angle are absolute copies taken at placement |
| `DoorProperties.tsx` | style (single/double pickable; portcullis/archway/portal render-only), state, secret, width |
| `doorRenderer.ts` | Glyphs per style + state dots; tries `renderDoorSprite`, falls back to glyph (the "doors are glyphs" complaint); secret-closed dot suppressed |
| `wallNodeRenderer.ts` | `DoorGap` cuts stone nodes out of doorways — standalone walls only |
| `occlusion.ts` `buildOcclusionSegments` | Splits standalone walls at doors into per-segment props (open passes light/vision, closed/locked blocks, archway always open, window/terrain/ethereal interactions). ~20 unit tests, solid |
| `roomBinding.ts` | Binds roomA/roomB at placement so fog/lighting see topology immediately |
| Commands | Wall delete cascade-deletes doors; `CloseAllDoorsCommand`; all edits undoable |

### Table (server + session client + mechanics)

- **Server authority.** `@dnd/mechanics/doors`: live overlay `DoorLiveState { open,
  locked, revealed }` per scene, lazily seeded from the authored door; map file never
  mutated. Commands: `toggle` (all roles, `door-locked` refusal), `lock`/`unlock`/
  `reveal-secret` (DM only). Unrevealed secret + player sender refuses as
  `unknown-door` — indistinguishable from a nonexistent id.
- **Redaction.** Players never receive unrevealed secret doors — stripped from module
  state, snapshots and broadcasts (`redactMap.ts` `doorKept`/`doorDeltaFor`).
- **Vision.** Doors gate the room-graph BFS (`visibleRooms`): with `concealBehindDoors`,
  players see revealed rooms reachable through open non-secret doors from token rooms.
- **Client.** `DoorPanel` (list + DM affordances + keyboard route), `DoorRenderer`
  (canvas marks, click to toggle), `doorLighting.ts` writes live state back onto the
  core store's door children so the *editor's* occlusion/lighting/render pipeline serves
  the table unmodified.
- **Contract.** `AuthoredDoor` reads only `{ id, state, isSecret, style, roomA, roomB }`
  — no geometry. The table inherits every editor geometry bug and every editor geometry
  fix through the shared renderer.

### The light path

`extractWallSegments` (raycaster.ts) → `buildOcclusionSegments` → ClockwiseSweep.
Correct for standalone walls. `raycaster.ts:36-46` pushes mergedFloor edges as light
blockers **unconditionally** — doors never consulted (documented as note H8 in
occlusion.ts). Hallways pass light only because Clipper2 union erases the shared edge
between touching floor shapes; a door mid-hallway is impossible without the
standalone-wall trick.

## §3 Defect ledger

- **DR1 — floor-door anchor.** Doors on floor edges store synthetic positional ids
  `floor-{poly}-{edge}` (`DoorTool.ts:60`) that exist nowhere else and are invalidated
  by any floor edit or union reorder.
- **DR2 — floor doors invisible.** `floorWallRenderer.ts:312` passes only
  `standaloneWalls` to `renderDoors`; floor-anchored doors are silently skipped.
- **DR3 — no stone gap on floor rings.** `wallNodeRenderer.ts:165-174` lays out floor
  rings without applying `doorGaps` (gaps only in the standalone loop at :187).
- **DR4 — no light through floor doors.** Raycaster's inline mergedFloor loop ignores
  doors entirely; an open floor door blocks light like solid wall.
- **DR5 — doors don't follow wall edits.** `position`/`angle` are placement-time copies;
  node-editing a wall leaves the door floating. (Angle is already re-derived at render —
  H1 — position is not.)
- **DR6 — three disagreeing floor-edge extractions.** `DoorTool.wallSegmentsFromFloor`
  (per-edge ids), raycaster inline loop (no ids, no doors), `wallNodeRenderer` per-ring
  loop (no ids, no gaps).
- **DR7 — stale room binding.** `bindDoorToRooms` runs at placement only; geometry edits
  that change topology leave roomA/B stale, which feeds table vision.
- **DR8 — glyph doors** (ex-Sprint 4): sprites exist as a code path
  (`renderDoorSprite`) but no real art is wired; glyphs are the shipped look.
- **DR9 — #18 toggle hitch** (ex-Sprint 4): a state-only door toggle triggers the
  mergedFloor Clipper2 union rebuild (~280ms).
- **DR10 — editor UX below the wall bar.** No canvas select/move/resize; Delete targets
  hover; every click on a placed door mutates its state, so a door can't be inspected
  without changing it.
- **DR11 — hollow e2e.** `28-doors-walls.spec.ts` injects doors via `store.addChild`;
  pointer-driven placement, floor-edge placement, and edit-follows are untested.

## §4 Design decisions

### DD1 — one canonical wall resolution

New shared resolver (core): `resolveWalls(layer): ResolvedWall[]` — standalone walls
plus floor-ring edges as real `WallSegment`s, resolved in exactly one place. Alongside
it `resolveDoors(layer, resolvedWalls): ResolvedDoor[]` where a `ResolvedDoor` carries
`{ door, wall, t, position, angle }`. **Every consumer** — DoorTool snapping,
doorRenderer, wallNodeRenderer gaps, `buildOcclusionSegments`, the lighting raycaster —
reads resolved output. The raycaster's inline mergedFloor loop and DoorTool's private
`wallSegmentsFromFloor` are deleted. DR2/DR3/DR4/DR6 all collapse into this.

### DD2 — anchor = position + projection; ids are hints

No parametric anchor is persisted. A door's stored `position` is the authored intent;
at resolve time it is projected onto its wall:

- **Standalone doors:** `wallId` is authoritative while the wall exists; position is
  re-projected onto the (possibly edited) wall polyline each resolve, clamped so the
  door stays fully on the wall. Doors thereby follow node edits for free (DR5).
- **Floor doors:** no synthetic wallId is trusted. The door re-projects to the nearest
  floor-ring edge within a threshold (door width, min 1 cell). Self-healing across
  Clipper2 re-unions and node edits — nothing positional is persisted (DR1).
- **Detached doors:** if nothing is within threshold (wall deleted out from under a
  floor door, floor erased), the door renders as a greyed "detached" marker in the
  editor, stays listed in properties/panel, and is excluded from occlusion. Never
  silently dropped; never blocks light invisibly.
- **Corner ambiguity:** prefer the hinted wallId when still valid and in threshold;
  else nearest projection wins. Write-back of position happens only on explicit user
  moves, not on resolve — the store stays authored, the resolution stays derived.

**Migration:** none required for standalone doors (wallId + projection covers them).
Legacy `floor-*` wallIds are treated as no hint — position projection re-anchors them on
first load. Save format unchanged; old files open correctly, new files open in old
builds no worse than today.

### DD3 — occlusion and light through everything

`buildOcclusionSegments` receives resolved walls (both kinds) and resolved doors.
Floor-ring segments carry `normal` wall occlusion props. Light through an open floor
door and a door mid-hallway then falls out of the existing, tested split logic — no new
lighting feature. H8 note deleted along with the special case.

### DD4 — DR9 (#18): state toggles never touch geometry

With DD1/DD3, door **state** feeds only occlusion + door visuals. Invalidation on a
state-only change: occlusion cache + lighting polygons + door layer redraw. The
mergedFloor union recompute must key on shape geometry alone (verify
`subscribeToStore`'s fold; fix the trigger path if child mutations reach it). Exit is
the Sprint-4 bar: state-only toggle < 50ms.

### DD5 — sprites (DR8)

Wire real door sprites from the dev pack through the existing `renderDoorSprite` path:
single/double/portcullis/archway, open/closed variants, locked/secret styling per
`docs/art-style-guide.md` (release gate — reviewer walks it). Glyphs remain solely as
missing-asset fallback. Lands on the shared renderer, so the table gets the art free.

**Rescoped 2026-07-30 (asset survey):** no door art exists anywhere — dungeon-classic
pack (94 entries, zero door keys), forge staging (rocks only, none passing), source
(empty). Forge F1 hasn't validated its pipeline for any category and needs a style
anchor first. Locked/secret need no art (tint/alpha overlays on closed/open). Two of
the five styles (`portcullis`, `archway`) are hard-dispatched to vector renderers and
never attempt a sprite lookup. P4 therefore ships **wiring, not art**: (a) extend the
`renderDoors` dispatch so every style tries `renderDoorSprite` first; (b) the four
minimum manifest keys are `door-{single,double}-{closed,open}` in `dungeon-classic`
(pack version bump + entryCount when they land); (c) sprite art itself is blocked on
S4 F1 shipping an approved door category — glyphs remain the correct, sanctioned state
until then. Art-guide line that governs: "doors read as objects (not glyphs) **once
door sprites ship**."

### DD6 — editor UX parity (DR10)

- Single click **selects** (properties panel opens, like every other child).
- Double-click cycles state (the current single-click behavior, moved).
- Drag slides the door along its wall (projection clamps it); drag across walls
  re-anchors to the target wall when within snap threshold.
- Delete removes the selection (hover fallback kept for the no-selection case).
- Width stays a panel field — no canvas resize handles (YAGNI until asked).

### DD7 — room rebinding (DR7)

After any geometry-committing command (wall node edit, floor edit, wall/shape
add/remove), re-run `bindDoorToRooms` for doors whose resolved wall was touched, inside
the same undo entry. Table vision's roomA/B never go stale.

### DD8 — table contract untouched

`AuthoredDoor`, the doors module, redaction, and vision BFS change **zero**. The table
picks up every fix through `doorLighting`'s write-back + the shared renderer. The gate
map (`gateMap`) keeps its pinned `wallIds.has(d.wallId)` invariant for standalone doors
and gains floor-door + hallway-door cases.

## §5 Work breakdown

Phases are ordered; 3–5 are independent of each other once 1–2 land.

| Phase | Work | Files (primary) | Exit |
|---|---|---|---|
| **P1 resolver + anchors** | `resolveWalls`/`resolveDoors`, projection anchoring, detached state, delete the three ad-hoc extractions | `shared/wallResolve.ts` (new), `DoorTool.ts`, `shared/occlusion.ts`, `lighting/raycaster.ts` | Unit: projection follows node edits, floor re-union re-anchors, corner ambiguity, detachment; all existing occlusion/raycaster tests green against resolver |
| **P2 renderers** | Floor doors draw; node gaps on floor rings; angle+position both derived; detached marker | `doorRenderer.ts`, `floorWallRenderer.ts`, `wallNodeRenderer.ts` | Visual: door on floor edge renders + gaps stones, editor and table |
| **P3 light/vision + #18** | Occlusion through floor doors and hallway doors; state-only invalidation path; profile the toggle | `occlusionCache.ts`, `subscribeToStore.ts` | Open floor door passes light; mid-hallway door works; state-only toggle < 50ms on dressed map |
| **P4 sprites** | Sprite dispatch for all styles; manifest-key readiness (art blocked on forge F1, see DD5 rescope) | `doorRenderer.ts`, pack manifest | All styles attempt sprite lookup with clean glyph fallback; the four `door-*` keys documented for F1; no visual regression |
| **P5 editor UX** | Select/double-click-cycle/drag-along-wall/delete-selection | `DoorTool.ts`, `hitTest.ts`, properties wiring | UX walk: inspect a door without mutating it; drag follows walls |
| **P6 rebinding** | Post-geometry-edit rebind in the same undo entry | `commands.ts`, `roomBinding.ts` | Unit: edit wall between rooms → roomA/B correct; vision BFS test on changed topology |
| **P7 verification** | Pointer-driven e2e both apps; Docker+Chrome gate walk | `canvas/tests/e2e/*`, `session/client/e2e/*` | Rows below, all green |

## §6 Acceptance

| Row | Verified by |
|---|---|
| Door placed on a floor edge: renders, gaps the stones, occludes when closed, passes light when open | canvas e2e + visual walk |
| Door mid-hallway (on corridor ring edge): placeable, full behavior, no standalone-wall trick | canvas e2e |
| Node-edit / floor-edit a doored wall: door follows; re-union re-anchors; no orphans | canvas e2e |
| Wall/floor deleted under a door: detached marker, listed, excluded from occlusion, deletable | unit + visual |
| Legacy map with `floor-*` doors loads and re-anchors; gate map invariants hold | loadFromFile test + gateMap test |
| State-only door toggle < 50ms (ex-S4 row) | e2e timing row |
| Sprite path attempts lookup for every door style; glyph fallback clean; `door-*` keys ready for forge F1 art (ex-S4 row, rescoped per DD5) | Visual walk vs art guide |
| Editor: click selects without mutating; double-click cycles; drag slides along wall | canvas e2e |
| Table: DM + player seats — toggle/lock/reveal on a floor door and a hallway door; light and vision correct both sides; locked toast; secret invisible to player until reveal | session e2e on dressed map |
| Redaction unchanged: player wire traffic carries no unrevealed secret door | wire test (existing, re-run) |
| All prior suites green; typecheck/lint clean | CI-equivalent local run |

**Gate:** standing rule — Docker-deployed, Chrome-walked on a dressed demo map, both
apps, zero console errors, zero failed requests. E2E suites run with
`E2E_SERVER_PORT=8790 E2E_CLIENT_PORT=5178` (8787 is held by com.docker.backend).

## §7 Risks

- **Projection re-anchoring is a behavior change:** a door near a corner can hop edges
  on aggressive floor edits. Mitigated by hint-first resolution + threshold + the
  detached state; P1 unit tests pin the ambiguous cases.
- **Resolver perf:** it runs on geometry changes only (cached like occlusion), but P3
  profiles it on the dressed map before the phase closes.
- **Sprite art availability:** dev pack may lack door states; the forge lane (S4 F1) is
  the backstop — P4 scopes to what passes the art guide rather than inventing art.
- **Ring identity remains positional** for `floorWallEdits` (known wall-tool issue);
  this spec routes around it for doors (nothing ring-indexed is persisted) but does not
  fix it for wall stone edits — out of scope, tracked separately.
- **Shape-move rebinding is debounced, not undo-atomic** (P6 finding): dragging a floor
  shape rebinds doors via the 250ms room-sync debounce rather than inside the undo
  entry, because `mergedFloor` for that path is recomputed asynchronously and a
  synchronous re-derive would read stale geometry. DD7's listed command set (node edit,
  floor edit, add/remove) IS undo-atomic. Acceptable for now; revisit if a stale-rooms
  report ever traces to a shape drag.

## §8 Execution

- Branch `door-overhaul` off main; squash-merge PR per labs rules; docs stay
  uncommitted.
- Standard model routing: Opus for implementation/debug lanes, Sonnet for
  reading/shell, Fable for planning and reviewing returned work. No Haiku, ever.
- Sprint 4 spec amended same day: §2.3 door-sprites bullet and §2.4 #18 bullet replaced
  with pointers here; the two §2.6 acceptance rows moved here.
