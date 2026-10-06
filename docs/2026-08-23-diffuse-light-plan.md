# Diffuse light + seat colour parity — plan

Status: APPROVED 2026-08-23 (with F). BUILT on branch `diffuse-light`, one PR. Build log at the end.

## What was measured (2026-08-23, Fieldstone Keep, live dev table, both seats, same camera, GL readback, 24px box means)

| Where | Clock | DM | Player | Note |
|---|---|---|---|---|
| Lighting FBO base (unlit) | 12:00 | 232,227,216 | 232,227,216 | Identical. The per-seat "bite" pass in `LightingRenderer` is a no-op (two source-over fills of the same colour). Known, tracked since #100. |
| Floor the party stands on | 12:00 | 96,87,70 | 84,75,59 | Player 12% darker. Cause is NOT lighting: the DM's `FogOverlay` paints `REGION_WASH` (#d8cfc0 @ 0.1) over every explored cell in vision mode. Bare background under it: DM 82, player 67. |
| Explored room (memory tier) | 12:00 | 116,104,87 | 38,37,36 | Player at 33%, desaturated. Reads as night at noon. |
| Pool edge, radial luminance | 00:00 | 45 → 23 → 7 | 41 → 12 → 3 | Same slope; player adds a hard drained-wash step at the light's radius, then the cloud 0.4 cells later. |
| Fog edge width | any | — | ~6px at 13% zoom | `FOG_FEATHER` 0.4 cells, 6 bands. |

Visual: DM pools fade `1 - t²` to the rim — non-zero slope at t=1, so every pool ends on a visible ring; wall shadows are razor polygons (half-res FBO adds ~1px). Player pools read as crisp discs because of the wash step + narrow feather, not because the gradient differs.

## Fixes, smallest first

Core (`packages/core/src/engine/lighting/LightingRenderer.ts`) — both seats:

- **A. Rim with zero slope.** `quadratic`: `(1 - t²)²`; `linear`: `1 - smoothstep(t)`. 12 stops instead of 4/6. One function. Pools keep their centre brightness and stop ending on a ring.
- **B. Penumbra at walls.** `BlurFilter` on the per-light blit sprite, applied at rebuild (the FBO is already memoised; nothing runs per frame). Radius = 0.25 cell × zoom × FBO scale, capped 12px. Per-light so FBO borders stay clean. ~8 lines. If the 1650 or the iGPU shows it, fall back to one blur of the final `lightFBO`.
- **G. Delete the dead bite pass** and the test that pins it; `voidStyle` stops pre-darkening the washes by a bite that never lands (they are currently darker than the "strict share of live" rule intends). ~10 lines. Plan #100's "player-only darkness" is NOT resurrected — the seats should match, that's the point of this work.

Table (`session/client/src/modules/fog/`):

- **C. Wider fog edge.** `FOG_FEATHER` 0.4 → 1.2 cells, `FEATHER_STEPS` 6 → 12. Two constants; rooms and vision modes both read them. Security unchanged: the ramp sits inside `reach`, outer band stays solid, the cloud still only eats inward.
- **D. Drained wash ramps in.** Darkness only. Instead of a hard `difference(clear, lit)` fill, the wash fades in over 1 cell from the pool rim: `reachOf(night.lit, 1)` gives the band, the same inside-stroke ladder `featherEdge` uses (alpha rescaled to `DARKVISION_TINT_ALPHA`) draws the ramp. ~20 lines in `drawFog`.
- **E. DM sees true colour.** `REGION_WASH` only while the fog tool is armed (the brush is the one thing that needs it). One condition. Outside the tool both seats show identical pixels wherever the party can see.
- **F. Memory tier follows the light level.** `EXPLORED_TINT_ALPHA` × lerp(0.55, 1, bite level): noon memories land ~60% of live instead of 33%; darkness unchanged. One expression. Taste knob — say no and it stays out.

