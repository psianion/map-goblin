# Bot: finishing the commands — build and check plan

Status: APPROVED 2026-09-15 ("GO"). Scope: `docs/2026-09-15-bot-finish-commands-scope.md`. Branch `bot-finish-commands` off main `3146630`.

Rulings baked in:
- Journal cards post text only. No image attachment.
- Crit and fumble rule stays: a single-die `1d20` term counts, nothing else. Advantage is two separate rolls at the table, so `2d20` is not advantage and does not count. No dice.ts change.
- Docker stays at `a0c76b1`. Everything is checked on the dev lane (server 5600, canvas 5601, table 5602, bot started by `pnpm dev` when `bot/.env` exists). Docker is rebuilt when this ships.

Two workflows, run one after the other. Fable adjudicates between them. Opus agents build and fix. Sonnet agents read, review and run checks. No Haiku, no Fable inside a workflow. Every agent prompt carries the checkpoint paragraph (one hour or 500k tokens → progress report, stop).

---

## Workflow A — build

One branch, one working tree, steps run in sequence because they share `observer.ts`, `session-stats.ts`, `live-session.ts` and `command-registry.ts`. Each step: one Opus builder → one Sonnet reviewer → one Opus fixer only if the review has findings. Three agents per step at most.

Gate for every step: `pnpm --filter bot check` green (typecheck, lint, tests), one commit on the branch with a plain imperative subject, no attribution.

### A1 — `/map` draws image-base maps and cuts them to the fog

Builder owns: `bot/src/render/map-svg.ts`, `bot/src/render/__fixtures__/battlemap.ts` (new), `bot/src/render/map-svg.test.ts` + snapshot, `bot/src/goblin/observer.ts` (widen `FogState`), `bot/src/goblin/session-stats.ts` (`region(sceneId)`), `bot/src/goblin/live-session.ts` (`liveState` exposes region; `snapshotOf` passes it), `bot/src/bot/command-registry.ts` (`postMap` passes it).

Facts the builder does not need to rediscover:
- Imported maps (`packages/core/src/shared/import/toDocument.ts`): a locked dungeon layer `Battlemap` with one child `{ childType: 'asset', objectType: 'image', assetId, position: {x, y} (centre, cells), width, height (cells), scale: 1 }`, plus a `Walls` layer with doors and lights. The image bytes are `root.customImages[assetId]`, a `data:` URL, inline on the document `rest.getMap` already fetches. No new route.
- The party's explored ground on such a map is the fog module's per-scene `region: { minX, minY, cols, rows, bits }`, bits = base64 of `ceil(cols*rows/8)` bytes, row-major, LSB first (`packages/mechanics/src/fog/region.ts`). The observer already receives the DM seat's whole `fog` state; the bot's `FogState` type only declares `log`. Cell `(col,row)` maps to world cell `(minX+col, minY+row)`.
- `mapSvg(doc, { tokens, dmView, region })`. DM view: whole image, no clip. Player view: image clipped to floor rings ∪ region cells (rects run-length merged per row). Player view with images but no region and no floors → no `<image` in the output, empty sheet. This is the fog-leak guarantee; test it.
- Images draw under floors and water. No grid over an image. Images extend `boundsOf` when the server stamps no `frame`.
- The bot re-declares wire shapes rather than importing workspace packages (`SIZE_CELLS` precedent). Copy the 20-line bit reader; do not add a dependency.
- resvg renders `<image href="data:image/png;base64,…">`. Keep the 2048px output cap.

Reviewer checks: snapshot tests for DM / player-with-region / player-without-region; no `<image` in the fail-closed case; region bit math (three cells at known offsets); `snapshotOf` and `postMap` both pass the region; nothing in `session/` or `packages/` touched.

### A2 — shared Journal cards post to the party channel

Builder owns: `bot/src/goblin/observer.ts` (`WireJournalEntry`, `journal?` on `TriggersState`), `bot/src/goblin/session-log.ts`, `bot/src/goblin/session-log.test.ts`, `bot/src/goblin/live-session.ts` + test.

