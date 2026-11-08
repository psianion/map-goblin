# Table v2: one product with the canvas

Plan written 2026-11-08 against `main` at 387dd86. One pass, three builders, one browser test run at the end. Boards and the research write-up: the shared "Table v2: the play surface for DMs and players" page (write-up at the index, boards at `boards/boards.html`; board numbers below refer to it). The boards are the visual spec; this file is the behavioural and code spec.

## 1. Goal

The table (`session/client`) becomes the same product as the canvas: same tokens, type, light and dark, no accent, same primitives from one shared package. The DM's controls move from a right rail of popovers into a bottom dock built like the canvas dock. The flows between the apps are finished in the same pass: maps are safe outside the browser, the canvas hands the DM to the table without retyping the pass, player tokens exist, and republishes announce themselves. The old table UI is deleted, not re-skinned.

## 2. Decisions (all taken, do not reopen)

| # | Decision |
|---|---|
| 1 | The table changes, the canvas does not change its look. Both keep their own domains and builds. |
| 2 | Shared UI lives in a new source-only package `packages/ui` (`@dnd/ui`), used by both apps. |
| 3 | Light and dark on both apps, one setting each, light by default, dark one click away. No accent colour; player identity colours, HP danger and connection trouble are the only hues. |
| 4 | Plex Sans and Plex Mono only, self-hosted through `@fontsource` from `packages/ui`. Newsreader goes; the canvas drops its Google Fonts import. |
| 5 | DM controls: one bottom dock with eight tabs: Fog, Map, Tokens, Encounter, Story, World, Scenes, Dice (boards 10 to 20). Keys 1 to 8 pick tabs, B collapses. No Sound tab this pass. |
| 6 | Left rail (44 px) holds pointer tools everyone has: Select V, Ping P, Measure M, Template T, Draw D, Pin I. All six ship. |
| 7 | The status bar goes. Zoom pill bottom-right; connection shown only when unhealthy (chip, then banner). |
| 8 | Combat bar top-centre while an encounter runs; players get End turn on their turn. |
| 9 | HP bars: per-token setting, default DM only. Ping pulls cameras: DM only (Shift+Alt+click). Blind rolls: in. Phone layout: players only. |
| 10 | One live scene for everyone; per-seat level stays. Per-player scenes are a later version. |
| 11 | Host flow: Campaign, Map, Invite, each with Back (board 7). The server and pass step is folded away when the table already holds a valid DM token; a "Different DM or new campaign" link always brings the pass step back. |
| 12 | DM tokens expire after 30 days and refresh on use. Player tokens keep 7 days. |
| 13 | "Open the table" in the canvas publish dialog uses a server-minted single-use handoff code, never the token in a URL. |
| 14 | Map safety, both: the server mirrors every published scene as exactly one `.ggvtt` file on disk, overwritten in place, and offers a campaign export archive on demand. The canvas gets Download all and a warning that maps live in the browser until published or downloaded. |
| 15 | `.ggvtt` finished everywhere; `.mapbuilder` still opens. |
| 16 | PC tokens: the DM creates them at the table; the DM or the owning player may upload art. Monsters and NPCs still come from the canvas prep and can be added ad hoc at the table. Art itself is out of scope; placeholders stay. |
| 17 | Old table Playwright specs are deleted. Builders write new scoped specs and unit tests but run only typecheck, lint, unit tests and build at each step. The browser suite runs once, at the end, by one tester. |
| 18 | The Discord bot's hosting path is untouched. |

## 3. What exists today (read before building)

