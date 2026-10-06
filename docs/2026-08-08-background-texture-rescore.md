# Background texture RE-SCORE — Good Goblin landing page (D2 "lit table")

**Date:** 2026-08-08 (evening run) · **Scope:** the rendered material world only, re-scored after two fix rounds against `docs/2026-08-08-background-texture-critique.md` (26/40). Second deliverable: the evidence-ranked **generation shopping list** for the real-art texture pass that follows.

**Method:** dual-agent (A: isolated source design review, Opus · B: isolated deterministic detector, Sonnet) + parent-context browser evidence walk. The browser portion ran in the parent because this desktop is single-session and actively shared with a human — tab foregrounding via UIA `SelectionItemPattern` + Win32 `SetForegroundWindow`, `document.hidden === false` asserted inside the same JS call as every scroll/measure, re-foregrounded before every capture. Ordering note, declared honestly: B (0 findings) returned before A; A never saw B's output, and synthesis waited for A.

**Build under test:** `site/` `npm run build` (clean) + `vite preview` on port 4213 (PIDs 15996/22616, recorded and killed at teardown; port verified freed). Branch `landing-page`.
**Environment caveats:** mid-walk the human moved the tab into its own Chrome window on a 125%-scaled monitor — beats 0–3 captured at 1920×855 dpr 1, beats 4–8 at 1536×639 dpr 1.25. The prior report established dpr-1.25 render parity (no aliasing/degradation delta), and both viewports produced consistent texture reads. dpr-1.25 OS-level captures were skipped (desktop not free); MCP captures at 100% zoom + native-res region zooms used throughout. Console: clean except one benign `THREE.Clock` deprecation warning.

---

## Design health score

| # | Heuristic | Was | Now | Key issue |
|---|-----------|-----|-----|-----------|
| 1 | Visibility of system status | 3 | **3** | Clock slider, beat states, night progress all legible |
| 2 | Match system / real world | 2 | **3** | Fringe organic, wood drawn, sheet grounded — but the table's baked lamp is off-stage and both hero surfaces render magnified 3–6× |
| 3 | User control and freedom | 3 | **3** | (n/a-lean) scroll scrubs both ways, slider works |
| 4 | Consistency and standards | 2 | **3** | Night value ladder now obeys the ink doctrine; CSS lamp rides nightT — undermined only by the split unlit/toon value system |
| 5 | Error prevention | 3 | **3** | (n/a-lean) |
| 6 | Recognition rather than recall | 3 | **3** | Map vocabulary self-evident; door-top parity now map-wide |
| 7 | Flexibility and efficiency | 2 | **2** | Scroll-only pacing, unchanged |
| 8 | Aesthetic and minimalist design | 3 | **3** | One focal per beat holds; pools monotonic; but every structural surface except the floor is textureless at every framing |
| 9 | Error recovery | 3 | **3** | (n/a-lean) |
| 10 | Help and documentation | 2 | **2** | (n/a for a landing page) |
| **Total** | | **26/40** | **28/40** | **Good (band floor) — system integrity is now excellent; the two largest surfaces are under-resolved** |

Honest delta: **+2**, both points earned in the match/consistency columns by the night-value rework and the physical-behavior fixes. Nothing reaches 4 because a 4 requires the table and sheet to hold up under the beat-8 close camera, and by the measured texel math they cannot yet.

---

## Fix-state vs the 26/40 report — finding by finding

Code verdicts from Assessment A (file:line evidence), visual verdicts from the beat walk.