Facts:
- `modules.triggers.journal: JournalEntry[]` with `{ id, at, kicker: 'place'|'person'|'missive'|'lore', title, body, imageKeys?, sceneId }`. Session-scoped, not per scene.
- Kicker labels are Place / Person / Missive / Lore (`session/client/src/modules/triggers/JournalSidebar.tsx`).
- `LogLine` gains `to: 'thread' | 'party'`. Existing lines are `thread`. A journal line is `party`: header `Journal — <campaign name>`, body `📜 **<Label> — <title>**` then the body quoted line by line with `> ` (never `>>>`), stamped `<t:…:t>` like every other line. `party` lines also go into the thread so the thread stays the full record.
- Same `seen` set, same seed rule: the first `session-state` snapshot is history and is not spoken. A card shared last session must never re-post on a bot boot. Test both.
- live-session's flush already batches and chunks thread lines at 3500; party lines flush through `deps.announce(campaign.channelId, …)`, one container per card.

Reviewer checks: first snapshot silent, later `triggers` event with a new card yields exactly one party line, repeat event yields nothing, thread and party both receive it, chunking still holds.

### A3 — recap stats survive a bot restart

Builder owns: `bot/src/db/migrations.ts` (v15 `ALTER TABLE sessions ADD COLUMN stats TEXT`), `bot/src/db/stores.ts` + test (`stats` on the row, `saveStats(goblinSessionId, stats)`), `bot/src/goblin/session-stats.ts` + test (`createSessionStats(startedAt, seed?)`), `bot/src/goblin/live-session.ts` + test (seed on resume, write after every `apply` when the recap JSON changed).

Facts:
- Cumulative counters: `scenes`, `doorsOpened`, `players`, `peakPlayers`. `durationMs` derives from `startedAt`, not stored. Live view (who is here now, current scene) is replaced by the next snapshot as today; only cumulative counters seed.
- Resume path: `attach(campaign, row, resumed = true)` in live-session.ts; `deps.sessions.byId(row.goblinSessionId)` is the row.

Reviewer checks: migration idempotent on an existing db; seeded stats plus one door event reads seed+1; resume test seeds from the row; a fresh session still starts at zero.

### A4 — `/initiative` refuses an ambiguous name instead of guessing

Builder owns: `bot/src/bot/command-registry.ts` (`namedBy`, `characterAutocomplete` for the initiative command), `bot/src/bot/command-registry.test.ts`.

Facts:
- `tableIdentityOf` stays a stub; update its `ponytail:` comment to name the protocol change (a Discord id on the seat) as the upgrade path.
- When more than one entry matches the name: throw `userInput` with "Two combatants are named X. Pick one with the `character` option." When an encounter is running, the `character` autocomplete lists the encounter's entries (by `name`, value = `key`) ahead of the member's characters, and a chosen `key` matches an entry directly.

Reviewer checks: two same-named entries → the error, not the first one; autocomplete lists encounter entries when one is running; the existing name path still works with one match.

### A5 — the bot refreshes its own game-server seats (added 2026-09-15 after Workflow B pre-flight)

Found live: the dev campaign's stored seat had expired 20 days earlier. Every server token lives 7 days (`TOKEN_TTL_MS`, session/server/src/auth.ts) and `/campaign setup` mints the bot's two seats once, so a week later every `/map`, `/session start`, scene autocomplete, handout fetch and observer join fails with a generic error.

