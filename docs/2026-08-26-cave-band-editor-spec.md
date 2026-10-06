# Cave band editor — spec for steps 2–6

Status: step 1 shipped (branch `floor-late-texture-rebake`, uncommitted). Steps 2–6 unbuilt.
Variant B chosen by the user from `docs/mockups/2026-08-26-cave-node-edit-variants.html`.

The feature in one line: **a cave wall is a run of placed asset children, and dragging a joint between
two of them re-lays that stretch out of pieces the kit can actually build, moving the floor outline to
match.**

---

## 0. Ground truth

Everything below was measured this session against the Goblin Warren, not assumed. An implementation that
contradicts one of these is wrong.

| Fact | Value |
|---|---|
| Cave band pieces on the map | 127 of 271 asset children |
| Non-band assets (rubble, ledges, mushrooms, furniture) | 144 |
| Kit size | 14 pieces + 11 mirrored straights |
| Kit chords | 1.28 – 5.97 cells, 14 discrete values |
| Kit turns | exactly 0, +90, −90. Nothing between |
| Placed band scales | 0.97 – 1.00. Pieces are matched, never stretched |
| Mirrored placements | 55 of 127, all straights, `flipY` only (`flipX` is always false) |
| Joint gap along the band | p50 0.34, p99 0.535, **max 0.555** |
| Nearest wrong-successor distance | **min 0.578** |
| Floor contour | one shape child, 256 points, one merged ring |
| `BAND_OUT` (band shove toward the void) | 0.18 cells |
| `BAND_OVERLAP` (designed joint overlap) | 0.30 cells |
| `floorBleed` (paint past the boundary) | 0.45 cells, render only |

**The kit is the whole vocabulary.** Fourteen chords and three turn values. Any curve the band follows is
an approximation built from those, which is why the outline has to move to the pieces rather than the
pieces stretching to the outline.

### Traps already paid for

1. **`chordCells` in `caveWallKit.json` is rounded.** The chord must be derived from the joints.
   Matching against the label puts every piece at scale 1.00025, and scale is uniform, so that is a hair
   of extra *thickness* on every stone in the wall. `toPiece` already derives it; do not "optimise" that
   back to reading the field.
2. **Mirroring lives in the piece, never in the placement.** `mirrorPiece` bakes swapped, negated joints
   into `jointsCells` and sets `flipY` as a render hint only. `jointsOf`/`placeOnChord` deliberately
   ignore `at.flipY`. Always go from a placed child to its piece through `pieceForAsset(assetId, flipY)`.
3. **Chord distance is not arc distance.** This caused a real 2.06-cell hole in the shipped cave: the walk
   advanced its cursor by a chord probe from the piece's start, and on a hairpin a 1.97-cell chord spans
   ~4 cells of arc. Any cursor advance must be measured back from where the piece *ends*.
4. **`material` + `gridSize` is the join to pack art**, verified 1:1 over all 17 measurements. Never parse
   identity out of an asset id — that is how the gg-demo squash bug happened.

---

## Step 2 — Band detection

**New file:** `packages/core/src/engine/caveBand.ts`. Pure, no Pixi, unit-tested.

```ts
interface BandPiece { childId: string; piece: CaveKitPiece; at: KitPlacement; joints: [Vec, Vec] }
interface CaveBand  { pieces: BandPiece[]; joints: Vec[]; closed: boolean }
export function detectBands(layer: DungeonLayer): CaveBand[]
```

Algorithm:

1. Collect asset children where `isCaveBandAsset(assetId)`; resolve each through
   `pieceForAsset(assetId, child.flipY)` and `jointsOf` to world joints.
2. Chain them by **global one-to-one matching**, not per-node nearest:
   build every candidate pair `(end[i] → start[k])` with gap ≤ **1.2 cells**, sort ascending, and accept
   a pair only when `i` still has no successor and `k` still has no predecessor.
3. Walk the resulting successor map into runs. A run whose successor chain returns to its head is
   `closed: true`; the Warren is one closed cycle of 127.
4. `joints[m]` between consecutive pieces is the **midpoint** of `end[m]` and `start[m+1]` — that absorbs
   the designed 0.30-cell overlap. A closed band has `joints.length === pieces.length`; an open run has
   one more.