- **Canvas maps** live in IndexedDB `mapbuilder-maps` (`canvas/src/io/mapIndexDB.ts`), format `3.9`, container `MPBLD` gzip (`io/mapFormat.ts`). `MAP_FILE_ACCEPT` already reads `.ggvtt,.mapbuilder` (`io/mapFile.ts:19`) but `saveLoad.ts` still writes `.mapbuilder` (lines 144, 203, 244, 343), and the table's `ScenePanel.tsx:158,469` and `HostSetup.tsx` accept only `.mapbuilder,.json`.
- **Publish** (`canvas/src/io/publish.ts`, `publishFlow.ts`, `editor/dialogs/PublishDialog.tsx`): map hash without prep plus a prep hash; DM token per campaign in localStorage `goblin.publish.token.<campaignId>`; routes `GET/POST /api/campaigns`, `POST /api/campaigns/:id/dm-token`, `POST /api/campaigns/:id/maps`, `PUT /api/scenes/:id/publish`, `PUT /api/scenes/:id/prep`. A 404 on republish clears the record and uploads a new scene.
- **Server** (`session/server/src`): SQLite `game.db` under `$GAME_SERVER_DATA`; tables `campaigns, maps, sessions, identities, passes, module_state, assets, scenes, waitlist` (`db/migrations.ts`). Republish (`http.ts:402`) inserts a new `maps` row, repoints `scenes.map_id`, carries fog by room lineage, keeps prep unless the file carries one, then `refreshScenes` pushes `session-state` to every seat and `scene-changed` when the live scene changed. Old `maps` rows are never deleted; `deleteScene` (`http.ts:494`) leaves module state and map rows behind. Tokens are `TOKEN_TTL_MS = 7 days` (`auth.ts:32`), HMAC signed, never refreshed. Protocol version 5.
- **Table client** swaps a republished map in place (`session/loadSceneMap.ts:290 swapSceneMap`, `renderer/GameRenderer.tsx:195`); nothing tells the DM or players it happened. Shell: `shell/Rail.tsx` and `Popover.tsx` with the panel registry `session/panels.ts` (`registerPanel`, `PanelDef`), hotkeys in `shell/hotkeys.ts`, pages `Landing`, `HostSetup` (four forward-only steps), `JoinSession`, `GameTable`. Styling: Tailwind 3.4, "Moss" dark-only RGB tokens in `index.css`, bespoke SVG icons `shell/icons.tsx`, Newsreader.
- **Mechanics** (`packages/mechanics/src`): modules `tokens, fog, doors, initiative, rolls, dice, triggers, crossings`; server adds `scenes, lights, world`. `TokenDef` has name, image asset or pack asset, size, disposition, sight, light. Commands: `library-upsert, library-delete, place, spawn, move, update, hide, delete, claim, assign, set-sight-link, set-token-level`. Room keys already carry encounters (`packages/core/src/shared/prep.ts:86 RoomKey.encounter`, `MonsterEntry`) and the triggers module spawns them as tokens.
- **Canvas design system**: `canvas/src/theme/tokens.css` (hex tokens, `.dark` block, radii key 4 / control 6 / float 8 / pill, shadows), `tailwind.config.ts` (`color-mix` alpha mapping, `ring-3`, `rounded-key/control/float/pill`, `shadow-e`), primitives in `canvas/src/ui` (shadcn over `@base-ui/react`), composites in `canvas/src/editor/components` (each with a test), `lib/toast.ts` on Sonner, `theme/theme.ts` (`dark` class, localStorage `v2-theme`), gallery at `/gallery`.
- **Build**: `pnpm-workspace.yaml` lists `packages/*`, `bot`, `canvas`, `session/*`. `@dnd/core` is source-only (`main: ./src/index.ts`), which is the model for `@dnd/ui`. Both Dockerfiles copy package manifests one by one (`Dockerfile:7-9`, `session/client/Dockerfile:11-21`).

## 4. Architecture

### 4.1 `packages/ui` (`@dnd/ui`)

Source-only like core. Contents, moved from the canvas (git mv, history kept):