| # | Prior finding | Code | Browser evidence | Verdict |
|---|---|---|---|---|
| P0-1 | Night wall inversion | `WALL_NIGHT_TINT` → `#1a1d28` target, `CAP_NIGHT_TINT` → `#5a6272` (`Diorama.tsx:200-224`); computed night ladder fringe 0.008 < wall 0.013 < floor 0.022 < cap 0.045 < pool 0.21 | Full-night + dusk frames: walls stay the dark note through the whole lerp; moonlight lives on the cap lip as a thin stroke; pools clearly brightest | **FIXED** |
| P1-2 | Pool/wall bleed | `clippedPoolGeometry` pre-clips quads to the torch's floor rect with UV re-center (`geometry.ts:153-178`) | No bleed at any pool, day dusk or night; beat-6 stray blotch gone | **FIXED** (rect-clip caveat → P3-O) |
| P1-3 | Wood has no grain | Per-plank ±9-16 tone, 26-40 wandering grain strokes/plank, staggered butt joints, one knot (`textures.ts:495-580`) | Grain/joints/tone visible at every beat — but soft/airbrushed at b8 magnification; knot never in frame | **PARTIAL** — the paint is real, the mapping defeats it (P1-B) |
| P1-4 | Sawtooth fringe | Noise-driven tear: ±35% wander, depth `0.38+hash^1.2×0.55`, 20% double-tear, flank kinks; ink-family tints + cool night ride (`geometry.ts:274-318`, `Diorama.tsx:146-158`) | Irregular torn-paper silhouette at all beats, lifted flaps with lit faces, near-black at night, stays inside the skirt at b7 | **FIXED** (surface still corduroy → P1-E) |
| P2-5 | Sheet reads as decal | Directional shadow (0.08 lamp-side / 1.0 far-side, `textures.ts:869-910`), warm hexes, lit thickness strip W+N (`:842-845`) | Offset shadow + west lit lip visible at b7 zoom; south edge grounds via shadow, faint lip reads at b8 angle | **FIXED for the framings that matter** (south-lip nit → P3-H) |
| P2-6 | Day pools off their sources | Braziers added at torch coords (`mapData.ts:124-126, 216-217`) | Every pool sits centered on its prop at b2/b3/b6 | **FIXED** (t5 deliberately fixture-less → P3-Q) |
| P2-7 | Pool inner ring | Stops now monotonic 0.42/0.30/0.16/0 but slopes jump 2.9× at r=0.5 (`textures.ts:796-799`) | Mach band barely perceptible at native zoom, invisible at reading distance | **FIXED in practice** (residual → P3-G) |
| P2-8 | Moss smudge | 8-14 two-value flecks + ink ticks (`textures.ts:91-120`) | Reads as clustered lichen flecks at b2, dissolves correctly at b0 | **FIXED** |
| P2-9 | CSS lamp at night | `--night-t` written per frame (`SceneRenderer.tsx:261`), lamp opacity `calc(1 - var(--night-t)×0.95)` (`global.css:128`) | Full night: wood margins properly dark, one light story | **FIXED** (viewport-lock is a different defect → P2-I) |
| P3-10 | Mid-fade x-ray | `alphaHash` on CrateStack only; vault/bones/brazier/chair/mug/dice still plain alpha, several with explicit `depthWrite:false` | Ghost faces confirmed mid-scrub at the b2 entry (door slab, bones, crates) | **PARTIAL** — fixed at one call site, not at the pattern (P2-J) |
| P3-11 | Brazier target read | Handle nubs + hashed per-instance rotation + rim highlight (`Diorama.tsx:1354, 1395-1396`) | Vessel read restored at day and night zooms | **FIXED** (nub overlap marginal → P3-L) |
| P3-12 | Swap door parity | Lintel decal reusing each door's own mats (`Diorama.tsx:1114-1122`) | b6 south door: full planked top parity | **FIXED** (decal 0.4 vs lintel 0.55 depth + 2.5:1 stud stretch → P3-K) |
| P3-13 | Dice/mug at distance | Dice → unlit basic + toneMapped:false; mug lifted to `#5c3d26` unlit (`TableScene.tsx:164-210`) | b7: readable pips, brown mug with handle | **FIXED** |

**Seam overlay removal: CONFIRMED CLEAN.** Full `src/` sweep — zero overlay code, zero dead CSS, no orphan imports, `global.css` now 719 lines and the detector's old `transition: width` hit at :743 is gone with it. The beat-4 divider glow and the b8 goblin eyes are present and correct. Only residue: two stale comments (`App.tsx:5` references a `src/seam/*` directory that no longer exists; `WaitlistForm.tsx:3` describes a removed re-attach hook).

**Deterministic scan (Assessment B):** `detect.mjs --json site/src` → exit 0, **0 findings** across 28 files (was 1). No false positives; canvas-baked texture work remains outside detector reach, as expected.

---

## The new findings — what still stands between 28 and unimpeachable

