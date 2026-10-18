# Publish hash off-thread + DM seat lifecycle — plan (2026-09-08)

Status: SHIPPED 2026-09-08 as PR #117 (main f204756). Walk notes at the bottom.

Scope came from the release triage of the Aug 6 sprint-exit issues. Five issues were
picked; triage against current main (e3e1435) cut it to two with real work left:

| Issue | Verdict on main | Action |
|---|---|---|
| #93 publish hash freezes editor | Still real. `hashMapForPublish` stringifies the whole doc and copies every splat PNG on the main thread (`canvas/src/io/publish.ts:40-56`); only the SHA-256 digest is async. | Fix (P0) |
| #87 `/textures/` 404 on table, DM black repaint | Moot. Fills are pack-scoped ids resolved through `AssetPackManager`/`textureLoader` since #110; the exact 404-into-SPA-fallback path was closed in #105 (`assetPackManager.ts:219-224`). Swap path warms textures before `setMapData`, falls back to magenta, never black. | Close with a note |
| #92 New Map wipes installed packs | Fixed in #114. `resetToDefault` carves out `packs` (`packages/core/src/store/store.ts:205`), regression test `assets.test.ts:50-61`. | Close with a note |
| #91 rename not reaching publish | Fixed in #114. `renameMap` writes through to `mapSettings.name` (`slices/maps.ts:279`), reconcile-on-load for unopened maps, tests `maps.test.ts:183-232`. | Close with a note |
| #94 seat/identity papercuts (4 findings) | (1)(2) half-fixed server-side, client gap remains. (3)(4) still exactly as filed. | Fix (P1–P3) |

## P0 — #93: hash in the save worker