**Why one-to-one and not nearest.** On the *current* map both agree, but only by 0.023 cells
(max-correct 0.555 vs nearest-wrong 0.578). On the map as it shipped before this session's walk fix, the
ranges overlapped and per-node nearest picked the wrong successor for 9 of 127 joints. A hand-edited or
hand-placed band will cross that margin. Matching is ~10 lines and cannot double-assign; nearest can.

**Do not add turn or forward gates.** Both were measured and both made the answer *worse* (2 and 6 wrong
against 0), because a legitimate successor across a 90° bend fails a forward test and a hairpin fails a
turn cap.

Tests: single closed cycle of 127 on the shipped warren fixture; an open run terminates at both ends;
a deliberately doubled piece does not get two predecessors.

---

## Step 3 — Node mode's second source

Node edit mode currently means "handles on the stones a wall texture set composed". It gains a second
source: "handles on the joints of an object-kit band".

- `wallNodeOverlay.ts` — `activeWall()` learns a third case beside standalone wall and floor ring. The
  cleanest shape is a discriminated `EditableRun`: `{ kind: 'stones', … } | { kind: 'band', band: CaveBand }`.
- `noWallStonesReason` stops being a dead end for cave layers: if the layer has no wall texture set but
  `detectBands` finds a band under the pointer, enter band mode instead of warning. Keep the warning for
  a layer that has neither.
- `toggleNodeEditAt` (`canvas/src/canvas/wallNodeEdit.ts`) hit-tests the band's joints as well as
  `snapToNearestWall`. Entry gesture is unchanged: double-click the wall with the Select tool.
- Handles are drawn at **joints**, not piece centres. Reuse `drawNodeHandle` and the existing overlay
  language — white on ink, double ring for the primary, hollow for group members.
- `selectedNodeT` / `selectedNodeTs` are keyed by `t` along a spine. A band joint has an index, not a
  `t`. Either map joint index → synthetic `t = index / joints.length`, or widen the selection state.
  **Prefer the synthetic `t`**: it keeps `toggleNodeSelection`, shift-click, group drag, and the status
  bar working untouched.

What comes free once this lands: multi-select, group drag, the keyboard table, and one undo entry per
gesture — all of it already exists and is only unreachable because entry is refused.

---

## Step 4 — The solver

This is where the quality lives. **The mockup's solver was a fix fix** — it re-solved only the two spans
either side of the dragged joint and left a 0.17-cell residual for the overlap to swallow. The rule the
user set is no empty spaces and accurate, so the affected stretch must *close*.

**Model: the drag edits the outline, and the band is re-walked over the edited outline.** That is the
generator's own behaviour applied locally, and it is what "the polygon auto-adjusts to incorporate the
asset" means.

Given a drag of joint `i` to world point `W`:

1. **Choose anchors.** Take joints `a = i − k` and `b = i + k`, starting at `k = 2`. The stretch outside
   `[a, b]` does not move.
2. **Deform the local outline.** Displace the floor contour points between `J[a]` and `J[b]` by a falloff
   that peaks at `W − J[i]` on the point nearest `J[i]` and reaches zero at both anchors. Cosine falloff;
   linear reads as a crease.
3. **Re-walk the stretch** from `J[a]` to `J[b]` over the deformed curve, using the generator's rules:
   chord fit against the kit, the turn-family gate (a bend for a real corner, a straight for a run that
   barely turns, neither in the 35°–45° band), and the cursor advance measured **back from where each
   piece ends**.
4. **Close it.** The last piece may take up to **±12% uniform scale** to land exactly on `J[b]`. Beyond
   that, split the closing stretch in two, exactly as `walkClosed` does at the ring seam.
5. **If closure fails within the budget**, widen to `k + 1` and retry, capped at `k = 6`. If it still
   fails, refuse the drag and leave the band as it was rather than committing a torn one.
6. **Re-apply `BAND_OUT`** (0.18) and each piece's own `fitArc` sideways nudge, or the rock sits on the
   floor edge instead of straddling it and pale floor shows at the join.

**Anchor width is a real trade-off.** Too narrow and closure needs unacceptable scale; too wide and a
small drag rewrites wall far from the cursor, which reads as the map fighting you. Start at ±2, widen
only on failure.

