# Site rebuild plan — skill-first world rebuild, same nine beats

**Date:** 2026-08-13 · **Branch:** `dm-site` (worktree `.worktrees/dm-site`, clean at `2275020`)
**Governing skills:** `.claude/skills/site-diorama-geometry`, `site-surface-value`, `site-beat-conductor`
**Gates:** `docs/art-style-guide.md` (release gate), `site/art-brief.md` (per-beat pins, scoring order)
**Bar:** the $10k agency site. The site is not a forge showcase — forge stays the product's tile factory.

## What this is and is not

Rebuild the *world* of the landing page — geometry, surfaces, and the conductor that drives them —
using the three site skills as the method. The nine beats, their copy intent, the camera story, the
loader, the waitlist form, and the DOM shell all **stay**. Nothing in `App.tsx`'s beat order changes.

Not in scope: re-authoring the story as chapters (declined), mobile scrubbed-sequence hero (open
follow-up, separate decision), seam (deleted 2026-08-08; if it returns it is carved into the scene,
not a DOM overlay), sound.

## Why this order

Structure before surfaces before pictures. The two structural refactors (P1, P2) delete the machinery
every later beat-pass would otherwise have to touch twice — the `if (i === N)` chain and the
`inkT`/`riseT` tween graph are exactly where "content leaking backwards" defects breed. Surfaces (P3)
swap under a stable structure. Only then is a per-beat picture pass (P4) worth judging, and the gate
(P5) is the art brief's own scoring order.

---

## P0 — Baseline evidence (half a day)

Before touching anything, capture the thing we are trying to beat.

- One PNG per beat at 1440×900 **and** dpr 1.25 (browser capture protocol from the workstream notes:
  foreground the window, verify rAF alive, PNG not JPEG — JPEG hides ~30-level steps in the darks).
- Perf baseline: p50/p95 frame time on a full forward+reverse walk, draw calls and triangles per beat
  (`renderer.info`), doc height, transfer size.
- Fix-or-file the **init flake** first (scroll rig sometimes never inits until a synthetic `resize`;
  known, diagnosed as real-user risk). It corrupts every later verification round if left in.

Acceptance: a `art-shots/rebuild-baseline/` folder and one numbers table. Every later phase diffs
against this.

## P1 — Conductor: beat ledger (1–2 days)

Per `site-beat-conductor`. Pure refactor — **zero intended pixel change**, verified by diffing P0
captures.

1. Introduce `site/src/scene/beats.ts`: one row per beat — `id`, `beat` (what the viewer
   understands), `landmark`, `change`, `camera` (folding `CAMERA_KEYFRAMES` in), `window`
   (re-windowing, e.g. clockT's `[0.3, 1]`, swapT's `[0, 0.45]`), `copy` key, `active` flag,
   `owns` (channels nothing else may touch).
2. `ScrollCamera` collapses its `if (i === N)` chain into a generic driver over the ledger. The
   `onEnter/onLeave/onEnterBack/onLeaveBack` symmetry becomes mechanical instead of hand-maintained.
3. Keep exact-only progress (no damped layer — Lenis already smooths upstream; beat gating stays on
   exact by construction).
4. Keep: quaternion camera authoring, the `(w−GAP_PX)/h` viewport solve, copy fade constants
   (0.05/0.20 in, 0.80/0.95 out against own pin tail), reduced-motion IntersectionObserver snap,
   collapsed pin spacers. All of these are settled and measured; the ledger *hosts* them, it does not
   re-derive them.

Acceptance: pixel-diff vs P0 within capture noise at all nine pins, both scroll directions; the
ledger is the only place a beat's contract lives; `tsc` + build green.

## P2 — Geometry: clip-plane reveal + builder vocabulary (2–3 days)

Per `site-diorama-geometry`.

**2a. The clip-plane build (beats 1–2).** Replace the per-mesh `inkT`/`riseT` tween state with one
rising `THREE.Plane` all structural materials clip against:

- Everything exists from frame one. `CLIP.constant = heightAt(beatProgress)` is the only animation.
- Cap mesh at the plane's height, per-plan (our rectilinear two-room plan → rectangular caps per
  room footprint), rebuilt as the plane crosses declared section changes.
