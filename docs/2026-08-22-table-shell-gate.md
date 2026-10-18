# Table shell rework — gate report

Branch `table-shell`, 2026-08-22. Plan: `docs/2026-08-22-table-shell-plan.md`. Mockups:
`docs/mockups/2026-08-22-table-ui/{current,recommendation,icons}.html`. Screenshots for this
report: `docs/mockups/2026-08-22-table-ui/gate/`.

Gate this round: dev stack (560x) walked in Chrome on both seats, Fieldstone Keep with an
encounter running; unit suites; Playwright lanes run serially. No Docker (user's call).

## What shipped

| Commit | Milestone |
|---|---|
| `b1659d3` | M0 Moss night tokens (raw RGB, both vocabularies), self-hosted IBM Plex Sans / Mono + Newsreader, all raw `neutral-*` gone; M2 drawn icon set (26 glyphs, style A, `src/shell/icons.tsx`) |
| `d8a696e` | M1 shell: 56px labelled rail, anchored `Popover` frame with dev overflow assertion, `shellStore`, hotkeys, `PartyStrip`, `LogDrawer` + `Ticker`, status bar (scene name → Session popover, armed tool, `Shift+D` diagnostics), `ActiveToolIndicator` deleted |
| `692c819` | `worldToScreen` for map-anchored chrome |
| `75ba259` | M3 wave A: Initiative (one widget, bookkeeping on the row), Fog (tool row, chip grid, brush swap), Doors (chip groups + on-map `DoorMenu`), Tokens (On map / Library tabs + on-map `TokenMenu`) |
| `8c3dd48` | M3 wave B: Scene (rows, ⋯ menu, in-popover delete confirm), World (300px, provenance line, vision-gate row), Triggers; Editor/Table light parity test |
| `4991a08` | Overlays mount from the shell (`PanelDef.mount`) — the missing-tokens fix; M4 player shell (`TurnPill`, `RollBar`, `MePanel`, player status bar, `railRoles`); first design review's 17 findings fixed; lint fully clean |
| `feaa0f6` | Second review: Scene ⋯ menu through a `Portal` (was clipped), one `Composer` shared by roll bar and drawer (Whisper on both), focus on next frame + × fallback, Esc order popover → drawer → selection → tool, roster shows claimed character, `GET /api/campaigns/:id/session` so a resumed DM seat still has its invite code |
| `8b239e4` | Scene subtitle counts from the session snapshot |
| `8f3a7cd` | Icon markup memoised so a press on a glyph stroke still clicks; Fit button labelled; token rows carry `data-x`/`data-y`; Place / Claim name the token |
| `488593c` | Playwright lanes reconciled with the shell (helpers, chip clicks, shared `OVERLAY_CHROME`, lit-floor wipe check, weather-only time-weather, `--force_high_performance_gpu`) |
| `9e75782` | D3 waiver for `WorldTicker.ts` (`shared/world` is pure clock math; mechanics loads it anyway) |
| `f2b0b40` | Editor previews the campaign's night sky (`ui.previewSky`, "Preview sky" row) so `worldFrame` matches the Table; parity test asserts full equality |
| `5d2676a` | Preview sky on its own row — the three skies did not fit beside a label at 300px (checked live) |
| `48541fc` | Token input wins a press over the door overlay whatever mounts first; door and token menus close on a press the token layer claims |
| `e32d8e6` | sprint3 fog / share / vision baselines re-derived for the living fog; fps row places by room; rail glyph-stroke click pinned in session-flow |
| `54ca25f` | DM sight preview: "Show sight" on the selected token draws its view on the DM's canvas only (local flag, nothing on the wire); Owner select lists an owner who left |
| `b16934f` | Token chips + turn ring in screen space above the fog, stencilled by the fog's shown region on player seats — exempt from the darkvision/lighting grades, still hidden where the seat cannot see |

## Checks

- `@dnd/session-client`: typecheck clean, lint clean (`--max-warnings 0`, including the two
  warnings that pre-dated this branch), vitest 49 files / 799 tests.
- `@dnd/game-server`: typecheck clean, vitest 12 files / 233 tests (new: active-session route).
- Console on both seats across every popover, drawer, menu: zero errors, zero warnings; the
  dev `[shell] panel … overflows` assertion never fired.
- Lane browsers now ask for the discrete GPU (`--force_high_performance_gpu`): without it ANGLE on
  this laptop picks the Intel UHD 630, so the fps and drag-latency numbers before 2026-08-23 were
  integrated-GPU numbers.
- No-scroll ledger: every DM popover measured `scrollHeight === clientHeight` at 320px (World
  540px tallest; all under the 692px budget at 720p). The log feed is the only scroller.

## Live walk (dev stack, Chrome)

DM seat (`gate/dm-*.jpg`): rail + party strip + ticker + status bar idle; `I` Initiative anchored
to its icon with the current row raised; `F` Fog with Reveal armed and the status bar naming the
tool; click a door → on-map menu (Close / Lock / Frame); click a token → on-map menu (Hide /
Frame / ⋯); `T` Tokens with detail block; `S` Scene with the ⋯ menu floating over the popover;
scene name → Session popover bottom-left with invite + Copy link + roster; `L` drawer, `Esc`
order, `Shift+D` diagnostics after the env badge.

Player seat (`gate/player-*.jpg`): turn pill top-centre ("Goblin's turn · round 8"), roll bar
bottom-centre with Whisper and Post, rail Initiative / Me / Log; Me lists claimable tokens →
Claim → Karlach card (HP "—" outside the encounter, sight, light, Find me); "stealth 17" posts
and the ticker updates on both seats; status bar without FPS / latency / tool.

## Design reviews

Two impeccable passes (product register, chrome style guide release checklist). Pass 1: 17
findings (5 P1), all fixed in `4991a08`. Pass 2: 19 findings (1 P0, 6 P1), all fixed in
`feaa0f6` except three deliberately left: Weather stays a native select this round (finding
12); `text-dim` keeps its name (18); `rail-session-controls` keeps its legacy id for the
Playwright lanes (18). Both reviews confirmed: tokens and contrast clean on all four surfaces,
selection as raised surface everywhere, presence as shape, no pointer/wheel leak to the map,
focus rings visible, icon-only buttons labelled, motion gated.

## Playwright lanes

Lanes boot their own server on the 561x ports and write one shared `dist/`, so they run one at
a time (two at once collide in `dist/` and read as "webServer not able to start"). A hidden,
detached shell cannot start Chromium on this box (exit 0xC0000142), so each lane ran as its own
foreground job. Results, 2026-08-23, on the `table-shell` head (`488593c`):

| Lane | Result | Notes |
|---|---|---|
| session-flow (default) | 1/1 | `openPanel` helper added to `e2e/table.ts` |
| publish-library | 4/4 | |
| sprint2 (rolls, scenes, tokens) | 7/7 | scene switch 76–218 ms, drag → observer 35 ms worst, 60.4 fps with 20 tokens |
| doors (flagship, focus, table) | 18/18 | `doors-table` "secret reveal" bound rewritten, see below |
| triggers-flagship | 5/5 | |
| scenes (scene-switch) | 3/3 | |
| time-weather | 2/2 | first test trimmed to weather: `env-time` left `src` at `c0e068f` (PR #99) for the World clock |
| sprint3 fog / share / vision / vision-gate | **34 pass, 0 fail, 0 skipped** (was 5 / 3 / 25) | Baselines re-derived from measured frames (below). fps row: **60.4 fps with 8 tokens + fog mask, 60.8 across a whole-map reveal**; reference 60.2 fps at 19 tokens. `vision-gate` 4/4 throughout (mask rebuild 28 ms median) |

### What the lanes found in `src`

- **Rail icon clicks were dropped when the press landed on a stroke.** `Icon` handed React a new
  `dangerouslySetInnerHTML` object every render; the rail re-renders on focus (roving tabindex),
  so between mousedown and mouseup the svg children were replaced and the browser never emitted
  a `click` (the `S` hotkey opened Scene, the icon did not — reproduced on Scene and World, whose
  glyphs have a stroke under the button centre). Fixed by memoising the markup object; unit test
  asserts path-node identity across a re-render. Same fix covers every inline glyph.
- **Placing a token on a door swung the door (48541fc).** `DoorRenderer` relied on registering
  its `pointerdown` listener *after* token input so the token's `stopImmediatePropagation` won;
  the old sidebar mounted Tokens (15) before Doors (30), the rail mounts Doors (30) before
  Tokens (40), and the assumption silently inverted. A placement or a grab on a door cell
  then also toggled the door. Fixed by listening in the bubble phase — at the target, capture
  listeners run first whatever order they were added — with a test that mounts the overlay
  first and token input second.
- **Door and token on-map menus stayed up after a placement or a grab.** Their outside-press
  listeners sat on `document` in the bubble phase, which a press the token layer claims never
  reaches; the stale menu then ate the next map click. Both listen in the capture phase now.
- On-map token rows lost `data-x` / `data-y` in the M3 rewrite; restored (the drag-latency lane
  reads them).
- Library "Place" buttons and the player's "Claim" button now name the token (`Place Borin`,
  `Claim Borin`) — a bare "Claim" under a list with no caption read as nothing.

### What the lanes needed on the e2e side

- Log panel id is `game-log`, so the rail testid is `rail-game-log` (the helper said `rail-log`).
- `token-layer` lives in the Tokens popover's On-map tab; DM helpers switch tabs before reading
  it (`openOnMap`), and the DM's popover covers the right ~25 % of the canvas, so the 20-token
  spread stays left of x ≈ 0.7.
- `openPanel` falls back to the panel hotkey on a seat whose rail hides the icon (players:
  Doors, Tokens).
- The roll bar unmounts under an open drawer, so `asPlayerComposer` matches whichever composer
  is mounted.
- Scene rows: `getByRole('button', { name })` needs `exact: true` — the ⋯ button is named
  "More actions for <scene>".
- Fog room chips are the button (no inner button to click).
- One shared `OVERLAY_CHROME` (e2e/table.ts) hides every piece of shell chrome during a canvas
  screenshot; the per-spec copies only knew about the old status bar and toast.
- **Living fog baselines, re-derived (e32d8e6).** The cloud wash over unexplored map measures
  luminance 21.6–58.5/255 (gate map) and 22.0–59.1 (vision map) — palette constants, identical
  in shots six seconds apart — so the old "drawn" floor of 32 counted fog as map (40 % "drawn"
  on a void canvas), and the vision map's 120 floor counted nothing (PR #100 grades an unlit
  floor to ~36/255). New instrument in all three specs: `lit` = luminance > 64 (above the
  cloud's ceiling), `clear` = outside the cloud's band entirely (< 16 or > 64). Measured:
  virgin canvas 0.000 % clear vs one revealed room 19.6 %; a claimed token's sweep 15.0 %
  vs 0.000 % before the claim; two seats 3.3 % / 4.3 % against an unearned seat at 0.000 %.
  Memory rows compare `clear` fractions instead of means (the cloud is brighter than a graded
  floor, which inverted the old mean comparison). The door-swing rows take their still-frame
  floor over the same wait as the swing (0.25 % drift vs 1.15 % moved) rather than
  back-to-back (0.00 %), so the floor carries the same weather as the reading.
- **fps row places by room.** The 5×4 blind spread stacked the 21st placement on an occupied
  cell and ran into the On-map tab's 20-row ceiling. It now calibrates screen → world off two
  placements (no camera handle in a production build), aims at cell centres with two cells of
  room around them, and loops on the player's own count — every aimed cell is in a revealed
  room, so each placement must reach the seat. `tokenCount` reads rows plus the "+N more"
  line so helpers stay right past the cap.
- **Rail glyph-stroke click** pinned in `session-flow` (Initiative, whose first path's box
  centre is on the stroke); the unit test pins the object identity, only a browser pins the
  gesture.
- `doors-table` measures the lit-floor fraction for the secret-reveal wipe (a wipe takes the
  floor off; clouds never light a pixel past 64).

### DM sight preview (54ca25f)

Built live on the user's table after the fog-mode walk (Rooms → Vision, Karlach 30 ft + torch,
Marra and the Goblin 60 ft darkvision). `useTokenInteraction.previewSight` + the selection choose
one token; `fogScene()` on the DM seat sweeps through that token exactly as a player seat would
(player bite, light gate, darkvision), the existing player fog layer draws it, and the rebuild
subscribes to the interaction store. An owned token previews through its owner's memory record
(individual share) or the party's; an unowned one previews live sight only — a goblin has no
memory. A hidden token is un-hidden for its own sweep. Players: untouched by construction — the
flag never leaves the tab and the referee's redaction is not involved; the vision lane pins it
(DM 49.9 % → 13.0 % clear, player 20.0 % → 20.5 %). Found on the way: a token whose owner left
the table read "Unassigned" in the Owner select while staying theirs — now listed as "Someone
who left" so it can be unassigned. Fixed in b16934f: under darkvision a player's own token
chip was graded grey with the floor and hard to read — chips and the ring now draw above the fog and the multiply, stencilled to what the seat can see (checked live on Marek's seat).

## Known and deliberately left

- Fog map click: Reveal / Hide buttons now decide the direction; with nothing armed a click still
  toggles. Shift-click frames the room.
- `brush` and `session` glyphs read a little soft at 20px; always paired with a label.
- Docker images not rebuilt (no Docker gate this round).
- Darkvision on the vision map lifts the torch-core patch only 18.4 → 19.1/255 (the memory
  tier's half-alpha cloud is brighter than the darkvision grade under `darkness`); the row
  reads the frame's black fraction instead. Product observation, not fixed here.
- The Tokens popover stays open across a placement on the map (its outside-press listener is
  bubble-phase too); reads as intended for placing several from the Library, left as is.
