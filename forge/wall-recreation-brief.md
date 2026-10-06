# Wall & Curb Recreation Brief — Round 1

ComfyUI generation brief for the first three handpainted wall designs, replacing the
`test-asset-sets/Walls_and_Curbs` placeholders. Chosen 2026-08-07: **Rugged Fieldstone**
(+ curbs), **Timber-Braced Stone**, **Timber Palisade**. Rejected for round 1: Fired Brick
& Ruin (source side pieces are single loose bricks), Iron-Braced Dungeon Stone.

Style gate: `docs/art-style-guide.md` — every generated piece passes it before acceptance.

## Shared contract

**Canvas.** 200 px = 1 grid square (matches `GRID_CELL_PX`). Piece tiles are cell
multiples: 1x1 = 200x200, 2x1 = 400x200, 3x1 = 600x200. PNG, RGBA, hard alpha
(no semi-transparent halo beyond anti-aliasing; content measured at alpha > 12).

**Footprint band.** Straights are a horizontal band that runs **edge to edge** (zero
horizontal padding — this is what makes runs tile seamlessly; never trim horizontally).
Vertical padding centers the band per the design table below. Every straight AND every
variant of a design shares the band y/h **exactly** — the renderer scales every band-less
piece against it (`referenceBandPx`).

**Padded pieces.** Connectors carry their own tight content box (independent of the band).
Corners, joints and endings ship full-tile with the pivot at tile center — their padding IS
the alignment pivot; never trim them.

**Variants.** 3 variants per straight length (A/B/C): same band footprint, different
stonework/grain, so long runs don't visibly repeat. Variant selection at render time is
position-seeded and deterministic; all three must butt cleanly against each other in any
order.

**Grey master + runtime tint.** One neutral master per design (chroma 0). The app tint is
multiplicative — it can only darken — so the master is painted **brighter than the source
kit** and tints pull it down to hue and value:

| Role | Master value | Note |
|---|---|---|
| Ink outline | #141414–#1E1E1E | stays dark under any tint |
| Deep recess | #303030 | crevices, under-beam shadow |
| Shadow | #8A8A8A | |
| Mid | #A0A0A0 | the tint anchor: tint x mid = source-kit mid |
| Light face | #B4B4B4 | |
| Highlight | #C8C8C8 | top-lit edges only |

Measured source value structure to preserve (luminance percentiles of the Earthy/Ashen
refs, for relative contrast only — masters sit ~1.6x brighter):

| Design | p25 | p50 | p75 | p95 |
|---|---|---|---|---|
| Fieldstone | #5B | #65 | #6C | #78 |
| Timber-Braced | #16 | #5A | #67 | #7C |
| Palisade | #42 | #59 | #60 | #73 |
| Curb | #42 | #6C | #7A | #8F |

**Outline weight.** Source ink measures a **3 px median** line at 200 px/cell. Target:
**1.5 px nominal (1–2 px range)** — half the source weight, per direction.

**Single master caveat (Timber-Braced).** Round 1 uses one master, so the wood bracing
takes the same tint as the stone. If tinted wood reads wrong at the table, round 2 splits
it into a two-region master. Do not solve this in round 1.

**Naming.** `GG_<Design>_<Piece>_<Size>_<Var>.png`, e.g. `GG_Fieldstone_Straight_3x1_B.png`,
`GG_FieldstoneCurb_Joint_T_1x1_A.png`. Pack-time ids derive from these; when the pack is
built, manifest ids and pack entry keys must stay in lock-step (the shipped stone-slate
set broke this — see `legacyAssetMapping.ts`).

## Band table (measured from source, alpha > 12)

| Design | Band h | Band y (in 200 cell) | Source ref |
|---|---|---|---|
| Rugged Fieldstone | 68 px | 66 | `Wall_Stone_Earthy_A_Straight_A_3x1.png` |
| Timber-Braced Stone | 62 px | 71 | `Wall_StoneWood_Earthy_Ashen_A_Straight_A_3x1.png` |
| Timber Palisade | 44 px | 78 | `Wall_Wood_Ashen_A_Straight_A_3x1.png` |
| Fieldstone Curb | 34 px | 83 | `Curb_Stone_Earthy_A_Straight_A_3x1.png` |