- `src/theme/tokens.css` and `src/theme/theme.ts` (init, toggle, `system` option; localStorage key `gg-theme`, migrate `v2-theme` on first read). Fonts: `@fontsource/ibm-plex-sans` 400/500/600 and `@fontsource/ibm-plex-mono` 400/500 imported from `src/theme/fonts.css`. The Google import in `tokens.css:10` is deleted.
- `src/tailwind-preset.ts`: everything in `canvas/tailwind.config.ts` except `content`. Each app's config becomes `presets: [preset]` plus its own `content` glob that includes `../packages/ui/src/**/*.{ts,tsx}` (the table: `../../packages/ui/...`).
- `src/primitives/*`: the 17 files of `canvas/src/ui` plus `primitives.test.tsx`. Imports change from `@/lib/utils` to relative.
- `src/components/*`: the composites of `canvas/src/editor/components` that have no editor dependency: ActionRow, AddTile, Caption, Chip, ColourRow, DockColumn, FloatBox, FlyoutRow, Fold, IconKeyButton, InputRow, KeyHint, PanelHeader, PrimaryButton, SecondaryButton, Seg, SelectRow, SettingRow, SliderRow, StatusChip, Stepper, Swatch, SwitchRow, Tile, with their tests. `LevelList` stays in the canvas if it reads the store; otherwise it moves too.
- `src/toast/*`: `lib/toast.ts`, `toastIcons.tsx`, Sonner skin from `index.css`.
- `src/lib/utils.ts` (`cn`), `format.ts`.
- `src/icons.ts`: re-export of lucide-react, so the table never adds its own icon set again.
- Dependencies declared here and only here: `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`, `tw-animate-css`, `@fontsource/*`, `react-colorful` if a moved primitive needs it. Dev: vitest, jsdom, testing-library, eslint, tsc, same versions as canvas. Scripts `test`, `typecheck`, `lint`, `check`.
- `tsconfig.json` extends `tsconfig.base.json`; `jsx: react-jsx`.

The canvas imports `@dnd/ui/...` everywhere it imported `@/ui`, `@/lib/utils`, `@/lib/toast`, `@/theme/*`, `@/editor/components`. `canvas/src/ui`, `canvas/src/theme/tokens.css`, `theme.ts`, `lib/toast*`, `lib/utils*` and the moved composites are deleted from the canvas. The `/gallery` route stays in the canvas and renders from `@dnd/ui`. `canvas/src/theme/desk.ts` stays (it reads tokens for Pixi) and is copied, not shared, into the table as `renderer/desk.ts` so the table desk is the v2 desk colour and dot grid (board 1), never black.

Dockerfiles: add `COPY packages/ui/package.json ./packages/ui/package.json` beside the other manifests in both files, and `COPY packages/ui ./packages/ui` in `session/client/Dockerfile` beside core and mechanics. `scripts/smoke.sh` needs no change. CI runs `pnpm -r check`, which picks the package up.

### 4.2 Table shell

Layout per write-up 4.2 and boards 1 to 6. Everything floats over the renderer; nothing permanent covers the map but the player roll bar.

