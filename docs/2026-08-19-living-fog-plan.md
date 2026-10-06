# Living Fog — look & feel plan

Reference: r/DnDIY "Creating realistic Fog Of War for my TV Tabletop Build" (GameboxAU).
Bar set: **this or better only.**

Decisions (adjudicated 2026-08-19):
- Mood: **scene-tinted** fog palette (hue from the scene's ambient/time), with **cold night smoke** as the night-default identity.
- Memory tier (explored, out of sight): **thin drifting mist** over the dimmed map.
- DM screen: **subtle animated haze** — same shader, low alpha, everything stays readable.
- Tools this round: **brush size** + **rect reveal/hide box**. (Polygon lasso deferred.)

Mockup (interactive, WebGL, the real shader): `docs/mockups/fog-living-mockup.html` — open directly in a browser.
Four mood presets, working brush/box tools, "party moves on" memory conversion, player + DM panels side by side.

## Shape of the change

The fog *geometry* pipeline is untouched. Reveal state, Clipper2 regions, token vision,
server redaction, wire commands, DB — all stay. Only the *paint* changes, plus two tool
additions that ride existing commands. No migration, no new wire commands.

Player identity flips from "fog-as-void" (hidden ≙ empty background) to "living fog"
(hidden ≙ visible animated fog). Both hide identically — one uniform cover over
everything unearned — so no information leak. The `FogRenderer.ts` header doc gets
rewritten to the new doctrine.

## Phase 1 — player fog goes living (`session/client/src/modules/fog/FogRenderer.ts`)

1. **Mask render target.** On fog mutation (existing rebuild discipline, `subscribeFogScene`),
   rasterize the already-computed earned/memory/drained ring trees into a small offscreen
   RenderTexture (≈½ screen res, linear-filtered). Tier encoded in R: 0 hidden, 0.5 memory,
   1 visible (drained flagged in G). `featherEdge()` stepped strokes retire — the feather
   comes from mask res + shader erosion.
2. **Fog quad + shader.** Full-viewport quad in the existing screen-space `playerFog` layer
   with a custom Pixi v8 shader (pattern: `waterAnimation.ts` DisplacementFilter hookup).
   Port of the mockup shader (v2, cloud doctrine): three light billow strata
   (`abs(2n-1)` noise — puffy lobes, never streaky warped-FBM smoke) with independent
   drift vectors so layers slide over each other; coastline = the billow field
   thresholded against a cloud-warped mask lookup, giving scalloped lobes/bays with a
   narrow transition, a darker dense rim at the cut edge, and faint wisp overhang into
   clearings. **Hard rule: hidden ground renders at alpha exactly 1.0, flat — nothing
   beneath (map bounds included) may telegraph through the cover.** Time is the only
   per-frame uniform.
3. **Scene-tinted palette.** Derive deep/mid/high from the ambient composite via the
   existing `voidStyle()/lit()/graded()` channel helpers so fog pixels stay consistent
   with the lighting doctrine. Night default = cold-smoke preset from the mockup.
   DM bite/strength rules unchanged.
4. **Tiers.** Never-explored → dense opaque fog (dot-grid void retires under it, player
   view only). Memory → existing `EXPLORED_TINT` dim stays, thin mist above it.
   Darkvision `drained` keeps its desaturation grade beneath the mist.
5. **Motion discipline.** Time advances only while the tab is visible;
   `prefers-reduced-motion` → frozen frame (still gorgeous as a still). Mask rebuilds
   only on fog change, exactly as today.

## Phase 2 — DM haze (`session/client/src/modules/fog/FogOverlay.ts`)

Replace the flat `FOG_TINT` fills for `never_revealed`/`re_hidden` rooms with the same
shader at DM alphas (≈0.48 dense / 0.20 mist equivalent, from `DM_FOG_LOOK`). Hover
highlight, brush cursor, and all pointer input unchanged.

## Phase 3 — tools (`FogTool.tsx`, `brush.ts`, `FogOverlay.ts`)

- **Brush size**: `size` field on `useFogBrush` (the upgrade path already noted in
  brush.ts), disc-of-cells stamping with segment interpolation, slider in the FogTool
  panel, scaled ring cursor. Rides the existing `region-set` batching.
- **Rect box**: new tool mode; drag marquee → vision mode: cells in rect → `region-set`;
  rooms mode: intersecting rooms → existing `reveal`/`hide`. Reveal and hide variants.
- Full design-review pass on the FogTool panel UI.

## Phase 4 — gate

Docker-deployed E2E walked live in the browser on the dressed Fieldstone Keep demo:
zero console/network errors, both seats, real fps numbers. Extend the
`sprint3-fog.spec.ts` 60fps assertion to run with the shader active (8 tokens + active
mask). Fallback if the budget misses: render fog to a half-res target and upscale.

## Risks

- **Perf**: first per-frame filter on the fog layer. GPU cost of 5-octave FBM at 1080p
  is expected fine; the 60fps e2e gate is the arbiter, half-res target is the escape hatch.
- **Ambient coupling**: shader palette must respect the lighting composite the same way
  the flat fills did, or fog pops against lit ground at dawn/dusk. The channel helpers
  are the single source for this.
- **Branching**: work branches off main (discord-bot-v1 is a separate unshipped branch).

## Non-goals

Bot snapshots (never render fog — pre-redacted docs), the Editor app (no fog), fog data
model/wire changes (none needed), polygon lasso (deferred).