**Share the code with the generator.** `walkClosed`, `fitArc`, `chordPoint` and `placePiece` currently
live in `scripts/gen-goblin-warren.mjs`. Move the fitting and closure into `packages/core` and have the
generator import them. If the editor and the generator keep separate copies, an edited stretch will
slowly stop matching the stretch beside it — the exact drift the single-copy kit move in step 1 was
about.

---

## Step 5 — Commit

One gesture, one undo entry, using primitives that already exist.

- The drag writes live to the store (no command per pointermove), same pattern as `beginNodeDrag` /
  `nudgeWallNode` / `endNodeDrag` in `wallNodeEdit.ts`.
- On release, land a **`CompositeCommand`** (`packages/core/src/store/commands.ts:62`) holding:
  - `UpdateChildCommand` on the floor shape child — the deformed contour, before and after.
  - `UpdateChildCommand` per re-laid band piece whose span already had a child (position, rotation,
    scale, `assetId`, `flipY`).
  - `AddChildCommand` / `RemoveChildCommand` only for the difference in piece count.
- **Reuse child ids in order** across the replaced span. Minting fresh ids for every piece would break
  selection stability and make undo look like a delete-and-recreate.
- Cancel mid-drag rewinds without a command, resolving against the layer the drag *began* on — the
  existing `rewindDrag` reasoning applies unchanged.

**Dressing does not move** (user decision). Rubble, ledges and mushrooms near a re-laid span stay where
they are; the DM repositions and resizes them by hand afterwards, because a moved wall usually wants them
re-fitted rather than translated.

---

## Step 6 — X-ray preview

While a joint drag is in flight:

- Render the candidate pieces for the affected stretch as ghosts at ~0.35 alpha, over the live band faded
  to roughly the same, so the swap is legible before release.
- Label each ghost with its piece name near the span midpoint.
- Status read-out names both chosen pieces and **how far the kit pulled the handle away from the cursor** —
  that number is what tells the DM whether the constraint is helping or fighting.
- Ghosts are overlay-only. Nothing is written to the real children until pointer-up.

---

## Acceptance gates

Run after every commit, not just in tests. These are the "no empty spaces" bar made checkable.

1. **The chain closes.** Every consecutive joint gap in the edited band ≤ **0.9 cells**, and the edited
   stretch's max gap no worse than the untouched band's (≤ 0.6).
2. **No piece stretched.** Every placed scale within ±12% of 1.
3. **No family violation.** Every placed piece's turn matches its family sign.
4. **The generator agrees.** `node scripts/gen-goblin-warren.mjs` prints no `BAND HOLES` line.
5. **Floor still covered.** `floorBleed` remains ≥ the largest residual the solver can leave.

Gate 1 is the same check `walkClosed` now performs; it should be one shared function.

---

## Build log — 2026-08-27

- **Steps 2, 4 shipped.** `caveBand.ts` (detection: 1 closed band / 127 / max gap 0.5546 on the warren),
  `caveWalk.ts` (single-copy walk core; generator byte-identical, proven 3×), `bandSolver.ts`
  (`solveBandDrag` / `solveBandStraighten` / `rewalkBand`, all pure; `walkClosed` is now a wrapper over
  `walkSpan`, and gate 1 is the shared `bandHoles()`). Step 3 shipped: band entry, joint handles,
  synthetic `t`, inert drag seam. Full-sweep numbers: half-cell drag 0/127 refusals, k=2 covers 62%
  (widening is routine, not exceptional), scales all within ±12%, hard 0.9 gap bar always met (strict
  ≤untouched-max holds 114/127, worst 0.633).
- **Adjudications.** (a) Drag is overlay-only until pointer-up — one ~280ms mergedFloor union per commit,
  not per pointermove; overrides step 5's "writes live to the store" line. (b) Single-span model kept:
  kitPull (p50 0.52, max 2.8 cells) is the honest read-out, the close-at-cursor two-span variant is the
  fix-fix again. (c) Insert gesture deferred to its own phase — needs a fractional-joint solver entry.