- **The DM's ink drawing is the scaffolding**: the beat-1 stroke-drawn plan (already built — the
  per-polyline draw reveal) ignores the plane and stands above the line, always one step ahead of
  the risen walls. Beat 1 = plane at 0, ink drawing in. Beat 2 = plane rises, torches ignite on
  cross. This is the product argument as a mechanism.
- Set `clippingPlanes` once on the shared materials (not per mesh) — program-cache fragmentation is
  a compile stall mid-scroll.
- Delete: `inkT`/`riseT` per-mesh scale machinery in `Diorama` (the ink *drawing* itself stays; its
  reveal already works). `Outline` children inherit the clip via shared materials.

**2b. Builder vocabulary + props.** Add `prismN`, `sweepPlan`, `lathe`, `tube` to `geometry.ts`
(shared-array appenders, merged by material). Rebuild with them:

- braziers (`prismN`), dice + mug (`lathe`/box with world-unit UVs), chair, door hinges + straps
  (`tube`), plaque + door frame moulding (beat 8), table edge profile.
- Wall-top lips per the brief (thin lighter cap so extrusion reads; sides stay ink).
- **SWAP_MAP silhouette pass**: beat 6's contract requires a visibly different room arrangement;
  redesign its footprint until the two greyscale thumbnails are unmistakably different maps.
- Fix flat-red doors while in here (pull to wood ramp — open follow-up).

Budget: ≤90 draw calls, ≤600k triangles any beat, DPR 1.5 clamp. Winding checked by a below-horizon
orbit in a dev scene before anything stacks on top.

Acceptance: beats 0–2 scrub clean forward/reverse with the plane (no leak-backwards possible by
construction); greyscale thumbnails of all 9 beats each identifiable; draw calls within budget and
no beat >1.5× its neighbours; skill checklists pass.

## P3 — Surfaces: the painted set (2–3 days + generation time)

Per `site-surface-value`. This is the phase that kills "procedural bakes are boilerplate."

**3a. The set.** ~14 surfaces, sized against the nine authored camera framings (not the product's
200px/cell): stone floor (8-cell meta-tile, etched grid, per-tile variation, moss flecks), wall face,
wall cap/lip, door wood + plan-view door top (normal/secret), table wood (radial lamp pool from
`LAMP_WORLD`), parchment sheet, iron/brazier, plaque, dice pips, mug glaze, torn-border ink.

**3b. Pipeline.** generate → seam-heal (half-offset cross-fade, searched roll offset) → derive
normal+AO from the colour map's own luminance (`deriveReliefMaps` survives) → sweep resolution ×
WebP quality scoring **luma and gradient error**, ship the knee → separate preloaded WebP files
(never data URIs — SSR prerender). `.map`-only onto `MeshBasicMaterial` (the bundle-spread crash).
`cached()` keying survives. Palette contract enforced at generation prompts *and* at eyedropper.

**3c. What stays authored in code:** the value system (unlit + tint lerps + night multiplies), the
one PostFX transfer curve, torch-pool sizing and clipping, additive-layer arithmetic. Textures
replace *albedo painting*, not the value chain — the chain is calibrated and stays.

Sourcing (D1, resolved 2026-08-13): **GPT Image 2 via the ChatGPT free tier** — the same generator
the towers study used for its texture set. No free API exists, so this is a handoff loop: a prompt
kit (one prompt per surface, derived from the art-style-guide's stone-interior rules + the palette
contract, flat-lay/top-down/matte/no-baked-directional-shadow constraints spelled out per prompt) is
authored here; the user generates on the free tier and drops raw outputs into
`site/art-src/raw/`; everything downstream — seam-heal, relief derivation, knee measurement,
eyedropper gate — runs locally and automated. A tile failing the gate gets a revised prompt and a
regeneration; **the quality gate does not bend to the source** ("no quality failures" is the user's
own condition). Free-tier daily caps mean the set fills over 2–3 days — P3's code work (pipeline,
material wiring) proceeds in parallel against the first accepted tiles. Zero product pack assets,
zero FA-derived pixels (licensing constraint stands).