### P1-A · The table's baked lamp is 38 world units off-stage
`textures.ts:449-451` centers the radial ramp at canvas UV (0.26, 0.12); `TableScene.tsx:132` grew the plane to 120×64 without moving it. The hotspot lands at world (−20.8, −20.8) — outside everything any camera frames. Measured modulation across the entire framed area: **12.6/255**. The only lamp a viewer ever sees is the screen-pinned CSS gradient. This is a fix-round regression (plane enlargement + ramp bake, each correct alone, contradictory together) and it is the literal mechanism behind the user's "still flat or gradient" complaint on the page's largest surface.
**Fix:** add a `LAMP_WORLD` constant next to `SHEET_CENTER`, derive the UV from it (hotspot ≈ world (−4, −6), radius ~0.45×size), so a resize can never desync it again.

### P1-B · Both hero surfaces are baked below screen resolution at every beat
| surface | tex px/world-unit | screen px/unit (b0→b8, 1920×815) | result |
|---|---|---|---|
| floor meta-tile | 128 × 128 | 25.2 → 88.9 | minified 1.4–5× ✅ |
| table wood (1024²/120×64) | **8.5 × 16.0** | " | **magnified 3.0–6.2×** |
| sheet (**256²**/21×13) | **12.2 × 19.7** | " | **magnified 2.1–4.3×** |

The sheet — the object the conceit rests on — is a 256px canvas stretched over 21×13 units. Browser-confirmed: b8's wood reads airbrushed; b0's grain strokes are soft. The one surface with correct density (the floor) is also the one surface that already clears the bar. That is the whole diagnosis in one table, and it sets the generation resolutions below.

### P1-C · Two unreconciled value systems — the same tint renders as two materials
Unlit `MeshBasicMaterial` shows albedo verbatim; `MeshToonMaterial` shows ≈ ×0.35 by day. Consequences, computed and browser-corroborated: the wall cap's "lighter lip" is a 3/255 difference by day (invisible — confirmed at the b2 zoom); a crate is ~3× darker than a door top of identical `PROP_WOOD_TINT`. Toon-lit and therefore ×0.35: wall caps, door jambs/lintels, secret filler, crates, bones, vault, exit door leaf, arch, hinges, chair. **Any generated art dropped onto those meshes lands three stops dark.** Collapse to one doctrine (or publish one `TOON_DISPLAY_FACTOR` and pre-divide) **before** the generation pass, or every brief below needs a ×2.86 pre-brightening footnote.

### P1-D · Wall and prop stone carries no readable texture at any framing
`getWallTexture` is 128² with `repeat(2,2)` on ExtrudeGeometry **world-unit** UVs → ~256 tex px/unit ≈ 10 texels per screen px: the speckle averages to flat fill. Shared by wall faces, caps, jambs/lintels, secret filler, brazier, bones. Browser: cap tops are the brightest architectural surface at night and carry zero variation along their length; wall faces read as smooth chipboard at the b2 zoom. Rule 6 ("texture everywhere") fails on every structural surface except the floor.

### P1-E · Skirt fringe and crates are corduroy, not planks
`getWoodTexture` `repeat(6,1)` → 768 px/unit on the border (plank pitch 0.027 units — sub-pixel moiré) and ~1097 px/unit on a crate face (~24 seams per face). The 6× repeat was tuned for the old table and never re-tuned for the two callers it left behind. One-line fixes per caller (target ~1 plank per 0.4 units on the skirt, 4-8 planks per crate face).

### P2-F · Derived relief maps are computed and discarded on the two biggest canvases
`deriveReliefMaps` runs full gradient+AO loops for the floor and table wood; both materials take `.map` only. `MeshBasicMaterial` supports `aoMap` and both geometries already carry `uv2` — the floor's etched-seam AO is free and unused.

### P2-I · The lamp is viewport-locked while the table moves under eight cameras
`.stage-lamp` pins at 26%/12% of the **viewport** while the wood travels through eight camera keyframes. The warm pool never parallaxes; combined with P1-A the table's light exists only as a sticker on the lens. Highest-leverage single perception fix on the page.

### P2-J · The x-ray fix landed at one call site, not at the pattern
`fadeAndNight` (`Diorama.tsx:1329-1334`) drives every prop fade; `alphaHash` belongs there or on the shared material factories. Scrubbing is the page's primary interaction and the ghost-faces are its one visible blemish.