- **Insert shipped 2026-08-27.** `solveBandDrag`'s `joint` now takes a fractional index: the peak is the
  point that far along the span, and the anchors are `floor(joint) − k` / `ceil(joint) + k`, which
  degenerates to the old `±k` on a whole index (existing solver tests untouched and green). `{` / `}`
  mirror the stones table and drop a **transient handle** mid-span whose entire state is the fractional
  `t` in `selectedNodeT` — no store write, no new store field; deselect, mode exit, Delete, or a landed
  drag all make it vanish. `bandJointIndex` snaps a whole index and keeps a fraction. Full-span sweep:
  126 of 127 spans close a half-cell drag with every gate held, span 40 refuses inside the ±12% stretch
  budget (leaves the band alone, says why); k=2 covers 80 of the 126.
- **Latent defects found in the shipped cave, tracked not fixed:** two fallback pieces sit 0.484 and
  0.731 cells off the outline (`BAND_FIT` is 0.22, `floorBleed` 0.45 — the second exceeds it, so gate 5
  is already violated at those two spots by the shipped map, not by the editor). Also `rewalkBand` on the
  saved (Douglas–Peucker-simplified) ring yields 121 pieces vs the generator's 127 from the smooth
  curve — expected, not a bug.

## Live canvas walk, 2026-08-27 — PASSED (dev server, Warren fixture)

Every gesture exercised against the real app, verified from the store not pixels:

- Double-click cave wall → band mode; status/chip copy exactly as built; refusal warning path intact.
- Joint drag → one "Move cave wall" entry, 127→126 pieces, **max joint gap 0.555 = the untouched
  band's own max**, scales 0.932–1.035, selection re-keyed to whole joint 121/126 (F1 fix live-proven).
- Undo → exactly 127/284 restored; redo → 126/283; repeatable.
- Delete → "Straighten cave wall", 127→126, gap bar held, re-key correct.
- Tab → "Re-lay cave wall", 121 pieces (bench-predicted number), closed, gap 0.593, scales 0.894–1.000.
- `}` insert → transient at exactly joint 123.5; dragging it committed "Move cave wall" (127→125,
  gap 0.555), transient cleared per contract.
- Zero console errors across the whole session; map returned to pristine 127/284 at the end.
- GIF: `D:\DownLs\cave-band-editor-walk.gif`. Dev map entry renamed "Goblin Warren (band-edit QA)"
  (it was wearing the Fieldstone Keep entry after a loadFromFile+autosave; the real keep regenerates
  from `scripts/gen-fieldstone-keep.mjs`).

**New defect found live (F12), FIXED same day:** undo/redo of a band command changes the joint
count but keeps the old `selectedNodeT`, which then decodes fractional → reads as a transient insert
handle → Delete right after an undo silently deselects instead of straightening. Same class as F1, on
the undo path.

Fixed by making transience explicit instead of inferred, which is the root cause rather than the undo
path alone: `setBandTransientT` (module state in `wallNodeOverlay.ts`, a gesture's lifetime, compared by
value) marks the one handle `{`/`}` dropped, and `bandJointIndex` keeps a fraction only for that handle
— every other `t` decodes to the nearest joint, clamped into the band. So a `t` keyed to a joint count
that has since moved (undo, redo, a re-lay, another window) names a real joint again, on every path that
decodes one, not just Delete. Set in `insertBandJoint`; cleared in `handleBandKey`'s Delete, in
`bandJointDrag`'s `end` when a transient landed, and in `reselect`. Tests: two in `bandJointDrag.test.ts`
(Delete straightens after undo, and after redo, on the shipped Warren), one in `wallNodeEdit.test.ts`
(a stale fraction routes Delete to a straighten and draws no stray handle), one in
`wallNodeOverlay.test.ts` (the 121/126 × 127 decode and the clamp). All four verified red before the fix.

Minor note: an asset selected with the Select tool keeps its white outline while band node mode is
open (pre-existing coexistence of selection + node mode, not band-editor code).

## Ctrl+Z report, 2026-08-27 — routing ruled out, repro pending

