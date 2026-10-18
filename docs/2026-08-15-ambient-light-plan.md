# Ambient Light — Plan

Approved 2026-08-15. One complete feature, no v1/v2 tiers — everything below ships together (time auto-advance included per confirmation). Presented and confirmed in-session; mockup round (P0) is the first deliverable.

## Vision

The DM authors a map's mood in the Editor, sets the world's time at the Table, and the light behaves like weather: the map cools and dims as evening falls, shadows swing and stretch with the sun, and when true night lands a player's torch becomes the boundary of their world. Light must feel *natural and painted* — the reference-board look (`docs/art-style-guide.md`, the release gate) — never a forced overlay. Everything is global across Editor (canvas) and Table (session), settable by the DM from either.

The art style guide already demands this: "baked ambient lighting… **one consistent global shadow direction per map**", "ambient tint per scene", and its gap table ranks "Scene grade — usable today, unused" at #6. This plan implements the style guide's lighting half.

## The model — three layers, one coupling

| Layer | Scope | What it is |
|---|---|---|
| **Mood grade** | per map (authored) | Existing `mapSettings.ambientLight` promoted: the map's base grade — "this world in neutral daylight". Always applies (fixes the current zero-lights skip). Tints map, background, and grid. |
| **World clock + time grade** | campaign (live) | One clock for the world. Time slider + quick jumps (dawn / morning / noon / evening / night). Per-map **time palette**: biome preset with per-keyframe recolorable swatches; OKLCH interpolation between keyframes → continuous gradient of the day. Composes on top of mood grade. |
| **Natural light (sun & moon)** | per map toggle (outdoor) | Sun/moon position from clock + map orientation ("which way is east"). Painterly directional shadows: soft polygons extruded from wall segments along the light vector + direction-aware prop offset shadows. Length/color/softness follow time — long amber at dawn/dusk, short neutral at noon, faint cool silver under the moon. Map area only, never grid or void. |
| **Darkness coupling** | rule + override | On outdoor maps the clock drives the vision gate (`AmbientLevel`): night → darkness (modulated by night sky), dawn/dusk → dusk, day → daylight. Indoor/underground never auto-flip. DM override always beats the clock. Badge shows the *effective* state. |

**Environment type** (per map, authored): `outdoor | indoor | underground`.
- *outdoor* — follows clock and sky fully.
- *indoor* — time grade damped (night outside makes the tavern moodier; the hearth still rules), no auto-gate.
- *underground* — ignores clock and sky entirely ("torchlit crypt at noon"; the existing decoupling comment in `prep.ts` becomes this rule).

**Night sky** (campaign, next to the clock — the sky is shared): `full-moon | crescent | moonless`.
- *Full moon* — cool dim grade, world visible: auto-gate lands on **dusk** (no vision clipping); soft silver directional shadows; torch pools read warm against the cool wash.
- *Crescent* — **darkness** gate with a softened bite: faint cool fill beyond torchlight (players sense shapes, not detail); weak moon shadows.
- *Moonless* — pitch black: full darkness gate, no directional shadows; torches and darkvision are the entire world.

**Time speed** (campaign): auto-advance rate for the world clock (paused / real-time-ish / fast dial, DM-set at the Table). Advancing time ticks the grade, shadows, and coupling exactly as manual scrubbing does, on coarse time steps.

## DM / player experience

**DM, Editor:** an "Environment" section in map properties — environment type, mood tint (existing presets + custom), time-palette preset + keyframe swatches, natural-light toggle + orientation compass — with a **live day-scrub preview** to watch the map pass through a whole day while authoring.

**DM, Table:** a "World" block in Session Controls — clock slider, quick jumps, night sky, time speed, darkness override. Same state both surfaces; session values win during play. The DM *sees the grade* (mood is presentation, not information) but **never loses visibility** — the vision-hiding bite stays players-only (PRODUCT principle 3).

**Players:** nothing to configure. The world just changes. Fog/vision mechanics engage per the coupling; explored-memory, darkvision tint, and torch pools behave as shipped in the token-vision-fog work.

## Current state (survey, 2026-08-15)

