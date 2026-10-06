# Map Art Style Guide

**Reference board:** https://in.pinterest.com/sainayanmahto/dbdmaps/ (22 pins, curated 2026-07)

This is the visual bar for every map, asset, and generated texture that ships from map-goblin. Canvas rendering, asset generation, the map-building tools, and every agent/skill that produces or reviews visual output must check its result against this guide before release. The reference images stay on the Pinterest board (they are third-party Patreon creators' work — do not copy them into this repo or into training/generation inputs verbatim; they are style references only).

## The style in one paragraph

Hand-painted digital top-down battlemaps: strict orthographic view with a slight 3/4 cheat on tall props, dark ink outlines over painterly fills, a subtle 1-inch grid tinted to match the terrain, baked ambient lighting with warm radial glows at light sources, one consistent global shadow direction per map, detail concentrated along walls and edges with open floor centers left readable for tokens, and one focal accent per map. Never photorealistic, never pixel-art, never flat vector.

## Style DNA (the 8 rules)

1. **View.** Top-down orthographic. Tall objects (barrels, beds, statues, trees) show a hint of their side/top volume but never true perspective. No isometric.
2. **Grid.** Always present, always subtle. One-inch squares. The grid is *terrain-tinted*, not overlaid black: pale blue-grey on snow, olive on grass, warm tan on sand, and on stone interiors it is *etched into the tile texture itself* (tiles cut at grid size). Grid contrast is low enough that it disappears at a glance and reappears when you look for it.
3. **Linework.** Dark ink outlines on every prop, tree, rock, and wall edge. Walls are thick dark strokes (0.3–0.5 grid units) with a lighter fill; ruined walls break into outlined rubble. Line weight is heavier on structure, lighter on ground clutter.
4. **Palette (per biome).**
   - *Wood interior:* warm mid-browns, plank direction visible, warm orange light pools (tavern pin).
   - *Stone interior/dungeon:* desaturated grey to grey-green or slate blue; warm orange/gold accents only at light sources and treasure.
   - *Dark dungeon/crypt:* near-black surround, grey floors, 1–2 strong warm glows (torch/altar) doing all the color work.
   - *Grass/meadow:* layered yellow-greens with cloud-shadow patches, flower speckles, ochre dirt breaks.
   - *Forest:* clustered canopy blobs, teal-to-green range; dark variants tint shadows purple/magenta for mystery.
   - *Snow/ice:* near-white with pale blue-grey shadows; frosted teal trees; warm gold lamps as accents.
   - *Desert/sand:* ochre/sepia layers, ink-outlined rocks, deep warm cast shadows; can go near-monochrome sepia.
   - *Overgrown/jungle ruin:* grey-green mossy stone, saturated plant greens, teal water, greek-key/mosaic details.
5. **Lighting is painted, not neutral.** Every light source gets a soft radial warm glow baked into the ground art. One global sun/shadow direction per outdoor map with long soft cast shadows. Dramatic interiors may use god-ray shafts and dark vignetted corners. Dungeon negative space is pure black with a rocky torn edge; building exteriors on settlement maps sit on white/parchment with the grid continuing over it.
6. **Texture everywhere, contrast nowhere.** Every surface has noise/texture (grass scribble, stone grain, plank grain) but at low contrast so tokens stay readable. Detail density: high at walls, edges and focal points; floor centers stay open.
7. **Composition.** Multiple rooms/zones with chokepoints, clear door gaps in walls, and exactly one focal accent per map (gold mosaic, glowing treasure pile, altar, hearth). Paths curve; nothing perfectly straight except built stone.
8. **Doors and walls read at a glance.** Doors are drawn wooden rectangles (or double-line gaps) sitting *in* wall gaps; archways are gaps with stone trim. Wall segments are continuous and clean — the map art must make wall/door/secret-door data trivially traceable over it.

## Reference index (what each pin demonstrates)

| Pin | Scene | Take from it |
|---|---|---|
| Tavern (Venatus-style) | Wood interior | Warm plank floors, hearth glow, white exterior margin, stone-tile kitchen |
| Crosshead | Desert town gate | Sand gradient + tan grid, gold mosaic focal, cutaway buildings, awning accents |
| Snow pass | Ice/snow exterior | Blue-grey grid on white, warm lamp accents, barricade props |
| Grey stone dungeon | Classic dungeon | Black surround, grid etched in tiles, hard consistent shadows |
| Darkest Maps forest path | Dark forest → meadow | Purple-shadow forest grading into warm meadow, painterly canopy |
| afilinkov desert rocks | Sepia desert | Near-monochrome ink+wash, strong cast shadows, open center |
| Forest camp | Night forest | Desaturated night ambient, low contrast, tent props |
| AtaraxianBear bridge | Chasm crossing | Two-scale depth via mist + tiny canopy, grid over mist layer |
| Reclusive Cartographer causeway | Jungle road | Saturated clean greens, mossy pavers, statue alcoves |
| Miscellanea Mesoamerican | Temple interior | God-ray light shafts, teal water glow, greek-key tiles |
| Guardhouse interior | Stone interior | Grey tiles + warm wood props, treasure-glow focal, smoke wisps |
| BBEB great hall | Big hall | Pillar long-shadows, central light shaft, debris storytelling |
| Mystveil ruins | Greyscale ruins | Ink linework, moss as only color, mist |
| TavernTales guardhouse | Ruin on grass | Long diagonal shadows, olive grid, high readability |
| Eldritch Arcanum crossroads | Forest road | Clean cartoon style, wheel-rut road, stream ribbons |
| TavernTales battlefield | Meadow | Prop-light storytelling (weapons/banners), cloud shadows |
| Vampire crypt | Dark crypt | Black surround, torch-only color, ornate floor borders |
| Mad Cartographer prison | Dungeon + caves | Warm lamp pools vs cool stone, natural cave tunnels between rooms |
| Blue-grey crypt complex | Printable dungeon | Slate palette, flooded room, per-room floor patterns |
| Xibalba sanctum | Overgrown dungeon | Moss floors on dark stone, lamp-orb light pools |
| Kobold warren (2MTT-style) | Hand-drawn dungeon | Rounded cobble outlines, flat colors + soft glows, hatch wall fill |
| Dark cellar | Storeroom | Barrel alcoves, two-torch drama, stair readability |

## How this maps onto map-goblin

The references are *finished paintings with baked lighting*. Map-goblin composes maps at runtime: 200px/cell assets (`GRID_CELL_PX = 200`, `packages/core/src/assets/textureManifest.ts:368`) + `GridRenderer` overlay + FBO lighting (`packages/core/src/engine/lighting/LightingRenderer.ts`) with ClockwiseSweep visibility and multiply compositing. So the guide splits into two contracts:

**Asset contract (generation-time).** Assets carry everything *except* directional light: ink outlines, painterly fill, low-contrast texture, soft ambient-occlusion contact shadow only. This is already codified in `forge/STYLE.md` ("Hand-Painted v0.2", merged via PR #32): orthographic top-down, dark seams, warm earthy palette, AO-only shadows because the engine casts shadows dynamically. That bible and this board agree; this guide supersedes nothing there — it adds the *map-level* rules STYLE.md doesn't cover.

**Scene contract (render-time).** The engine owns what the references bake in: light-pool glows (point lights with warm color stops), global shadow direction, ambient tint per scene, grid appearance, negative-space treatment. The composed scene in the browser — not the individual asset — is what gets judged against the board.

### Current output vs the reference — gap analysis

What already matches:
- Engine lighting can reproduce the warm radial light pools (gradient falloff color stops exist).
- Per-shape wall drop shadows exist (`shadowEnabled` on `DungeonStyle`) — refs' wall AO.
- Door renderer already supports pack-supplied `door-{style}-{state}` sprites (`packages/core/src/engine/doorRenderer.ts:107-117`) — no pack ships them yet.
- Forge output sizing (gridSize × 200px, WebP atlases) is grid-correct by construction.

Gaps, ranked by visual impact:

| # | Gap | Reference behavior | Current behavior | Fix |
|---|---|---|---|---|
| 1 | Palette cohesion | One graded biome palette per map | FA-derived `dungeon-classic` pack + flat preset fill colors (`presetRegistry.ts:36-71`) mixed ad hoc | Per-biome palettes in this guide become forge prompt kits + preset texture sets |
| 2 | Biome coverage | grass, ice/snow, rock, stone, wood, sand, moss/overgrown, water | Manifest floors: grass, dirt, stone, cave, gravel, wood, water only | Forge: snow, sand, moss floor families + matching edges |
| 3 | Doors | Drawn wooden doors sitting in wall gaps | Vector glyphs + colored state dots | Ship `door-{style}-{state}` sprites in the next pack (renderer support already exists) |
| 4 | Grid | Terrain-tinted, low contrast; etched into stone tiles | Uniform overlay lines regardless of floor | Per-preset grid color/alpha; stone interior floors baked with tile seams at cell size |
| 5 | Negative space | Pure black + torn rock edge (dungeons), parchment white (buildings) | Flat background color | Preset-driven background + edge treatment |
| 6 | Scene grade | Vignette, per-map ambient tint (purple forest shadow, sepia desert) | Ambient light color only (usable today, unused) | Set ambient color per scene preset; vignette only if a scene demands it |
| 7 | Focal accent | One glowing/ornate focal per map | None by convention | Map-authoring convention, not code |

God-rays and mist overlays appear in a few pins — skip; revisit only if a specific scene needs them.

Licensing note that makes this guide load-bearing: `docs/RECONCILIATION.md` (merged with PR #32) flags the current `dungeon-classic` pack as Forgotten-Adventures-derived and not redistributable — the forge pipeline exists to replace it with owned art. Every replacement asset should be generated against this guide, so the owned pack converges on the board style instead of re-cloning FA.

### Forge output audit (2026-07-28, rock set in `forge/staging/`)

Audited every staging folder against the board. No candidate passes yet; the failure modes are consistent:

| Failure mode | Seen in | Board/STYLE.md rule violated |
|---|---|---|
| Viewpoint drift — 3/4 or side view | `cave-rock`, `rock-cluster`, `rock-pebbles` | Strict top-down flat lay |
| Low-poly 3D-render / specular gloss | `cave-rock-r2`, `rock-sheet-sliced` (all 15) | Hand-painted matte, ink outline + painted highlights |
| Scene/diorama drift — whole vignette, not one object | `rock-boulder-md-r2` (isometric lava-rock tower w/ trees, path, plinth) | "Exactly one subject, nothing else in frame" |
| Baked context — grass surround, solid backgrounds | `rock-boulder-lg` (moss ring), `cave-rock` (grey bg), `rock-pebbles` (black bg) | Isolated on plain background; slicer needs clean bg separation |
| Baked directional shadow | `rock-boulder-lg`, `rock-cluster` | AO contact shadow only — engine casts shadows dynamically |
| No ink contour, off-palette (pink/candy tones) | all folders | Dark-seam definition, desaturated grey-brown rock palette |
| No two folders share a register | whole set | One coherent pack style |

Closest candidate: `rock-boulder-lg/001` (genuinely top-down, painterly) — still fails on baked surround + directional shadow.

**Diagnosis.** SDXL's prior for "RPG game asset, painterly" is dominated by isometric mobile-game 3D renders, and the staging dims (768/832px) indicate these came from the fast-draft workflow (Lightning 8-step, cfg 2.0), where prompt/negative adherence is weakest. Prompt-only steering on base SDXL will not hold this style.

**Fix direction (pipeline, not prompts alone):**
1. Style anchor: small style LoRA or IP-Adapter reference set built from exemplars we own in the target style — never the Patreon references (STYLE.md already forbids training/img2img on them).
2. Approval candidates only from the full workflow (28 steps, cfg 6.5); the Lightning draft is for composition triage, not style judgment.
3. Harden prompts: emphasize "flat lay, viewed directly from above"; extend negatives with `diorama, pedestal, base, low poly, specular, glossy, grass, ground, terrain`.
4. Optional deterministic post-pass adding the uniform dark ink contour — the cheapest lever for cross-asset coherence.

### Release checklist (the gate)

Judge the composed scene in the running app (docker-deployed, walked in the browser per sprint-exit verification), not asset thumbnails:

1. Top-down orthographic everywhere; no perspective drift on props.
2. Grid visible on every terrain but subtle — terrain-tinted, never black overlay.
3. One biome palette per map from §Style-DNA-4; no palette collisions between adjacent assets.
4. Every light source shows a warm radial pool; one global shadow direction; ambient tint set per scene.
5. Walls read as thick dark strokes with clean continuous segments; doors read as objects (not glyphs) once door sprites ship; secret doors invisible to players.
6. Floor centers open and token-readable at 20px/cell default zoom; detail concentrated at walls/edges.
7. Dungeon exteriors black with edge treatment; building exteriors parchment with grid continuing.
8. One focal accent present.
9. New generated assets: AO contact shadow only, no baked directional shadow, ink outline present, reads at 200px/cell.

Anything producing or reviewing visual output — the canvas editor, the session client, forge asset generation, and any automated review of them — checks against this file before release.

### Engineering backlog (smallest diffs first)

1. Extend `forge/STYLE.md`'s prompt kit with the §Style-DNA-4 biome palette phrases (snow, sand, moss). (The pipeline itself merged via PR #32; terrain painting via PR #31.)
2. Per-preset grid tint/alpha in `GridRenderer` + `presetRegistry`.
3. Ship door sprites in the next asset pack (zero renderer work).
4. Scene ambient color defaults per preset (forest = cool green-purple, desert = warm sepia, crypt = near-black + warm lights).
5. Forge job batches for the three missing floor families + edges.
6. Preset background/negative-space treatment (black + hatch for dungeons, parchment for interiors).
7. Forge style anchor (LoRA/IP-Adapter from owned exemplars) + prompt hardening per the forge output audit above — prerequisite for any asset approval.
