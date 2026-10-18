# Vision containment + soft band — plan (2026-09-01)

Status: AWAITING APPROVAL. Builds on branch `raster-fog-mask` (the GPU tier compositor);
ships with it or stacked on it. Nothing here is built.

## The model (settled with the user, 2026-09-01)

- **The DM's opened ground is the fence for live sight.** Inside it, eyes work freely —
  line of sight, no caps. Sight never punches past it into ground the DM hasn't given.
- **Movement peels the cloud back.** A token entering unopened ground uncovers it at its
  *own* sight range — the keen-eyed scout earns more per step. What's uncovered joins the
  record and stays (the ratchet). Composes with party/individual vision share as-is.
- **DM reveals stay memory-grey.** Revealing well (initially and on the fly) matters more
  than the tier. Locked rooms still beat everything. "Players see everything" is the DM
  opening the whole map — no presets, no named modes.
- Explicitly rejected: hard cap at token range as the rule, distance haze, named presets,
  any fixed scene view-distance.

## Why this is small: it is two shipped mechanisms composed

Live sight per eye becomes:

```
live_i = (sweep_i ∩ held)  ∪  sweep_i(range_i)
```

- `sweep_i ∩ held` — the roomless battlemap clip (#114), today gated behind
  `rooms.length === 0` (`tierPlan.ts:179` `heldSources`); generalized to all maps.
- `sweep_i(range_i)` — the range-limited sweep that `sightRangeLimit` already takes
  (`sweep.ts:156`); here it runs as a *second, additive* pass instead of replacing the
  full sweep. The sweep memo already keys on reach, so both coexist in it.

The union is per-eye by construction (each pass only ever draws that eye's own polygon),
which closes the edge case where eye A's long sweep could open ground near eye B.
Darkness/light gating (`seen()`'s lit/darkvision clause) applies on top, unchanged.

**held** on a contained map = record runs (`regionRects(region)`) ∪ revealed-room
polygons. On roomless maps that degenerates to today's record-only clip (unchanged); with
containment off, walled maps keep today's rooms-only held (unchanged).

## P0 — mechanics: the field

`packages/mechanics/src/fog/types.ts`, beside `sightRangeLimit`:

- `containedSight?: boolean`, reader `containedSightOn(scene)`; doc comment names the
  default and the three readers that must agree (referee sweep, player mask, DM preview) —
  same contract as `sightRangeLimitOn` (`types.ts:82-86`).
- Command `'set-containment': ['dm']` in `module.ts:80-84`, handler modelled on
  `'set-range-limit'` (`module.ts:224-228`, deliberately no log line).
- **DECISION (user):** default ON (containment is the doctrine; existing vision tables
  keep everything already earned — the record is a ratchet — they only stop future
  long-distance reveals) vs default OFF (stored scenes play exactly as before until the
  DM flips it; precedent: `sightRangeLimit`). Recommendation: **ON** — the user's stated
  rule is "if there's fog of war, vision is contained", and the off position remains one
  switch away.
- Tests: stores/defaults/rejects-non-bool rows in `module.test.ts`, mutation-checked.

## P1 — server: referee, wire, ratchet

`session/server/src/fog/sweep.ts` + `vision.ts`:

- `partyVision` gains the second per-eye pass when `containedSightOn(fog)`: for each eye,
  also `sweep(x, y, sight.range)` (memo-friendly). `seen(sight, x, y)` becomes
  `inFullSweep ∧ inHeld  ∨  inRangeSweep`, then the existing light gate. `inHeld` reads
  the same record/rooms union the client will (shape to copy: `openGroundOf`,
  `vision.ts:505-517`, which already reads the record).
- `canSee` (`vision.ts:343`) inherits the composed `seen()` automatically — tokens beyond
  the fence stay off the wire. `openGround` unchanged.
- Auto-explore (`swept()`, `vision.ts:445-475`) needs no separate bound: cells fail the
  composed `seen()` unless held or within the eye's own range, so the record ratchets at
  exactly the discovery pace the model wants. Locks keep filtering writes (`:468`).
- `set-containment` joins the re-redaction action list (`registry.ts:59`) — flipping it
  re-cuts player documents, same precedent as the mode-flip fix (`8758582`).
- Tests in `vision-mode.test.ts` (file-level `ensureClipperReady` — the lying-suite trap):
  contained hall shows held + own-range only; far lit ground beyond the fence invisible
  until walked; record ratchet extends sight next tick; locks still win over both passes;
  darkness composes; individual share fences each seat by its own record; containment off
  reproduces today's rows byte-identical.

## P2 — client: mask + preview

`session/client/src/modules/fog/tierPlan.ts` + `FogRenderer.ts`:

- `TierScene` gains `contained: boolean` (from `containedSightOn`) — set in `tierSceneOf`
  (`FogRenderer.ts:984-1000`). One edit covers player mask *and* DM preview, because the
  preview already substitutes the previewed seat's record before `tierPlan` runs
  (`FogRenderer.ts:750-761`).
- `heldSources` predicate: contained ⇒ record runs ∪ revealed-room polys (rooms fetched
  from the existing `revealed` field, `tierPlan.ts:328-337`); else today's ternary.
- Live layer becomes the two-pass composition: full sweeps clipped by inverseHeld (the
  existing erase-dual), plus range sweeps drawn unclipped. Range sweeps come from
  `partySight` with `rangeLimited` semantics — do NOT clip inside `partySight` itself
  (memo poisoning; the doc at `visionSight.ts:96` is the contract).
- The `live` RT is also the SIGHT_MASK stencil (`tierPlan.ts:313` invariant) — the added
  pass must land before the held clip ordering assertion rows; extend `tierPlan.test.ts`
  contract rows (all symbolic in GROW/SWEEP_GROW, safe).
- GL harness: add a contained-walled scene to `compositor-check.ts` and assert
  `shownOutsideVectorCells === 0` against an updated oracle branch.

## P3 — DM reveal tooling

- The brush/box already works on walled vision maps (`brushAvailable` gates on mode, not
  geometry — `brush.ts:95-99`; server `region-set` has no geometry gate) — today it paints
  cells nothing consumes; under containment those cells ARE the fence. Verify + surface:
  the FogTool empty-state copy stops implying battlemap-only.
- New: "Open whole map" for the record (today `set-bulk`/Reveal-all is rooms-only,
  `FogTool.tsx:573-578`, disabled on roomless). One DM action filling the region record
  within the frame — this is the model's "players see everything". Inverse ("Reset
  exploration") already exists via `reset`.
- Switch UI beside auto-explore/range-limit in the vision block (`FogTool.tsx:221-244`),
  plain words, e.g. "Sight stays inside revealed ground".

## P4 — the S band (locked by the user)

- `session/client/src/modules/fog/fog.ts:145` `FOG_MARGIN` 0.3 → 0.5
- `session/client/src/modules/fog/FogRenderer.ts:227` `FOG_FEATHER` 0.4 → 0.8
- **`session/server/src/fog/redactMap.ts:184` — the hand-duplicated server copy of
  FOG_MARGIN, 0.3 → 0.5.** Nothing catches drift; skipping it desyncs shipped geometry
  from the client mask. Strengthen the cross-reference comment on both sides.
- Derived: pad 0.8→1.0, sightPad 0.55→0.75, GROW 1.2→1.8, SWEEP_GROW 0.95→1.55.
  `tierPlan.test.ts` and the GL harness are fully symbolic (safe); `FogRenderer.test.ts`
  two-halls fixtures survive by construction (run, don't rewrite); e2e lit-fraction
  bounds don't read the band (verified) — but the **rebuild budget pins must be
  re-measured** (`sprint3-vision-gate.spec.ts:461` 8ms, `sprint3-vision.spec.ts:770`
  16ms): FOG_FEATHER is the round-join stroke width in the raster path, and doubling it
  grows stroke area. Re-derive from measured medians, same method as `1802f84`.

## P5 — verification gate

Suites (client/server/mechanics/core) green with the new mutation-checked rows; GL
harness green including the contained scene; sprint3 vision + gate e2e lanes green with
re-derived budget pins; doors lane green. Then a live Chrome walk on the **Goblin Warren**
dev table (per the test-map rule; docker not required, dev-stack precedent): DM opens the
clearing → player sees it all (grey) + own surroundings live; the road ahead stays under
cloud and opens at the scout's range as he walks while a short-sighted token opens less;
locked warren chamber never leaks through its mouth; "Open whole map" shows everything;
containment off reproduces today; darkness + torch composes; zero console errors; band
reads as the S look from the fog-dials artifact.

## Scope exclusions

No haze, no dim tier, no presets, no per-scene view distance. Beyond-the-fence rendering
is the existing living-fog cloud — no new visual. `concealBehindDoors`, locks, share
modes, clock/ambient machinery all untouched.

## Orchestration

Same shape as the raster build: execution agents implement P0–P4 (P1 and P2 against the
same contract tables so server and client cannot drift), review agent over the composed
seen()/tierPlan seams, browser agents for P5 walks (one at a time), adjudication between
phases. Capture/verification note: **fog constants do not propagate under Vite HMR — full
page reload per change** (proven 2026-09-01, byte-identical readbacks otherwise).