Not touched: grass at noon reads (74,69,3) — that is the art (yellow-olive, no blue), not lighting.

## Gate

- Unit: falloff curve (slope at rim = 0), feather ladder alpha sum, region-wash condition.
- Live: both seats, Fieldstone Keep, 00:00 / 12:00 / 17:00, the same GL box readback at the five points above → DM == player inside sight (±3), pool rim luminance falls over ≥ 1 cell, no ring. Pan at 8 tokens on the 1650 and the UHD 630: ≥ 55 fps / ≥ 25 fps.
- Lanes: sprint3-fog/vision/share baselines will move (edge width, wash) — re-baseline in the same PR.

Size: ~1 day, one PR. Agents ≤ 5 per step, each under an hour.

## Build log (2026-08-23)

What shipped differs from the plan in four places, each measured rather than guessed:

- **A** landed as "authored curve inside, ease-out over the last quarter" (`RIM_START` 0.75), not `(1−t²)²`. The steeper curve dimmed every torch on the near-black crypt by a third (lane: lit pixels 1.5% → 0.2%). The plateau is byte-identical now; only the ring at the rim is gone.
- **B** needed `blendMode: 'add'` on the `BlurFilter` itself — a Pixi filter composites with its own blend mode, not the sprite's, and at 'normal' every pool lost the grade under it.
- **C** is an inward fade, not a wider reach. Growing `FOG_FEATHER` to 1.2 cost 12 → 30ms per mask rebuild (round-join offsets on a 1600-vertex sweep) and showed a bright halo a cell past the party's sight. The reach stays 0.4; `FOG_FADE` 1.2 is the look, drawn as a GPU blur of the mask texture taken `min()` against the sharp mask in the shader (inward only, leak-free). Stroke ladders at that width combed every sweep's rim and compounded alpha at corners — backed out.
- **D** builds its rings from the lights' own sweeps at larger radii (`NightSight.litRamp`, cached per position) — not Clipper offsets — with a bbox prefilter and chained differences; 2 steps. Dark-scene rebuild: 23.5 → ~31ms on the gate map (quiet A/B); day at baseline.
- **F** also eases the cloud's memory mist with the level, and the memory wash moved into the cloud shader (`setWash`) so it ramps with the mask instead of stepping on the sight line. The cloud's rim band went 0.75 → 0.25.
- **E** grew: the DM's room-status tints and haze are also tool-gated now. In Vision mode the party sweeps rooms nobody "reveals", and the DM was seeing the hall they stand in through a 0.62 near-black tint while the players saw it lit — the colour mismatch the screenshots showed. Off the tool the DM sees the map as authored; arm the fog tool for the state grammar.

Gate: client 814 tests, core 1084, lint + tsc -b clean. Lanes: see PR body.

## Round 2 (2026-08-23, after the live review)

The user's screenshots after round 1 still showed two shapes on the player seats the DM never sees: an arc crossing a lit room (the token's `sight.range` circle capping lit floor) and crisp line-of-sight wedges. Softening edges does not remove a shape, so the rule changed instead:

- **Sight is line of sight to the whole map.** `SIGHT_REACH` (1000 cells, `@dnd/mechanics/fog`) is the radius both sweeps use — server `sweep.ts` for redaction and auto-explore, client `visionSight.partySight` for the mask. A token's `range` now bounds one thing only: how far it sees *unlit* ground (the darkvision ring). In darkness the player's clear tier is `line of sight ∩ (light pools ∪ darkvision ring)`, so its edge in a lit room is the pool's own falloff; in daylight it is line of sight alone, which is what the DM sees.
- The client's darkvision half is a second sweep at `range` (`litArea` at that radius, memoized with the torches) instead of reusing the party polygon, which no longer carries the range.
- **Gotcha:** `drawFog` grew the scrim/mask cover to every raw sight vertex, and a raw sweep now has rays a thousand cells long — the mask texture stretched over a 2000-cell square and the map collapsed into a few texels (flat blue over the whole lit room, one wedge of floor). The cover is measured off the *drawn* rings now; the region already clips the sweep to the rooms the player holds.
- Tests that staged two tokens in one daylight room with a short `range` (server vision-mode, integration, the renderer's darkvision row) re-stage in the dark with darkvision of that radius — same geometry, same claim, the honest version of the rule.
- Live: Fieldstone Keep at night, DM vs Player One vs Player Two, 0.5-cell box means along y = 19/22/25/28 for x = 12…31: within 2/255 everywhere the player can see; east of the shut door the DM reads ~20 (unlit floor) and the player ~9 (hidden tier). No arc, no wedge inside a pool. Lit rooms seen through a doorway show as line-of-sight fans, which is the one shape a player legitimately has that the DM does not.

## Round 3 (2026-08-23, live review on the table)

Two more things the user pointed at on the player seats, both treatments layered over ground the DM simply shows:

- **The drained wash is gone.** Unlit ground a darkvision eye reaches used to take a navy `0x151b24` at 55%, ramped in from every pool's radius (`DRAINED_RAMP`, `rampAlpha`, `NightSight.litRamp`, `VisionRegion.drained` — all deleted, with their tests). That ground is now the floor under the night grade, exactly as the DM sees it: readback `25/25/28` on both seats past the torch. The grade already leaves it near-grey, which is all "shape without colour" asks.
- **Pools run out in the cloud shader, not in a cut.** `LivingFog.setPools` takes every light (whole to its radius, gone a pad past it — the edge the geometry drew before) and every darkvision eye (whole to `RIM_START · range`, gone at `range`) as discs; `maskAt` fades live texels over them on the lighting pass's own rim curve, and the fade lands on the memory grey (`max(poolAt, 0.5)`) — a band fading to hidden in front of a remembered corridor read as a blue smear. No circle is drawn at any radius now.
- **Memory is the map under a thin haze.** `MEMORY_MIST` 0.55 → 0.25, `EXPLORED_TINT_ALPHA` 0.7 → 0.3, and the shader's hidden ramp ends at the memory grey so a remembered room carries none of the dense cover. The user's words: "a thin patch of clouds/smoke above, still visible almost."
- **Cleanup.** The per-seat "bite" (`biteStrength`, `LIGHTING_STRENGTH`, `FogScene.bite`) is gone — the lighting pass stopped reading it in round 1 and the only consumer left was the cloud palette, which now takes `SCENE_DARKNESS` (renamed from `AMBIENT_BITE`) directly. The stroke ladder `featherEdge` / `FEATHER_STEPS` is gone too: the living fog's GPU blur is the edge on every mask, the DM's haze included.
- **Lanes re-staged to the rule:** sprint3-share's two seats are separated by a partition wall in the near hall (an in-memory doc, `MapUnderTest.doc`) instead of a 3-cell range; sprint3-vision's look-away rows shut the door behind the party (there is no spot in an open hall that cannot see the doorway); the gate's Drowned One and Crypt Rat stand round corners their nearest eye cannot see past, checked against every party sweep on the geometry.
- **Found while re-staging the lanes: the redactor attributed a wall to rooms by probing at its midpoint only, half a cell out.** A wall longer than the rooms it divides (the two-room fixture's, 40 cells) had its midpoint beside no room, and a room authored a whole cell back from its wall never matched either — so the wall shipped to nobody and the player's own sweep, with nothing to stop it, cleared the whole hall beyond the moment its door opened. The 8-cell radius had been hiding this. `roomsAlong` now probes once per cell along the wall at half a cell and a whole cell (server `sceneMap.ts`, with a row in `fog.test.ts`).
- `clockwiseSweep` drops vertices collinear with their neighbours (consecutive rays landing on one wall): a whole-map sweep on the crypt goes 603 → 22 vertices with its area unchanged; the eight-eye mask build in Node 38 → 15 ms.