## Piece list — each wall design (x3: Fieldstone, TimberBraced, Palisade)

Walls ship the auto-placed roles plus broken endings. Joints and 2x2/3x3 showpiece
corners are deferred (the renderer never auto-places them).

| Piece | Tile | Content | Variants | Count |
|---|---|---|---|---|
| Straight_3x1 | 600x200 | 600 x band | A/B/C | 3 |
| Straight_2x1 | 400x200 | 400 x band | A/B/C | 3 |
| Straight_1x1 | 200x200 | 200 x band | A/B/C | 3 |
| Straight_Half | 200x200 | 100 x band, left-anchored | A/B/C | 3 |
| Connector | 200x200 | own tight box (~99 x band for stone) | A/B/C | 3 |
| Corner_1x1 | 200x200 | full tile, pivot center, authored 90° | A/B/C | 3 |
| Ending | 200x200 | full tile, cap art | A/B | 2 |
| Ending_Broken | 200x200 | full tile, ruined cap | A/B | 2 |

**22 pieces per design, 66 across the three walls.**

Shade/design references: Fieldstone → `Wall_Stone_A` Earthy (+ Slate as second tint
target); Timber-Braced → `Wall_StoneWood_A` Earthy_Ashen; Palisade → `Wall_Wood_A` Ashen.
Broken-ending refs: `Broken_Wall_Endings/Wall_Stone_Earthy_Broken_Ending_A*.png`,
`.../Wall_Wood_Ashen_Broken_Ending_A*.png` (invent the Timber-Braced one; no source exists).

## Piece list — Fieldstone Curb (full source taxonomy)

| Piece | Tile | Content | Variants | Count |
|---|---|---|---|---|
| Straight_3x1 / 2x1 / 1x1 / Half | as walls | 34 px band at y=83 | A/B/C each | 12 |
| Connector | 200x200 | own tight box (~99x32) | A/B/C | 3 |
| Connector_Diag | 200x200 | 45° stone | A/B | 2 |
| Corner_1x1 | 200x200 | full tile, pivot center | A/B/C | 3 |
| Corner_2x2 | 400x400 | L-shape, anchored like source | A | 1 |
| Corner_3x3 | 600x600 | L-shape showpiece | A | 1 |
| Joint_T | 200x200 | full tile | A/B | 2 |
| Joint_X | 200x200 | full tile | A | 1 |
| Ending | 200x200 | full tile cap | A/B | 2 |

**27 curb pieces.** Source ref: `Curb_Stone_A` Earthy. No broken curb endings (none exist
in source; not needed).

## Round 1 totals

93 pieces: 66 wall + 27 curb. Generation order: Fieldstone straights first (anchor
design, proves the band/tint/outline contract), then its remaining pieces, then curb,
then the other two designs.

## Acceptance checklist (per piece)

- [ ] Passes `docs/art-style-guide.md`
- [ ] Chroma ≈ 0 (neutral grey), values inside the master ramp
- [ ] Outline 1–2 px at 200 px/cell
- [ ] Straights: content box exactly matches the design's band (h and y), zero horizontal padding
- [ ] Straights: seam test — piece tiled against itself and against the other two variants shows no visible joint
- [ ] Padded pieces: full tile preserved, no trim
- [ ] Tint test: looks right under Earthy-, Slate-, and Moss-like tints (multiplied down)

## Deferred (not round 1)

- Chains/spikes coping accents (`Wall_Stone_L..O`)
- Wall joints and 2x2/3x3 wall corners
- Two-region master for Timber-Braced if single-master tint fails at the table
- Pack wiring (new `WallCategory`, `textureManifest.ts` entries, style-picker UI) — build
  phase, tracked in the workstream memory