- **Title card** top-left: scene name, level, chevron opening the scene switcher (search, thumbnails, Switch now, Prepare), world chip "Dusk · Rain" that opens the dock on World.
- **Rail** left, 44 px, `IconKeyButton`s with the key letter in the corner: Select V, Ping P, Measure M, Template T, Draw D, Pin I. One active tool, ink inversion. Players see the same rail (board 5) minus Template, Draw, Pin.
- **Dock** bottom (DM only): tab row (Fog, Map, Tokens, Encounter, Story, World, Scenes, Dice), context text at the right end ("on Web Gallery", "Rolling GM only"), zoom controls (−, %, +, fit) and a collapse chevron. Body: tool and setting groups left, a strip of pickable things right (rooms, doors, tokens, scenes, handouts). The dock sits folded to its tab row until a tab is picked; the same tab again folds it (board 1). Controls act on the selection if there is one, else on the scene.
- **Combat bar** top-centre while an encounter runs: portrait chips in turn order, current enlarged, round number, Next (DM) or End turn (the player whose turn it is), previous arrow (boards 3, 5).
- **Presence and session** top-right: coloured avatars of connected people (green dot online, hollow when away), Invite (prominent until the first player joins), View menu (Player view, Preview as, Theme Light/Dark/System, UI scale 90/100/115, Grid, Diagnostics), Session menu (roster with assign, invite code, Pause the table, Lock token movement, Export campaign, End session; players see Leave table).
- **Right column**: a slim tab column with Party and Log (unread badge), and sheets that open from the dock or a card: Room key, Handout, Token type, Character (players), Party, Log. One sheet at a time, 320 px, `SheetFrame` from the canvas pattern.
- **Zoom pill** bottom-right on the player side (the DM has it in the dock row). Connection: nothing when healthy; a chip with a countdown when reconnecting; a banner after several seconds (board 5 text).
- **Toasts**: Sonner from `@dnd/ui`, bottom-left, replacing `components/Toast.tsx`.
- **Shortcuts sheet** (board 9) opened with `?` or the keyboard button at the foot of the rail; content generated from the registries below.
- **Player shell** (board 5): same title card without switcher, rail with Select, Ping, Measure, combat bar with End turn, presence row, sheets Character, Journal, Log, Encounter while combat runs, roll bar bottom-centre with privacy Public / To DM. No dock, no debug data.
- **Phone layout** (board 8, players only, `max-width: 640px`): bottom tab bar Map, Character, Log; roll bar becomes a bottom sheet with large dice buttons; title card shrinks to the name; 44 px targets; Find my token; long-press pings.
- **Pages**: Landing, Host (board 7, three steps with Back, library cards from the campaign's scenes, Upload file, Blank map, starting room as thumbnails, QR code and link on Invite, "Enter table"), Join (code, name, colour, optional character link, then "Waiting for the DM" with the party list when no scene is live).

Registries replace `session/panels.ts`:

```ts
// session/client/src/shell/dock/registry.ts
export interface DockTabDef {
  id: 'fog' | 'map' | 'tokens' | 'encounter' | 'story' | 'world' | 'scenes' | 'dice';
  title: string;            // tab label
  icon: LucideIcon;
  key: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
  Body: ComponentType;      // left part: tools and settings
  Strip?: ComponentType;    // right part: pickable things
  context?: () => string | null;  // "on Web Gallery"
  onMap?: () => () => void; // overlay or sync loop the tab needs while the role is DM
}
// session/client/src/shell/rail/registry.ts
export interface RailToolDef { id; title; icon; key; roles; onArm(); onDisarm(); }
```

Builder B writes both registries, the dock frame, the rail, and stubs for the eight tabs in the first step so Builder C can fill bodies in parallel. Hotkeys: `shell/hotkeys.ts` is rewritten to resolve from the registries plus fixed bindings (board 9): R reveal, H hide, W brush, Shift+R rect (Fog), N next turn, Shift+N previous, `/` type a roll, Shift+P pause, +/− zoom, 0 fit, F find my token, ? sheet, Esc ladder (card, sheet, dock body, selection, tool). Dev-time duplicate-claim warning stays.

### 4.3 Server and cross-app flows

All routes are in `session/server/src/http.ts` unless named. Protocol version becomes 6.

**Handoff (decision 13).** `POST /api/campaigns/:id/handoff` (DM token) mints a 32-byte random code, stores `sha256(code) → {campaignId, identityId, exp: now+60s}` in a server-memory map, returns `{code, tableUrl}` where `tableUrl` is `PUBLIC_TABLE_URL` (already used by the bot) plus `/host#handoff=<code>`. `POST /api/handoff/redeem {code}` (no auth) looks up the hash, deletes it, and returns `{campaignId, campaignName, token}` with a fresh 30-day DM token. Rate limited like `/join`. The table's Host page reads the fragment on load, redeems, stores the token, and lands on the Map step with the campaign chosen. The fragment never reaches a server log because fragments are not sent.

**Token lifetime (decision 12).** `auth.ts`: `TOKEN_TTL_MS` stays for players; `DM_TOKEN_TTL_MS = 30 days` used by `dm-token`, campaign create, service token and handoff. `POST /api/campaigns/:id/dm-token/refresh` (valid DM token) returns a new token. Both clients refresh when the token has under 7 days left (decode `exp` client side; the token is JSON plus signature). The canvas stores under the existing key; the table stores DM tokens in `localStorage['gg.table.dm.<campaignId>']` and the seat in sessionStorage as today.

**Mirror on disk (decision 14).** `session/server/src/mirror.ts`: on `uploadMap`, `publishScene` and scene rename, write the stored map bytes (gzip container as uploaded or re-serialised) to `$GAME_SERVER_DATA/maps/<campaign-slug>--<campaignId first 8>/<scene-slug>--<sceneId first 8>.ggvtt` via temp file and rename. Rename removes the old file. `deleteScene` removes the file. One file per scene, always; never a copy per publish. A startup pass writes files for scenes that have none and removes files whose scene is gone.

**Export.** `GET /api/campaigns/:id/export` (DM token) streams a zip built with `fflate`: `manifest.json` (campaign, scenes with order, visibility, prep, protocol version, exported at), `maps/<scene>.ggvtt`, `state.json` (every `module_state` slice for the campaign), `assets/<id>.<ext>` plus `assets.json`. Import of the archive is out of scope and said so in the Session menu copy. The table exposes it in the Session menu as "Export campaign"; the canvas home gets "Download all maps" (a zip of every local map as `.ggvtt`, built client side with `fflate`).

**Cleanup.** `publishScene` deletes the previous `maps` row after the scene points at the new one. `deleteScene` deletes the `maps` row, the mirror file, and the scene's slices in `module_state` for fog, tokens, doors, triggers, crossings, pins and story (every module gets a `forgetScene(sceneId)` on its state, called by the handler). A startup sweep deletes `maps` rows no scene references. Assets are left alone.

**Republish notice.** `SessionManager.refreshScenes` already sends `scene-changed` for the live scene; the client store (`session/store.ts:270`) toasts "Map updated from the canvas" when the scene id is unchanged and the map id differs. Camera and selection are kept (they already are).

**Players and PC tokens (decision 16).** `TokenDef` gains `kind: 'pc' | 'npc' | 'monster'` (default `npc` when absent), `hp?: {current, max}`, `ac?`, `speed?`, `nameplate: 'hover' | 'always' | 'never'`, `showHp: 'dm' | 'owner' | 'all'` (default `dm`), `conditions: string[]`, `effects: {name, roundsLeft}[]`, `ownerIdentityId?`, `ownerName?`. `MonsterEntry.hp` feeds `hp.max` on spawn. New commands: `damage {targets, amount, half?: boolean}` (DM), `heal`, `set-condition {target, name, on}`, `set-effect {target, name, rounds}`, `gather {targets, x, y}`. `update` lets a player change name, art and nameplate of a token they own. Server: `POST /api/campaigns/:id/assets` accepts the player role for image uploads under 2 MB. On `POST /api/sessions`, after the starting room is chosen, the server runs `tokens.spawn` for every `kind: 'pc'` def not already placed on that scene, fanned out from the room anchor (reuse the triggers module's spawn placement). Claim stays as today. Ownership survives a rejoin: `join` with a name that matches a PC def's `ownerName` re-attaches `ownerIdentityId` (name match is enough for a home table; say so in the code).

**Rolls, requests, tables (board 20).** `rolls` module gains `mode: 'public' | 'dm' | 'gmonly' | 'blind'` per roll (log redacts result by mode), `request {targets, label, ability?, dc?}` (DM) which broadcasts `roll-requested` to the targets and collects `roll-result`s into a request record the DM sees (board 20 card), `tables` (campaign-level `{id, name, die, rows: {range, text}[]}` with `roll-table`), `saved` rolls per campaign. The DM's "Share results" posts the request summary to the log; "Apply Restrained to Bram" calls `set-condition`.

**Story (board 17).** New module `story` (mechanics): state per campaign `{handouts: {id, assetId?, text?, caption, from?}[], shown: {handoutId, audience: 'all' | identityIds[], mode: 'card' | 'full'} | null, titleCard: {text, mode: 'over' | 'full', shownAt} | null, journal: {sharedAt, kind: 'readaloud' | 'handout' | 'title', ref}[]}`. Commands DM: `handout-upsert`, `handout-delete`, `show`, `hide`, `title-show`, `title-hide`, `share-readaloud {roomId}` (reuses the existing Share path). Players render a full-screen or card overlay with a Hide-for-me control. Journal replaces `JournalSidebar`.

**Pause, lock, pins, marks.** `sessions` row gains `paused INTEGER DEFAULT 0` and `movement_locked INTEGER DEFAULT 0` (migration 006); a `table` module with DM commands `pause {on}` and `lock-movement {on}`; `tokens.move` from a player is refused while either is on. New module `pins` (persisted per scene: `{id, x, y, text, dmOnly}`). New ephemeral channel `mark` (not module state): `ping {x, y, pull?}`, `ruler {from, to}` while held, `template {shape, origin, size}`, `draw {points, ttl}`; broadcast to the session and dropped after their TTL; the DM's `pull` recentres every player camera.

**Levels per seat (decision 10).** Already exists (`set-token-level`, World "seats see"); surfaced in the World tab and the Scenes tab, no model change.

### 4.4 Canvas side

- `.ggvtt` writes: `saveLoad.ts` filename and pickers, export modal copy, test expectations. Table accept strings become `MAP_FILE_ACCEPT` imported from core (move the constant to `packages/core/src/shared/mapFile.ts` so the table does not import from the canvas).
- Home screen: a one-line notice above the grid, "Maps live in this browser. Publish to a campaign or download them to keep them safe." with Download all; each map card shows a small "Published · <campaign>" chip from its publish record.
- Publish dialog: after a successful publish the summary gains "Open the table", which calls the handoff route with the campaign's token and opens `tableUrl` in a new tab. `PUBLIC_TABLE_URL` reaches the canvas through the handoff response, so no canvas build setting is needed.
- Token refresh as in 4.3.

## 5. Deleted at the end

Table: `shell/Rail.tsx`, `Popover.tsx`, `Portal.tsx`, `SessionPopover.tsx`, `LogDrawer.tsx`, `PartyStrip.tsx`, `RollBar.tsx` (replaced), `Ticker.tsx`, `TurnPill.tsx`, `Sidebar.tsx`, `icons.tsx`, `anchor.ts`; `components/TableStatusBar.tsx`, `ConnectionStatus.tsx` (replaced), `Toast.tsx`, `controls.tsx`, `InviteCodeChip.tsx`, `PlayerList.tsx` (folded into Session menu and Party sheet); `session/panels.ts`, `session/sidebars.ts`; every `modules/*/…Panel.tsx`, `FogTool.tsx`, `FogLookPanel.tsx`, `MePanel.tsx`, `JournalSidebar.tsx`, `PrepSidebar.tsx` and their tests; the Moss block in `index.css` and the table's own `tailwind.config.ts` theme; `@fontsource-variable/newsreader`; all of `session/client/e2e/*.spec.ts` and the per-sprint Playwright configs (one config and one spec per scope replace them).

Canvas: `src/ui`, `src/theme/tokens.css`, `src/theme/theme.ts`, `src/lib/toast*`, `src/lib/utils*`, the moved composites in `src/editor/components`, the Google Fonts import, `.mapbuilder` write paths.

Kept and reused under the new chrome: `renderer/*`, `session/*` (store, auth, loadSceneMap, WebSocketClient), the logic files of every module (`fog/FogRenderer.ts`, `FogOverlay.ts`, `doors/DoorRenderer.ts`, `tokens/drag.ts`, `rolls/beyond20.ts`, triggers runner), `modules/*/store.ts`, all mechanics tests.

## 6. Work plan: three builders, one pass

Order: A1 lands first (half a day of moves) and is the only hard dependency. B1 lands next so C has the dock frame and registries; until then C builds tab bodies against the registry types in this file and mounts them in the gallery. Everything else runs in parallel. Each step ends with `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green and `pnpm -r build` green. No Playwright, no dev server screenshots, until step T.

### 6.1 Ownership

| Builder | Owns | Does not touch |
|---|---|---|
| **A** platform | `packages/ui`, canvas (imports, `.ggvtt`, home notice, Download all, Open the table, token refresh), server (`auth.ts`, `http.ts` new routes, `mirror.ts`, export, cleanup, migration 006, session spawn of PCs, player asset upload), `packages/core` `mapFile.ts` move, Dockerfiles | table client UI |
| **B** shell | `session/client`: theme wiring, registries, dock frame, rail, title card, presence and menus, combat bar, sheets column, zoom pill, connection chip, toasts, shortcuts sheet, hotkeys, pages (Landing, Host, Join), phone layout, player shell, Fog / Map / World / Scenes / Story tab bodies and strips (porting existing logic), door, light, trigger and room-key cards, pins and marks client side, Player view and Preview as, deletion of the old shell | mechanics, server |
| **C** play | `packages/mechanics` changes (tokens fields and commands, rolls modes and requests and tables, `story`, `pins`, `table` modules, `mark` ephemeral channel on the server side of the protocol), server module registration and redaction for the above, Tokens / Encounter / Dice tab bodies and strips, token card and group card, Token type sheet, Party sheet, Character sheet, player roll bar and roll prompt, combat bar data | shell chrome, pages |

Shared files with one owner: `packages/core/src/shared/protocol.ts` (C bumps the version and adds message types; B and A add nothing there), `session/client/src/session/store.ts` (C adds state for new modules; B adds the republish toast only), `session/server/src/index.ts` module list (C). A and C both touch `session/server/src/http.ts`: A owns routes, C owns nothing there except the `mark` broadcast hook in `ws/`.

### 6.2 Steps

| Step | Owner | Builds | Done when |
|---|---|---|---|
| A1 | A | `packages/ui` created by moving tokens, theme, fonts, preset, primitives, composites, toast, utils; canvas imports rewritten; gallery renders from the package; Dockerfiles and Tailwind globs updated; `@fontsource` in, Google import out | `pnpm -r check` and both `build`s green; `grep -r "fonts.googleapis" canvas packages` empty; canvas `index.css` under 40 lines |
| A2 | A | `MAP_FILE_ACCEPT` into core; `.ggvtt` written everywhere in the canvas; table accept strings read the constant; tests updated | no `.mapbuilder` literal left outside migration comments and test fixtures |
| A3 | A | `auth.ts` DM TTL and refresh route; handoff mint and redeem routes with rate limit; canvas refresh on load; publish dialog "Open the table"; home notice, "Published ·" chips, Download all | unit tests for mint and redeem (single use, expiry, wrong code) and refresh (new `exp` issued) |
| A4 | A | `mirror.ts` with startup pass; export route with `fflate`; cleanup in republish and delete; startup sweep; migration 006 | tests: publish twice leaves one file and one `maps` row; delete removes file, row and slices; export zip lists the expected entries |
| A5 | A | PC spawn on session create; player asset upload; server-side defaults for old `TokenDef` rows (`kind`, `showHp`, `nameplate`) in the tokens validator, type change coordinated with C1 | tests: a campaign with two PC defs starts a session with two placed tokens in the starting room; a player can upload a 1 MB png and not a 3 MB one |
| B1 | B | Table on `@dnd/ui`: preset, tokens, theme init and View menu toggle, desk colour from tokens; registries and the dock frame with eight stub tabs; rail with six tools (Select, Ping, Measure wired to existing camera and selection; Template, Draw, Pin arm a tool and broadcast marks once C's channel exists, until then local only); hotkeys from registries; shortcuts sheet | the table renders light and dark with the new chrome over the existing renderer; old rail still mounted behind a flag until B4 |
| B2 | B | Title card with switcher, presence row, Invite card (board 6), View and Session menus, combat bar shell reading initiative state, sheets column with Party and Log, zoom pill, connection chip and banner, Sonner toasts, republish toast | each surface has a unit test; `Popover` no longer imported by any new surface |
| B3 | B | Fog, Map (Rooms, Doors, Lights, Triggers, Levels, Labels segments and strips), World, Scenes, Story tab bodies on the existing module stores; door, light, trigger and room-key cards; Player view and Preview as; pins client; Journal into the Story sheet | each tab body has a test that drives its commands through a mocked `sendCommand`; boards 10 to 14 and 17 to 19 match in the gallery |
| B4 | B | Pages: Landing, Host (three steps, Back, library cards, Upload, Blank map, starting-room thumbnails, QR, handoff redeem, "Different DM or new campaign"), Join with waiting screen; player shell; phone layout; delete the old shell, panels, sidebars, Moss, Newsreader, old specs | `session/client/src/shell` contains only new files; `grep -r Newsreader session` empty; `pnpm -C session/client build` green |
| C1 | C | Mechanics: `TokenDef` fields and new token commands with validation and redaction (`showHp`); `rolls` modes, requests, tables, saved; `story`, `pins`, `table` modules; `mark` channel; protocol v6; server registration and redaction; store slices in the client | mechanics tests for every command and refusal; protocol test for v6 messages |
| C2 | C | Tokens tab (library strip with filters All / PCs / NPCs / Monsters / Prepped, search, new-token defaults, Alt-drag hidden, Hide all NPCs, Show all, Gather party, Lock movement), Token type sheet, Party sheet, token card and group card, HP bars, condition badges, turn ring, hidden-token ghosting | boards 15 and 3 match in the gallery; drag code reuses `modules/tokens/drag.ts` |
| C3 | C | Encounter tab (Start, Roll for NPCs, Next, Previous, round, End behind confirm, damage and healing to selection with Half on save, conditions catalogue, effect timers, Prepped encounters with Spawn), combat bar data and End turn, Add to combat from cards | board 16 matches; initiative module tests extended for effects ticking on Next |
| C4 | C | Dice tab (quick dice, formula, Adv/Dis, modes, Ask players with DC, tables, saved), player roll bar with privacy, roll prompt card (board 20), result chips beside tokens, log entries by mode, Character sheet (board 5) with Beyond20 state and Find my token | boards 20 and 5 match; blind roll result invisible to the roller in the log test |
| T | tester | Browser run, once: see section 7 | report with screenshots, one RCA, one fix commit by the owning builder, re-run of failed files once |

### 6.3 Rules for the builders

- Pixel and copy source is the board; where a board and this file disagree on behaviour, this file wins; where the file is silent, the write-up section the board cites wins.
- No new CSS files in the table. Tailwind classes on `@dnd/ui` tokens only; no `text-[11px]` style arbitrary sizes, use the preset's scale.
- No new icon drawings. lucide only.
- Every new surface and tab body gets a vitest test next to it. No builder runs Playwright, a dev server screenshot loop, or Chrome. Typecheck, lint, unit tests and build at each step only.
- Keep `data-testid`s on the new surfaces using the names the new specs (section 7) will use; write the spec files in the same step, unrun.
- Commit per step with the step id in the subject. No pushes.
- Ask before adding a dependency not named here.

## 7. Testing, once, at the end

One Playwright config for the table (`session/client/e2e/playwright.config.ts`) with scope tags, one spec file per scope, written by the builders during their steps and first executed at step T by one tester through context mode, following the scoped budget rule (the suite is run once, failed files re-run once after the fix commit):

| Spec | Tag | Covers |
|---|---|---|
| `shell.spec.ts` | @shell | light and dark, dock fold and tabs by key, rail tools arm and Esc, zoom pill, shortcuts sheet |
| `host-join.spec.ts` | @host | three-step host flow with Back, library cards, starting room, QR present, handoff redeem lands on Map step, "Different DM" shows the pass step, join and waiting screen |
| `publish-live.spec.ts` | @publish | canvas publish then republish: table swaps the map, toast appears, fog and tokens survive, one mirror file, one `maps` row |
| `fog-map.spec.ts` | @map | Fog tab reveal, hide, rect, look picker; Map tab doors open and lock, secret reveal, lights on and off, trigger fire and re-arm, room key sheet share |
| `tokens-combat.spec.ts` | @play | PC tokens spawned at session start, claim, player art upload, token card HP and conditions, Alt-drag hidden, encounter start, Next, damage with half on save, effect timer ticks, End turn as player |
| `story-dice.spec.ts` | @story | handout shown full screen to players and hidden, title card, roll modes incl. blind, roll request and result card, rollable table, journal |
| `world-scenes.spec.ts` | @scenes | clock jumps, weather, darkness fade, seats see level, Prepare then Switch now, delete scene confirm and cleanup, export zip downloads |
| `player-phone.spec.ts` | @player | player shell, character sheet, Find my token, phone tabs and roll sheet at 390×844 |

Canvas: the existing suite is run with `--grep @home` and `--grep @publish` only, since only those surfaces changed.

## 8. After the pass

Build the head locally as `cv-<sha>` from a clean `git archive` export and restart the public stack on it; rollback stays the previous `cv-` tag. Then the user walks both apps and reports what feels off; nothing else is scheduled.

## 9. Out of scope, named so nobody builds it

Sound tab; per-player scenes; token and handout art generation; archive import; Discord bot changes; account system; canvas visual changes beyond the home notice, chips and the Open the table button; conditions with mechanical effects beyond a badge and a timer; character sheet fields beyond HP, AC, speed, passive and conditions.
