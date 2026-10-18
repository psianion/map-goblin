# M5 results — time & weather + live relight (2026-08-06)

Branch: `worktree-time-weather` @ `6e7e3fe` (single commit, stacked on M4 `6e06802`).
Verification level: unit + e2e + live-browser design review. **Docker deploy and the
sprint-exit Chrome gate walk are deliberately NOT done** — held for the go call.

## What shipped

- **DM Environment control** (SessionControls): Time/Weather selects under the panel's
  Environment header, labeled options from the shared `TIMES`/`WEATHERS` vocabulary in
  core `prep.ts`, "Not set" placeholders, optimistic pending echo with a 4s fallback so
  the select can never show an untaken value indefinitely, and an
  "Activate a scene to set its environment." empty state.
- **Env badge** (TableStatusBar, both roles): "Dusk, Rain" in the bar's own separator
  grammar; hidden when env is empty. `data-testid="env-badge"`.
- **Diegetic env narration**: `envText` narrates only the delta, through phrase maps —
  "Dusk settles." / "A storm rolls in." / "Night falls. Snow begins to fall." — in toast,
  player log, and DM trigger log.
- **Live relight** (`lightSync.ts`): triggers `lightOverrides` drift-synced onto the core
  store's light children (`visible` flag), doorLighting pattern — recursion-guarded,
  reapplies after map load/scene switch. The relight path is real: LightingRenderer's
  per-frame `getVisibleLights()` + cache signature recomposites on the flip.
- **Player-facing light narration, author-controlled**: light actions carry
  `toPlayers?: boolean` (default on) with a labeled "Show to players" toggle in the
  canvas light-action panel (product call made this session). Deliberately-named lights
  narrate as "«Name» lights"/"«Name» goes dark"; auto-named ("Light N") and unnamed
  lights fall back to "A light kindles"/"A light goes dark" — never an id, never the
  editor's counter name.
- **Toast coalescing**: all toastable log entries from one state update join into a
  single multi-line toast (`whitespace-pre-line`), so a show-text + light trigger no
  longer silently drops the narration.
- **Canvas visual pass**: zone markers now hold constant on-screen weight across the
  whole zoom range (world constants scaled by `zoom / REFERENCE_ZOOM`, REFERENCE_ZOOM=20
  = PixiRenderEngine's px-per-world-unit; store-subscribe dirty flag + cheap rAF zoom
  watch, `ui.solo` in the subscription tuple per the renderLoop.ts trap); zone interiors
  got the white-over-ink fill sandwich so they read on black-surround dungeon maps.

## How it was built

Three contained workflows (Sonnet build/verify lanes + one Opus impeccable reviewer per
step; ≤5 agents each): build → e2e + design review (13 findings + 1 product fork),
fix → full M1–M5 regression + live UI check (blocker caught: zoom fix divided by
px-per-world-unit, markers invisible — unit test passed on ratio alone, screenshots
caught it), final fixes → live re-verify (8/9 confirmed, one solo-state regression
found and fixed by hand along with 4 small follow-ups).

## Verification state at close

- Unit: core 924, mechanics 233, canvas 249, client 320, server 159 (startup cold-spawn
  = documented machine flake, passes isolated). Typecheck + lint clean workspace-wide.
- E2E (all green): time-weather 2/2 (env → player badge + toast; light trigger → player
  store `visible` flip + named toast, no uuid), triggers-flagship 5/5, publish-library
  4/4, canvas publish-dialog 4/4, doors 18/18, sprint2-scenes 2/2, session-flow 1/1
  (third attempt; box was pinned at 100% CPU — environmental), M1 branch scene-switch
  3/3 + client unit 284.
- Live design review (Opus, screenshots): zone markers legible at 50%–400% zoom on dark
  ground; Environment control measured at 256px sidebar (104px client vs 102px scroll —
  no clip); pending fallback exercised with a dropped command; two-sentence env copy
  seen in all three surfaces.

## Known failure — pre-existing, NOT M5's

`sprint3-fog.spec.ts` "zero-setup: the editor's file is a fogged table": virgin player
canvas is 1.3% above the pure-black floor (`virgin.lit` ≈ 0.0128, mean lum ~10).
**Reproduced byte-identically on plain main @ 6b2dc7c** in a clean detached worktree —
pre-existing, most likely the #51 grid drawing before any reveal. File an issue at ship
time: either the unconditional draw respects the black-floor contract, or the assertion
gets a documented floor.

## Tracked / deferred (ship-time list additions)

- sprint3-fog `virgin.lit` above (issue at ship time).
- Pending-pick timeout is a fixed 4s constant; key it to connection state if real
  latency data ever proves it tight.
- Playwright worktree-name gotcha re-confirmed: an unanchored `testMatch` regex sweeps
  sibling specs when the worktree dir name substring-matches (bit the fog classification
  run via a `sprint3-fog-check` temp dir).
- All three Docker images are stale at M4 `6e06802`; M5 requires the usual
  all-three-together rebuild when the gate walk is cleared.
