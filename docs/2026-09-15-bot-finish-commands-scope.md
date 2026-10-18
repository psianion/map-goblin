# Bot: finishing the commands — scope

Status: SCOPE, awaiting approval. No code. Companion to `docs/2026-08-02-discord-bot-v1-plan.md`.

Baseline on main `3146630`: all 18 planned commands plus `/ping` and `/initiative` exist, `pnpm --filter bot check` is green (typecheck, lint, 342 tests), protocol version 5 matches the server.

Five work items, in the order they should land. Each is one small PR or one commit on one branch; none depends on another.

---

## 1. `/map` on an image-base map

### What is broken

`readScene` (bot/src/render/map-svg.ts) reads `shape`, `water`, `door`, `text` and `light` children. It skips `asset` children on purpose ("assets keep their meaning in the painted render"). A map imported from Foundry or UVTT is a locked `Battlemap` dungeon layer holding one `asset` child with `objectType: 'image'`, plus a `Walls` layer with doors and lights. So the sheet draws doors and lamps floating on blank parchment. The same applies to any hand-built map whose ground is an image rather than traced floors.

Fog on such a map is roomless: the party's explored ground is the fog module's `region` bit mask (`RegionMask`: `minX, minY, cols, rows, bits` base64, one bit per cell), not room ids. The bot never reads that mask.

### What changes

**Read the image (no new route).** `GET /api/maps/:sceneId` without `?images=external` already returns `customImages` inline as data URLs, which is what the bot fetches today. Resvg renders `<image href="data:…">` natively. So the bot reads `customImages[child.assetId]` from the document it already has. The `?images=external` route is not needed; skip it until a map's JSON is too big to parse comfortably.

- `readScene`: new `images: { href, x, y, width, height, rotation }[]` from `asset` children whose `assetId` resolves in `root.customImages`. Position is the child's centre (`position.x/y`), size is `width × height` in cells (toDocument.ts writes both). Children on a hidden layer are skipped like everything else.
- `boundsOf`: images count toward the sheet bounds for the DM view when the server stamps no `frame`.
- `mapSvg`: draw images first, under floors and water. No grid over an image (imported maps carry their own).

**Cut the image to what the party has seen.** The server's player document decides what floors and doors a player gets, but the image child is a single object and the fence for it lives in the table client's fog mask. The bot has to apply the same cut or the whole battlemap leaks into a shared channel. Rule, matching the client's `tierPlan`: visible ground = revealed rooms' floor rings ∪ region mask cells.

- `MapSvgOptions` gains `region?: RegionMask`. Player view: the image is drawn inside a clip path made of the floor path plus one `<rect>` per set cell of the region (run-length merged along rows so a 200×200 map does not emit 40k rects). DM view: whole image, no clip.
- **Fail closed.** Player view of a map that has images but no `region` and no floors draws no image and falls through to the existing "Nothing explored yet" sheet. A missing mask never means "show everything".
- Where the region comes from: the observer already receives the DM seat's `fog` module state, whose `byScene[sceneId].region` is the party record. `FogState` in bot/src/goblin/observer.ts is currently narrowed to `{ log }`; widen it to `{ log, byScene?: Record<string, { region?: RegionMask }> }`. `session-stats` keeps the latest region per scene beside the tokens it already keeps (`region(sceneId)` next to `tokens(sceneId)`). `liveState()` in live-session.ts exposes it; `postMap` and `snapshotOf` pass it through.
- `RegionMask` type and `toBytes` come from `@dnd/mechanics/fog` region.ts. That file is browser-safe (ES2022, no DOM). The bot re-declares wire shapes today rather than importing mechanics; the 30-line reader (`getCell` over base64 bits) is copied, same as `SIZE_CELLS`, so the bot keeps zero workspace imports.

**Out of scope:** the session-end snapshot in `snapshotOf` gets the same cut for free because it goes through `mapSvg` with the player token; nothing else to do there. Brush strokes painted by the DM in `rooms` mode land in the same `region` record, so they are covered.

### Files

bot/src/render/map-svg.ts, bot/src/goblin/observer.ts, bot/src/goblin/session-stats.ts, bot/src/goblin/live-session.ts, bot/src/bot/command-registry.ts (`postMap`), new fixture `bot/src/render/__fixtures__/battlemap.ts`, snapshot tests.

### Tests

- Snapshot: DM view of an image map draws the whole image; player view with a region draws the image clipped; player view with no region and no floors is the empty sheet and the SVG contains no `<image`.
- Region reader: three cells set at known bit positions resolve to the right `(col,row)`.

### Quality bar

The player sheet for a half-explored imported map shows exactly the cells the table client shows explored, at up to 2048px wide, and never a pixel outside them. DM view renders the 4096px import cap without exceeding the 2048px output cap.

---

## 2. Shared Journal cards reach Discord

### What is broken

The DM's `share-note` and `share-card` commands publish `JournalEntry` cards into `modules.triggers.journal` (session-scoped, visible to all roles). The bot's `session-log.ts` reads only `triggers.byScene[*].log`. Nothing in Discord ever shows a shared card.

Note where the mirror lives: the session log thread hangs under the **DM channel**, so even a line there would not reach the player who is away from the table. The card has to be posted where the party reads.

### What changes

