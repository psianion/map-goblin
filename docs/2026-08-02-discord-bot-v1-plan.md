# Good Goblin Discord Bot — v1 Plan

2026-08-02. First draft scope as picked by the user; grounded in surveys of uxie, hq-vgc, and the map-goblin server.

## 1. Where it lives: in this repo, as a workspace package

**Decision: `bot/` package inside the map-goblin pnpm workspace**, deployed as a fourth docker-compose service. Not a separate repo.

Why:
- The bot is a deep consumer of game-server data (sessions, scenes, redacted maps, live WS events) and needs the same wire types. A separate repo means duplicating `session-state` / `scene-changed` / map-JSON shapes and letting them drift. In-workspace it imports types the same way `session/client` does.
- The bot and game-server are co-deployed by the same operator on the same box. Same compose file, same volume conventions, same secrets story.
- Everything else matches: Node 22, pnpm, vitest, `check = typecheck && lint && test`, colocated `*.test.ts`. (Uxie runs Bun; we don't — monorepo consistency wins over copying uxie's runtime.)

"Standalone bot" from the earlier decision meant standalone *vs Avrae*, not a separate codebase.

Layout:

```
bot/
  Dockerfile                 # node:22-slim, non-root, like infra pattern in hq-vgc
  package.json               # @dnd/bot
  src/
    index.ts                 # boot: env → db → client → registry → ready
    env.ts                   # zod-validated, sole process.env reader (uxie pattern)
    db/                      # better-sqlite3 + append-only SQL migrations (same pattern as session/server/src/db)
    bot/
      client.ts              # discord.js Client, minimal intents, presence
      commands.ts            # pure SlashCommandBuilder declarations
      command-registry.ts    # dispatch table {authorize, execute, autocomplete} (hq-vgc pattern)
      interaction-router.ts  # auth-before-defer, single error catch site
      sync-commands.ts       # guild-scoped PUT, reads same registry (no drift)
    lib/
      ui.ts                  # container() Components-v2 helper (hq-vgc)
      custom-id.ts           # namespaced + owner-stamped component IDs (hq-vgc)
      channel-log.ts         # Discord log-channel sink (uxie debounce + hq-vgc audit lines)
      log.ts                 # JSON logger w/ recursive secret redaction (uxie)
      errors.ts              # BotError taxonomy, mapped to user replies at the catch site
    goblin/
      rest.ts                # game-server REST client (bearer token)
      observer.ts            # persistent WS client per active campaign session
      session-stats.ts       # accumulates recap data from observed events
    render/
      map-svg.ts             # redacted map JSON → SVG
      raster.ts              # satori/resvg → PNG buffers
      card-kit.ts            # character/status cards (hq-vgc satori pattern)
    features/
      session.ts  map.ts  character.ts  campaign.ts
      quests.ts  journal.ts  dice.ts  economy.ts  calendar.ts
      handout.ts  schedule.ts  lfg.ts  feedback.ts  nickname.ts
  smoke/
    smoke.ts                 # live self-check posting results to the log channel
```

## 2. Stack

- TypeScript strict ESM, Node ≥22, `tsx` dev / `tsc` build.
- `discord.js ^14.26` (Components v2, media galleries — same version as both reference bots).
- `better-sqlite3` at `<BOT_DATA>/bot.db` — same DB + migration pattern the game server already uses. No Postgres, no ORM. `// ponytail: sqlite + SQL strings; revisit if the bot ever outgrows one guild`
- Images: **satori + satori-html + @resvg/resvg-js** (hq-vgc's proven pipeline; resvg note: embed big raster backgrounds as JPEG data URIs, not PNG — resvg's Linux binary blocks the event loop decoding large PNGs).
- `zod` for env. `vitest` for tests.

## 3. Identity & data ownership

- **discord_id IS the user id.** No /link, no web login. All bot tables key on `discord_id` (+ campaign).
- **Game server stays the authority** for campaigns, sessions, scenes, maps, fog, doors. The bot never re-implements visibility — it fetches through the server's existing per-role redaction choke point.
- **Bot DB owns everything Discord-native** that doesn't exist server-side (survey confirmed none of these exist): characters, quests, notes/journal, gold & loot ledger, roll history, in-game calendar, schedule polls, LFG applications, feedback, session recap stats, and the campaign↔Discord mapping.

