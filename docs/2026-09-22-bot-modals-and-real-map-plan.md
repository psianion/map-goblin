# Bot: modals, real map picture, component sweep — plan

Status: 2026-09-22, launched as one build-only workflow (4 steps, sequential, same files). User reviews in Discord.

## 1. Modal seam
- `routeInteraction` gains an `isModalSubmit()` branch → `registry[ns].modal(interaction, id, deps)`; same
  `namespace:action:userId:extra` custom id, same owner check.
- Modals use Label-wrapped fields (Text Input, String Select, User/Role/Channel Select, File Upload,
  Radio Group, Checkbox Group, Checkbox) — all present in @discordjs/builders 1.14.1. Modal cap is 5
  top-level components. Read back with `fields.getTextInputValue / getStringSelectValues /
  getSelectedChannels / getSelectedUsers / getSelectedRoles / getUploadedFiles / getRadioGroup /
  getCheckboxGroup / getCheckbox`.

## 2. Which commands open a modal
| Command | Slash options kept | Modal fields |
|---|---|---|
| `/campaign setup` | none | name · goblin campaign id · player channel (Channel Select) · DM channel (Channel Select) · DM (User Select) — role stays a slash option? No: 5 labels is the cap, so role + D&D Beyond move to `/campaign settings` (new modal: player role (Role Select), D&D Beyond link). |
| `/character create` | none | name · class (String Select, 13 5e classes) · level (short, 1–20 validated) · portrait (File Upload 0–1) |
| `/character update` | `name` (autocomplete, picks the character) | same four, prefilled; name field = rename |
| `/recruit open` (renamed from `/lfg open`) | none | blurb (paragraph) · seats open (select 1–6) · who we're after (Checkbox Group: new players welcome, voice, weekly, one-shot) |
| `/apply` and the Apply button | `campaign` (autocomplete) on the slash form; the button carries it in `extra` | pitch (paragraph) · experience (Radio: new / some / veteran) · availability (short) |
| `/handout` | none | title (short, optional) · body (paragraph, optional) · files (File Upload 0–10, split by mime) · game asset id (short, optional) · spoiler (Checkbox) |
| `/feedback` | none | category (Radio: bug / idea / praise) · text (paragraph) |
| `/note`, `/quests add`, `/schedule`, `/roll` | unchanged | one field or autocomplete-dependent; a modal adds a click for nothing |

New columns where the store has none (migration v17): `lfg_posts.seats`, `lfg_posts.tags`,
`lfg_applications.experience`, `lfg_applications.availability`, `feedback.category`; `campaigns.role_id`
already exists. Cards from sets 5–7 show the new fields.

## 3. Real map picture (`/map`, player view)
- Today: `render/map-svg.ts` schematic. Wanted: what a player's browser shows.
- Build: Playwright (already used by `session/client/e2e`, chromium-1208 installed) inside the bot:
  `render/table-shot.ts` opens the table page with the campaign's player-role token in
  `sessionStorage['mg-seat']`, hides chrome with `OVERLAY_CHROME`, waits for the map to render, and
  screenshots `[data-testid="game-canvas"] canvas`. Reuses `session/client/e2e/table.ts` patterns.
- Falls back to the schematic with a `-# schematic · the table is closed` line when no session is live
  or the browser fails.
- The bot's player identity would appear on the roster while the shot is taken → `session-stats`
  ignores the bot's own identities. If the player-role token is refused on the socket, join through
  `/join/<invite>` with a fixed name and report it.
- DM view stays on the schematic: the DM socket identity is the observer's; a browser on it would
  kick the observer. Per-player-accurate fog needs the seat-binding work (sync plan, Batch B).
- `bot/Dockerfile`: `node:22-slim` + `playwright install --with-deps chromium` (~400 MB). Accepted:
  one container, laptop-hosted.

## 4. Message-component sweep
- `/mycharacters` rows: Section accessory button "Show card" (non-link accessory buttons are allowed).
- `/quests log` (DM): a String Select "Mark complete" under the card, owner-stamped.
- `/character show` when the user has several: String Select to switch character on the private card.
- Poll: vote buttons stay; add a role-restricted "Close poll" button for the DM.
- Then `pnpm sync` once, since command shapes changed.
