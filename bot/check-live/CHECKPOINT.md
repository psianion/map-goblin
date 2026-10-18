# checkpoint.ts — one truthful row of the sync matrix

Run from `bot/`. Read-only: both SQLite files open readonly, Discord is GET-only, nothing is written
except `check-live/out/cp-<label>.json`. Secrets are read from `bot/.env` and never printed.

    pnpm exec tsx check-live/checkpoint.ts <label>        # capture, prints a 20-line summary
    pnpm exec tsx check-live/checkpoint.ts diff <a> <b>   # plain-text delta between two captures

Campaign defaults to bot campaign `test01`; override with `CP_CAMPAIGN=<name>`. It picks the open
session (`ended_at` null) for that campaign, else the most recent.

## The three sections

- **table** — `session/server/data/game.db`. The server's own persisted truth: session row + active
  scene, all campaign scenes, identities (name/role/banned/last_seen), and per-module state from
  `module_state` (doors, fog, tokens, initiative, rolls, triggers). Door and room **names** come from
  the scene's map document via `mapNames()`, so a door reads as "Watch Door", not an id.
- **discord** — REST v10 with the bot token. The live board message (read from the **party** channel,
  where `live-session.ts:184` edits it), every message in the log thread (under the **DM** channel,
  `live-session.ts:447`), and the last 30 of both channels. Components V2 cards are flattened with the
  bot's own `payloadText()`, so the capture reads like the card does.
- **bot** — `bot/data/bot.db`: the session row, `stats` JSON, rolls and notes created since
  `started_at`, and the campaign's characters.

## Live-only facts — captured as `{liveOnly: true, value: null}`, never guessed

`table.liveOnly`: who is connected right now, whether the DM is connected, which identities hold a
seat, and the table Log panel itself (it is re-derived client-side; the nearest disk truth is each
module's `logTail`). `SessionManager` keeps sessions in memory (`SessionManager.ts:250`).
`bot.liveOnly`: the board's live counters, the `/initiative` encounter snapshot, observer socket
health — all in the runner's process (`live-session.ts:291`); `sessions.stats` is only the throttled
save of scenes/doorsOpened/players/peakPlayers.

Also note: `module_state` is keyed **per campaign, not per scene or session** — fog, doors, tokens and
initiative carry across sessions, and `initiative.sceneId` may name a different scene than the active one.
