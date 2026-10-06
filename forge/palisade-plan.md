# Timber Palisade — Master-Strip Plan

Executes the brief's Stage 5 for the Wood design. Everything reuses the locked Fieldstone
recipe and tooling; only band constants, prompt, and arm strips change.

## Design read (from `Wall_Wood_A` Ashen refs)

Two stacked long timber planks running the wall's length, dark seam between them,
**staggered butt joints** (top row and bottom row joint at different x — this is the
in-piece texture, unlike Fieldstone's single slab). Smooth painted grain along the length.
Source corners are 45° picture-frame miters — identical to what compose-pad already
produces, so padded pieces are native to this design.

Source ink 3px → target 1.5px, same as Fieldstone. Value ref: Palisade p50 #59
(brief table); master painted ~1.6x brighter, mid anchor #A0, chroma 0.

## Constants

- Band **44 px at y=78** (vs Fieldstone 68@66). Working strip 1536×400 → content rows ≈ 88px.
- Recipe: grey template v2 (contrast stretch + thin=1), **d0.70, 28 steps dpmpp_2m/karras
  cfg 6.5, wrapblend 80** — confirmed at P2 gate before the full sweep.
- Piece scope: **parity with shipped Fieldstone (29 pieces)** — straights 3x1/2x1/1x1/half
  × A/B/C, Path, connectors A/B, DIAG, corners A–H, joints A–D, ending. Broken endings
  stay deferred (Fieldstone shipped without them).
- Arc radii for curved corners recomputed from band 44@78: E(200,200) r78–122,
  F(400,400) r178–222, G(400,400) r278–322, H(600,600) r378–422 — verify against source
  before composing.

## Stages

**P1 — templates + prompt (no GPU).** prep-template v2 over `Wall_Wood_Ashen_A_Straight_A_3x1`
(re-measure stretch percentiles on the wood ref — don't reuse stone's p5/p95). Write
`prompt-palisade.txt`: two stacked long planks, staggered butts, painted grain, no stone
vocabulary; negative gets masonry/stone/brick. Band consts 44@78 into check/lib call sites.

**P2 — recipe confirmation, USER GATE (quick).** Micro-sweep on Straight 3x1:
d{0.65, 0.70} × seeds {22, 555} = 4 strips (~30–70 min). Wood ≠ stone; confirm the locked
recipe holds grain + joints before burning the full sweep. Gate page beside source ref.

**P3 — straights, USER GATE.** Winning recipe × 6 seeds → pick 3 for 3x1. 2x1/1x1/half
**cut from 2 fresh cut-source strips** (cut-piece.mjs — SDXL can't paint short strips, and
the 44px band is thinner than Fieldstone's, so no native small-strip attempts at all).
Wrapblend 80/64/40/24 by width. Cross-variant seam matrix A|B, B|C, C|A.
Plank-butt caveat: cuts must not land mid-butt-joint in a way that leaves a sliver —
eyeball each cut window (machine gate can't see style drift; standing lesson).

**P4 — padded pieces, USER GATE.** compose-pad.mjs with palisade band consts + fresh arm
strips; miter tie is the source's own corner look. Path via compose-path. check-pad
(--maxink for arcs as before), demo-assembly run, gate page.

**P5 — package.** pack-fieldstone.mjs generalized (or thin clone `pack-palisade.mjs`) →
`forge/dist/GG_Palisade/` (29 PNGs + manifest, band 44@78, grid 200, grey masters).
**Wiring is out of scope** — the fieldstone-wall-set branch isn't merged yet; palisade
wiring stacks after it ships (WallCategory 'palisade', manifest arrays, preset with Ashen
tint, explicit legacy mapping — never stem derivation).

## Risks

- **Thin band**: 88 content rows ≈ 11 latent rows. Wood grain is simpler than stonework so
  it may hold; if P2 shows mush, regenerate at 600-tall working canvas (band → 132px) and
  downscale — template change only, recipe unchanged.
- **Stone drift**: the checkpoint spent two rounds wanting fitted stones; negative prompt
  carries the full masonry block list from round 1.
- ComfyUI is down (killed 2026-08-07 for VRAM) — relaunch with the three mandatory flags
  including `--disable-dynamic-vram`.

Budget: ~12–14 strips total (4 P2 + 6 sweep + 2 cutsrc + spares) ≈ 1.5–4 h GPU depending
on VRAM pressure. Cleanup rule applies: rejected candidates deleted from forge/staging AND
D:\ComfyUI\output immediately after each gate.
