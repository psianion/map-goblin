# Bot ↔ table sync plan — 2026-09-22

Branch `bot-finish-commands` (tip 07c0325, local only). Status: **awaiting approval + 3 rulings.**

Quality bar for everything below: a command never tells a Discord user something happened on
the table unless the server confirmed it; anything the bot shows about the table survives a bot
restart; a command reply lands inside Discord's 3s defer window with the server answering in
under 500ms on the dev lane. Each item ships with a unit test and a live check on the dev lane
against Goblin Warren.

## Where each command stands

| Command | State lives | Sync today | Gap |
|---|---|---|---|
| `/session start/end` | bot db + server REST + observer | two-way | none |
| `/campaign setup` | bot db + server service-token | bot writes | none |
| `/campaign status` | bot db | none | does not say whether a table is live |
| `/ping` (uncommitted) | bot + server probe | bot reads | probes `/api/health`, which the server does not have (404 reads as "reachable") |
| `/roll` | bot db + `rolls.post` | two-way | write is not confirmed; with no live table the roll silently stays in Discord |
| `/initiative` | server `initiative.set` | two-way | write not confirmed; roster is lost on bot restart until the table next broadcasts; player↔combatant is a name guess (`tableIdentityOf` is a stub) |
| `/map` | server maps + observer | bot reads | one flat fog tier (table has seen vs remembered); no claim state |
| `/character *`, `/mycharacters` | bot db | none | no link to table tokens (`Token.ownerId`, `Token.sheet` are dropped by the observer) |
| `/quests *` | bot db | none | table has its own Prep panel (`GET/PUT …/scenes/:id/prep`); two separate records |
| `/note`, `/recall` | bot db | table→thread only | Discord notes never reach the table; table Journal cards reach the thread but `/recall` cannot find them |
| `/handout` | Discord post (+ optional asset read) | bot reads | never lands on the table — by design |
| `/loot`, `/gold`, `/calendar`, `/schedule`, `/lfg`, `/apply`, `/feedback` | bot db | none | no server counterpart exists — nothing to sync |

DM initiative actions the table has and Discord lacks entirely: start, begin, next, add, remove,
end, hp, damage, condition.

## Batch A — make the existing sync truthful (no rulings needed)

1. **Real health route.** Add unauthenticated `GET /api/health` → `{ ok: true }` on the game
   server; `/ping` treats only 2xx as reachable. One route, one test.
2. **Initiative roster survives restart.** Seed `entry.encounter` from
   `session-state.modules.initiative` in the snapshot handler, next to the doors/tokens/fog seed.
3. **Confirmed writes.** `observer.command` returns a promise settled by the server's reply to
   that `seq` (accepted / refused / 3s timeout). `/roll` and `/initiative` report the real
   outcome: "on the table", "table refused: …", or "no live table — kept in Discord only".
   First step is reading the server's command-reply frame; if it has none, the item grows a
   small server change and I come back before building it.
4. **`/campaign status` shows the live table** using the `sessionRunner.health()` row the
   `/ping` work already added.
5. **Seat re-mint de-dup** (`seat.ts:53`): share one in-flight mint per campaign.
6. Commit the `/ping` health board with 1 folded in.

## Batch B — seat binding (needs ruling 1)

Tie a Discord member to a table seat so the bot stops guessing by name. Unlocks: `/initiative`
picks the player's own combatant, `/character show` can say which token is theirs, `last_played`
stamps by identity, `/map` can mark "you".

Proposed shape: the session embed's Join button becomes per-member — the bot mints a player
identity carrying the Discord id (the service-token route already mints identities) and hands
that member a `/join/<code>?seat=<token>` link, ephemerally. The observer keeps `ownerId` on
tokens. Falls back to today's shared link for anyone who joins by code. Server + client touch:
the join page accepts a pre-minted seat. This is the same player-confirmed pattern the Beyond20
sheet link uses.

## Batch C — DM initiative from Discord (needs ruling 2)

`/encounter start|next|end` and `/encounter hp|damage|condition <combatant>` with autocomplete
off the live roster, DM-only, all through the confirmed-write path from A3.

## Batch D — one journal, not two (needs ruling 3)

Smallest useful step: index table Journal cards into the bot's notes search so `/recall` finds
them (table → Discord, read-only). The reverse (`/note` → table Journal card, `/quests` ↔ Prep)
writes DM prep from Discord and wants a decision on which side owns the record.

## Rulings

1. Seat binding: per-member join links as above — yes / different shape / not now?
2. DM initiative commands in Discord: wanted, or does the DM always drive from the table?
3. Journals: `/recall` finds table cards only (D-small), full two-way, or leave separate?

## Order

A (one batch, one commit per item) → live check → B → C → D, each gated on its ruling.
`/map` fog tiers is tracked here as open, not scheduled: it is render fidelity, not sync.
