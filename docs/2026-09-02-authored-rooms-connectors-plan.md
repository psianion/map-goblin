# DM-authored rooms & connectors — plan

**Date:** 2026-09-02 · **Status:** APPROVED 2026-09-02, build started on branch `authored-rooms` (stacked on vision-containment); ship ruling: whole stack goes together after the user's Chrome recheck · **Supersedes:** `2026-09-02-terrain-walkable-ground-plan.md` (walk-mask demoted to a possible later assist) · **Branch target:** stacked on `vision-containment` (worktree `D:\Labs\map-goblin-vc`)

## The model (user rulings 2026-09-02)

The DM draws rooms and their joints instead of the engine inferring them from floor-minus-walls:

- **White loops = rooms.** Closed shapes the DM draws in the canvas. Authored, named, stable ids.
- **Blue blobs = connectors.** Small shapes spanning the seam between two rooms — corridors, pathways, arches, doors. Where movement and sight flow between rooms.
- **Sight rule at a joint:** standing at a room's edge, a player sees into the next room only up to their own vision range, unless the DM has revealed that room. *(This is exactly the shipped containment composition — no new sight rules.)*

Rulings: (1) authored rooms are an **override layer** — where any exist on a dungeon layer, they win over detected rooms, and detection becomes an editable suggestion; (2) inside a room = **standable ground**, subject to the existing reveal/explore/lock rules (occupyRefusal unchanged — a room you haven't been shown still refuses; locks still beat everything); (3) authoring lives in the **canvas** (table-live authoring is a later follow-up on the prep layer).

## Why this is the root fix

- Kills the art-vs-geometry bug class at the source: intent is declared, never inferred. The Warren trunk failure (floor pinched to 0.119 cells under painted path art) cannot happen — the DM circles the corridor and joins it.
- Works over any art: painted terrain, imported battlemaps, generated maps — no floor polygons needed for playability.
- Authored ids are stable across republish — which also neutralizes the republish-orphans-fog-state bug for authored maps (the detected-rooms variant of that bug stays tracked separately).
- Downstream consumers don't change: fog reveal, visibleRooms, occupiable, roomAt, redaction all keep consuming the same `Room` shape — only its *source* changes.

## Data model (core + editor)

- **`RoomChild`** (`childType:'room'`): closed polygon contour, `name`, stable `id`. Serializes, transforms, undoes like any child.
- **`ConnectorChild`** (`childType:'connector'`): blob polygon/ellipse, `kind: 'arch' | 'door'`. An `arch` is an always-open passage; a `door` carries open/closed/locked state and joins the existing doors UI and graph. The two rooms it joins are derived by overlap; the **aperture span** on each room's boundary is the intersection of the blob with that boundary.
- **Precedence in `syncRooms`:** if a dungeon layer has ≥1 `RoomChild`, `layer.rooms` = the authored set (converted to the existing `Room {id, name, boundary}` shape). Detection still runs, but only to power **"Seed rooms from detection"** — one click mints editable `RoomChild`ren from the current detected set (migration path for existing maps).

## Semantics (mechanics + server)

- **Rooms downstream: unchanged.** roomAt/visibleRooms/occupiable/fog state consume authored rooms identically.
- **Connectors → door-graph edges.** Each connector contributes a roomA↔roomB edge; `arch` = permanently open, `door` = the doors module's normal state machine. `visibleRooms`, `blockedEdge`, movement refusals, auto-explore flow all just work.
- **Standability:** inside an authored room, `roomAt` hits → `onAuthoredFloor` holds → standable under the *existing* occupancy rules (must be occupiable/explored; locks subtract). No new rules.
- **Occlusion — the one new engine piece.** An authored room's boundary is promoted to sight occluders, with apertures cut where connector blobs cross it — so sight stops at the white edge except through the blue joints, where the containment near-term peers through up to range. Direct precedent: the raster-fog work already promotes mergedFloor ring edges to occluders with door apertures bound to span (a86eefa + 6387d88's span-projection). Real walls keep occluding too — occluder sources union. Two rooms' boundaries overlapping without a connector = mutually opaque (correct, wall-like); void between loops = void (cloud, unstandable).
- **Wire:** rooms redact as today (credited rooms only ship); connectors ship like doors (held set). Player never sees room/connector ink — they're logic, not art — except `door`-kind connectors, which get the normal door glyph.

## Canvas UX (v1)

- **Room tool:** freehand loop (release to close) → `RoomChild`; edit with existing node/transform tooling; rename via the existing room-name surface.
- **Connector tool:** drag a small blob across a seam; kind toggle arch/door.
- **Overlay:** rooms + connectors render on a DM-only toggleable overlay — white + ink neutrals only (hard rule: overlays never wear theme accent).
- **Seed from detection:** the one-click migration button above.

## Phasing

- **P1 — model + graph + standability:** RoomChild/ConnectorChild, authored precedence in syncRooms, connector edges into the door graph, seed-from-detection. Correct on walled maps immediately (walls still occlude).
- **P2 — boundary occlusion with apertures:** the promoted-edge work, server sweep + client compositor from the same segment source. This is what makes wall-less painted/imported maps fully correct.
- **P3 — canvas polish + live gate:** overlay/UX pass (impeccable), then the dogfood gate: author rooms over the live Goblin Warren exactly per the user's mock — loops over chambers and clearing, blue joints at the necks — and walk it seated.

## Tests

Mechanics: authored-precedence rows, connector-edge rows, standability under reveal/lock, aperture/occlusion rows mirroring the containment contract; mutation-checked. Server: cut-doc rows (authored rooms redact identically, connector-door held set), sweep aperture rows. Client: tierPlan/compositor rows + GL harness scene with authored rooms and one arch + one door connector. E2E: one authored-rooms lane row. Live: the Warren dogfood walk, two seats, zero console errors.