### P3 residuals
**P3-G** pool falloff slope discontinuity (barely perceptible at zoom — make slopes non-increasing, e.g. 0.42/0.26@0.30/0.12@0.58/0). **P3-H** sheet south-edge lip faint at b7 (shadow carries it; lit strip is W+N only). **P3-K** door-top decal narrower than lintel (0.4 vs 0.55) + studs stretched 2.5:1. **P3-L** brazier nubs overlap the bowl by only 0.017 units. **P3-M** `WOOD_NIGHT_TINT` is the one hand-written night constant left un-migrated to the ratio system. **P3-N** `depthWrite:false` on the opaque table plane — latent sorting trap. **P3-O** pool clipping is rect-shaped, not wall-graph-shaped (no spill through archways; invisible today). **P3-P** two stale comments (`App.tsx:5`, `textures.ts:477` claims 2-unit plank pitch, measured 3.75). **P3-Q** the fixture-less t5 pool reads as a sourceless pin-prick at dusk/night — give it a floor prop or kill it.

---

## What already clears the bar (do not churn)

1. **The floor system is the model, provably.** 128 tex px/unit isotropic, 8-cell meta-tile, per-cell nudge + wear + 8% moss odds, grid etched into the albedo at α0.14, repeat count living in the geometry (`geometry.ts:48-52`) so one cached bake serves both maps with zero wallpaper. Every other surface should be measured against it.
2. **The night value system is a designed object.** Every `*_NIGHT_TINT` is a computed night-linear/day-linear per-channel ratio from a named board anchor (`Diorama.tsx:200-295`); the resulting ladder (fringe 0.008 < wall 0.013 < floor 0.022 < cap 0.045 < pool 0.21) is exactly the P0-1 prescription and it verifies on screen at dusk and at full night. Strongest craft in the codebase.
3. **The fringe was fixed at the right altitude** — tooth depth is sized against the projected wall shadow at named camera heights, which is the difference between "randomized" and "designed to read". The honest `ponytail:` note naming the beats that still swallow teeth is the correct posture.
4. **Seam removal was executed cleanly** — no dead code, no orphan CSS, detector finding closed as collateral.
5. **Matte discipline + moss + pools-on-sources + door-top parity + dice/mug albedo** all hold at every captured framing.

---

## AI-slop verdict

**First-order** (theme+palette guessable from "fantasy TTRPG map tool"): **pass, by system rather than by surface.** The meta-tile floor, computed night ladder, shadow-sized fringe, and pre-clipped pools are craft no template ships. The two prior first-order tells (stripe-wallpaper wood, pinking-shears fringe) are gone as authorship failures — the wood is now genuinely painted (per-plank stock variation with a deliberate 22% sign-repeat is a level of thought no generator produces). What remains is a **mapping** failure: the paint is real, the projection destroys it, and at beat 8 a viewer still reads "generated blur" on the largest surface. Practically: the day map passes clean; the shell passes at reading distance and fails at close scrutiny.

**Second-order** (the saturated parchment-cartography lane): **earned where the diorama is on stage; still coasted in the shell — for a new reason.** No longer "flat cream + generic wood": the shell now has no *light*. The table's own lamp is baked off-frame and the only visible lamp is a screen-pinned CSS gradient that never moves with the surface — a lit table whose light is a sticker on the lens is exactly the trope generator's shortcut. Fix P1-A + P1-B + P2-I and the second-order answer flips, because the authorship underneath is already there to be revealed.

---

# THE GENERATION SHOPPING LIST

Ranked by visual leverage. Screen densities at 1920×815 from `cameraPath.ts`: **b0 25.2 · b2 88.9 · b4 37.0 · b7 52.4 · b8 38.2 px per world unit.** All surfaces ride the multiplicative night-tint system: ratios are computed against the *current day albedos*, so generated art must center on the existing day tint families (or the ratio IIFEs must be re-anchored). **Precondition for the whole pass: resolve P1-C first** — art dropped on toon-lit meshes today lands ×0.35 dark.

**Grey-master note (wall-set lesson):** stone/wood family art should be authored as neutral greyscale masters and colored by the existing tint constants — that keeps day/night/torch lerps working unchanged and lets one master serve multiple tints (walls, caps, jambs, bones all share one bake today).

