# Living fog of war v2 — plan

Status: DRAFT for approval, 2026-09-09. No production code touched.
Reference look: `docs/mockups/2026-09-09-fog-current-vs-living.html` (right panel).
Capability sweep: four read-only explorers over shader, settings, mask/vision, perf+tests (2026-09-09); their file:line evidence is folded in below.

## 1. Why the fog went dead (established)

All in `session/client/src/modules/fog/`:

1. The live→memory edge was flattened to a plain alpha ramp in PR #114 (`mFog = min(m,0.5)*2` + `alpha *= 1-smoothstep(0.5,0.95,m)`, livingFog.ts ~210/232). Done to kill a dark ring that tracked every sighted token. Rim, wisp and lobes now only shape the memory→hidden edge.
2. Mist 0.55→0.25 and rim 0.75→0.25 four days after ship (a38478a, FogRenderer.ts:1179).
3. FOG_MARGIN 0.3→0.5 and FOG_FEATHER 0.4→0.8 (band S, PR #115). Cloud edge sits 1.3 units back from geometry.
4. Memory tier is one texel per cell, bilinear only (tierPlan.ts cellTexture, MEMORY_BLUR_CELLS = 0). One bit per cell end to end, including the wire.
5. A maskSoft blur pass was added (a38478a). Palette dim coefficient softened.

Animation is still wired (uTime advances every frame unless reduced motion).

## 2. Target look (user rulings 2026-09-09)

- Pale, realistic mist: white crowns, shadowed creases, drifting on strata. Not a tinted film. Settable **mist base** colour under the layers.
- **Layer stack**: 3 layers, each with type (billow / haze / streaks / smoke), tint, strength, scale, drift speed, drift direction. Presets: cumulus, ground mist, smoke overlay, rolling fog. Global **wind** multiplier.
- **Wide fade** into discovered ground (mockup default 2.5x), lobed coastline with a shadowed crease.
- **Veil**: thin drifting cloud over live-sight ground (0.18), map fully readable.
- **Torch glow**: warm tint on fog near light sources.
- **DM setting "show blurred floor under hidden fog"**: gaps in the cloud over hidden ground open onto a heavily blurred, desaturated, base-tinted copy of the floor. Show-through 0..0.9, blur 0.5..5 cells. Total cover alpha stays exactly 1.0. Off = solid cover.
- DM screen keeps the same fog at low alpha (already how FogOverlay.ts works, `createLivingFog(engine, {dense:0.26, mist:0.13, rim:0.3})`).
- Wind default 4x the old pace; the old max was "abysmal".

## 3. Design decisions (the parts where production disagrees with the mockup)

### D1. Fade width scales blur and shader bands, never the pad
FOG_MARGIN is hand-duplicated in `session/server/src/fog/redactMap.ts:218` and gates server-shipped geometry. FOG_FEATHER changes mask-hole geometry and already cost 8ms→24ms rebuild once. So the fade-width knob multiplies only:
- `look.fade` (maskSoft blur radius, livingFog.ts:460), and
- a new `uFade` uniform multiplied into the body / wisp / rim smoothstep pairs (livingFog.ts:212–217), exactly as the mockup's `u_fade` does.
Zero server change. The mask-rebuild lane (8ms / 16ms budgets) gets re-measured because the blur radius grows.

### D2. Organic live→memory edge without the ring
The mockup's coastline formula has no clamp and would reopen the ring bug (fixed twice: 5e3ce63 then 7e48810). Keep `mFog = min(m,0.5)*2` and maskAt()'s floor-at-0.5 untouched, so body / wisp / rim stay blind to the live/memory step. Add character to that seam with a **monotonic** term only:

```
float seam = m + (den - 0.5) * uSeamLobe;       // continuous noise wobbles the seam position
alpha *= 1.0 - smoothstep(0.5, 0.95 * uFade, seam);
```

A wobbled monotonic fade cannot draw a band, so it cannot draw a ring. No rim or wisp at that seam in v1. Ships only after the adversarial live walk from PR #114's commit message (two tokens, move one, no crescent on either) and a unit test that samples `d` across the seam and asserts body/wisp/rim stay 0.

### D3. Blurred floor underlay is a client capture of what the seat already holds (DECIDED 2026-09-09)
The server's D4 policy ships **no art at all** for never-revealed rooms on a zoned map (redactMap.ts:1–6, byte-searched by integration tests), and that guarantee stays. The underlay is built client-side from art the seat already has: the memory tier on zoned maps, and the whole image on unzoned battlemaps (which ship whole by design). A never-revealed room on a zoned map shows the mist base through the gaps, nothing else. No new data crosses the wire.

Mechanism:
- Extend `RenderEngine.renderToTexture` (packages/core/src/engine/RenderEngine.ts:26, PixiRenderEngine.ts:169) with an optional `transform: Matrix`, threaded to Pixi's `renderer.render({container, target, clear, transform})`. This renders the map-art sub-containers of `worldContainer` (background, terrain, grid, layers; tokens and door marks are separate screen-space overlays, so they are excluded by construction) into a small fixed map-scale RenderTexture, independent of the live camera.
- Capture at 1/8 map scale, then BlurFilter at the DM's blur radius (the maskSoft pattern, livingFog.ts:365–371). Desaturation is a luma mix in the fragment shader, no extra filter pass.
- Rebuild only when the scene changes (`scene.sceneId !== sceneId`, FogRenderer.ts:1297) or the map/layers identity changes, never inside the general fog `rebuild()` firehose. Blur-radius changes re-blur the cached capture, not re-capture.
- Bind as a third texture on the fog mesh and composite with the mockup's algebra:

```
fill = (1.0 - alpha) * hiddenness;
gl_FragColor = vec4(col * alpha + under * fill, alpha + fill);   // alpha + fill == 1 over hidden ground
```

- DM toggle `showFloor` (default off), `showThrough` 0..0.9, `floorBlur` 0.5..5 cells. On a battlemap the DM is choosing to hint at unexplored layout through the blur; that is their call per table.
- Pixel test: hidden ground alpha = 255 with the toggle on and off.

### D4. Torch glow needs a light/darkvision discriminant
`scene.night.pools` concatenates light sources and darkvision eyes with no flag (FogRenderer.ts:729–740). Warm-tinting all of them would glow around a darkvision-only token. Add `warm: boolean` to `FogPool` (fog.ts:342–356), true for light sources only; shader glow loop reads `uPools[i]` plus a parallel `uPoolWarm` float array (or pack warm into an unused component). FogOverlay.ts gets `haze.setPools(...)` so the DM haze keeps parity.

### D5. Layer uniforms packed as vec4 arrays
Only `vec4[]` and scalar `i32` uniforms are proven in this codebase's UniformGroup shape (livingFog.ts:396). Pack each layer as two vec4s: `uLayerA[3] = (type, strength, scale, speed)`, `uLayerB[3] = (angle, tint.r, tint.g, tint.b)`. Constant loop bound of 3, no break. Proven path, no spike.

### D6. Heavy fog is a DM toggle, measured against the performance bar (DECIDED 2026-09-09)
No device/quality tier exists anywhere in the client. Per fragment today: 20 noise evaluations (2 fbm warp + 3 billow). Billow / haze / streaks are 4 each, smoke is 12. Default stack allows one smoke layer (worst case 28, the ground-mist preset). A DM toggle **"heavy fog"** lifts the cap to three smoke layers (44) for tables whose hardware carries it. Both settings must meet the bar in section 3a on the reference hardware, and the panel shows the measured frame time next to the toggle so the choice is informed, not blind. Wind is `t = uTime * uWind` inside the shader so it inherits the reduced-motion freeze (FogRenderer.ts:1458, FogOverlay.ts:323).

### D7. Settings live in two places, like World already does
- **Authored default** `MapSettings.fogLook` (packages/core/src/store/types.ts, sibling of `ambientLight`), set in canvas, shipped by the existing hash-gated `publishScene`. Read by FogRenderer as the fallback the way `mapSettings.ambientLight` is today.
- **DM live override** `SceneFog.look?: Partial<FogLook>` (packages/mechanics/src/fog/types.ts) via one new command `set-fog-look`, DM-gated, no table log line (same convention as set-containment), validated field by field with hand-written range checks (no clamp helper exists). Players receive it unredacted; they render their own fog.
- Every fog command persists and rebroadcasts the whole campaign FogState, so sliders debounce 150ms client-side before `send()`.

```ts
type FogLayer = { type: 'billow'|'haze'|'streaks'|'smoke'; tint: string; strength: number; scale: number; speed: number; angle: number }
type FogLook = {
  preset?: 'cumulus'|'mist'|'smoke'|'rolling'
  base: string            // mist base colour
  layers: [FogLayer, FogLayer, FogLayer]
  wind: number            // 0.5..12, default 4
  fade: number            // 1..4, default 2.5
  veil: number            // 0..0.5, default 0.18
  glow: number            // 0..1, default 0.35
  showFloor: boolean      // default false
  showThrough: number     // 0..0.9, default 0.6
  floorBlur: number       // 2..5 cells, default 2
}
```

### D8. Palette identity
`SMOKE` (livingFog.ts:258–262) becomes the pale-mist identity; `fogPalette()` keeps grade-pulling and darkening it. `uDeep` = mist base after grade/darkness. Layer tints mix onto that inside the loop, so scene grade still lands on every layer.

### 3a. Quality and performance bar (the point of the work)
The goal is a top-quality experience, not the least effort. Every work package is judged against this, and none ships below it:

Look
- Side by side at 1:1 on the docker gate, the table's fog reads as the mockup's right panel: pale mist volume with white crowns and shadowed creases, lobed coastline, wide fade, veil over sight, glow near lights. Judged by the user in canvas/table, not by a screenshot diff.
- Hidden ground: rendered alpha exactly 255, no bounding-rect or token silhouette leak, toggle on or off.
- No ring, crescent or halo tracking any token in the adversarial two-token walk.
- Passes the art-style-guide tonal doctrine and an impeccable review of the panel.

Performance (measured with BOTH DM and player canvases open on one GPU, the sprint3-fog setup, on the dev box at 1080p)
- Player canvas steady ≥ 60 fps with the default stack; ≥ 45 fps with heavy fog on. Today's baseline is 21.8 fps with two contexts, so the existing ratio gate (steady/dmSeat ≥ 0.6) is kept as the regression floor but is not the target.
- Fog fragment cost is measured per layer type before presets are finalised, and the numbers go in the plan.
- Mask rebuild stays inside the 8 ms budget with the 2.5x blur radius; the 16 ms per-build gate on the 8-token map stays green.
- Underlay capture: never per frame, never per fog mutation; only on scene/map change.
- No new animation loop; reduced motion freezes everything through the one existing switch.

## 4. Work packages (stacked branches, one squash-merge each)

### WP1 — Shader look (no new settings; presets hardcoded)
- F1 palette + mist base, D5 layer loop, D6 wind, D1 fade uniform, D2 seam term, veil, D4 glow with `warm`.
- DM haze parity (`haze.setPools`).
- First step: re-derive the E2E luminance classifier in `sprint3-vision.spec.ts` develop() (lit>64 / dark<16 calibrated to the old 22–59/255 band; the pale palette sits entirely above 64, so the lane would pass for the wrong reasons).
- Tests: ring-invariant unit test (D2); hidden pixel alpha = 255 assertion; vitest fog suite (241 green today); sprint3 lane re-run; fps ratio re-baseline; compositor-run.mjs A/B for the coastline.
- Gate: docker two-surface walk on Goblin Warren, both seats, console clean, with the adversarial two-token walk.

### WP2 — Settings, publish, DM panel
- `MapSettings.fogLook` + canvas editor field and preset picker; `SceneFog.look` + `set-fog-look` + validation; client store read; FogRenderer/FogOverlay consume authored default then override.
- New prep-group panel modelled on `WorldPanel.tsx`: provenance (authored default, read-only) above live controls (preset, base swatch, three layer rows, wind/fade/veil/glow sliders). Does not go in the 224px `FogHeaderActions` popover.
- Impeccable pass on the panel. Debounced sends.

### WP3 — Blurred floor under hidden fog (D3)
- Engine: `transform` argument on `renderToTexture` (core package, both interface and Pixi implementation), with a unit test that the container's own transform is untouched after the call.
- Table: fixed-scale capture of the map-art containers on scene/map change, cached, re-blurred on `floorBlur` change; third texture on the fog mesh; compositing algebra above; `showFloor` / `showThrough` / `floorBlur` in the panel with the heavy-fog toggle from D6.
- Tests: hidden alpha = 255 with showFloor on and off; capture count stays at 1 across a scripted burst of token moves, door toggles and reveals; no token pixels in the capture (render a token over a flat-colour map, assert the capture is flat).

### Lock the defaults (mockup session, after WP2)
Once the panel is on the table, a second mockup/live session locks the shipped defaults for preset, base, wind, fade, veil, glow, showThrough and floorBlur against the bar in 3a, on Goblin Warren. Until then WP1 ships the mockup's current values as provisional defaults.

Order: WP1 → WP2 → lock defaults → WP3. WP3 can follow later without affecting the others.

## 5. Out of scope
- Finer-than-cell memory record (server/wire change; the coastline gets its lobes from the shader warp, not the mask).
- Device-detected quality tiers.
- Discord bot changes (it only renders live fog state).
- Restoring rim/wisp at the live→memory seam (D2 ships the wobbled fade only).

## 6. Decisions (taken 2026-09-09)
1. D3: client capture limited to explored ground and battlemaps. No new data shipped to players.
2. Floor show-through on battlemaps is a DM toggle, off by default.
3. Heavy fog (up to three smoke layers) is a DM toggle, off by default; both settings measured against 3a.
4. Defaults are locked in a later mockup/live session after the panel is on the table; WP1 ships provisional values.

Remaining before WP1 starts: approval of this plan as written.