- `WireJournalEntry { id, at, kicker, title, body, imageKeys?, sceneId }` and `journal?: WireJournalEntry[]` on the observer's `TriggersState`.
- `session-log.ts`: one more `diff(...)` over the journal array in both `fromModules` and the `triggers` event case. Same `seen` set and same seed rule: the first snapshot is history, not news, so cards shared last week are not re-posted on every bot boot. Line format matches the sidebar card: `📜 **Place — Title**` then the body quoted line by line (kicker labels Place / Person / Missive / Lore, from JournalSidebar.tsx).
- `LogLine` gains `to: 'thread' | 'party'`. Everything existing is `thread`; journal lines are `party`. live-session's flush sends `party` lines to `campaign.channelId` as a container with header `Journal — <campaign>`, and also writes them into the thread so the thread stays the full record.
- Images on a card: v1 posts the text. `imageKeys` on a shared entry are fetchable with the player token from `GET /api/maps/:sceneId/images/:key`; adding `getMapImage` to rest.ts and attaching the first image is about 15 lines and can ride in the same PR if wanted. Say which.

### Files

bot/src/goblin/observer.ts, bot/src/goblin/session-log.ts, bot/src/goblin/live-session.ts, tests beside them.

### Tests

- A `triggers` event with a new journal entry yields one `party` line with kicker, title and quoted body. A second identical event yields nothing. The first snapshot carrying three old cards yields nothing.

---

## 3. Recap stats survive a bot restart

### What is broken

`createSessionStats` starts from zero on every `attach`. A resumed session keeps the board and the thread (ids are in the `sessions` row) but `doorsOpened`, `players`, `peakPlayers` and `scenes` reset, so the recap of a table that restarted mid-session is the recap of its second half.

### What changes

- Migration v15: `ALTER TABLE sessions ADD COLUMN stats TEXT` (JSON of `RecapStats` minus `durationMs`, which `startedAt` already gives).
- `sessions` store: `saveStats(goblinSessionId, stats)` and `stats` on the row.
- `createSessionStats(startedAt, seed?)` takes the stored counters as its starting point. Live view (who is here now, which scene) is still replaced by the next snapshot, as today; only cumulative counters seed.
- live-session: after every `stats.apply(event)`, if the recap JSON changed, write it. One synchronous SQLite update per counter change is nothing.

### Files

bot/src/db/migrations.ts, bot/src/db/stores.ts, bot/src/goblin/session-stats.ts, bot/src/goblin/live-session.ts, tests.

### Tests

- Store: save then read back. Stats: seeded with `doorsOpened: 4`, one door event, recap says 5. live-session: resume with a stored row seeds the counters (existing resume test extended).

---

## 4. `/initiative` collision on same-named characters

### What is broken

`tableIdentityOf` returns `undefined`; the combatant is matched by character name. Two entries named "Bob" are indistinguishable and the first wins.

### Why the real fix is not in the bot

The table's `identityId` is the seat a browser claimed via invite code. The server has no Discord id for that seat and no route to bind one. Wiring `tableIdentityOf` properly means a protocol change (a `discordId` on the seat or a bind command) and a client affordance. That is its own workstream, not part of finishing the commands.

### What changes instead

- Ambiguity becomes an answerable error. When `namedBy` finds more than one entry with the name, it throws: "2 combatants are named Bob. Pick one with the `character` option." The existing autocomplete on the `character` option is extended to list the encounter's entries by key when an encounter is running, so the player picks the exact entry. No schema change. (Built as `7079f59`.)
- The `ponytail:` comment on `tableIdentityOf` is updated to point at the protocol change as the upgrade path.

### Files

bot/src/bot/command-registry.ts, command-registry.test.ts.

---

## 5. Live walk of the never-verified paths

No code unless the walk finds something. Docker images are at `a0c76b1`, so the docker lane cannot run this; the dev lane (560x) can, with the bot pointed at it.

Walk list, in order, on Goblin Warren:

1. A prep encounter fired from the scene prep layer, then `/initiative 17` from a player's Discord account. Expect: the tracker on the table shows the value and the thread prints the initiative log line.
2. Welcome message: a test account joins the guild. Expect one post in the welcome channel.
3. `/schedule` poll: two different accounts vote. Expect both counted, the second voter's confirmation names the right slot.
4. `/character` portrait after the persistence change: set a portrait, restart the bot, `/character show`. Expect the image still attached.
5. After item 1 lands: `/map` in the party channel on the imported battlemap with half the ground brushed. Expect the cut sheet.

Each failure becomes a finding with a fix in the same branch or a tracked item; nothing gets dropped.

---

## Rulings needed

1. **Journal card images in v1?** Text only, or attach the first image (about 15 lines, one rest call).
2. **Crit and fumble rule.** Today only a single-die `1d20` term counts, so `2d20` rolled for advantage never counts. Options: (A) keep as is; (B) a multi-d20 term counts by its highest die, which treats `2d20` as advantage; (C) every d20 die counts on its own. Recommend B. The change is one loop in dice.ts either way; the stats column does not change.
3. **Docker rebuild now or after?** Rebuilding images to main before the walk lets the walk run on the docker lane; otherwise it runs on the dev lane and docker is rebuilt when this ships.

## Not in this scope

- Discord id ↔ table seat binding (needs protocol work).
- Combat sync and token icons from the Beyond20 bridge (deferred in PR #116, unchanged).
- `?images=external` in the bot: no need until inline JSON is measurably slow.