### 1 · TABLE WOOD — needs art. The single highest-leverage asset on the page.
- **Exposure:** full viewport at b0/b7/b8 (the first and last things a visitor sees; b8 is the conversion beat). Camera frames ~76 world units of wood at b0; a single plank (3.75 units) is ~143 screen px wide at b8.
- **Resolution target: 4096×2176** (aspect-matched 1.88:1 for the 120×64 plane — a square canvas is a 1.88× anisotropic smear). Untiled single sheet; no variants needed (no repetition possible).
- **Mapping constraints:** plan-view; canvas −x = world west, canvas top = world north (flipY). Unlit `MeshBasicMaterial` — albedo shows verbatim. Night = `TABLE_NIGHT_TINT` multiplier; keep values in the warm mid-band so one multiplier works.
- **Lighting:** do NOT paint the lamp pool into the art at the current UV constants (P1-A). Either paint it at the corrected world position via a new `LAMP_WORLD` constant, or ship the wood evenly-lit and add a separate lamp decal plane that can parallax (fixes P2-I at the same time).
- **Brief sketch (per art-style-guide):** hand-painted oak planks in the `#70471e` family, plank pitch matching the current 3.75-unit seams (or re-seam to the painted layout), cathedral grain figure + rays, 2-3 knots placed *outside* the sheet footprint, staggered butt joints, ink-weight seams, matte, texture-everywhere-contrast-nowhere — the wood must stay quieter than the map. **Keep procedural on top:** nothing required; optionally the existing speckle. Wire the discarded AO (P2-F) if relief is wanted.

