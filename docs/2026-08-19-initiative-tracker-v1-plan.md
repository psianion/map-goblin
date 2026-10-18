# Initiative Tracker v1 — scope

2026-08-19. Decisions locked with the user this session:
- **Discord input = full identity link** (discord_id → table identity, stored server-side, players link once per campaign).
- **Capture rule**: initiative-titled rolls auto-fill (Beyond20 sends `Initiative` as the roll title); plus a "use my last roll" button and a plain number field on the prompt card.
- **NPCs**: DM types each NPC's initiative manually. No auto-roll in v1. NPC names + numbers visible to players (default — flag if wrong).
- **Turn marker**: tracker panel on the **table** + active-turn ring on the table's token render, both seats.

Everything logs into the DM's Discord session thread via the existing table-log mirror.

## What exists that we build on

| Piece | Where | Reuse |
|---|---|---|
| Roll ingestion (`rolls` module, `source: 'dndbeyond' \| 'manual'`) | `packages/mechanics/src/rolls` | Initiative capture listens to these |
| Beyond20 bridge → `rolls:post` | `session/client/src/modules/rolls/beyond20.ts` | Untouched; it already carries the `Initiative` title |
| Internal cascade (`registry.dispatchInternal`, M4) | server registry | `rolls:post` → `initiative:set` cascade |
| Trigger prompt card stack (no modal) | client `TriggerPrompts` | Same pattern for the "Roll initiative" card |
| Table log wording + Discord thread mirror | `GameLog` / `bot/src/goblin/session-log.ts` | New sentences flow through for free |
| Bot observer on the DM seat (service token, WS) | `bot/src/goblin/observer.ts` / `live-session.ts` | Same socket carries the on-behalf command |
| Bot `/roll` | `bot/src/features/dice.ts` | `/initiative` sits next to it |

## The module (new: `packages/mechanics/src/initiative`)