## Out of scope, tracked

- Table-live room authoring on the prep layer (follow-up).
- Token-blocking props inside rooms (later).
- Walk-mask terrain assist (auto-suggest room loops from painted ground) — possible P4, needs its own approval.
- Republish id-churn fix for *detected*-rooms maps — separate bug, still tracked.
- Two shut doors sharing one seam: the refusal names whichever door sits earlier in the children array (deterministic but arbitrary — blockedEdge's signature can't see which door is nearest the attempted crossing). Found live on the Warren (hand-authored old-gate + a connector on the same seam). Pre-existing door-graph behavior, needs its own small design.
- Duplicate/paste offset no-op for transform-less children (pre-existing, triplicated — found by P1a).
- Decorative scatter wins single-click *selection* over doors/blobs under it with the Select tool (live-walk finding at the Warren rubble cluster). Double-click flipping now checks blobs first so the flip works; selection precedence for fixtures under dressing needs its own hit-test design. Pre-existing for wall doors.
- Door popover still shows Width while placing a blob (blob ignores it) — ruled acceptable in the merge; revisit if it confuses.
- Blob commit writes no room binding — "not linked" can flash for one ~250ms resync after placement (pre-existing from the connector tool; ponytail note in commitBlobPlacement).

## Build outcome (2026-09-02)

Built, reviewed, dogfooded on branch `authored-rooms` (~23 commits on vision-containment). All contract rows landed incl. the W2 amendment (boundary contours ship credit-fenced — the client sweeps locally; disclosure byte-nil, tested). Adversarial review found 3 HIGH wire/occlusion bugs (delta-lane credit fence, twin/blob id collision, secret-blob shipping) — all fixed with fail-first regression tests. Live Warren gate: authoring + two-seat walk passed 7/7 (the "sight past range" reading was proven a record artifact with a virgin-record probe; regression rows document it). Behavior note surfaced for the user: opening a door auto-reveals the room behind it (existing door-open-sweep behavior, predates this work).

## Review amendments (user feedback 2026-09-02 — approved GO, BUILT + LIVE-VERIFIED same day, tip e33270f)

Build outcome: both amendments landed (14 commits). Live walk passed everything except one real find — at real seams the placement fork always picked the wall path, because promoted room boundaries, floor-ring edges, *and* legitimate wall chords all sit within snap range of a seam drag. Fixed in three steps: boundary edges never snap; floor edges don't snap on authored-rooms layers (classic maps unchanged); and the gesture now decides — click = wall door (commits on release, same ghost), drag = blob joint even with a wall in range. Re-verified live: the once-failing bridge drag commits a bound archway joint. Also landed from walk findings: blob doors flip on double-click from any tool (checked before the general hit so scatter props can't swallow it), sliver-loop guard on the room trace, stray clicks never mint joints.

### A. Room boundaries adjustable in the canvas

What exists: the full vertex editor already accepts rooms (move/insert/delete corners, Alt for curves) — but the only way in is double-clicking inside the room, which nothing advertises, and with the Select tool the rooms overlay is usually hidden, so the boundary isn't even visible to click. Built, undiscoverable.

The fix (reuses all existing machinery):
1. **The Room tool edits, not just draws.** Press inside an existing room → select it and open the boundary editor immediately (corner handles appear); drag on empty ground → trace a new loop, as today. Escape or an empty click returns to tracing. Same hit-first pattern DoorTool already uses.
2. **Selection shows the boundary.** A selected room's loop (and handles, in edit mode) render even when the Rooms overlay toggle is off — picking a room in the layers panel shows what you picked.
3. **Status-bar hint while editing** — drag corners, click an edge to add one, Delete removes, Alt curves.
4. Double-click entry stays as the shortcut from any tool.

### B. Connectors merge into Doors

Server-side a connector already IS a door (it ships as a door twin; `arch` ≡ the existing `archway` style, whose always-open machinery predates this branch). The split is pure UI — so the merge is a UI/tool unification with the wire and save format untouched.

1. **One Door tool (D); the Connector tool (J) is removed.** Near a wall it snaps a wall door exactly as today; away from walls, a drag places a blob door across a room seam (the old connector gesture) in the same style the popover has selected — Archway for an open passage, any other style for a real door. The ghost previews which one the release will place, and goes red when a blob would land unlinked (today that only flags after commit).
2. **The arch/door "kind" option disappears.** Kind derives from style (archway ⇒ arch); the field stays on the wire for compat but stops being a concept anyone sees. The popover's kind toggle goes away — the style picker already says it.
3. **One properties panel.** ConnectorProperties retires; DoorProperties serves both (blob doors hide Width — their size is their drawn geometry). Blob doors auto-name by style ("Archway 2") like wall doors, and double-click cycles their state the same way.
4. **Layers panel + copy:** blob-door rows wear the door icon; the word "Connector" leaves the UI. The seam blobs keep rendering in the rooms overlay (with the "not linked" flag) — they are how a joint is seen while authoring.

Tests: ConnectorTool/ConnectorProperties suites retarget to the merged surfaces; wire/redaction suites untouched. Estimate: A ≈ half an agent-day, B ≈ one agent-day, then impeccable pass + live Warren recheck.

## Estimate & orchestration

Comparable to vision-containment: ~3–4 agent-days. Contract file first (rooms/connector/occlusion semantics with mirror test rows), Opus execution agents per phase, Sonnet gate agents, adversarial review before the live gate. Note for ship sequencing: this stacks a third branch on the unshipped raster-fog-mask + vision-containment stack — worth deciding whether to ship the existing stack first.
