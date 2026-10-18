# Bot test-table dresser — plan (awaiting approval)

Status: survey done 2026-09-22, nothing built. Build after the cursory review of card sets 4–7.

## Why

`/session start`, the live board and the `/session end` recap look right but were only seen with an
empty table (0 players, 0 doors). Reviewing them properly needs a session with varied data.

## What

One script, `bot/check-live/dress.ts` (untracked test tooling, no product code), run as
`pnpm exec tsx check-live/dress.ts` from `bot/` while the dev server (5600) and the bot are up and a
session is open (`/session start`).

Steps it performs against the open session, with pauses so the live board can be watched changing:

1. Seat 4 named players: `POST /api/join {code, name}` → `ws://…/ws?token=` → first frame
   `{type:'join', protocolVersion}`. This is the only new code; everything else is in `live.ts`.
2. Puppet DM seat (reuse `mintDmToken()` + `dmSeat()` from `check-live/live.ts:104-164`):
   `tokens/place` + `tokens/move`, `doors/toggle` ×3, `scenes/activate` to a second scene and back,
   `fog/region-set`.
3. One player socket closes (roster shrinks, peak stays), then the puppet DM closes
   ("DM has stepped away" on the board).
4. Exit; the user runs `/session end` and reads the recap.

Inputs: campaign id or invite code, base URL, admin pass read from `bot/.env` (never printed).

## Facts the survey confirmed

- The puppet DM (`dm-token` identity) is a different identity from the bot's `service-token`
  ("Goblin Bot") seat — it will not kick the bot. It WILL kick a human DM browser tab on the same
  campaign (one socket per identity, `ws/SessionManager.ts:216-219`).
- `POST /api/join` always mints a fresh identity; there is no delete route. Repeated runs pile up
  ghost players in the dev `game.db`. Use a throwaway campaign, or accept it on the dev lane.
- What feeds the bot's stats: `player-joined/left` (players, peak, dmConnected), `doors`
  state-update false→true (doorsOpened), `scene-changed` (scenes), `tokens` and `fog` updates.

## Separate bug found: recap map drawn tiny in a corner

`bot/src/render/map-svg.ts:613` sizes the canvas to `scene.frame` (the whole document, stamped by
the server for zoned/vision scenes, `session/server/src/fog/redactMap.ts:86-106`), while only rooms
the party has ever explored are drawn. An early or empty session therefore draws a sliver at its
true coordinates inside a sheet the size of the dungeon. This was a deliberate choice
(`map-svg.test.ts:47-51`), so it needs a ruling:

- A. Keep the full frame (honest scale, mostly blank early on).
- B. Fit the recap snapshot to explored content plus a margin; keep the full frame for `/map`.
- C. Fit both to explored content.