Two unlinked "ambients" exist today:
- `MapSettings.ambientLight: string` (map tint, `packages/core/src/store/types.ts:24-31`, default `#2d2d44`, `SetAmbientLightCommand`, edited in `canvas/.../PropertiesPanel.tsx` with 6 presets) → fills the light FBO base in `LightingRenderer.updateAndRender` (`packages/core/src/engine/lighting/LightingRenderer.ts`); full-screen multiply sprite, alpha 0.95, in `overlay()`. **Skipped entirely when a map has zero lights and no forced dial.**
- `AmbientLevel = 'daylight'|'dusk'|'darkness'` (`packages/core/src/shared/prep.ts`), per-scene in `SceneTriggers.env.ambient` (triggers module), set via `set-environment` (`SessionControls.tsx`), synced unredacted. Mechanics: only `darkness` matters — `needsLight()` clips normal vision to `lightSources()` coverage (shared pure rule, `packages/mechanics/src/fog/light.ts`; server `session/server/src/fog/vision.ts`, client `session/client/src/modules/fog/FogRenderer.ts`). Presentation: `AMBIENT_BITE = {daylight:.45, dusk:.75, darkness:1}` × `LIGHTING_STRENGTH = {dm:0, player:.7}` — **the DM view is pinned to 0 and today never sees any of it.**

Light sources: authored `LightChild` (color/radius/feather/intensity/falloff/mask/flicker; 24-light render cap), token torches (pseudo-LightChild via `lightSync.ts`, `radius=max(dim,bright)`), trigger `lightOverrides`. Sight: range + `normal|darkvision`; `angle` fields exist but are ignored everywhere (standing non-goal, unchanged by this plan). `env.time` exists as narration-only vocab (`dawn/day/dusk/night`) — this plan makes it real.

Storage: all lighting data lives in the map JSON blob + `module_state` JSON; no SQL columns (fine — stays that way).

## Architecture

**1. Grade/bite split (the prerequisite).** Split the single multiply pass driver into:
- **Grade** = mood tint × time tint (interpolated) × environment damping — applies to *everyone*, both apps, DM included. Always on when set (remove the zero-lights skip for grade).
- **Bite** = vision-darkness strength — players only, exactly today's `AMBIENT_BITE × LIGHTING_STRENGTH` path, now driven by the *effective* gate (coupling output), with the crescent "softened bite" as a third strength value.
`LightingRenderer` grows `setGrade(color)` alongside `setAmbientLevel(darkness)`; the FBO base color becomes the composed grade instead of raw `ambientLight`.

**2. Time interpolation.** Keyframes at dawn/morning/noon/evening/night (per-map palette, campaign clock). Interpolate in OKLCH. Clock is coarse-stepped (minutes-granularity ticks); the lighting-signature memoization gains a time-bucket term so idle frames stay free and a paused clock costs nothing.

**3. Sun/moon shadow pass (the hard part).** New geometry pass, *not* the point-light sweep:
- Per wall segment, extrude a soft shadow quad along the sun/moon vector; length & alpha & blur-feather from time and sky; reuse the existing `extractWallSegments` + `SegmentQuadtree` infrastructure and the geometry-feather technique (nested strokes) already proven in `FogRenderer` — no per-frame filters.
- Props: direction-aware offset/skew shadow under object sprites.
- Cache per (wall-set, sun-step); recompute on time step, wall/door edit, orientation change. Clip to map area (floor/terrain union), never grid or void.
- Chosen lane is **painterly** (style-guide "one confident shadow direction"), not physical simulation — it still moves with the clock via steps.