User report after their own canvas try: joint drag worked, Ctrl+Z seemingly didn't. DOM keydown routing
RULED OUT by 11 new tests (`canvas/src/canvas/useCanvasInput.test.tsx`, real hook + real document
events; canvas suite 302 → 313): ctrl+z/cmd+z reach `undoManager.undo()` in band mode with or without
a selected joint, even from a text input; ctrl-combos provably skip the band key table; Delete/Escape
precedence pinned. Remaining candidates, need a live browser: (a) undo ran but the canvas did not
repaint (pre-F12 walk showed repaint working; unverified post-F12), or (b) the drag never committed
(solver refusal or the 0.1-cell threshold — both commit nothing by design, leaving nothing to undo).
The Ctrl+Z toast disambiguates: "Undo" = render bug, "Nothing to undo" = no commit, silence = half-dead
vite page (hard refresh).

## Review findings tracked, 2026-08-27 (adversarial review passed — no blockers; F1–F3 fixed same day)

Notes kept open, in review's numbering. None are geometry/undo defects; all verified as stated.

- **F4** — whole-wall re-lay reuses child ids from walk-index 0, not by proximity; aligns on the Warren
  by luck (0.02 cells). On a band whose `pieces[0]` sits elsewhere, ids (and a carried `tint`) rotate
  around the ring. Fix shape: align id reuse by nearest-child before patching.
- **F5** — `detectBands` runs ~once per frame while band mode is open (1.84 ms on the Warren; called
  from `activeWall()` before the signature guard, and again in `currentWallNodes()`/`wallNodeAt()`).
  Cache per children-signature if it ever matters.
- **F6** — the one mid-drag store write (`setBandDragStatus`) re-fires `subscribeToAssets`' selector
  (fresh array, no equality fn) → full `syncSprite` over all 271 children per pointermove. Cost only;
  mergedFloor union confirmed once-per-commit.
- **F7** — ghost sprites constructed/destroyed per pointermove (4–20); labels are pooled.
- **F9** — `sameBand` compares ids and order only; a concurrent *move* of a band child mid-drag commits
  placements solved against old joints. Needs concurrent editing to hit.
- **F10** — pre-existing step 1: `pieceForAsset` mirrors bends though only straights may mirror; `flipX`
  ignored by detection. A DM flipping a bend rock with the flip tool drops it out of the run.
- **F11** — a two-piece band refuses every drag ("the kit cannot close that stretch") — honest but a
  dead end.
- **Group-drag cue** — non-primary handles don't signal that only the primary moves; worth dimming
  during a band drag.
- **Latent shipped-cave defects** (from the solver phase): two fallback pieces 0.484/0.731 cells
  off-curve; 0.731 > floorBleed 0.45, so gate 5 is violated at those two spots by the shipped map.
- **Insert unavailable on span 40** of the shipped Warren (closure refuses at every k ≤ 6) — contract
  working, but a real hole in gesture availability there.

## Out of scope

- **The mipmap / flicker fix is parked** until the user asks. Verified cause: pack textures upload with
  `autoGenerateMipmaps: false`, `mipLevelCount: 1`, and band art is minified ~12× at working zoom.
- **Carrying dressing with a wall drag** — decided against.
- **gg-forge and other wall-texture-set layers** are untouched. They keep the existing `layoutWall` node
  mode; the two sources coexist.
- **Rebuilding gg-demo** is impossible from inside this repo; its build inputs live outside it.

## Open questions — resolved 2026-08-27

1. **Explicit insert/delete: yes**, on top of re-walking. Semantics that keep the outline as the single
   source of truth:
   - *Delete* — select joint(s), press Delete: the outline between the two adjacent joints is replaced by
     a straight chord and that stretch is re-walked. Piece count falls out of the walk; one undo entry.
   - *Insert* — the gesture adds a **transient handle** mid-span (no outline change, no commit). Dragging
     it runs the normal solver with the deformation peak at that point; joints are re-derived from the
     committed pieces on release, so the "inserted" joint only survives if the walk actually placed a
     boundary there. Mirror whatever insert/delete gestures the floor-ring node mode already has before
     inventing new ones.
2. **Whole-wall re-walk: yes** — one action in band mode that runs `walkClosed` over the current floor
   ring and commits via the same step-5 composite. Recovery tool for a band desynced from a floor shape
   moved by other means.
3. **Open runs: free ends simply move.** No closure constraint at a free end; the re-walk starts/ends
   there and the end lands where the last piece lands.

---

*Per project convention, `docs/` is deliberately untracked; this file is not committed.*