The save path already moved `JSON.stringify` + splat bytes + gzip into a dedicated worker
in #55 (`canvas/src/io/saveWorker.ts`, driven by `callSaveWorker` in `saveLoad.ts:53-106`).
Publish (#82) landed later and never adopted it. The fix is the sibling of `serializeToBytes`:

- `saveWorker.ts`: add `op: 'hash'` taking `{ data, splats }` and returning the hex. The
  worker has `crypto.subtle`. The pure body moves out of `publish.ts` into a function the
  worker imports (`hashMapBytes(data, splats: (Uint8Array|null)[])`), so `publish.test.ts`
  keeps testing the logic directly, same split as `mapFormat.ts`.
- `publish.ts`: `hashMapForPublish` becomes the thin main-thread caller: flush pending
  terrain strokes (as `serializeToBytes` does), `Blob → ArrayBuffer`, post to the worker,
  transfer the buffers. `hashPrep` stays on the main thread; prep is small.
- `PublishDialog.tsx:119,150`: unchanged call sites, they already `await`.
- Cost that remains on the main thread: one structured clone of the document per dialog
  open. Autosave already pays exactly that every save and does not hitch, so no
  incremental/dirty-counter scheme (bigger diff, new invalidation to get wrong).

Check: `publish.test.ts` determinism/prep-invariance/splat-sensitivity pass against the
moved function. Live: open the publish dialog on Goblin Warren (three layers, painted
terrain) with the FPS meter up; no frame drop longer than a structured clone.

## P1 — #94 (1)+(2): resume the live session instead of minting a new one

Server already supports it (N10: `POST /campaigns/:id/dm-token` reuses the DM identity;
`GET /campaigns/:id/session` returns the live session id + invite code,
`http.ts:317-322`, tested `api.test.ts:846-857`). Only the client never asks.
`HostSetup.tsx:175-185` `openTable` always calls `startSession`, and `createSession` ends
whatever was running (`http.ts:864-866`), which rotates the invite code and orphans every
claim (claims key on `ownerId` = the identity bound to the dead session).

- `HostSetup.tsx` `hostExisting`: after `mintDmToken`, call `fetchActiveSession` (exists,
  `session/auth.ts:147`, already used by `InviteCodeChip`). On 200: set `inviteCode` and
  jump straight to step 4 in its "invite code + Enter table" state, with one extra
  secondary action, "Start a new session instead", that clears `inviteCode` and returns to
  step 3 (the map/scene picker) so the existing `openTable` path runs. On 404: today's flow,
  untouched. `createCampaign` never has a live session, untouched.
- Copy on the resume state names what resuming means: same invite code, players still
  seated, claims kept. Copy on the escape hatch names what starting fresh means: ends the
  session for everyone, new code.
- No server change. No storage change: the DM still proves themself with the admin pass,
  the per-tab `mg-seat` design stays (`session/client/src/session/store.ts:106-125`).

Check: `HostSetup.test.tsx` gains two cases (live session → step 4 with the existing code
and no `startSession` call; no session → unchanged path). Docker walk: seat two Chromes,
claim a token, kill the DM tab, re-host through the wizard, same invite code, player's
claim still theirs without rejoining.

## P2 — #94 (3): claimable in explored-but-dim ground

Root is server redaction, not the menu. `inSight` (`packages/mechanics/src/tokens/module.ts:158-166`)
drops any unowned token whose room is not currently lit (`scene.visible`) or whose point
fails `canSee`. It never consults `scene.occupiable` (rooms the party has been shown and
can reach, `vision.ts:398`) or `openGround` (the vision-mode cell memory,
`types.ts:113-130`). So the token never reaches the client and `TokenMenu.tsx:205-214`
never gets to offer Claim.

- `inSight`: one extra branch for tokens that are claimable (see decision 2 below) and
  unowned: also in sight when `scene.occupiable.has(roomAt(x,y))` or
  `scene.openGround?.(x, y)`. Everything else keeps today's rule: hidden tokens, owned
  tokens of other players, and non-claimable tokens still vanish the moment the light does.
- Client renders whatever it is sent, no change. The token draws over memory-grey, which is
  the honest picture: it is standing where you have already been.

Check: `module.test.ts` next to "claims an unowned, visible token" (line 579): an unowned
friendly token in an occupiable-but-unlit room reaches a player's view and claims; a
hostile one in the same room does not; an unowned friendly token in a never-revealed room
does not. Docker walk: DM reveals a room, lets it go dark, player claims the token in it.

## P3 — #94 (4): def edits reach placed tokens

Placed tokens copy the def at `place()` (`module.ts:262-273`, `parseDefFields`) and keep
`defId` as provenance only; `libraryUpsert` (`module.ts:228-237`) rewrites the def and
stops. D12 ("deleting a def never removes something from the table") stays as is.

- `libraryUpsert`: when `base` exists, walk `state.byScene[*]`, and for every token with
  `defId === id` overwrite the propagated fields (decision 3 below) from the new def.
  Instance-only fields (`x y z elevation hidden ownerId sharesSightWith sheet`) untouched.
  One command, no schema change, no new action, no client change: the DM's existing
  "edit token type" flow does it. The vision recompute already keys off token state, so
  sight changes take effect on the next tick.

Check: `module.test.ts`: editing a def's sight range updates two placed instances across
two scenes and leaves a third token placed from a different def alone; an instance's
position, owner and links survive. Docker walk: bump a PC's darkvision range, its live
sight ring grows without re-placing.

## P4 — close-outs and verification gate

- Close #87, #91, #92 on GitHub with a one-line pointer to the PR that fixed each
  (#105, #114, #114). Not filed as commits.
- Suites: `pnpm test` across packages (mechanics, core, session server + client, canvas).
  The EPERM temp-file flake rule applies.
- Docker gate: rebuild the 562x stack at the branch tip, walk P1–P3 in two Chromes on
  Goblin Warren, zero console errors, and re-run the publish-dialog open on the DM canvas
  for P0. Notes go in this doc under a "Walk" heading, same as the 08-24 gate doc.

## Scope exclusions

- Persistent DM secret in localStorage (skip the admin pass on re-host): not doing it, see
  decision 1.
- Any change to how player identities are minted on join (`http.ts:801-810` always fresh):
  moot once the session is resumed rather than restarted.
- A "sync from def" button per placed token, or per-field propagation controls: P3's
  automatic propagation covers the issue; add a button only if a DM asks for per-instance
  overrides.
- #85, #86, #88, #89, #90, #95, #96: not in this PR.

## Decisions needed

1. **Resume by default, escape hatch to start fresh** (recommended), vs. a prompt every
   time. Default-resume is the smaller change and matches what the issue asks for; the
   escape hatch keeps the fresh-start path one click away.
2. **Which unowned tokens ride the dim wire for P2.** Claim is not gated by disposition
   today (any unowned token, hostile included, shows Claim). Recommended: only
   `disposition === 'friendly'` unowned tokens get the widened rule, so a monster the DM
   drops into a room the party left stays hidden until the light returns. Alternative: all
   unowned tokens, which leaks hostiles into explored rooms.
3. **Which def fields propagate in P3.** Recommended: everything the def owns except
   `name` (`sight`, `light`, `size`, `disposition`, `imageAssetId`, `packAsset`), since a
   DM editing a "type" expects the type to change on the table, and `name` is the one
   field a DM plausibly retitles per instance ("Goblin 3"). Alternative: `sight` and
   `light` only, strictly what the issue names.

## Orchestration

Single branch `publish-hash-seat-lifecycle` off main. P0 and P1–P3 touch disjoint packages
(canvas vs. mechanics + session client) and can be built in parallel by two Sonnet
executors, each under an hour; main loop reviews and runs the docker gate. One squash-merge.

## Walk (2026-09-08, docker 562x at branch tip a50399d..b49b144)

Images: all three rebuilt at the branch tip and proven fresh by grep (`Start a new session
instead` in the table bundle, `op:"hash"` in the editor bundle, the new `module.ts` in the
game-server image, which runs the TypeScript source). Demo session RPQWXN intact.

- **P0**: dev editor with the warren loaded (300 KB doc JSON, two splats ~270 KB): worker and
  inline hashes byte-identical (`75424604dad8…`); worker path max frame gap 17 ms. Synthetic
  24 MB splat set: inline hash blocks one frame for 101 ms, worker path stays at 17 ms with
  the same digest. The 13 s freeze from the Aug 6 walk is not reproducible on the warren; the
  fixture is too small. The mechanism is fixed, the original map is not available to re-time.
- **P1**: DM tab closed (truly dead), host wizard from step 1 → Goblin Warren → landed on
  step 4 with RPQWXN and the new copy, no picker, no new session. Enter table → same session,
  player claim intact. Player reseated on the ORIGINAL token: reconnects, still owns Scout.
- **P2**: DM hid the forest room (rooms mode, `re_hidden`). Player snapshot kept the unowned
  friendly Scout, dropped both tokens owned by other players, never received a hostile placed
  in the same hidden room. Claim offered on the real token menu; claim succeeded.
- **P3**: Scout def sight 6/normal → 12/darkvision via library-upsert; the placed Scout
  carried it on both seats, owner and position untouched.
- Zero console errors on DM and player seats, including after a reload of both.
- Table left as found (Scout/Lurker tokens and defs deleted, room revealed) except one extra
  player identity "Walker" (7d6fafe5) in the campaign roster; there is no delete route, see
  the demo-table memory.

Findings outside this PR:
- A `re_hidden` room in rooms mode still paints fully lit on the player canvas instead of
  memory-grey. Server state is right (tokens redacted); the fog film is not applied. Not
  caused by this branch.
