# P3 spec — token-vision fog: the light model

Parent plan: `docs/2026-08-15-token-vision-fog-plan.md`. Prereqs: P1 (12d75c4 + 45aceea)
and the P2 client mask (13d0041 + its findings-fix commit). P2's landed client API,
for the sections below: `session/client/src/modules/fog/visionSight.ts` (party sweep +
LightManager-shaped memo; `sightLayers` nulls `mergedFloor` — keep light sweeps
consistent with that occluder choice), `fog.ts` `visionRegion(sight, region, revealed,
shipped, pad, feather)`/`regionRects`/`sightPad` (clipper pipeline; clear AND memory
both clipped to shipped geometry), `FogScene` optional fields `mode?/sight?/fog?`,
probe fields `mode/sweepSources()/rebuilds/lastRebuildMs/memoryCells()`. Adjudicated
semantics: `'revealed'` room status = DM act (whole-room memory wash); auto-explored
rooms are `re_hidden`+bits (cell-granular); vision mode runs no reveal fades.
The §3 clear-area change slots into `visionRegion` as an additional intersection with
(lit ∪ darkvision reach) when ambient is darkness. Rooms mode stays byte-identical; everything here is behind
`mode === 'vision'`, and with the ambient default the P2 vision behavior is unchanged
until a DM touches the dial — P3 is additive on P2 exactly as P2 was on P1.

Scope: ambient light level (state + command + the one small dial control), light-gated
normal vision, token-carried lights, darkvision treatment (impeccable on the look),
server redaction + auto-explore gated by the same light test.

## Verified seam facts (scouted 2026-08-15)

- NO environment module exists: time/weather are `SceneTriggers.env: { time?, weather? }`
  (triggers/types.ts:71), DM-only `'set-environment'` command (triggers/module.ts:62,
  handler L181 merges deltas, narrated log via `envText`, `toPlayers: true`); vocab
  `TIMES`/`WEATHERS` in `packages/core/src/shared/prep.ts:12-16`. `env` and
  `lightOverrides` ride to every viewer unredacted (module.ts:84-99).
- Light on/off truth: `SceneTriggers.lightOverrides: Record<lightId, boolean>`
  (types.ts:70), written by trigger action case `'light'` (module.ts:441-456); client
  reconciles via `session/client/src/modules/triggers/lightSync.ts`
  (`overrides[child.id] ?? child.visible` at L41, writes `LightChild.visible` onto the
  loaded doc). `LightManager.getVisibleLights()` filters `visible !== false`.
- `LightChild` (core shared/types.ts:167-183): `color, radius, featherRadius,
  intensity, falloff('linear'|'quadratic'), position, flicker…` — ONE radius, no
  bright/dim split. `Token.light: { dim, bright, color, angle } | null` is separate,
  schema-only, unused.
- `LightingRenderer.updateAndRender(lightManager, camX, camY, zoom, ambientColor)`
  (L245-251), called from renderLoop.ts:179-184 with `mapSettings.ambientLight`; FBO
  cleared to ambientColor (L302-308), ≤24 nearest lights, per-light polygon from
  `LightManager.getOrComputePolygon`, radial FillGradient, additive into lightFBO,
  multiply-composite alpha 0.95. Cache-guard `lightingSignature` (L29-59). NO darkness
  scalar exists; threading one is a 6th param + signature part + ambient fill alpha —
  the scout confirmed this is a small isolated diff.
- Server knows lights by NAME only (`SceneMap.lightNames`, sceneMap.ts:47, built
  L105-111); positions/radii sit unparsed in `data.layers[].children`. Extraction
  mirrors the existing doors/zones indexing. Live on/off = triggers module state via
  `stores.moduleState.get(campaignId, 'triggers')` (prepResolver.ts precedent L58-73).
- Environment UI lives as a section (L339-398) of SessionControls.tsx (panel
  'session-controls', title "Session", DM-only, order 0): `env-time`/`env-weather`
  selects → `sendCommand('triggers','set-environment',…)` with a 4s optimistic echo;
  read-only badge in TableStatusBar.tsx:112-119.