Acceptance: eyedropper pins from `site-surface-value`'s checklist (wall < floor beside it; beat-5
night hexes; beat-7 table luminance ~3×; no `#B6D648` on any surface); repeat period ≥ frame width
at closest camera (no wallpaper); decoded texture memory ≤ 96MB; knee measurements recorded in the
phase doc.

## P4 — Per-beat picture pass (2–3 days)

Now, and only now, judge pictures. Work the art brief's scoring order, one contained round per item,
each with measured acceptance from the brief's own pins:

1. **Value inversion** — verify it *held* through P2/P3 (it is currently fixed; this is regression
   proof, not new work).
2. **Beat 3** wedge + darkness: hard-edged visibility polygon (≤2px falloff), token ink outline +
   sight ring, 70% darkness, wall-corner shadow spike in frame.
3. **Beat 5** blue night: full-night hexes land; rain = instanced streaks, 112°, `rgb(190 210 235)`
   ~5–8%, map-footprint only (already close — verify against the new surfaces).
4. **Beat 4** pane difference: obviously-different maps, badge + dashed secret break, player pane
   ≥50% darkness. The split render mechanics are signed off — this is content, not plumbing.
5. **Beat 7** table: plank seams, lamp pool, dice/mug/room-glow present, luminance target. Fix the
   too-dark table here (open follow-up).
6. **Outline + grid seams everywhere** (largely free from P2/P3 — verify).
7. **Beat 0/1 staging discipline**: pre-dawn really empty, ink stroke `#5a5d50` not green-white.
8. **Beat 8** stage glow, hinge straps, torch rim, door grade.

Plus the small open follow-ups that fit where they land: scrub-widget legibility at full night
(extend the sheet inset), delete the dead `swapRiseLightRef` pointLight, THREE deprecation warnings
if the version bump is free.

Acceptance: each item closed on *measured* evidence (PNG grids, projection math, eyedropper values)
— not screenshots eyeballed. Fixer claims are re-verified; the fixer-over-claims lesson is standing.

## P5 — Gate (1 day)

The full QA matrix from `site-beat-conductor` + the repo's own sprint-exit rule:

- All 9 beats × {1440×900, 1280×800, ~1200×900 short window} × {slow fwd, slow rev, fast flick,
  scrollbar drag, reload mid-beat, resize between endpoints, hidden-tab 10s}.
- **dpr 1.25 asserted as well as dpr 1** (permanent rule — 11 rounds once missed a site-breaking
  dpr bug).
- Reduced-motion pass, no-JS prerender sanity, 390px DOM story readable, footer reachable.
- Perf vs P0 baseline: p95 ≤ 17ms, doc height unchanged, zero console errors, zero failed requests.
- Docker-deployed walk in the browser per sprint-verification convention.
- Loader retests owed from its own verification: reduced-motion + no-JS live.

Deliverable: gate report in `docs/`, before/after beat strip, numbers table. Ship decision is the
user's.

---

## Decisions (resolved 2026-08-13)

- **D1 — Texture source:** GPT Image 2 via the ChatGPT free tier (towers' own generator), prompt-kit
  handoff loop, hard quality gate regardless of source. Details in P3a/P3b.
- **D2 — Clip-plane reveal:** yes — replace `inkT`/`riseT` machinery (P2a as written).
- **D3 — Beat-5 atmosphere:** rain only, per the brief. No storm/lightning/snow.

## Routing and process

Per the workstream's standing overrides: Fable plans/adjudicates, Sonnet executes/verifies, Opus
reviews (impeccable guide on UI passes); no Haiku. Contained workflows, ≤5 agents per step, disjoint
file scopes, agents never commit. One browser-walking crew at a time (tab-contention lesson). Every
verify round: PNG + measured grids + dpr 1.25; approach measurement targets from outside converged
scroll ranges (`frameloop="demand"` dead zones).

Estimated wall-clock: ~8–11 working days of rounds. P1 and P2b can overlap (disjoint files); P2a
blocks P4 beats 1–2; P3 blocks P4 entirely. **The P3 prompt kit is authored during P0** so the
free-tier generation trickle starts on day one and the set is filled by the time P3's code needs it.