State, keyed by scene id (same shape as triggers' `byScene`):

```
{ status: 'idle' | 'gathering' | 'running',
  round: number, turn: number,
  entries: [{ key, tokenId?, name, kind: 'pc' | 'npc',
              identityId?, initiative: number | null }] }
```

Commands (role-gated by the module contract):
- `initiative:start` (DM) — seeds one `pc` entry per claimed token (awaiting), plus `npc` entries for the DM-picked tokens. Status → `gathering`. Broadcasts the player prompt.
- `initiative:set` (player: own entry only; DM: any entry — this is also the manual NPC entry path). Re-set allowed while `gathering`; DM-only once `running`.
- `initiative:begin` (DM) — locks the order (sort desc, ties by entry insertion), round 1 turn 1, status → `running`. Unfilled entries sink to the bottom, DM can still set them.
- `initiative:next` (DM) — advance turn, wrap → round+1.
- `initiative:add` / `initiative:remove` (DM) — mid-fight joins and deaths.
- `initiative:end` (DM) — status → `idle`, entries cleared, log line emitted.

Capture cascade: on `rolls:post` while `gathering`, if the event's title/text matches `/initiative/i` and the sender owns a pending `pc` entry → internal `initiative:set`. Success-gated, swallowed errors, no recursion — the M4 cascade rules.

One encounter per session at a time. Keyed to the scene it started on; a scene switch hides the panel but keeps the encounter (switch back = still running). Scene delete ends it.

No redaction in v1 (numbers public). Protocol bump required (new module + commands) → **simultaneous 3-image deploy at ship**, same as protocol 4.

## Table UI

- **DM controls** (table sidebar, next to Environment): Start Encounter → token picker (claimed = auto-in, unclaimed = checkboxes) → manual NPC initiative fields → Begin → Next Turn / End Encounter. Add/remove entry inline.
- **Player prompt card** (TriggerPrompts pattern): appears on `gathering` — shows "use my last roll" (last roll event by this identity), a number input, and auto-dismisses when their slot fills (from any source: Beyond20, manual, Discord).
- **Tracker panel** (both seats): ordered list — token name + initiative, current turn highlighted, round counter. White+ink only, no accent (overlay rule).
- **Turn ring**: table token renderer draws a ring on the active entry's token, both seats. White+ink styling, zoom-invariant (divide by zoom ratio, not raw stage scale — the M5 marker lesson).

## Log + Discord thread

New table-log sentences (word-for-word shared with `session-log.ts`): encounter started, "Marra rolls initiative: 17", order locked, "Round 2", "It's Grukk's turn", encounter ended. The bot's existing buffered mirror posts them to the DM's session thread — coalescing already handles turn-by-turn volume.

## Discord identity link + input

No `/link` command, no code ceremony — linking happens implicitly at join (user call 2026-08-19: joining IS the link).

- `identities` gains a nullable `discord_id` column (migration 00X), unique per campaign where set. The mapping is permanent per campaign — later sessions auto-resolve.
- **Discord-native join**: the bot's existing session announcement gains a "Join the table" button. Click → bot reads the clicker's discord_id → service-token endpoint `POST /api/sessions/:id/discord-join {discordId, name}` mints a one-time join URL → ephemeral reply with the personal link. Opening it joins the table: server reuses the campaign's existing identity with that discord_id if one exists (seat reclaim — solves a chunk of #94 as a side effect), else mints one with discord_id attached, name prefilled from the registered character card.
- Classic invite-code join stays as the fallback — that player is simply unlinked (no Discord initiative input; DM sets their number). Clicking their personal link later adopts the linked identity; the code-joined seat is abandoned.
- `/initiative <n>` (and `/roll initiative` result forwarding) in Discord: bot resolves the member → linked identity first; **unlinked fallback = name match** (user call 2026-08-19): the member's registered character-card name is matched (case-insensitive) against the encounter's entry names. Either way the bot sends `initiative:set-for {entryKey, value}` over its observer socket — `set-for` is service/DM-role only and addresses the entry, not the identity, so both paths converge. No link AND no name match → ephemeral reply pointing at the Join button + "ask your DM".
- **Discord rolls tracked per character even unlinked**: the bot forwards `/roll` results into the table's rolls log as `rolls:post` with `characterName` = the member's registered character (the field already exists on `RollEvent`). Source value `'discord'` added alongside `'dndbeyond' | 'manual'`. They land in GameLog and mirror back to the thread like any other roll — so every roll is attributed per character in the session record, linked or not.

## Milestones

- **M1 — mechanics module**: state machine + commands + capture cascade + unit tests. Server-only, no protocol exposure yet.
- **M2 — table UI**: DM controls, player prompt card, tracker panel, log sentences. Protocol bump. Client + server tests.
- **M3 — turn ring**: table token render, both seats, zoom-invariant test + screenshot check.
- **M4 — Discord join + input**: migration (identities.discord_id), Join button + discord-join endpoint + one-time join URL, seat reuse, `/initiative` + `/roll` forwarding with linked/name-match resolution, `set-for`, `'discord'` roll source, thread lines verified live.
- **M5 — e2e + gate**: two-seat Playwright lane (start → prompt → Beyond20-shaped post auto-fills → manual NPC → begin → next → end; Discord path mocked), then the standard Docker+Chrome gate walk on a fresh-authored map with a live Discord thread.

## Deliberate exclusions (v1)

- No auto-roll for NPCs, no DEX modifiers, no character-sheet stats.
- No HP/conditions/damage on the tracker — names + numbers + turn order only.
- No trigger-fired encounter start (the M4 "prompt" trigger action stays DM-log-only; wiring it to auto-start an encounter is a natural follow-up, not v1).
- No tie-break UI — ties keep insertion order; DM edits a value to reorder.
- No encounter history/persistence past `end`.

## Sequencing note

This stacks on `discord-bot-v1` (needs the bot's observer, service tokens, session threads — none of it on main). The branch also carries 5 uncommitted `session/server` files that must land first. Recommendation: **ship discord-bot-v1 first** (it's complete and live-proven), then branch `initiative-tracker-v1` off fresh main — keeps the ship reviewable and this feature cleanly scoped. Stacking without shipping works too if shipping waits.