- No ColorMatrix/desaturation filter exists anywhere in core; the only Pixi filter
  precedent is water's DisplacementFilter attached via `container.filters`
  (sceneGraph.ts:186). Art style guide: dark dungeon = "near-black surround, grey
  floors, 1–2 strong warm glows doing all the color work" (L18); night = "Desaturated
  night ambient, low contrast" (L40); ambient color is explicitly flagged underused
  for scene mood (L82, L134).
- `mapSettings` is read-only live; the lightOverrides drift-reconcile pattern is THE
  precedent for a live scene dial overriding an authored default without touching the
  document.

## 1. Ambient light level (state + command + one control)

- Vocab in `packages/core/src/shared/prep.ts`: `AMBIENTS = ['daylight', 'dusk',
  'darkness']`, `AmbientLevel` derived — beside TIMES/WEATHERS.
- State: `SceneTriggers.env.ambient?: AmbientLevel` — absent ≡ `'daylight'` (existing
  scenes keep P2's purely geometric vision until the DM touches the dial).
- Command: extend `set-environment` payload with optional `ambient` (same delta-merge,
  same DM-only gate, narrated log line in the envText voice). Independent of
  time-of-day — time stays narration; auto-coupling time→ambient is a NON-GOAL (note
  scene presets as the future home).
- Mechanics of the gate (shared client/server): `daylight` and `dusk` → the whole
  sweep counts as lit (dusk differs only in presentation); `darkness` → only
  light-source coverage counts for normal vision.
- UI (the one P3 control, mockup-approved): an `env-ambient` select in the
  SessionControls Environment section, exactly the TIMES/WEATHERS pattern (testid,
  optimistic echo, vocabLabel), plus the TableStatusBar badge string gaining the
  ambient word when not daylight. Moss chrome, existing select styling — no new
  design surface. Impeccable bar applies to the darkvision LOOK (§4), not this select.

## 2. Light sources (shared semantics, both sides)

A scene's light-source list = placed lights (on = `lightOverrides[id] ?? visible`) +
token-carried lights (`Token.light` non-null on a non-hidden token in the scene;
hidden tokens' lights are OFF — a lit torch would leak a hidden token's position;
`ponytail:` note). Lit polygon per source = `clockwiseSweep(position, radius,
segments)` with the same occluder semantics as sight (closed doors occlude, unfound
secrets are walls). Radii: placed light = its `radius`; token light = `max(dim,
bright)` mechanically; bright-vs-dim is presentation only (v1 keeps lit/unlit binary
per the plan).

- Server: extend `sceneMap.ts` `index()` to collect light children ({id, position,
  radius, featherRadius, color, falloff, visible}) mirroring doors/zones; the sweep
  service gains lit-area computation with per-source memoization exactly like token
  sweeps (dirty on lightOverrides change, token-light move, door toggle); triggers
  state read via the existing moduleState store. The vision cache already invalidates
  on every module write (revision key), so a `set-environment` or relight trigger
  re-derives for free.
- Client: synthesize pseudo-`LightChild`s from token lights (id `token-light:<tokenId>`,
  position from token x/y, radius = dim, featherRadius = bright, color) and feed them
  through the EXISTING LightManager/LightingRenderer pipeline — zero renderer changes,
  the per-source shadow cache and 24-light cull come free. Sync them where lightSync
  reconciles overrides (same drift pattern, session store → core store).

## 3. Vision gating (the actual rule, applied identically in three places)

`seen(point, byToken) = inSweep(point) AND (ambient !== 'darkness' OR lit(point) OR
(byToken.sight.visionMode === 'darkvision' AND dist(point, byToken) <= sight.range))`

Party entitlement = union over the party's tokens. Applied in:
1. **Server `canSee`** (token redaction): replaces the P1 purely-geometric test when
   ambient is darkness. Wire truth: in darkness a token beyond every light and beyond
   darkvision is NOT on the wire; carried torch moves the boundary; darkvision reaches
   it unlit.
2. **Server auto-explore**: region bits and room credit accumulate only over seen
   cells (you explore what you saw, not what your sweep crossed in pitch black).
3. **Client clear-area mask**: live area = sweep ∩ (lit ∪ darkvision reach) — same
   clipper pipeline P2 built, with lit-union polygons unioned from the per-source
   caches on mutation only.

Darkvision tokens in daylight/dusk behave as normal vision (range still applies).

## 4. Darkvision treatment (the impeccable moment)

The darkvision-only area (visible via darkvision but unlit) renders DRAINED: the
party sees shape, not color. Direction from the approved P3 mockup + art style guide
("near-black surround… glows doing all the color work"; night = desaturated, low
contrast): achromatic lift above void level, clearly dimmer than lit space, chroma
visibly below the lit area's. Implementation options, implementer picks after a REAL
visual check (screenshot on the e2e fixture, both a lit torch pool and a darkvision
area in one frame): (a) masked container + `ColorMatrixFilter.desaturate` (no
precedent in core but the water DisplacementFilter shows the attachment mechanism) —
only if it holds 60fps; (b) the P2 wash primitive with a dedicated darkvision tint
(cheapest, on-precedent). The ambient dial also threads the darkness scalar into
`LightingRenderer` (6th param + signature + ambient fill alpha) so `darkness` scenes
actually read dark on the table and `dusk` reads between.

Reduced motion: no new animation is introduced (treatment is a static grade); any
transition riding existing fades inherits the existing reduced-motion path.

## 5. Tests (phase gate)

- Mechanics/server unit: ambient default + command merge + log; light-source list
  assembly (overrides precedence, hidden-token light off, token radius = max(dim,
  bright)); the §3 rule on a fixture (wall-shadowed light, door toggle relights a
  room edge, darkvision ring seen/unseen, dusk == daylight mechanically); auto-explore
  in darkness writes only seen cells; locked zones still beat everything.
- Wire test: darkness scene — unlit token id absent from player frames; lit by
  carried torch → present; darkvision viewer in range → present; `set-environment
  ambient` flip changes the answer without any token moving.
- Client unit: pseudo-light synthesis (id stability, dirty on move, removal on token
  delete/hide); clear-area = sweep ∩ lit union (fixture with a torch pool inside a
  larger sweep); darkvision area geometry.
- e2e (extend sprint3-vision.spec.ts): (5) darkness row — torch pool visible, beyond
  it void, on BOTH seats' pixels; (6) darkvision row — unlit area draws above void
  luminance with chroma below the lit pool's (the sprint3 chroma-metric pattern);
  (7) ambient dial flip live-changes the player canvas without a reload; (8) carried
  light moves with the token. Fixture: extend `vision-two-rooms.mapbuilder` (or the
  spec's setup commands) with a placed light and tokens carrying light/darkvision.
- Full gate: all unit suites + typecheck + BOTH sprint3 e2e specs green, exact
  numbers, no flake-rounding.

## 5b. Deviations from this spec, as built

- **The ambient dial is not gated on vision mode.** §4 threads the darkness scalar into
  `LightingRenderer` from `fogScene()` with no `mode === 'vision'` guard, so a rooms-mode
  scene the DM calls dark reads dark on the table. Adjudicated as intended rather than
  fixed: the dial is world state (it lives in `env`, beside time and weather, and rides to
  every viewer), and "rooms mode stays byte-identical" holds where it was actually promised
  — a scene nobody has turned the dial on carries no `ambient` field at all, so `darkness`
  is `undefined` and the lighting pass runs exactly as it did before P3, no-lights shortcut
  included. Only a DM's own deliberate act changes a rooms scene's composite.
- **The fog's void imitation bites at the dial too.** `voidStyle` is taken at
  `LIGHTING_STRENGTH.player * darkness` rather than at full strength, because the fogged
  sheet renders above the same composite the real void renders through; at daylight/dusk the
  two disagreed and the fog read as a darker patch of the same map.
- **The drained grade covers cleared ground no light reaches, not only darkvision ground.**
  The lit pools are padded by `sightPad` so a torch lights its room's wall band, while the
  renderer's gradient is zero by `radius` — leaving a thin clear-but-unlit ungraded ring
  around every pool. `drained` is now `clear` minus the *unpadded* pools, which folds that
  band into the same grade and leaves the darkvision rule unchanged.

## 6. Non-goals (P3)

Vision cones / light angle (schema ready, later); dim-light mechanical effects
(presentation only); time-of-day driving ambient automatically (scene presets later);
flicker/animated darkvision grain (separate track); per-viewer divergence (P5);
DM fog-panel UI (P4 — the ambient select is the only control here, and it lives in
the Session panel's existing Environment section).