Bot DB tables (v1):

| Table | Keys / notes |
|---|---|
| `campaigns` | goblin campaign id, name, guild category/channel ids (player channel, DM channel), campaign role id, DM discord_id, bot's game-server token |
| `characters` | discord_id, campaign, name, class, level, portrait asset ref, last_played |
| `sessions` | goblin session id, campaign, started/ended, recap JSON (scenes visited, doors opened, duration), recap message id |
| `quests` | campaign, title, status, added_by |
| `notes` | campaign, discord_id, text, created_at (FTS index for /recall) |
| `rolls` | campaign, character, expr, result, faces, is_crit/is_fail, ts |
| `ledger` | campaign, delta (gold) or item, actor, ts |
| `calendar` | campaign, current day counter, epoch label |
| `schedule_polls`, `lfg_posts`, `feedback` | as named |

## 4. Game-server integration (one small server-side change)

**Token minting.** The bot holds `GOBLIN_ADMIN_PASS` in env (same operator, same box). New route on the game server — the only server change v1 needs:

- `POST /api/campaigns/:id/service-token` (admin-pass gated) → mints a long-lived DM-role token for the bot. The auth code already says "another issuer of the same token — nothing here changes"; this is that seam. ~20 lines + test.

Everything else uses existing routes: `GET /api/campaigns` (list), `GET /api/maps/:sceneId` (DM token → full map, **player token → server-redacted map**), `POST /api/join` (mint per-player tokenized join links for the session embed), `GET /api/campaigns/:id/scenes`, sessions open/close.

**Live events: the bot is a persistent WS client, not a webhook receiver** (no webhook bus exists, and building one is more code than one WS consumer). Per campaign with an active session, `observer.ts` connects with the bot's token and consumes: `session-state`, `player-joined/left`, `scene-changed`, `session-ended`, `dm-disconnected`, plus door-toggle state updates. Auto-reconnect with backoff; on reconnect, re-sync from the `session-state` snapshot so missed events can't corrupt recap stats.

That single WS stream drives: live session embed updates, recap accumulation, initiative later.

**Fog-leak guarantee.** For anything player-facing, the bot connects/fetches with a **player-role token**, so the server's `buildRedactor` choke point strips DM-only data before the bot ever holds it. The DM `/map` variant uses the DM token and is CBAC-locked to the DM channel (§6). The bot never filters map data itself.

## 5. Map snapshot renderer (the one genuinely new build)

Nothing in the stack can rasterize a map today — rendering is client-only Pixi. Headless Pixi/WebGL in Docker is the over-engineered path. Instead:

- `render/map-svg.ts`: pure function, redacted map JSON → SVG (floor polygons, wall paths, door glyphs, labels, token dots, grid). Style it to the art-style-guide palette — a "parchment schematic" look, deliberately not a Pixi replica.
- resvg → PNG buffer → `AttachmentBuilder`, shown in embeds via `MediaGalleryBuilder`.
- Player `/map` renders the player-token JSON (fog holes already cut server-side); DM `/map` renders the DM-token JSON.
- Pure function ⇒ snapshot-testable against fixture map JSON without Discord or the server.

`// ponytail: schematic SVG, not textured render; upgrade to headless-Pixi service only if users reject the look`

## 6. RBAC + CBAC

**Roles (RBAC).** Resolved in the registry's `authorize` hook, always before `deferReply` (auth-before-defer, as in both reference bots):
- `owner` — bot operator (`DISCORD_OWNER_ID` env): admin commands, campaign registration.
- `dm(campaign)` — `discord_id === campaigns.dm_discord_id` in bot DB. Not a Discord role check — DB is the authority; a Discord "DM" cosmetic role proves nothing.
- `member(campaign)` — has the campaign role id stored in the campaign row.
- `everyone` — public surface (`/apply`, `/feedback`).

**Channels (CBAC).** Campaign commands resolve their campaign **from the channel they're invoked in** (channel id → campaign row). No `campaign:` option on every command; wrong channel = ephemeral "this isn't a campaign channel." Two hard rules:
1. **DM-only output only ever posts to the campaign's registered DM channel.** The unfogged map, feedback delivery, and applications are posted *to* that channel by the bot — never as a reply wherever the command was typed. If invoked elsewhere, the reply is an ephemeral pointer.
2. Session embeds, recaps, LFG posts go to their registered channels (campaign player channel, LFG channel id from env), not the invoking channel.

