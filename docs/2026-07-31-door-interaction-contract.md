# Door Interaction Contract

Everything a door must do, written as plain-language success criteria from four
points of view: the mapmaker in the editor, the DM at the table, the player at
the table, and the door itself (the engine). Each line carries a status from
the 2026-07-31 Docker/Chrome gate walks:

- ✅ verified working live
- ❌ verified broken live
- ⚠️ works but with a caveat, or only partially verified
- ❓ never tested — no walk has exercised it yet

This file is the checklist for closing out the door overhaul: every ❌ and ❓
needs either a fix or a deliberate "not for this release" decision.

---

## 1. Mapmaker's POV (editor, canvas app)

### Placing a door

- **Hovering a wall with the door tool** shows a snap preview on the nearest
  wall edge within snap range (1.5 cells), on both standalone walls and
  floor-outline walls. The preview is where the door will actually land. ✅
- **Clicking places the door** flush with the wall, snapped to it, with its
  room binding (`roomA`/`roomB`) set immediately — no extra step. ✅
- **Placing on a floor-ring edge works identically** to a standalone wall.
  The mapmaker should never need to know the difference. ✅
- **The wall visibly opens up**: stones under the door disappear, leaving a
  gap exactly as wide as the door, with the door art sitting in the gap. ✅
  (session app) / ⚠️ editor showed the gap but a wrong-looking door visual —
  see "Door appearance" below.
- **A brand-new map needs zero setup**: walls render (slate stones by default)
  and doors cut gaps into them without touching any style settings. ✅ (fixed
  today — `stone-slate` is now the default wall texture set)

### Selecting a door

- **With the select tool, clicking a door selects the door**, never the floor
  shape or room underneath it — the door is on top, the door wins. ✅ (fixed
  today)
- **With the door tool, clicking a door selects it too** — both tools agree on
  where a door is clickable (same hit radius, same resolved position). ✅
- **Box-drag selection picks up doors** inside the box. ❓
- **Selecting a door shows its properties** (style, state, secret flag, width)
  in the properties panel for editing. ❓

### Moving a door

- **Dragging a selected door slides it along its wall** — it stays projected
  on the wall edge like a bead on a wire, never floats free, and re-snaps to
  whichever wall edge is nearest if dragged toward another wall. This must
  work from BOTH the select tool and the door tool; the mapmaker doesn't
  care which tool is active. ❌ select tool (door selects but drag does
  nothing — SelectTool has no door case in its move/transform session) /
  ✅ door tool (e2e-verified; not re-verified live today)
- **The gap in the wall follows the door** during and after the drag. ⚠️
  (verified for committed drags via the redraw-signature fix; live drag
  preview untested)
- **A committed drag is one undo entry** — ctrl+z returns the door to where
  it was, including its room binding. ❓ (undo of placement verified ✅;
  undo of drag untested because drag is broken via select tool)

### Opening and closing in the editor

- **Double-clicking a door toggles it open/closed** (within 300 ms, small
  slop allowed) — again from BOTH tools. ❌ select tool (double-click does
  nothing) / ✅ door tool (e2e; door-tool click cycles closed → open →
  locked → closed)
