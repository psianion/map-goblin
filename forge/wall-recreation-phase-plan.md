# Wall Recreation — ComfyUI Trial Phase Plan

Executes `wall-recreation-brief.md`. Accuracy over speed throughout: small batches, every
candidate machine-verified before human review, hard user gates between stages.

## Why this approach is different from the two rejected ones

Both 2026-08-06 rejections failed on structure: txt2img held the style but not the
footprint; the cut-from-sheet approach produced non-interchangeable pieces. This phase
inverts the problem — **structure comes from the source kit, style comes from generation**:

1. Each source piece (known-good footprint, measured in the brief) becomes an img2img
   template: flattened onto neutral ground, ink pre-thinned, fed to SDXL at moderate-high
   denoise so the painted surface is new but the silhouette stays anchored.
2. The **source alpha is reused verbatim** as the output alpha. Footprint accuracy is
   therefore exact by construction — the diffusion model never gets a vote on the band.
3. A deterministic post-process (script, not model) does the rest: desaturate to the grey
   master ramp, value-normalize, apply source alpha, then machine-check band / seams /
   outline / chroma before a human ever looks.

No ControlNet needed (none installed; 4 GB VRAM makes SDXL+ControlNet marginal anyway).
img2img needs nothing we don't already have.

**Originality note.** At low denoise the output is a restyled copy of the source art; at
high denoise the footprint anchor weakens. Default is denoise ≥ 0.60 so the painted
surface is genuinely new work and the source contributes geometry only — the trial sweep
(Stage 2) finds the floor where structure still holds. If the floor lands uncomfortably
low, fallback is edge-map templates (source reduced to thin structural lines on grey, no
surface pixels), which costs more iterations but severs surface derivation entirely.

## Fixed parameters (from memory, do not re-derive)

- Launch: `D:\ComfyUI\.venv\Scripts\python.exe D:\ComfyUI\main.py --disable-cuda-malloc
  --fp8_e4m3fn-unet --disable-dynamic-vram` (last flag mandatory; aimdo hooks crash this card)
- `batch_size: 1` always; one job file per candidate; pin seeds when iterating prompts
- Full 28-step base model sampling, not the Lightning LoRA — accuracy phase, and strips
  are cheap (~90 s per 768×256 image at 9.3 s/it-equivalent)
- Working sizes: 3x1 strip 768×256 → downscale to 600×200; 1x1 tiles 256×256 native or
  512×512 → half (trial decides); 2x2/3x3 curb corners later at 512/768 square
- Staging: candidates land in `forge/staging/`, mirrored from `D:\ComfyUI\output`.
  Rejected candidates are deleted immediately from BOTH (standing rule).

## Tooling to build (Stage 1, all in `forge/`)

| File | What |
|---|---|
| `workflows/img2img.json` | SDXL img2img graph: load template PNG → VAE encode → KSampler (denoise param) → decode → save. Parameterized: template path, prompt, seed, denoise, size |
| `prep-template.mjs` | Source PNG → template: composite onto mid-grey, erode ink lines toward 1.5 px target, optional 64 px circular horizontal pad for straights (seam context), resize to working size |
| `post.mjs` | Raw output → candidate: crop pad, downscale, desaturate, value-map to master ramp, apply source alpha |
| `check.mjs` | The acceptance gate: content-box vs brief band (exact h/y), horizontal edge-to-edge, outline median 1–2 px, chroma ≈ 0, seam test (self-tile + cross-variant tile, edge-difference metric). Emits pass/fail table per candidate |
| `run-job.mjs` | Drive ComfyUI over HTTP (`COMFY_URL`, default 127.0.0.1:8188), poll, collect |
| `review.html` | Contact sheet per round: candidates tiled as runs, under Earthy/Slate/Moss tints, beside source ref. What the user actually reviews |

All scripts use the workspace `sharp` (already proven for measurement).

## Stages and gates

**Stage 1 — infra.** Build the six tools above. Smoke-test: launch ComfyUI with the three
flags, run one throwaway img2img, confirm `check.mjs` correctly FAILS a raw source piece
on outline (3 px) and PASSES its band. No user gate; report results.

**Stage 2 — contract trial (the phase's core).** One piece only: Fieldstone Straight_3x1.
Sweep denoise {0.55, 0.65, 0.75} × 2 seeds = 6 candidates, ~15 min GPU. Post-process,
machine-check, build the review sheet. **USER GATE:** pick the winning recipe or redirect.
Iterate the sweep (prompt wording, ink pre-thinning strength, pad size) until one recipe
passes all checks AND the user likes the paint. This stage is allowed to take multiple
rounds — it locks the recipe everything else reuses.

**Stage 3 — Fieldstone straights.** Locked recipe × 12 straight pieces (4 lengths × A/B/C
variants via seeds), 2 candidates each → best-of per piece by `check.mjs`, then one review
sheet. Cross-variant seam matrix must pass (A|B, B|C, C|A). **USER GATE.**

**Stage 4 — Fieldstone padded pieces.** Connectors, corners, endings, broken endings
(templates keep full tile + center pivot; no seam checks, band-scale check instead).
**USER GATE**, then Fieldstone curb (27 pieces, full taxonomy incl. joints/diagonals/big
corners — big corners are the riskiest templates, budget extra rounds). **USER GATE.**

**Stage 5 — Timber-Braced Stone, then Timber Palisade.** Same recipe, per-design prompt
and band values from the brief. One combined review sheet per design. **USER GATE each.**

**Stage 6 — handoff.** Accepted masters + a manifest-ready inventory (piece, file, band,
content box) written to `forge/staging/accepted/`. Pack wiring is explicitly out of scope
for this phase (tracked in workstream memory: WallCategory, textureManifest, style picker).

## Budget honesty

93 pieces × ~2 candidates × ~90 s–4.5 min each ≈ 6–15 GPU-hours spread across stages,
plus trial rounds in Stage 2. Slow is accepted; if it drags, `COMFY_URL` can point at a
rented pod with zero code change — decision deferred until Stage 3 has real timings.

## Failure lines (pre-agreed, so trials don't wander)

- Recipe can't hold structure at denoise ≥ 0.60 after 3 Stage-2 rounds → switch to
  edge-map templates before burning more rounds.
- Ink pre-thinning can't reach 1–2 px without artifacts → generate thick-ink, thin in
  post via morphological pass on the ink mask (check.mjs verifies either way).
- 4 GB VRAM chokes on 768-square curb corners → generate at 512 and upscale, or rent.