**Secrets/config from env — nothing baked in code, nothing loggable.**
- `env.ts` is the sole `process.env` reader, zod-validated at boot, boot fails naming the bad field (uxie).
- Logger recursively redacts any key matching `TOKEN|SECRET|PASS|AUTH|KEY` at any depth before output — including the channel-log sink, so a secret can't leak *into Discord itself* via an error message (uxie's redaction sits below the sink).
- Join links are per-user tokens: always delivered via ephemeral reply or DM to that user, never in a shared channel message.
- Game-server URL refinement: https or loopback-only http (uxie's rule) so the bearer token can't transit plaintext off-box.

Env schema:

```
DISCORD_BOT_TOKEN  DISCORD_APP_ID  DISCORD_GUILD_ID  DISCORD_OWNER_ID
LOG_CHANNEL_ID  LFG_CHANNEL_ID
GOBLIN_SERVER_URL  GOBLIN_ADMIN_PASS
PUBLIC_TABLE_URL            # base for join links handed to players
BOT_DATA                    # sqlite dir, docker volume
DEV_FEATURES                # gates unfinished commands out of sync (hq-vgc DEV_ONLY set)
```

Per-campaign channel/role ids live in the DB (set once by `/campaign setup`), **not** env — env is server-level secrets and fixed guild structure only.

Commands are **guild-scoped only** (registered against `DISCORD_GUILD_ID`, `guildOnly()` builder wrapper, no global registration path — both reference bots do this and it also makes accidental exposure to other guilds impossible). Every component custom id is namespaced and owner-stamped (`map:refresh:<userId>`); the router rejects clicks from other users.

## 7. Command surface, v1

`authorize` column is enforced in the registry; "posts to" is the CBAC rule.

| Command | authorize | data | posts to |
|---|---|---|---|
| `/campaign setup` (register goblin campaign ↔ channels/role/DM) | owner | bot DB + service-token mint | invoking (ephemeral) |
| `/session start` | dm | opens goblin session, starts observer | player channel (live embed) |
| auto: session end recap | — | observer stats + final player-map PNG | player channel; embed carries the snapshot inline (media gallery), not a separate post |
| auto: "Previously on…" | — | last recap row | player channel, on next `/session start` |
| `/map` | member | player-token redacted JSON → PNG | invoking channel |
| `/map` in DM channel | dm + channel==dm_channel | DM-token JSON → PNG | DM channel only |
| `/character <name>`, `/mycharacters` | member | bot DB → satori card | invoking |
| `/campaign status` | member | bot DB + goblin session history | invoking |
| auto: nickname sync | — | on character create/rename: nick = `Char (Player)`, 32-char cap, skip users above bot's role | — |
| auto: level-up/milestone announce | — | on character update | player channel |
| auto: welcome message | — | GuildMemberAdd | configured welcome/player channel |
| `/quests` (+ dm-only add/complete subcommands) | member / dm | bot DB | invoking |
| `/note <text>`, `/recall <query>` | member | bot DB (FTS) | invoking |
| `/roll <expr>` | member | own parser in bot, results persisted | invoking |
| auto: initiative broadcast | — | **deferred — combat is Sprint 5**; observer seam reserved | — |
| `/loot add`, `/gold split <n>` | member (add), dm (split) | ledger | invoking |
| auto/DM-set: in-game calendar | dm sets, shown in embeds/recaps | calendar table (day counter — nothing server-side exists; bot owns it) | — |
| `/handout <asset>` | dm | goblin `GET /api/assets/:id` (DM token) → repost | player channel |
| `/schedule` | dm | poll via buttons, pings campaign role, writes date to campaign row | player channel |
| `/apply` + LFG board | everyone | lfg_posts; apply pings the campaign DM | LFG channel / DM channel |
| `/feedback <text>` | member | stored **without** discord_id (anonymous = not stored, not just not shown) | DM channel |

Open items from the draft list, defaulted (say if wrong):
- *"recap and snapshots inside?"* → yes, final player-visible map PNG embedded inside the recap via media gallery, one message.
- *nickname format* → `Character (Player)`, truncated at Discord's 32-char cap.
- Roll leaderboards/crit stats: data is persisted from day one; the leaderboard *display* rides on `/campaign status` rather than its own command. Add `/leaderboard` later if wanted.

## 8. Components v2 & cards

- One `container()` helper (`lib/ui.ts`, lifted from hq-vgc): accent color, header, text blocks with separators, optional media gallery, optional action rows. All embeds go through it — session embed, recap, cards, quest log, status.
- Model → builder split (uxie): each feature maps domain data to a plain model object (no discord.js imports), a shared renderer turns it into a container. Models are unit-tested as plain objects.
- Character cards via `card-kit.ts` (satori → resvg): portrait, class/level, campaign, last played — same pipeline as the map raster, one set of fonts/assets, styled to the art-style-guide.
- Live session embed edits in place (stored message id), throttled to ≥1 edit per ~5s to respect rate limits.

## 9. Logging, error handling, presence

- Error taxonomy + **single catch site** in the router mapping error → ephemeral user reply (both reference bots converged on this; command bodies stay try/catch-free).
- `channel-log.ts` to `LOG_CHANNEL_ID`: audit line per command (`✅ /map by @user — 1.2s` / `❌ …`) like hq-vgc, plus uxie's debounced batched mirror of `warn`/`error` app logs (fast flush for errors), char-capped, never re-logs its own send failures, flushed on SIGTERM/uncaughtException.
- Presence: `setActivity` showing live table state (`Watching 3 adventurers in <campaign>` during a session, idle text otherwise), updated by the observer.
- Intents: `Guilds`, `GuildMembers` (nickname sync + welcome) only. No message-content intent — nothing in v1 reads messages.

## 10. Tests

- **Unit (vitest, colocated `*.test.ts`, wired into `check`)** — DI seams like uxie so nothing needs a live Discord: env validation, router (auth-before-defer, error mapping, owner-stamp rejection), custom-id codec, dice parser, recap accumulator fed synthetic WS event streams, map-svg snapshot tests against fixture map JSON, channel-log batching/redaction, DB migrations.
- **Smoke (`pnpm --filter @dnd/bot smoke`)** — this is the "tests that log into a log channel" piece: logs into the dev guild for real and posts a pass/fail checklist container to `LOG_CHANNEL_ID`: env valid, game-server reachable + service token mint, command sync diff (declared vs deployed), test card render, test map render from a fixture campaign. Run after every deploy; the log channel becomes the deploy gate record.

## 11. Milestones

Ordering rule: Discord-native first (milestones 1–4 need zero game-server code), integration last (5–6).

1. **Skeleton** — package, env, db/migrations, client, registry/router/sync, channel-log, errors, smoke harness. All patterns, no features. Everything after this is additive feature files.
2. **Campaign registry & characters** — `/campaign setup` (Discord-only: channels/role/DM in bot DB; service-token mint deferred to milestone 5), characters table, cards, `/character`, `/mycharacters`, nickname sync, level-up announce, welcome.
3. **Knowledge, dice, economy** — quests, notes/recall, `/roll` + persistence, ledger, calendar.
4. **Logistics** — `/schedule`, LFG + `/apply`, `/feedback`, `/campaign status` (bot-DB data only; goblin session history joins in milestone 5).
5. **Goblin bridge** — service-token route (server-side, the one server PR), token mint added to `/campaign setup`, REST client, WS observer + reconnect, `/session start` + live embed, session-end recap (text-only), "previously on".
6. **Map pipeline** — map-svg + raster, `/map` both variants, snapshot into recap, `/handout` (goblin assets API).

Each milestone lands as its own branch/PR per Labs git rules; smoke run posted to the log channel is the merge gate.

## 12. Explicitly deferred

- Initiative broadcast — blocked on Sprint 5 combat; the observer already gives it a seam.
- Discord Activity / embedded table, OAuth issuer — the auth seam exists server-side; untouched in v1.
- Webhook/event bus on the game server — WS observer covers v1; revisit only if the bot ever runs off-box.
- Sharding, multi-guild — one guild by design; guild-scoped commands make this structural, not aspirational.
