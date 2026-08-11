# Beat 2 value-chain diagnosis (Diagnose phase — no visual changes made)

Scope: `WorldTurns.tsx`, `textures.ts`, `Outline.tsx`, `Diorama.tsx`, `TableScene.tsx`, `Canvas3D.tsx`.
Three.js `^0.185.1`. Read-only trace, numbers below are order-of-magnitude hand
calculations through the real shader math (toon banding, physically-correct
point-light falloff, ACES Filmic fit, sRGB encode) — good enough to rank root
causes and size corrections, not a pixel-exact render.

## 1. The full chain, in render order, for one floor/wall pixel

1. **Albedo** — `getFloorTexture(FLOOR_TINT='#2b2e26', ...)` / `getWallTexture(WALL_TINT='#181a13')`,
   canvas-drawn, `texture.colorSpace = SRGBColorSpace` (GPU converts sRGB→linear on sample).
2. **Material `.color` tint** — `WHITE` at beat 2 (night lerp `clockT` is 0 until beat 5). No-op.
3. **AO map** — derived from albedo luminance, range 0.55–1.0 (`deriveReliefMaps`), multiplies
   the *indirect* (ambient) term only.
4. **Toon ramp** (`getToonGradientMap`, 4 steps ≈ 0.235 / 0.51 / 0.745 / 1.0) — quantizes
   `N·L` for each *direct* light (torch point light, WorldTurns' sun). Ambient/indirect
   irradiance is **not** banded — added to the diffuse sum unquantized.
5. **Ambient light** (`WorldTurns.tsx`) — color lerps `WARM(#eda94e)→COOL`, intensity
   `AMBIENT_WARM_INTENSITY = 0.12` at beat 2 (day). Only ambient source in the scene.
6. **Sun (directional)** — `SUN_WARM_INTENSITY = 0.15`, banded via the ramp same as torches.
7. **Torch point lights** (`Diorama.tsx`) — `TORCH_INTENSITY=2.2`, `distance=TORCH_DISTANCE=4.5`,
   `decay=2`, height 1.4. Physically-correct falloff: `1/max(d²,0.01) × (1-(d/cutoff)⁴)²`.
8. **Baked additive glow quad** (`getTorchGlowTexture`, `AdditiveBlending`, `toneMapped:false`) —
   a separate 7×7-unit plane per torch (`TORCH_POOL_SIZE`), stops `rgba(255,217,160,0.35)` core →
   `rgba(237,169,78,0.16)` mid, laid **on top of** the shaded floor, not multiplied through it.
9. **Fog** — `TableScene.tsx` mounts one scene-wide `<fog near=26 far=60>`. Beat-2 camera sits at
   world-y 13–15 (`cameraPath.ts` keyframes 1–2), i.e. **distance ≈13–15 from the floor**, inside
   `near=26` → fog factor is 0 at beat 2. Ruled out for this beat (see §4).
10. **Outline pass** (`Outline.tsx`) — backface-only ink mesh, only visible at silhouette edges.
    Does not touch face-interior color. Ruled out.
11. **Tonemap** — `Canvas3D.tsx` sets `THREE.ACESFilmicToneMapping`, exposure left at default `1`.
12. **Output encode** — linear→sRGB (R3F default `outputColorSpace = SRGBColorSpace`).

## 2. Numeric walkthrough

All colors converted sRGB↔linear with `x^2.2`/`x^(1/2.2)` (close enough to the real piecewise
sRGB curve for this purpose). ACES via the standard Narkowicz fit:
`f(x) = x(2.51x+0.03) / (x(2.43x+0.59)+0.14)`.

### Floor, directly under a lit torch (room A, `t1`/`t2`, mid-pin, 2 lit)
- Albedo linear ≈ `(0.021, 0.024, 0.016)` (from `#2b2e26`).
- Torch diffuse: `d=1.4` (torch height) → falloff `1/1.96 × 0.98 ≈ 0.50`; `N·L≈1` → top ramp
  band `1.0`. Torch color linear ≈ `(0.85, 0.40, 0.07)` (from `#eda94e`).
  Irradiance ≈ `2.2 × 0.50 × (0.85,0.40,0.07) = (0.94, 0.44, 0.08)`.
- Ambient: `0.12 × (0.85,0.40,0.07) = (0.10, 0.05, 0.008)`.
- Diffuse floor color ≈ albedo × (torch+ambient) × AO(~0.9) ≈ `(0.020, 0.011, 0.0012)`.
- **Additive glow quad, core stop, alone**: `0.35 × linear(#ffd9a0) = 0.35×(1,0.70,0.35) = (0.35, 0.245, 0.123)`
  — **17× the diffuse term in R**. This one additive layer already dwarfs the correctly-lit floor.
- Sum ≈ `(0.37, 0.256, 0.124)` → ACES → `(0.513, 0.382, 0.169)` → sRGB encode →
  **≈ `rgb(187,165,113)` = `#bba571`** — a caramel/tan pixel, nowhere near the contract's
  `#4a4030`–`#6a5638` band, and brighter than mid-value stone should ever read.

### Floor, outside any torch pool (same room, back strip)
- Only ambient reaches it: diffuse ≈ albedo × ambient × AO ≈ `(0.0020, 0.0011, 0.0001)`.
- ACES compresses small inputs to roughly `0.21×` before the sRGB curve even applies
  (`f(0.002)/0.002 ≈ 0.21`) — this is ACES Filmic's known shadow-crush behavior on sub-1
  linear scenes.
- Result ≈ **`rgb(8,7,3)` = `#080703`** — effectively void-black, not the contracted `#2b2e26`
  mid-tone.

### Wall face, near a torch (worst case for "walls must stay darkest")
- Albedo linear ≈ `(0.007, 0.008, 0.004)` (from `#181a13`, already ~3× darker than floor albedo).
- Torch diffuse at `d≈2`, mid ramp band `0.745`: irradiance ≈ `2.2×0.23×0.745×(0.85,0.40,0.07) ≈ (0.32,0.15,0.03)`, plus ambient `(0.10,0.05,0.008)`.
- No baked glow quad on walls (glow is floor-only geometry).
- Result ≈ `(0.003,0.0017,0.0002)` → ACES → sRGB ≈ **`rgb(11,8,3)` = `#0b0803`** — comfortably
  under the `≤#20221a` ceiling.

**So: walls are already correctly ink-dark. The value-inversion gate (#1) is not currently
failing on the wall side — it's failing because the floor swings to both extremes (near-black
away from torches, blown caramel under them) instead of holding the mid `#2b2e26` band.**

## 3. Room geometry makes the wash worse, independent of the alpha math

Room A is `8×6` (`mapData.ts`), torches `t1 (1,1)` and `t2 (7,1)`, 6 units apart. Each glow
quad is a 7×7 plane (`TORCH_POOL_SIZE=7`, radius 3.5). Two pools 6 units apart with radius 3.5
each overlap by ~2 units and between them blanket `x:0→8, z:0→4.5` — i.e. everything except a
1.5-unit strip at the room's far edge. With only 2 of 4 torches lit at mid-pin, **most of the
visible room is already inside a pool**, so the per-pixel wash computed above reads as a
room-wide caramel cast, not discrete pools — exactly the "smoky/caramel wash" symptom from
round 2. Fixing the alpha math without also confirming pool-radius-vs-room-size still leaves
gaps to return to base stone (art-brief: "floor between pools returns to `#2b2e26`").

## 4. Ruled out

- **Fog**: scene-wide but `near=26`; beat-2 camera distance (~13–15) is inside `near`, fog
  factor 0. Not a beat-2 contributor (it is legitimately active for beats 7–8's pull-back,
  where it's not implicated in this complaint).
- **Outline pass**: backface-silhouette only, never touches face fill color.
- **Toon-ramp banding logic**: the 4-step quantization itself is fine; the problem is the
  *magnitude* of what feeds it (ambient too low, glow-quad alpha too high), not the bands.
- **Wall tint / wall-side lighting**: already dark enough, not the active failure right now.
- **Double ambient**: `Diorama.tsx`'s own comment confirms this was already fixed (only
  `WorldTurns` mounts the scene's ambient now).

## 5. Root causes, ranked

1. **Additive torch-glow quad is the dominant term and is unmultiplied by anything.**
   `getTorchGlowTexture`'s core/mid alpha stops (0.35 / 0.16) times a near-white/torch-hot
   color, additively blended with `toneMapped:false`, are ~15–20× larger (pre-tonemap) than
   the correctly-shaded diffuse floor beneath them. This single layer is what reads as
   "caramel wash" — it's floor-only geometry sitting on top of everything else, not scaled to
   the rest of the exposure.
2. **Baseline ambient (+ sun) is far too weak for ACES Filmic's shadow response.** At
   `AMBIENT_WARM_INTENSITY=0.12`, unlit floor lands at a linear input (~0.002) that ACES
   compresses by another ~5×, crushing `#2b2e26` stone to near-void black instead of holding
   the mid-tone. Note the asymmetry: `AMBIENT_COOL_INTENSITY` (night, 0.55) is already
   **4.5× brighter** than the day value (0.12) — day should not start from a dimmer ambient
   floor than night; that's backwards and independently explains why floors read near-black
   through most of the day beats.
3. **Pool radius vs. room size leaves no gap to return to base stone** at typical torch
   spacing (§3) — compounds #1 into a room-wide wash rather than discrete pools, independent
   of the alpha numbers.
4. **Tonemap choice amplifies #2.** ACES Filmic's small-signal gain (~0.21× in the shadow
   region relevant here) means any toon-lit sub-1 scene needs roughly 4–5× more baseline
   irradiance than a `NoToneMapping` pipeline would to read the same painted hex back off
   screen. Not wrong by itself, but it means fixes to #2 need to be sized against ACES, not
   against a naive "ambient intensity 1.0 ≈ full brightness" assumption.

## 6. Minimal corrections (target numbers)

All in the already-scoped files; no other pipeline stage needs to change.

- **`textures.ts` → `getTorchGlowTexture`**: cut the additive stops roughly 2.5–3×:
  core `0.35 → ~0.12`, mid `0.16 → ~0.05`. This alone should pull the under-torch floor pixel
  from `#bba571`-caramel back toward the `#4a4030`–`#6a5638` band once paired with the ambient
  fix below (the two corrections are not independent — do both, then re-measure).
- **`WorldTurns.tsx` → `AMBIENT_WARM_INTENSITY`**: raise from `0.12` toward **`~0.5–0.6`**
  (i.e., stop being *dimmer* than the night value `AMBIENT_COOL_INTENSITY=0.55` — day ambient
  should be at or above night ambient, not a quarter of it). This is what lifts unlit floor off
  near-black toward `#2b2e26`. Re-check wall faces stay `≤#20221a` after this change — since the
  raise is a uniform multiplier and wall albedo is already ~3× darker than floor albedo at the
  texture level, the floor > wall value relationship should hold, but confirm rather than assume.
- **`Diorama.tsx` → `TORCH_INTENSITY`**: likely wants a modest trim (`2.2 → ~1.5–1.7`) once the
  ambient floor is raised and the glow quad is dimmed, to avoid double-brightening the same
  torch pool from two directions (diffuse + additive). Treat as the last knob, tuned after 1–2
  land and get re-measured against the board reference, not applied blind.
- **Room/pool geometry**: after 1–3 land, re-check `TORCH_POOL_SIZE`/`TORCH_DISTANCE` (currently
  7 / 4.5, already matching the brief's stated radius) against actual room dimensions — Room A's
  two lit torches at mid-pin still overlap-cover most of the room (§3); if pools still read as
  one continuous wash after the alpha/ambient fixes, the fix is spacing/radius, not alpha, and
  belongs in `mapData.ts` (out of this task's file scope) or a `TORCH_POOL_SIZE` reduction.
- **Tonemap**: not recommending a change to `ACESFilmicToneMapping` itself (it's an explicit,
  reasonable choice and the brief doesn't ask to remove it) — but the corrections above are
  sized *for* ACES's shadow-compression behavior. If 1–3 still can't hit the `#2b2e26`/`#4a4030–
  #6a5638` targets simultaneously without blowing out highlights, the next lever is
  `gl.toneMappingExposure` (currently default `1`, unset in `Canvas3D.tsx`) rather than pushing
  individual light intensities further.

No visual changes were made in this pass.
