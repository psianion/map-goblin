# Background texture critique — Good Goblin landing page (D2 "lit table")

**Date:** 2026-08-08 · **Scope:** the rendered material world only (table wood, parchment sheet, diorama floors/walls/props, night states, DOM light/grain layers, cohesion). Copy and the seam are other crews' scope; seam notes in the appendix only.

⚠️ DEGRADED: single-context (the prescribed method — UIA tab foregrounding, lenis-driven beat walk, OS-level PNG capture at dpr 1.25 — required hands-on control in this agent's own context; the deterministic detector still ran, findings below). Method: Assessment A (design review + browser walk) and Assessment B (detect.mjs) both executed, sequentially, in this context.

**Build under test:** `site/` local `npm run build` + `vite preview` (port 4199), commit state of branch `landing-page` on 2026-08-08.
**Comparison reference:** `docs/landing-mockups/2026-08-07-direction-board.html` D2 frames (served over http, port 4198), `docs/art-style-guide.md` (release gate), impeccable brand-register criteria.
**Capture set:** all 9 pinned beats at dpr 1 (viewport 1920×815, MCP capture 1568×665 JPEG) + native-res PNG at dpr 1.25 (OS-level capture, 1920×1080 monitor) for the hero and full-night states + 5× region zooms per texture family. Coordinates below refer to those captures.

**Capture-tooling note for future crews:** MCP tab screenshots return flat parchment-colored frames when Chrome page zoom ≠ 100% — the page itself renders correctly (verified via OS-level PNG, `scratchpad/dpr125-hero3.png` / `dpr125-night.png`). Do not diagnose a dpr rendering bug from MCP captures at 125%. At dpr 1.25 the real render shows **no new aliasing, no grain moiré, no texture degradation** vs dpr 1.

---

## Design health score

Scored page-wide with the texture lens; heuristics with no meaningful surface on a scroll-story landing page are marked (n/a-lean) and scored on what little applies.

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 3 | Clock slider + beat states read clearly; night progress legible |
| 2 | Match system / real world | 2 | The physical-table metaphor breaks where materials go synthetic: decal-flat sheet edge, sawtooth "torn" fringe, stripe-wallpaper wood |
| 3 | User control and freedom | 3 | Scroll scrubs both directions; slider works |
| 4 | Consistency and standards | 2 | Night value inversion contradicts the ink doctrine; CSS lamp disagrees with canvas night; door-top parity nit |
| 5 | Error prevention | 3 | (n/a-lean) single form, low stakes |
| 6 | Recognition rather than recall | 3 | Map vocabulary (doors, torches, fog) self-evident |
| 7 | Flexibility and efficiency | 2 | Scroll-only pacing; acceptable for the register |
| 8 | Aesthetic and minimalist design | 3 | One focal per beat mostly held; restrained chrome |
| 9 | Error recovery | 3 | (n/a-lean) |
| 10 | Help and documentation | 2 | (n/a for a landing page) |
| **Total** | | **26/40** | **Acceptable — the map world is close to Good; the shell around it drags** |

---

## Findings

### P0-1 · Night wall value inversion — the ink becomes the glow
- **Texture/file:** `WALL_NIGHT_TINT = (11.83, 15.82, 43.82)` in `site/src/scene/Diorama.tsx` (~line 179), applied to `getWallTexture(WALL_TINT)` slabs + caps.
- **Evidence:** beat 5 full night (scroll 9300 dpr 1; `dpr125-night.png` native PNG). Walls render pale silver-lilac and are the **brightest surface on the map after the torch pools** — brighter than floor, sheet, and props. Dusk (scroll 8700) already shows the flip mid-lerp.
- **Why it misses:** D2's own doctrine is "dark ink walls carrying the read"; style-guide rule 3 (walls = thick dark strokes) and rule 4's night palette ("desaturated night ambient, low contrast") both invert. The board comparison is diagnostic: the board's D2 night frame uses this same pale blue-lilac — **as 2–3px strokes**. The site applies that stroke value to 0.3–0.5-grid-unit 3D slabs plus caps, turning delicate moonlit ink into glowing architecture. A value spec authored for line weight was transplanted onto slab geometry. The ×11–44 multiplier ratio is the mechanism (a ratio computed to lift near-black to pale blue lifts *everything* it touches to pale blue).
- **Fix direction:** keep wall **side faces** in dark ink at night (small multiplier, stay the darkest note) and let only the **cap lip and/or the Outline stroke** take the moonlit #9aa3bd family — that reproduces the board's thin-stroke read on slab geometry. Floor/wall night contrast target: walls slightly *darker* than the moonlit floor, caps slightly lighter.

### P1-2 · Torch pools bleed through walls
- **Texture/file:** `getTorchGlowTexture()` pool planes (`TORCH_POOL_SIZE = 3` in `Diorama.tsx`), plus `composition.tsx` PoolBoosts.
- **Evidence:** `dpr125-night.png` — the top-center pool crosses the north wall and washes the torn fringe + sheet beyond it; the east-room pool crosses the right wall band; bottom-right pool sits half outside its room. Day: beat 6 (scroll 10700) shows a stray amber blotch on the swap room's east wall interior edge (~890,390 in the 1568-wide capture).
- **Why it misses:** the page's positioning line is "torches carry exactly as far as you placed them" and "fog of war that reads your walls" — the background art contradicts the sales pitch in the same viewport. Style-guide rule 5 puts glows *in the ground art*; a glow crossing an authored wall is exactly what the D2 fix round (finding 4) tried to kill and didn't finish.
- **Fix direction:** clip pool quads to their room polygon (pre-split the plane geometry against the wall graph at build time — cheap, static), or bake pools directly into each room's floor texture region. The dynamic point lights already respect distance; only the baked decals leak.

### P1-3 · Table wood has no grain — stripe wallpaper at every distance
- **Texture/file:** `getTableWoodTexture()` / `paintTableWoodRadial()` in `site/src/scene/textures.ts` (1024px, radial ramp + 32 ruled seams + 11k speckle px).
- **Evidence:** beat 0 zoom (region 60,40–560,420): flat brown field, dead-straight uniform seams, near-invisible speckle. Beat 7 oblique: planks read as continuous full-length boards, zero joints. Beat 8 (closest camera, the conversion beat): the page's largest surface is flat gradient + sparse 1–2px dots. Same story at dpr 1.25 native res.
- **Why it misses:** style-guide rule 4 ("wood interior: warm mid-browns, **plank direction visible**" — via grain, not just ruled seams) and rule 6 ("texture everywhere"). Impeccable's brand bar: this is the "material stated, not painted" shortcut — the single strongest AI-made tell on the page. The board's own `.d2 .stage` recipe is the same CSS stripe gradient — i.e. the site faithfully reproduced a *mockup's placeholder wood* instead of elevating it to production material. The mockup was the floor, not the ceiling.
- **Fix direction:** stay in the baked-canvas system, add three cheap layers: (1) per-plank tonal offset (fill each seam-bounded strip with base ±4–8), (2) low-contrast longitudinal grain streaks (a few dozen 1px wavy strokes per plank, same family, alpha ≤0.06), (3) staggered butt joints (break each plank column 1–2× with a horizontal seam, offset per column). Optional single knot far from copy. Keep the radial lamp ramp untouched.

### P1-4 · The "torn" fringe is a pinking-shears stamp
- **Texture/file:** the wall-perimeter fringe geometry/decal (Diorama wall dressing; visible wherever walls meet the sheet).
- **Evidence:** beat 4 zoom (region 520,320–790,480): uniform, same-size, same-angle brown triangles in a regular row. Beat 5 night: the brown teeth sit against pale walls and read as rust trim. Beat 7 oblique: fringe pieces hang past the skirt edge like cardboard shims under the diorama box.
- **Why it misses:** style-guide rule 5's negative-space treatment calls for a *torn rock edge* — an organic, irregular silhouette. A perfectly periodic sawtooth is the machine version of "torn"; under the "hand-made warmth" gate it reads as a laser-cut craft supply. It also violates rule 7's "nothing perfectly straight except built stone" in spirit — this is perfectly *periodic* chaos.
- **Fix direction:** noise-drive the tear (vary tooth width, depth, and angle per vertex; occasional double-tear), pull the fill toward the ink/sheet family rather than mid-brown, and keep the silhouette inside the skirt line at beat 7. Give it a night tint ride so it doesn't stay warm brown against moonlit walls.

### P2-5 · Sheet reads as a decal, not paper on a table
- **Texture/file:** `getSheetTexture()` + `getSheetShadowTexture()` (textures.ts), sheet meshes in `TableScene.tsx`.
- **Evidence:** beat 0 zoom (region 620,180–1090,490): the baked shadow is a symmetric 4-side vignette band — a picture-frame, including a full-strength band on the *lamp-facing* top edge. Beats 7–8: the sheet's near edge is a hard cut line with no thickness, no lit edge, no curl; the sheet reads grey-white, well off the board's warm #efe7d1→#d9cdab.
- **Why it misses:** the board recipe is `box-shadow: 0 14px 34px` — an *offset* shadow agreeing with the 26%/12% lamp; the bake dropped the offset, so the two light stories disagree at the sheet's own grounding. The greyness is the F9 triple-darkening residue (stage-lamp outer stop × PostFX vignette × roomGlow) still costing warmth at pull-back distances. "Deliberate flatness" is a defensible choice for the sheet body; an undirected shadow and a cold cast are not.
- **Fix direction:** bias the baked shadow band toward +z/+x (away from the lamp) and nearly zero it on the lamp side; add a 1px warm lit strip on the sheet's lamp-facing edges (paper thickness); recover warmth at distance by easing whichever of the three darkeners is cheapest to touch (stage-lamp outer stop already went 0.34→0.15; the remaining cold is mostly PostFX + roomGlow interaction).

### P2-6 · Day torch pools don't sit on their sources
- **Evidence:** hero beat (dpr 1 and the native `dpr125-hero3.png`): the NE brazier (~1262,353 native) has **no pool at all** — uniform cream floor right up to its rim — while a warm wash floats near the top-left wall with no visible source. Beat 3: the pool reads offset from its brazier (pool centroid left of the prop).
- **Why it misses:** style-guide rule 5 — *every* light source gets a baked warm pool. A pool-less brazier reads unlit by day; a sourceless wash reads like a rendering mistake. The night state proves the pools exist and are placed near — but not on — the props.
- **Fix direction:** audit pool-plane positions against torch/brazier prop positions (they look keyed to authored torch coordinates, not to where the visible prop meshes sit); every brazier prop should own a pool, even a faint day one.

### P2-7 · Torch pool inner ring (banding)
- **Texture/file:** `getTorchGlowTexture()` stops 0.42 / 0.24@0.35 / 0.24@0.5 / 0@1.
- **Evidence:** night captures — each pool shows a readable soft-edged inner disc where the 0.35–0.5 plateau ends (clearest on the east-room pool, `dpr125-night.png` ~1180,420).
- **Why it misses:** the D2 fix round pulled the plateau in but kept a flat shelf; a shelf always draws a rim. "Soft radial warm glow" (rule 5) means monotonic falloff.
- **Fix direction:** replace the plateau with a continuously decreasing curve (e.g. stops 0.42/0.30/0.16/0), or dither the two mid stops.

### P2-8 · Moss reads as smudge, not lichen
- **Texture/file:** `paintMoss()` in textures.ts — 6 soft arcs, one flat hue, alpha 0.1–0.22.
- **Evidence:** hero zoom (region 560,230–1060,560) and the grain A/B zooms: each moss cluster is 2–4 featureless grey-green blobs; at reading distance they scan as mildew stains or fingerprints on the parchment.
- **Why it misses:** the board pins that legitimize moss (Mystveil "moss as only color", Xibalba moss floors) give moss internal structure — clustered flecks, value range, edge accents. Rule 6 wants texture, not tint-blur. Density and restraint are right; the mark itself is unfinished.
- **Fix direction:** compose each cluster from 8–14 smaller flecks with two values (darker core + lighter rim, same hue family) and an occasional 1px ink tick; keep current placement odds.

### P2-9 · The CSS lamp never goes down — two light stories at night
- **Texture/file:** `.stage-lamp` (global.css:102) — static radial at 26%/12%, 0.32 warm core.
- **Evidence:** `dpr125-night.png`: the left wood margin glows warm rust from the DOM gradient while the canvas world is moonlit blue. The board's own night-frame copy: "**The lamp goes down with the sun.**"
- **Why it misses:** the baked-value doctrine keeps day/night agreement inside the canvas (table/sheet/fog all lerp by nightT) — the one light layer outside the canvas was left out of the story. Consistency (heuristic 4) and the board text itself.
- **Fix direction:** expose nightT to the DOM (CSS var written from `sceneProgress` once per frame or per beat) and fade `.stage-lamp` opacity toward ~0.05 cool over beat 5; restore on the beat-6 swap like the canvas does.

### P3-10 · Mid-fade x-ray props
- **Evidence:** beat 2 dpr 1 mid-scrub: crates render as translucent overlapping faces (ghost boxes). Settled states are solid (confirmed in `dpr125-hero3.png`).
- **Why:** `transparent + depthWrite:false` during kitT/beat fades shows both faces of each box. Transient, but scrubbing is the primary interaction on this page.
- **Fix direction:** flip `depthWrite` on when opacity ≥ ~0.95, or fade via dithered alpha.

### P3-11 · Brazier plan view reads as a target
- **Evidence:** hero captures — concentric grey ring / dark ring / amber dot. The F4 rim inset helps but the vessel read is still weak at nadir.
- **Fix direction:** break the rim's rotational symmetry (a lip highlight arc on the lamp side, two handle nubs, or ember texture in the bowl).

### P3-12 · Swap-map door top parity
- **Evidence:** beat 6 — the swap room's south door reads as a dark slab; main-map doors read bright `PROP_WOOD` plan-view tops with seam + studs.
- **Fix direction:** confirm the swap map's doors route through `getDoorTopTexture` with the same tints.

### P3-13 · Dice and mug die at pull-back distance
- **Evidence:** beat 7 — the red/blue dice are black specks, the mug a black blob; their albedo never survives the toon shadow band at that distance.
- **Fix direction:** lift the dice/mug base values or give them the unlit-baked treatment the rest of the tabletop got; set dressing, lowest priority.

---

## What already clears the bar (don't churn these)

1. **The floor system.** Per-cell tonal nudge + etched terrain-tinted grid (alpha 0.14 dark-ink on light stone) + edge wear is genuinely per style-guide rules 2 and 6: the grid disappears at a glance, reappears on inspection; cells read individually cut. **No wallpaper repetition was visible at any captured framing or dpr** — the 8-cell meta-tile fix did its job (residual note: the 16-cell map width means a 2× horizontal period is still theoretically present; nothing in the captures betrays it).
2. **The `.grain` overlay.** A/B toggle at hero zoom proves it supplies most of the perceived paper tooth; without it the tiles go sterile. No moiré or seam at dpr 1 or 1.25. Keep exactly as is.
3. **Night floor + pools color story.** "Torch pools holding warm against the blue" lands — the amber-on-slate contrast at 23:40 matches the board's night frame mood, and the floor survives its multiply tint without going muddy.
4. **Secret-door dressing.** The plan-view door top (center seam, studs, S badge) plus the amber light shaft is the richest texture moment on the page and reads perfectly at nadir.
5. **Swap-map texture parity.** Beat 6's room is unmistakably the same material world — same floor, ink, grid, moss, fringe (for better and worse).
6. **Matte discipline.** Not one specular highlight anywhere; the unlit-baked doctrine successfully holds the photorealism ban and keeps everything in one exposure.

## Deterministic scan (Assessment B)

`detect.mjs --json site/src`: **1 finding** — `layout-transition` warning, `transition: width` at `site/src/styles/global.css:743` (seam layer's territory; appendix). No slop-pattern hits in markup/CSS; the texture work is canvas-baked and outside the detector's reach, as expected. No false positives.

## AI-slop verdict

**First-order:** the composed daylight map does **not** read as generated — the meta-tile floor, etched grid, ink walls, and secret-door dressing carry visible system craft, and the matte/no-gloss discipline avoids the render-y tells. But the two surfaces that frame every single beat — the table wood and the torn fringe — are the classic "material named, not made" shortcut (CSS stripe planks, periodic sawtooth "tear"), and they would let a viewer say "AI made that" from the beat-0 or beat-8 frame alone. **Partial fail, localized to the shell.**

**Second-order (the saturated parchment-cartography lane):** the conceit itself — the map drawn *into* the paper, walls rising through the sheet, nightfall performed in place on a physical table — is a specific, ownable idea that no template ships, and the floor/ink execution supports it. The lane is earned **where the diorama is on stage**. It is coasted **in the shell**: flat cream parchment + generic wood + static warm lamp is precisely what the trope generator produces around a fantasy map. Fix the five items below and the page's answer to "which AI made this?" becomes "none — how was this made?", which is the bar.

## Top 5 — fix these and the background is unimpeachable

1. **Night wall values** (P0-1): ink stays ink at night; moonlight goes to caps/outlines only.
2. **Table wood grain bake** (P1-3): per-plank tone + grain streaks + staggered joints — the page's largest surface at its most-seen beats.
3. **Pool/wall clipping** (P1-2): baked pools must obey authored walls — the product promise is in the pixels.
4. **Organic torn fringe** (P1-4): noise-cut the tear, retint, night-ride it.
5. **Sheet grounding** (P2-5): directional shadow + edge thickness + far-field warmth.

---

## Appendix — seam observations (other crew's scope, noted only because they leapt out)

- The five-stroke fissure design reads well against the lit table at day framings; the goblin-eye pairs peeking from the crack are the page's best delight beat.
- Detector hit: `transition: width` at global.css:743 (layout-thrash warning) sits in/near the seam block — worth that crew's confirmation.
- At night the seam's molten green holds value against the darkened wood — no conflict observed with the texture world.

## Appendix — capture inventory

| Capture | State | Where |
|---|---|---|
| Beats 0–8 | dpr 1, day/dusk/night/swap/kit/door | MCP JPEG captures, coordinates cited inline |
| Hero + full night | dpr 1.25, native PNG | `scratchpad/dpr125-hero3.png`, `dpr125-night.png` |
| Zooms | wood ×2, sheet ×2, floor/moss ×3, torch ×2, secret door, fringe, grain A/B | MCP zoom regions cited inline |
| Board D2 frames | day + night (`.d2`, `.d2 .d2n`) | served over http :4198, compared side-by-side |