### 2 · WALL STONE FAMILY (faces + caps + jambs + secret filler) — needs art. One master, many tints.
- **Exposure:** the ink skeleton of every map beat; caps are the brightest architectural surface at night (~12-15px bands at b2's 88.9 px/unit; face bands 0.3-0.5 units).
- **Resolution target:** **512² seamless tile at ~128 tex px/unit** (covers 4 world units per repeat), greyscale master, tinted by `WALL_TINT`/`WALL_CAP_TINT`/night ratios exactly as today.
- **Variant structure (the wall-variant lesson):** repeated elements need alternates sharing an exact footprint or the same stone repeats down the run — either a 4-unit tile with enough internal variety, or 2-3 alternate tiles selected per segment hash. Caps need *lengthwise* variation most (they are read as long strokes).
- **Mapping constraints:** ExtrudeGeometry emits world-unit UVs — set `repeat` from world size (fixes P1-D as part of the art drop). Faces unlit, caps currently toon (P1-C must be resolved or caps pre-brightened ×2.86).
- **Brief sketch:** cut dark stone with subtle coursing, chisel marks and edge nicks, ink-outlined per rule 3 ("thick dark strokes"), value range tight (±10) so the ladder ordering survives; caps get a slightly worn top-face treatment with occasional chipped corners.

### 3 · PARCHMENT SHEET — needs art. The conceit's own surface is the lowest-res bake on the page.
- **Exposure:** full viewport at b1 ("You draw the map" — the sheet IS the frame); ground of every map beat. At b2 the 21-unit sheet spans ~1867 screen px.
- **Resolution target: 2048×1280** (1.61:1 for 21×13 units; ≥1024×640 is the floor, 2048 survives b2).
- **Mapping constraints:** untiled, rotated −0.6°, unlit. Lamp side is west/north — keep the lit thickness strips there (or bake edge light into the art the same way). The sheet shadow decal below it encodes the same direction; a replacement must agree. Night = `SHEET_NIGHT_TINT` multiplier.
- **Brief sketch:** hand-made paper in the `#f3e7cb → #ddcda5` family — visible fiber tooth, faint foxing spots, slight edge darkening, one or two pressed creases lighter than α0.05 so the drawn map always wins. The base must stay *quiet*: the authored ink lines, grid, and story marks draw on top of it. **Keep procedural on top:** the `.grain` DOM overlay (already proven), the drawn-map line work, speckle if the art's own tooth is insufficient.

### 4 · EXIT DOOR ASSEMBLY (leaf + arch frame) — needs art. It owns the conversion frame.
- **Exposure:** ~330×500 screen px at b8, dead center, holding the waitlist form. Currently flat vertical strips + a smooth brown arch.
- **Resolution target:** **512×768** leaf + arch strip (or a 1024² atlas for leaf+arch+jamb).
- **Mapping constraints:** `getDoorTexture` today is 128² `repeat(2,1)`; leaf is toon-lit (P1-C) and its night tint is the one un-migrated constant (P3-M) — migrate both with the art drop.
- **Brief sketch:** heavy planked door per rule 3, iron bands with rivets, ink outlines, warm `#4a331f` family; arch in the wall-stone master. The goblin eyes above it stay exactly as they are.

### Fine as-is / procedural-fix-only (in priority order)
- **STONE FLOOR TILES — fine as-is; the reference implementation.** Any future generated stone base must tile seamlessly at exactly 8 cells (per-rect UV origin), keep grid seams on cell boundaries, and either include moss or move moss to decals. The meta-tile nudge/wear/etch system should be LAYERED OVER any art, not replaced. Wire the discarded AO for free depth (P2-F).
- **TORN FRINGE** — geometry earned; **surface is a one-line repeat fix** (P1-E), not a generation target. If art is ever wanted: a 256px torn-paper-edge strip, world-scaled, ink family.
- **CRATES** — repeat fix first (4-8 planks/face); after that a 128² painted crate-top is optional polish (~60×47 screen px at b2).
- **DOOR TOPS** — reads well at map framings; if regenerated, author at ~2.5:1 (256×102) so studs stop stretching to ovals; keep the heavy/secret variant pair.
- **TORCH POOLS** — correct as procedural gradient (a glow is a gradient); adjust stops per P3-G. Never night-tinted, by design — the amber-vs-blue is the night story.
- **MOSS** — fixed and good; keep baked odds at 8%.
- **BRAZIER / BONES / VAULT** — small footprints, read fine after the value-system collapse; bones could take a painted top-down pile decal (borderline, last).
- **DICE** — fine (unlit, pip layouts correct). **MUG** — the one surface with zero material; a 64² glaze ramp would do; last.

**Bottom line for the generation phase:** four assets (table wood, wall-stone master, parchment sheet, exit door) move the page from 28 to the high band, because between them they own every pixel of beats 0, 1, 7, and 8 and the ink skeleton of everything between. The two prerequisites that cost no art: P1-A/P2-I (put the lamp in the world) and P1-C (one value system), or the generated art will be lit wrong the moment it lands.

---

## Appendix — micro-interaction observations (seed list for the interaction pass; not scored here)

- **Scrub feel:** lenis + demand frameloop stayed clean at every step size (120-300px); beats settle promptly; no blanking anywhere, both directions, including across the b5→b6 night→swap boundary.
- **The one scrub blemish:** mid-fade x-ray ghosting on door slab/bones/vault/crates during beat entries (P2-J) — scrubbing is the primary interaction, so this is the interaction pass's highest-value scene fix too.
- **Beat-4 divider:** slides in smoothly; the green edge-glow reads deliberate and quiet. No jank observed.
- **Clock slider (b5):** amber track + thumb legible at night; "23:40" label reads; dawn/noon/dusk tick labels visible. Not drag-tested (owned by the interaction pass).
- **Night text contrast:** the b5 section heading dims to near-illegibility at full night (deliberate nightfall styling, but it crosses readable); body copy over day parchment at b2/b3 also sits low-contrast. Copy crew territory — flagging, not scoring.
- **Waitlist form (b8):** parchment card composition lands; placeholder "dm@yourtable.com" is voice-correct; focus/hover/error states not exercised this run.
- **Delight beats confirmed:** goblin eye-pairs above the b8 door; "The goblin holds your seat" at b7.
- **Console:** one `THREE.Clock` deprecation warning (`Canvas3D` chunk) — one-line migration to `THREE.Timer` when convenient.

## Appendix — capture inventory

| Capture | State | Viewport |
|---|---|---|
| b0 + wood zoom + sheet-corner zoom | day, blank-sheet intro | 1920×855 dpr 1 |
| b1 | map draw-in, sheet full-frame | 1920×855 dpr 1 |
| b2 mid-fade (x-ray evidence) + settled + fringe zoom + brazier/floor zoom | day | 1920×855 dpr 1 |
| b3 | fog & sight | 1920×855 dpr 1 |
| b4 | DM/player split | 1536×639 dpr 1.25 |
| b5 dusk (scroll 6652) + full night (7012) + night wall/pool zoom | dusk / 23:40 | 1536×639 dpr 1.25 |
| b6 | swap map | 1536×639 dpr 1.25 |
| b7 + sheet-edge zoom | war-table pull-back | 1536×639 dpr 1.25 |
| b8 | door / conversion | 1536×639 dpr 1.25 |