- **The toggle is instant** — no visible hitch, no whole-map flash, because a
  state flip redraws only the doors and the lighting, never re-lays wall
  stones. ✅ engine-side (write cost ~4–5 ms measured); ⚠️ full frame still
  ~65–95 ms on a heavy map because relighting re-sweeps every light (tracked
  as its own task, #19)

### Deleting a door

- **Pressing Delete with a door selected removes it**, closes the wall gap
  (stones come back), restores light blocking at that edge, and is one undo
  entry. ❓ — never tested in any walk
- **Deleting the wall or floor under a door does NOT delete the door** — the
  door becomes *detached* (see below). Deliberate design: geometry edits
  never silently destroy authored doors. ✅

### Editing geometry under a door

- **Moving/reshaping the floor or wall re-anchors its doors** by position:
  each door re-projects onto the nearest surviving wall edge within range.
  Small nudges keep doors seated. ✅ (resolver-verified in unit tests;
  detach/reattach verified live)
- **If no wall edge remains within range, the door shows the detached
  marker**: a grey broken bar with a hollow ring — readable by shape, not
  colour, so it survives greyscale and low zoom. It draws no state dot and
  blocks no light. ✅
- **Undoing the geometry edit re-attaches the door** exactly as it was. ✅
- **Room rebinding rides the same undo entry** as the geometry change —
  after undo/redo, every door's `roomA`/`roomB` is correct without a manual
  resync. ✅

### Door appearance in the editor

- **A door renders its pack sprite** (painted slate/wood art) whenever the
  pack provides one, rotated flush with its wall, scaled to its width,
  centered in the gap. ✅ session app / ❌ editor — live walk saw a flat
  magenta/purple bar instead of the sprite (open bug; suspicion: editor
  draws before pack textures finish loading and doors never re-render, or a
  placeholder texture slips past the sprite guard — needs diagnosis)
- **With no pack art, the glyph fallback is legible at editor zoom**: closed =
  solid bar (thickness floored so it can't anti-alias away), open = swing
  arc, portcullis = bars, archway = caps, secret-closed = faint dashed line.
  Per-key fallback: a style missing one sprite falls back for that key only
  (portcullis-open is glyph-only by design — no art exists). ✅ (thickness
  floor added today; portcullis-open fallback ❓ never visually confirmed)
- **Locked doors read as locked at a glance** — red-tinted art/glyph, not
  just a small dot. ✅ session sprites / ⚠️ unlit rooms make the tint hard
  to see (QA note, not a bug); ❓ glyph fallback tint in editor unverified
- **Secret doors on the authoring side render at reduced alpha** so the
  mapmaker can see and edit them while knowing they're hidden. ⚠️ (data
  verified; visual confirmed only in near-darkness)

---

## 2. DM's POV (session/table app)

### The door list (DoorPanel)

- **Every door on the scene is listed by its real name** with its live state
  ("Open · locked", "Closed · secret"). ✅
- **Clicking a row selects/highlights it and nothing else** — inspecting a
  door must never change game state. ✅ (fixed today)
- **An explicit Open/Close button toggles the door.** Lock/Unlock and Reveal
  are separate explicit buttons. Lock gating: a locked door cannot be
  toggled until unlocked — the panel offers Unlock first. ✅
- **Clicking a row should also bring the door into view** (pan/zoom the
  camera to it). ❌ — no camera-to-door affordance exists; both walk agents
  and any real DM must hunt across the map by hand. Follow-up UX task.

### Toggling and its effects

- **The toggle takes effect immediately on the DM's own canvas**: sprite
  swaps closed↔open, and light visibly spills through (or stops at) the
  doorway. ✅
- **The change propagates to every player seat without anyone reloading.** ✅
  (state + panel verified; canvas-visual propagation on the player seat ⚠️
  verified via store, not pixels)

### DM-only knowledge

- **Secret doors are visible to the DM** (reduced alpha) and carry a Reveal
  control; until revealed they are invisible to players everywhere — canvas,
  panel, everything. ✅
- **Locked state is DM-authoritative**: players cannot unlock; the DM's
  Unlock is instant for everyone. ⚠️ (DM side verified; player-attempt
  behavior ❓ — what happens when a player tries a locked door is untested
  and possibly undefined)

### Tokens and doors (DM side)

- **The DM can place a token and it round-trips through the server** —
  it is real shared state even before players can see it. ✅
- **An unclaimed token is invisible to players by design** until a player
  claims it or its room is revealed. ✅ (by-design, verified in source —
  the "sync bug" from the walk was a missed Claim step)

---

## 3. Player's POV (session/table app)

### What a player sees

- **Only doors their vision has earned**: doors in unrevealed rooms are
  absent; doors at the edge of vision appear with **generic names**
  ("Door 2"), the real name withheld until the DM reveals or the fiction
  earns it. ✅
- **Secret doors simply do not exist** for players — not in the list, not on
  canvas, not at reduced alpha, until the DM reveals them. ✅
- **A revealed door's state is live**: when the DM (or another player) opens
  it, every seat sees it swing within a beat, no reload. ✅ (list state
  verified; pixel-level canvas update on the player seat ⚠️)

### Vision through doors

- **A closed door stops sight and light** — the player's visible area ends at
  the closed door exactly as at a wall. ❓ live (engine raycaster unit-tested
  ✅; never pixel-verified from a player seat)
- **Opening a door extends vision through the gap** immediately — the room
  beyond becomes visible to the degree the party's tokens can see it. ⚠️
  (verified from the DM canvas; player-seat verification blocked twice, see
  Tokens below)
- **Walking a claimed token through an open doorway reveals the room
  beyond** on the player's seat (fog persists per the fog rules afterward).
  ❓ — THE flagship flow, still never executed end-to-end. Verified recipe
  for the next walk: DM places token → player presses **Claim** in the token
  panel → DM opens door → drag the token through the doorway → the new room
  enters the player's visible set on the next state push.
- **A closed door the party has already seen stays visible as geometry**
  (fog memory), but activity behind it is hidden. ❓

### What a player can do

- **Players can open/close unlocked, visible doors themselves** (canvas
  interaction and/or panel toggle — same gating as the DM minus lock/secret
  powers). ⚠️ code says yes (toggle affordance is not DM-gated, matching
  canvas rights); never exercised from a player seat in a walk
- **A locked door refuses a player's toggle** with clear feedback (it should
  feel locked, not broken). ❓ — behavior unspecified/untested; needs a
  decision (silent refusal vs. shake/message)