Builder owns: new `bot/src/goblin/seat.ts` (decode a token's `exp`), one async seam in `command-registry.ts` that re-mints both seats with the admin pass when either is missing or within 24 hours of expiry, saves them on the campaign row, and returns the refreshed campaign. Every server-facing read of `serviceToken` / `playerToken` goes through it. Bot-only; the server's TTL stays.

Reviewer checks: decoder matches auth.ts encoding; unreadable token counts as expired; fresh seats cause no mint; no call site left reading the raw token.

---

## Workflow B — check everything

Runs against the dev lane with the bot up. Prerequisite handled by the first step: a campaign in `bot/data/bot.db` whose `goblinCampaignId` exists on the dev server and holds a service token and a player token. If not, the workflow stops and reports "run `/campaign setup` in Discord", because minting seats is a slash command only a person can type.

Slash commands cannot be invoked with a bot token, so the workflow checks every command by driving its handler in-process against the real dev server and a real temp bot db, with Discord posting captured. Rendering in Discord itself is checked on the observer-driven paths, which need no typing: the thread mirror, the Journal card, the recap. What is left for a typed pass is listed at the end and done with the user after the workflow.

### B1 — pre-flight (Sonnet reader)

- Dev stack up on 5600/5602 and the bot process running from `pnpm dev`. Bot db campaign row matches a live dev campaign; both tokens present; the Goblin Warren map is a scene there. Report the campaign id, scene ids, and whether an imported battlemap scene exists (if not, import `session/testdata` UVTT or a Foundry folder via the canvas import so `/map` has an image map to cut).
- `pnpm --filter bot check` on the branch tip.

### B2 — every command through its handler (Opus writes the harness, Sonnet runs and reads)

A scratchpad script builds `Deps` the way `command-registry.test.ts` does, but with `createGoblinRest` pointed at `http://127.0.0.1:5600`, a temp sqlite db with the campaign row copied in, and `announce`/`edit`/`archiveThread` capturing to an array. It runs each command's `execute` with a fake `ChatInputCommandInteraction` and asserts the reply and the captured posts. One case per subcommand of: campaign, session (start/end against the real server), map (DM channel and party channel on the battlemap scene, PNG decoded and checked for non-parchment pixels only inside the region), character, mycharacters, quests, note, recall, roll (a `1d20` nat 20 counts, a `2d20` does not), loot, gold, calendar, handout, schedule (create, two voters, close), lfg, apply, feedback, status, initiative (one match, two same-named, chosen key), ping.

Output: a table, one row per subcommand, PASS or the failure text. The runner fixes nothing; findings go back to Fable.

### B3 — observer-driven paths live in Discord (Sonnet wire driver + Sonnet Discord reader)

With a session the bot started (`/session start` typed by the user before this step, or the B2 harness's session if the bot process is watching it): drive the table over WS from the DM seat (`dm-drive.mjs` pattern: join frame v5, then `command` frames) — open a door, brush a region on the battlemap scene, `share-card` a Journal entry, place a token, then read back over Discord REST with the bot token (never printed): the thread has the door line and the card line, the party channel has the Journal card, the live board updated. Restart the bot process, drive one more door, end the session, and read the recap: door count includes the pre-restart doors.

### B4 — review (Sonnet)

Reads the full branch diff against the scope doc and this plan. Reports anything skipped, any `ponytail:` comment without a named ceiling, any test that asserts less than the scope promises. No fixes.

### Left for the typed pass (user in Discord, Fable on wire and Chrome)

1. `/initiative 17` from a player account while a prep encounter runs.
2. Welcome message on a guild join.
3. `/schedule` poll with two real voters.
4. `/character` portrait after a bot restart.
5. `/map` typed in the party channel on the battlemap scene, half brushed.

Each failure is a finding: fixed on the branch or tracked, never dropped.

## Findings from Workflow B (2026-09-15)

B2 handler harness: 37 of 37 rows pass against the live dev server, including the seat re-mint by the A5 seam, both `/map` views on a real imported map (Riverside Mill, scene `047c4129-abb1-4566-ba75-4894500d7ebf` on the bot's campaign), and the crit rule. Harness at `bot/check-live/commands.ts` (untracked). Facts it corrected: `GET /api/campaigns/:id/session` answers `{sessionId, inviteCode}` or 404; map upload mints the scene itself, no publish call; fog region memory survives the session that painted it, so a "nothing swept" sheet needs a `fog reset` first.

B3 live harness (`bot/check-live/live.ts`): 10 of 10 rows pass with a real bot restart in the middle: door line, scene line, Journal card to the party channel and the thread, board edit, stats row across the restart, recap door count, end-snapshot cut. B4 full-diff review: five commits clean, no findings against them.

Fixed on the branch in `251702a` (all four found live, all with tests):
1. **`/initiative` replied "Sent" for a frame the dying socket dropped.** `observer.command()` now returns false unless the socket's ready state is open, so the existing "couldn't reach the table" error fires.
2. **`/session end` replied before the recap was posted.** The server's `session-ended` broadcast raced the DM command into two concurrent `finalize()` calls; the second now awaits the first's promise.
3. **Player sheets drew tokens on unswept ground.** The seen-clip applied to the base image only; tokens are now drawn inside the same clip, and a player sheet with nothing seen draws no tokens at all. This also cuts a token standing in an unrevealed room on an ordinary map.
4. **Door names were lost for non-active scenes after a restart.** The name loader now fetches every scene the snapshot lists, once each, not only the active one.

Harness facts worth keeping: `bot.db` runs in WAL mode, copy the `-wal` and `-shm` sidecars with it; the door counter only counts a proven closed→open transition, so a re-run must close a door before opening it.

## Ship

Squash-merge PR after the typed pass is clean, then rebuild docker images to main. Ship steps per the labs-git skill.
