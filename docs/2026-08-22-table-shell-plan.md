# Table shell rework — plan

Status: APPROVED 2026-08-22 (icon style A, fine ink). Building on branch `table-shell`. Decisions 2026-08-22: separate Scene/World, World global + canvas-authored facts honoured, one PR, icon style to be picked from options.
Mockups: `docs/mockups/2026-08-22-table-ui/current.html` (as-is), `recommendation.html` (target).
Base: main `1bd9488`.

## Goal

Replace the Table's single scrolling sidebar with a labelled icon rail and anchored popovers, a
bottom log drawer, and a separate player shell, on Moss night tokens, with custom icons. Hard rule
from the user: **no side panel scrolls, ever.** The log feed is the one scrolling region and it is
a drawer, not a side panel.

Same modules, same protocol, same server. This is a client-shell change in `session/client` only.

## Decisions already made (2026-08-22)

- Direction approved as drawn in `recommendation.html`.
- Doors keeps its rail icon (chip grid as overview, on-map menu as fast path).
- **Custom icons for everything** — no lucide in the Table. One drawn set covering the rail and the
  inline glyphs, to the art style guide (ink-outlined, painterly register, reads at 20px on
  `surface-1`). Gated by a mockup before use (M2).
- Scene and World stay separate. **World is campaign-global** (clock, night sky, speed, vision-gate
  override live on the session, not the map) and the table must honour what the canvas authored
  per map **accurately**: environment, time palette, natural light + orientation, and fixed time
  (`MapEnvironment` in `packages/core/src/shared/world.ts`). The World popover shows that
  provenance as a read-only line ("Fieldstone Keep · outdoor · follows the clock" / "pinned to
  21:00 in the Editor") and never re-authors it; both apps already resolve through the same core
  resolver, and M3 adds a parity test that the table's resolved light for (map, clock, sky) equals
  the Editor's preview for the same inputs.
- Ship as **one PR** (squash) after the M5 gate.
- **Top-left is the party, not the scene name.** A strip of token portraits (`PartyStrip`): out of
  combat it shows the party (claimed and friendly tokens first); in an encounter it shows the
  initiative order with the current turn marked and the round number. Click a portrait to frame
  that token; the DM opens the Initiative popover from the rail as before. Players do not get
  the strip: their shell is the turn pill + Me + roll bar (M4), as the mockup draws it. The scene name moves into the status bar (left end) and is the
  click target for the Session popover (invite, roster, end session).

## Milestones

Each milestone is shippable on its own behind nothing — the rail replaces the sidebar in M1 and
every later milestone refines a popover. Each ends with typecheck + unit + the Playwright lanes it
touches green, and a live walk on the 560x dev stack (DM + player seats) before moving on.

### M0 — Moss tokens into the Table (½ day)

- `session/client/tailwind.config.ts` + `src/index.css`: replace the achromatic hex block with the
  Moss night raw-RGB tokens from `canvas/src/index.css` `.dark` (surface/text/border/accent/
  danger/warning/success/info, `--hover-glow`, `--panel-shadow`, `--settle`). Declare both the
  Tailwind and shadcn vocabularies (the canvas gotcha in `chrome-style-guide.md`: half-declared
  vocabularies compile to nothing).
- Migrate the six panels still on raw `neutral-*` (Session, Players, Tokens, TokenLibrary, Log,
  PlayerScenes, InviteCodeChip) to semantic tokens. Mechanical; no layout change yet.
- Fonts: self-host IBM Plex Sans / Plex Mono / Newsreader as woff2 under `session/client/public/
  fonts` with `font-display: swap` and a system fallback stack. The Table's "no CDN during a live
  session" rule stays true; the style guide's open question closes. Mockup used Google Fonts only
  because it is a local doc.
- Exit: chrome-style-guide release checklist items 2–5, 9 pass on the unchanged layout.

### M1 — Shell: rail, popover frame, session chip, status bar, drawer (2 days)

New files under `src/shell/`:
- `Rail.tsx` — reads `usePanels(role)`; renders a 20px icon + 9px label + optional badge per panel; a
  divider between `group: 'play'` and `group: 'prep'`; Log pinned to the bottom. 56px wide.
- `Popover.tsx` — the one frame every panel renders into: header (Newsreader title, subtitle slot,
  header-actions slot, ×), body, footer slot. Anchored `right: 66px`, top aligned to its icon and
  clamped to the viewport. Width 320 (360 on `wide`). **`overflow: hidden` on the body and an
  explicit max-height; a dev-only assertion logs when a panel's body exceeds it** so a scroll can
  never quietly come back.
- `shellStore.ts` (zustand, same shape as `tools.ts`) — `openPanel: string | null`,
  `drawerOpen`, `diagnostics`. One open at a time. `Esc` order: close popover → disarm tool.
- `PartyStrip.tsx` — top-left; token portraits (disc, 28px, initials when no portrait), party or
  initiative order, current turn ring, round chip. Click = frame token.
- Scene name in the status bar (left end) opens the `session` popover (invite, roster, end session
  with an in-popover confirm, replacing `window.confirm`).
- `LogDrawer.tsx` + `Ticker.tsx` — bottom drawer, fixed 260px, filter chips, merged feed (rolls +
  table lines + trigger narration + initiative lines, already merged in `GameLog.tsx`'s model),
  composer pinned. Collapsed form is the one-line ticker.
- `TableStatusBar.tsx` — drop FPS/frame-time behind `Shift+D`; add the armed-tool segment (replaces
  `ActiveToolIndicator.tsx`, which is deleted); presence as shape.
- `hotkeys.ts` — one keydown listener with the typing guard from `cameraInput.ts`; panel letters
  from `PanelDef.key`; `N`, `/`, `Shift+D`. Player seat only binds the keys for panels it has.

`panels.ts` gains `icon`, `key`, `group: 'play' | 'prep' | 'log'`, and `popover: { width?: 320|360,
maxRows? }`. Registration stays the D8 plug-in point; GameTable stops rendering an `<aside>`.

Existing panels render unchanged inside the new frame in this milestone (they will be too tall;
that is what M3 fixes). Exit: both seats usable end to end; `sprint2`/`sprint3`/`doors`/`triggers`/
`time-weather` Playwright lanes updated to open the popover before asserting (one helper
`openPanel(page, id)` in `e2e/table.ts`; test ids listed below are preserved).

### M2 — Icon set (1 day, parallel with M1)

- 10 rail glyphs: initiative, fog, doors, tokens, scene, world, triggers, log, me, session; plus
  ~12 inline glyphs: reveal, hide, brush, lock, secret/eye, frame/target, place, copy, close,
  more, plus, whisper, dice.
- Authored as a single SVG sprite (`src/shell/icons.svg` + `<Icon name>` component), 24-grid,
  1.75px ink stroke with the art guide's "thick dark stroke" character, no fills except state dots.
  Must read at 20px on `surface-1` (rail) and at 15px inline (user sized these up from 17/13 on 2026-08-22); tested in the mockup page before wiring.
- Gate: an icon sheet page under `docs/mockups/2026-08-22-table-ui/icons.html` reviewed by the
  user. Only after approval do they replace the placeholders in the rail.
- Not forge-generated: raster icons would not survive 17px; these are drawn vectors in the
  same hand as the door/wall outlines.

### M3 — Popovers to the no-scroll ledger (3 days)

One panel at a time, each with its ledger row as the acceptance test:

1. **Initiative** — merge `InitiativeControls` (SessionControls.tsx:392–607) and
   `InitiativeTracker.tsx` into `modules/initiative/InitiativePanel.tsx`: rows with HP number +
   bar, condition chips, bookkeeping line on the selected row, add-combatant, footer Next/End.
   Pre-encounter state = candidate checklist + Begin. Densify at 15+, widen + two columns at 24+.
   `N` hotkey. Player variant = same rows, read-only, own row marked, NPC hp as bar only (existing
   redaction).
2. **Fog** — tool row (Reveal/Hide/Brush buttons replacing the toggle + segment pile), hint line,
   chip grid grouped Unrevealed/Revealed with status shapes, footer Reveal all/Hide all, `⋯` header
   menu for conceal-behind-doors / auto-explore / vision share. Brush controls swap in for the grid
   while armed (same height). Filter field at 25+ rooms. Map hover ↔ chip hover.
3. **Doors** — chip grid grouped Closed/Secret/Open, footer actions for the selected door, plus the
   **on-map door menu** (new `DoorMenu` overlay positioned from the door's world coordinates via
   the existing camera, same component for both seats). Filter at 25+.
4. **Tokens** — tabs On map / Library; selection detail in place; library rows Place/Edit; New
   token expands the form and collapses the list; on-map token menu (Claim for players; Hide/
   Reveal/Frame for DM).
5. **Scene** — radio rows, eye toggle, `⋯` menu (Rename/Replace/Delete), Weather, Import.
6. **World** — ribbon, jumps row, sky/speed segments, badge line + override switch, trace on hover,
   plus the read-only "authored in the Editor" provenance line (environment, palette, fixed time,
   natural light) and the resolver parity test against the canvas preview.
7. **Triggers** — rows with switch + Fire; trigger log removed from the panel (it is a drawer
   filter).
8. **Session** — invite, roster, end session.

Delete as we go: `ActiveToolIndicator.tsx`, the `Import a map file` block from Session, the
duplicated Initiative heading, `PlayerScenes.tsx` (folded into the player's Table popover).

### M4 — Player shell (1 day)

- Role-specific shell composition in `GameTable.tsx`: `TurnPill`, `RollBar` (replaces the Log
  composer for players; `/` focuses; Whisper toggle = private roll), `Me` panel
  (`modules/tokens/MePanel.tsx`: claimed token's HP/conditions/sight/light, Find me; unclaimed =
  claimable list).
- Player status bar: presence, world light, zoom only.
- Prompt stack: `InitiativePrompt`/`TriggerPrompts` keep bottom-center; roll bar shifts up 48px
  while one is open.

### M5 — Motion, a11y, polish, gate (1 day)

- 180ms `settle` enter for popover/drawer/map menus; instant under `prefers-reduced-motion`.
- Focus management: opening a popover moves focus to its first control; closing returns it to the
  rail icon. Every icon has `aria-label` + the key in the tooltip. Roving tabindex on the rail.
- Contrast pass on the four surfaces (checklist item 4).
- `/impeccable audit` on the shell, then the Docker gate walk on Fieldstone Keep, both seats, zero
  console/network errors, screenshots into `docs/2026-08-xx-table-shell-gate.md`.

## No-scroll ledger (acceptance)

| Popover | Fits | Past the ceiling |
|---|---|---|
| Initiative | 14 rows × 36px + header/footer = 624px | 15+: 28px rows, chip counts. 24+: 360px wide, two columns. Cap 40. |
| Fog | 24 chips + tool row + footer = 500px | 25+: unrevealed first, header filter field. |
| Doors | 24 chips in groups + footer = 540px | 25+: Closed group first, filter. |
| Tokens · On map | 12 rows + detail = 600px | 13+: detail collapses until selected (20 rows). Filter at 21+. |
| Tokens · Library | 16 rows = 512px | Filter at 17+; editing collapses the list. |
| Scene | 8 rows + weather + import = 430px | 9+: 28px rows. |
| World | 300px fixed | n/a |
| Triggers | 10 rows × 40px = 460px | 11+: 32px rows, condition in tooltip. |
| Session | 10 roster rows = 380px | n/a |
| Log drawer | 20 lines in two columns | **scrolls inside the feed** (the one exception) |

The dev-only overflow assertion in `Popover.tsx` plus a unit test per panel that renders the
ceiling case and asserts `scrollHeight === clientHeight` make this checkable in CI, not by eye.

## Test ids preserved (Playwright depends on them)

`token-layer`, `fog-bar`, `fog-tool-toggle` (becomes the Reveal button), `fog-rooms`, `fog-reveal-all`,
`fog-hide-all`, `fog-share`, `door-list`, `door-toggle`, `door-lock`, `door-actions`, `game-log`,
`manual-roll`, `toast`, `env-badge`, `env-time`, `scene-list`, `scene-upload`, `player-list`,
`claim-button`, `active-tool` (moves into the status bar), `trigger-list`, `trigger-log` (moves to the
drawer filter), `trigger-prompt`, `token-library`, `token-selection`, `token-sight`, `token-hide`,
`token-name`, `token-save`, `place-hint`, `invite-code`, `reconnecting-banner`, `table-status-bar`,
`game-canvas`. New: `rail`, `rail-<id>`, `popover`, `log-drawer`, `ticker`, `turn-pill`, `roll-bar`,
`door-menu`, `token-menu`, `me-panel`.

## Risks

- **Popover over the Pixi canvas** — pointer events must not leak to the map under an open
  popover; the drawer must not steal wheel-zoom outside its bounds. Same `stopPropagation`
  discipline `TableStatusBar` already uses.
- **On-map menus need world→screen projection** each frame while the camera moves; reuse the
  camera's transform (token turn ring already does this in `FogOverlay`/token layer). Menu closes
  on pan.
- **Sprint-3 fog/vision e2e lane is already stale on main** (4 failures, see living-fog memory).
  M1 rewrites its selectors anyway; reconcile it there rather than before.
- **Hotkey collisions** with the canvas keys (`0 + -`) and with typing: one listener, one guard.
- **Icon set is the longest pole for "done" feel**; M2 runs in parallel so it never blocks M1/M3.

## Sequencing and agents

M0 → M1 (M2 in parallel) → M3 panels 1–8 (one worktree each, ≤5 agents per step: Sonnet
workers + one Opus impeccable guide, Fable adjudicates between steps) → M4 → M5 gate. Ship as one PR (squash) after the gate (decided).

Estimate: ~8–9 working days end to end.

## Open

None. Icon style: **A (fine ink)**, picked 2026-08-22.

## Rules for everyone building this

- Product register (impeccable `reference/product.md`): earned familiarity, one family, tight
  scale, restrained colour, every control has default/hover/focus/active/disabled states.
- Chrome style guide (`docs/chrome-style-guide.md`): three ink weights, selection = raised
  surface, no accent side-stripes, green only on active tool / current turn / primary action / live
  state, presence as shape, 150–250ms settle motion, reduced-motion honoured, focus rings visible.
- No panel scrolls. The ledger above is the acceptance test. `Popover` asserts it in dev.
- Zero Claude/Anthropic/AI mentions in any file, comment, commit, or doc. No attribution trailers.
- Tailwind semantic tokens only (`surface-*`, `text-*`, `border-*`, `accent-*`); no raw
  `neutral-*`, no hex in components.
- Preserve the Playwright test ids listed above; add the new ones.
- Every non-trivial piece of logic leaves one unit test behind (vitest, jsdom, testing-library).