---

## 4. The door's own POV (engine/game rules)

### One source of truth

- **A door is anchored by position, not by wall identity** — `wallId` is only
  a hint; every render/hit-test/occlusion pass re-projects the door onto the
  best wall via one shared resolver. Floor doors carry `wallId: ""` — the
  editor walk flagging the empty string as "suspicious" is in fact the
  designed encoding. ✅
- **Everything consults the same resolver**: renderer, both tools' hit tests,
  occlusion, room binding. No consumer keeps its own idea of where a door
  is. ✅ (this was the core of the overhaul)

### Light, sight, and state

- **Closed, locked, and unrevealed-secret doors block light and sight.
  Open doors and archways pass both.** An archway can never be closed or
  locked — states that downstream systems can't express are unreachable. ✅
  unit-tested / ⚠️ live pixel verification only from the DM seat
- **A state flip re-lights the scene** (occlusion recomputed) but must not
  re-lay wall stones or re-run the floor union. ✅
- **Perf budget: a door toggle should complete within 50 ms** on the dressed
  map. ❌ — write is ~4–5 ms now, but the relight re-sweeps all lights
  (~65–95 ms frame). Honestly pinned as a failing e2e; scoped as task #19
  (targeted light invalidation).

### Sync and persistence

- **Door state rides the module channel** (server-authoritative command →
  broadcast), NOT the map snapshot — `mapData` is fog-only by design. The
  panel, canvas, and lighting all converge from the same push. ✅
- **Saved maps round-trip**: doors (including detached ones) survive
  save/load with authored intent intact; legacy `floor-*` wall ids are
  treated as no hint and re-anchor by position — old maps load without
  migration. ✅ unit-tested / ❓ live save→reload walk untested
- **The bundled asset pack self-heals**: a returning browser with an older
  cached pack detects the newer bundled manifest (version + entry count) and
  reinstalls before first render. ✅ (fixed today)

### Sprites

- **Pack contract**: `door-{single,double}-{closed,open}`,
  `door-portcullis-closed`, `door-archway-open` (+ `door-portcullis-open`
  deliberately absent). Missing keys fall back per-key to glyphs. Locked =
  red tint on the closed art; secret = 0.35 alpha on whatever the state maps
  to. ✅ sessions / ❌ editor rendering bug (see §1)
- **Sprites honor true grid dimensions** — non-square art (2×1 frames, 1×2
  arches) renders at its real aspect, rotated to the wall, never stretched.
  ✅ (verified on a vertical wall)

---

## The gap list (what stands between here and "done")

Ranked, from the ❌/❓ above:

1. **Select-tool drag and double-click do nothing on doors** (§1). The fix
   direction: SelectTool needs a door branch that delegates to the same
   slide-along-wall and toggle logic the DoorTool already has (shared
   helpers exist: `projectDoorOnto`, `isDoubleClick`). Alternative decision:
   make doors door-tool-only for manipulation and have select-tool clicks
   switch tools — but pick one, today it half-works.
2. **Editor door visual is a magenta bar, not the sprite** (§1) — diagnose
   why the editor renders neither sprite nor proper glyph when the session
   app renders the same pack correctly.
3. **The flagship player flow has never run end-to-end** (§3): claim →
   open → walk through → room reveals. Recipe is written; needs one clean
   walk.
4. **Delete-a-door is completely untested** (§1) — gap must close, light
   must return, one undo entry.
5. **Locked-door feedback for players is undefined** (§3) — decide and
   implement the refusal affordance.
6. **DoorPanel row → camera navigation** (§2) — DMs can't find their doors;
   also the biggest QA friction in every walk so far.
7. **Toggle relight budget** (#19) and the remaining ⚠️/❓ pixel
   verifications (player-seat canvas update, box-select, properties panel,
   save/reload walk, portcullis-open glyph, editor glyph tints).