**4. State & sync.**
- Map document (authored, zero-setup): `environment`, mood tint, time palette (preset id + keyframe overrides), natural-light toggle, orientation, `timeMode: 'clock' | 'fixed'` + `fixedTime` (static-sun maps, decision #9 — fixed maps ignore clock and speed for grade/sun/coupling).
- Campaign live state (new `world` slice or extension of triggers `env`): clock time, night sky, time speed, per-scene DM gate override. Rides the existing module command/broadcast path (`set-environment` pattern), unredacted (world state everyone sees).
- Coupling resolver (pure, shared server+client like `lightSources()`): `(environment, clockTime, nightSky, override) → { grade damping, effective AmbientLevel, bite strength, sun/moon vector+intensity }`. Server uses effective level for vision gating; clients use all of it for paint. One rule, two runtimes.

**5. Both apps.** The pass lives in `packages/core`; Editor consumes it with a preview clock (local, not synced), Table with the campaign clock. Editor preview never mutates campaign state.

## Coupling table (resolver spec)

| Environment | Clock | Sky | Grade | Effective gate | Directional shadows |
|---|---|---|---|---|---|
| outdoor | day | — | mood × noon key | daylight | sun, short/neutral |
| outdoor | dawn/dusk | — | mood × dawn/dusk key | dusk | sun, long/amber |
| outdoor | night | full moon | mood × night key | dusk | moon, soft silver |
| outdoor | night | crescent | mood × night key | darkness (soft bite) | moon, weak |
| outdoor | night | moonless | mood × night key | darkness (full bite) | none |
| indoor | any | any | mood × damped time key | manual (DM) | none |
| underground | any | any | mood only | manual (DM) | none |

DM override replaces the "effective gate" column whenever set; badge shows the post-override result.

## Phases

Workstream convention: each phase is specced, built in one focused pass, reviewed; ≤5 workers per step; user reviews between phases. No PR/publish without user say-so.

- **P0 — Mockups.** DONE 2026-08-15 — three options built + design-reviewed, user adjudicated: B chassis + C grafts (decision log #8), static-time requirement added (decision log #9).
- **P1 — Grade/bite split.** DONE — commit ee79125 (+review fix round in-commit). Grade fills the FBO base for every seat; lights tinted through lerp(white, grade, 0.35) so lit ground can't escape the grade (W1); explored/drained washes are strict shares of the live room by construction.
- **P2 — World state + clock.** DONE — ecf7064 (state/resolver, reviewed SHIP no findings), 08d0875 (Editor Environment section), 0896bdb (Table World block + coupling-trace badge), reviewed SHIP no fixes. World clock superseded the env time dial; ambient dial became the gate override.
- **P3 — Sun & moon shadows.** DONE — 868657b + fix rounds 7e0a1d5 (eased low-sun alpha, daylight mood on demo keep), ce3d65c/0cfb4d3 (mask lifecycle: Pixi stencil masks bake at build time and can't be redrawn in place → shadows now clipped as Clipper2 geometry; void takes ⅓ of the grade, not all of it — grade² orange-flood fix). P3b explored-memory raster mask DONE c383075 (marching-squares isocontour, repaint only on cell delta). Terrain clip half is an AABB, not per-texel (stencil was never per-texel anyway); revisit only if a terrain-heavy outdoor map ships.
- **P4 — Time speed.** DONE — e672fb2 + d933be7. Server-authoritative WorldTicker per open session, drift-free, dispatches real set-world commands; clock is campaign-global across scene switches (adjudicated); real=1×, fast=24×.
- **P5 — Gate.** PASSED 2026-08-16 (dev lanes, no Docker — approved). Walk A (Editor) A1–A7 pass; Walk B (Table, DM+player) B1–B9 pass; shadow-visibility finding led to the P3 fix rounds above, then re-verified live with pixel extraction at noon/17:00/21:00-full-moon. Zero console/network errors throughout; 59–61 FPS worst case (night + shadows, both roles); idle coarse-tick by design. Evening quick-jump moved to 17:00 (ca9f255) — 18:00 is the sunset zero and casts nothing by construction. Design review: impeccable passes ran inside both UI builds; live walk confirmed. Evidence: docs untracked — screenshots in session scratchpad gate-walk/.

Post-gate fix round (2026-08-16, cfaeb3e): daylight moods let grade + additive light clamp pools to white — a white pool in a multiply composite is no pool — so light alpha now scales by `headroom(grade)`; night palette keys darkened ×0.4 (they were calibrated against near-black moods); MAX_ALPHA 0.42→0.6 so shadows read at play zoom. All re-verified live by eye + pixel extraction (0 clamped px at noon/17:00/midnight; warm pools against cool night; zero console errors; 59-60 FPS).

Tracked findings (pre-existing, not regressions, not fixed):
- LightingRenderer's player-bite second pass paints the grade over itself in normal blend — a literal no-op (player darkening actually comes from the fog scrim path, which works). Dead code to remove in a quiet moment.
- Prop shadows are a fixed `length × 0.55` regardless of prop size — a 6-unit tree casts a 1.9-unit smear. Needs per-prop height in the data model; feature, not tuning.
- Terrain half of the shadow clip is an AABB (per-texel was never reachable through a stencil); revisit only if a terrain-painted outdoor map ships.

Remaining taste knob: courtyard grass tile art is naturally dark olive (art note, not lighting).

## Decisions log (this session)

1. Time auto-drives the darkness gate on outdoor maps; DM override always wins. (User-confirmed.)
2. Shadows are painterly directional (extrusion), not physical simulation — style-guide lane; still clock-driven via steps. (Asserted; "all of it ships" confirmed.)
3. Time colors = curated biome presets + per-keyframe recolor, no free curve editor. (User-confirmed.)
4. Moonlit vs pitch-black night IS a setting: night sky = full moon / crescent / moonless. (User correction — no tiers, everything ships.)
5. Time speed included. (User-confirmed at plan approval.)
6. Grade applies to the DM view; bite never does. Mood is presentation, visibility is sacred. (PRODUCT principle 3.)
7. Environment type is map-authored data (zero-setup principle), sky+clock are campaign live state.
8. P0 adjudicated 2026-08-15 (user): **Option B (sky ribbon) is the chassis**; graft **C's coupling-trace badge** (live coupling sentence under the badge, struck through + replaced with "You set X. The clock would say Y." on override) and **C's inapplicable-state treatment** (per-layer explicit N/A with reason sentence, never bare grey). A's rack-row compactness may be borrowed for the Table's sky/speed rows. Mockups in `docs/mockups/2026-08-15-ambient-light/`.
9. **Static-time maps** (user-added at adjudication): per-map authored `timeMode: 'clock' | 'fixed'` + `fixedTime`. A fixed map pins the sun/grade/coupling to the authored time and ignores the world clock and time speed entirely; the DM "places the sun" once in the Editor. Badge shows fixed provenance at the Table. Editor control lives in the Environment section next to the natural-light toggle; the day-scrub doubles as the fixed-time picker when mode is fixed.

## Live-walk findings (2026-08-15, dev server, Fieldstone Keep, DM + player)

Confirmed working, blends well: authored lights (braziers/lantern/hearth/candles) render as warm shadow-swept pools; multi-light + vision-sweep unions read as one organic shape; light spills through open doors as natural cones; darkness gate correct (normal eye in unlit room sees only distant lit ground, own square dark); darkvision drained wash stays cool while lit pools stay warm through it; env dial syncs live with badge + toasts; 60 FPS both roles; zero console errors.

Feeds the build:

- **W1 (drives P1).** `AMBIENT_BITE` only darkens the *unlit base*, but vision-mode players mostly can't see unlit ground anyway — daylight/dusk/darkness are near-indistinguishable wherever ground is lit. The grade must tint the **lit** map too or ambient will never be felt at the table. This is the central P1 requirement, verified empirically.
- **W2 (drives P1).** DM strength-0 means the DM sees a flat unlit map all session — no brazier glow, no mood. Confirms grade-applies-to-DM.
- **W3 (pull into P1/P3).** The explored-memory tier has hard stair-stepped cell edges that visibly clash with soft feathered pools; an ambient grade will make the seam more obvious. The fog backlog's raster-mask item is a visual-quality fix for this workstream, not just perf.
- **W4 (note only, pre-existing, not lighting).** Player door panel/markers show doors the party has never seen; redaction question for another day.
- False alarm, recorded so it isn't rediscovered: darkvision tint appearing to cover lit pools was probe error — sample points sat inside brazier pools; well-lit rooms make vision modes and ambient levels visually identical. No bug.

## Known constraints & watch items

- 24-light render cap vs uncapped fog rule is pre-existing debt; unchanged here but night scenes lean harder on lights — re-check on the gate walk.
- `sight.angle` / `light.angle` cones stay non-goals.
- Editor preview clock must not leak into campaign state.
- Fog mask layering (screen overlay above the multiply composite) must hold with grade always-on — regression-check the void-imitation path (`voidStyle()`).
- docs/ and PRODUCT.md stay untracked; this doc never ships in a commit.
