# Sprint-exit gate — token-vision fog (2026-08-15)

Branch `token-vision-fog` @ `5199a83`. Gate defined by
`docs/2026-08-15-token-vision-p6-spec.md` §§1–4, budgets adjudicated in
`docs/2026-08-15-token-vision-fog-plan.md` §Performance discipline.

**Verdict: PASS**, on the second walk, with one open defect recorded in §5 and no
gate item unverified.

The gate took two walks. The first, at `40a3b0c`, was **blocked at station 3**: a player
seat that joined after the tokens were placed held an empty `modules.tokens.byScene`, so
there was no token to claim and nine downstream stations could not be reached. That
finding was not a sync bug — the redaction was behaving exactly as written — and the
diagnosis, the fix and the regression pin are §2. The second walk, at `5199a83` on a
rebuilt stack, reached all eleven stations and passed them, including the darkness /
darkvision art exhibit the first walk never got to.

This report keeps both walks. The first one's reading is the reason the second one is
trustworthy: the deadlock was invisible to the whole automated tier, and knowing *why*
is worth more than the eventual green.

## 1. Checklist verdicts

### 1.1 Gate items (plan §P6)

| Gate item | Automated row | Walk station | Result |
|---|---|---|---|
| 30 ft honored | `sprint3-vision` "a claimed token's sweep is the first thing on the player's canvas" | 3, 4 | PASS |
| Wall blocks sight | `sprint3-vision` sweep + memory rows | 4 | PASS |
| Door opens → vision extends live, two contexts | `sprint3-vision` "opening the door grows the clear area, live on two contexts" | 4 | PASS |
| Darkvision in an unlit room | `sprint3-vision` "darkvision reads shape without colour" | 5 | PASS |
| Ambient dial flips visibility | `sprint3-vision` "the ambient dial moves the canvas live" | 5 | PASS |
| Locked zone resists auto-explore | `sprint3-vision-gate` "an authored explore lock resists the party's own sweep" | 7 | PASS |
| Partial reveal renders half a room | `sprint3-vision` "a swept room remembers the cells it swept" | 6 | PASS |
| Token-position redaction | `sprint3-vision-gate` "a mid-fight reload carries no token the party has not seen" | 3, 9, 10 | PASS |
| DM hands a token to a seat that has none | `sprint3-vision` "a seat with no token is not stranded", `vision-mode` "a seat that joined with nothing" | 3 | PASS (new, §2) |
| fps mid-drag + rebuild budget | `sprint3-vision-gate` "eight sighted tokens rebuild the mask inside the budget" | — | PASS at the adjudicated bound (§1.3) |
| No page errors under vision mode | `sprint3-fog` / `sprint3-vision` / `sprint3-share` / `sprint3-vision-gate` error rows | 11 | PASS |

### 1.2 Suites at `5199a83`

| Suite | Result | vs `40a3b0c` |
|---|---|---|
| e2e `sprint3-fog` | 10/10 | — |
| e2e `sprint3-vision` | 13/13 | +1 (DM assignment through the panel) |
| e2e `sprint3-share` | 6/6 | — |
| e2e `sprint3-vision-gate` | 4/4 | — |
| e2e `time-weather` | 2/2 | — |
| unit — mechanics | 342/342 | +4 (`tokens assign` dispatch, roster check, both directions) |
| unit — server | 216/216 | +1 (the wire-level deadlock pin) |
| unit — client | 415/415 | +1 (Owner select renders, sends, reads back) |
| unit — core | 1007/1007 | — |
| unit — canvas | 261/261 | — |
| `pnpm -r typecheck` | 7/7 packages | — |

No suite regressed, no row was skipped, and nothing was retried to green.

### 1.3 Budgets

| Budget | Plan target | Measured | Verdict |
|---|---|---|---|
| 60fps held mid-drag, 8 sighted tokens | 60fps, no gap vs DM control | 60.1fps masked player seat vs 60.1fps unmasked DM control; held in darkness | **MET outright** |
| Mask rebuild, 8 sighted tokens on the dressed map | < 2ms | ~12ms median (was ~33.8ms before the P6 §1 memo work); ~20.5ms median with the lights out against ~13.2ms in daylight | **MOVED, with the number attached** |

The rebuild target moved rather than being met, per the P6 §1 instruction to report an
honest floor rather than silently relax the line. The floor is dominated by four Clipper
boolean ops over ~1600 offset-sweep vertices; vertex thinning was tried and rejected (8%
off the median for 4.6 square cells of accuracy loss on a mask the player looks at). The
route to ~2ms is a raster/composited mask — its own phase, tracked in §5, not smuggled in
here.

**The bound changed between the two walks, and narrowed.** At `40a3b0c` the gate row
asserted two numbers: a 30ms median *and* a 20ms floor on the fastest of ten steps, on
the theory that the quickest step is the cleanest reading of what the pipeline costs. A
subsequent measurement on a heavily loaded box read 20.4ms at its fastest against the
reverted code's idle 22.9ms — there is no reliable line between those two, so the floor
assertion was a coin flip on a busy afternoon. It was removed at `5199a83`
(`session/client/e2e/sprint3-vision-gate.spec.ts:411`): **`REBUILD_BUDGET_MS = 30` median
is the only assertion**, and the fastest step is still printed in the metric line so drift
shows up in log history. The median discriminates in both conditions — good code stays
under it loaded or idle, and the reverted code fails it even idle. What it catches is a
full revert of the P6 perf work; a partial regression (dropping `reachOf` and keeping the
memos, ~17–19ms) hides inside the box-noise headroom, and the client unit suite's memo-key
rows are what pin the individual pieces. A flaky gate row is worse than one honest bound.

## 2. The join deadlock — first walk's finding, and the fix

### What the first walk saw

At `40a3b0c`, station 3: a player joined via the invite code, connected as role `player`,
rendered the scene correctly — and read "No tokens on this scene." `modules.tokens.library`
held all four defs; `modules.tokens.byScene[sceneId]` was `{}` while the DM store held all
four instances at the same scene id. Reproduced four ways: fresh join, after flipping scene
visibility, after a full page reload, and against a live delta (Scout dragged on the DM
canvas, position confirmed changed in the DM store, never arrived on the player store after
a 3s wait — ruling out a load race). Both consoles clean, no failed requests, nothing in
`docker logs gate-tvf-game-server-1`.

Nine of the eleven stations depend on a player holding a token, so they were recorded as
**unverified** — not passes, and not failures of the vision code they were meant to
exercise.

### What it actually was

Not a transport or sync defect. **The redaction was correct and remains byte-for-byte
unchanged.** In vision mode a seat's token list is filtered by what that seat can see;
a seat with no claimed token has no eyes, so `canSee` is false everywhere and the seat is
sent *zero* token instances. That is the intended rule, and it is the rule the whole
`sprint3-share` suite passes on.

The defect was a **deadlock in the claim path, not the fog path**: claiming a token is
done by clicking it on your own list, and the list of a seat with no token is empty by
design. A player who joins after the tokens are placed can never claim their way in. The
first walk's phrasing — "instances not delivered to player-role clients" — described the
symptom correctly and the cause wrongly, which is exactly why the automated tier was silent
on it: every e2e row before this one claimed by dispatching a `tokens claim` command down
the socket by id, a path a real player cannot take.

### The fix (`5199a83`)

1. **`tokens assign`, DM-only** (`packages/mechanics/src/tokens/module.ts`) — the DM's side
   of `claim`. Takes `identityId` or `null`, so one command both hands a token over and
   takes it back, and reassignment over an existing owner is deliberate (a player leaves, a
   familiar changes hands). The identity is validated against the table roster rather than
   taken on trust: an `ownerId` nobody at the table holds is a token no seat can ever move
   again. Hidden-beats-owned is unchanged — an assigned hidden token is still withheld from
   its new owner, as it already was for a token claimed and then hidden.
2. **Owner select on the DM's token panel**
   (`session/client/src/modules/tokens/TokenPanel.tsx`) — "Unassigned" plus one option per
   `role: 'player'` seat, DM-only, reading the stored `ownerId` back. The DM is not a
   pickable owner.
3. **Auto-explore trigger** (`session/server/src/fog/autoExplore.ts`) — `assign` joined
   `claim` in the token trigger list, so a handed-over token sweeps immediately instead of
   lighting nothing until somebody takes a step.
4. **Wire-level regression pin** (`session/server/src/fog/vision-mode.test.ts`, "a seat that
   joined with nothing") — asserts the deadlock from the socket down: the token reaches the
   DM's wire and nobody else's, no fog memory stands in for the missing sight, then one
   `assign` puts it on the seat's wire, opens `canSee` past the doorway, and auto-explores
   the hall. Reverting `assign` fails this row on the dispatch. The first half of the row
   asserts the redaction stays exactly as it is.
5. **UI-level e2e row** (`session/client/e2e/sprint3-vision.spec.ts`, "a seat with no token
   is not stranded") — drives the deadlock and the way out through the real panel: unhand
   the token, assert the player's list is empty and `sources === 0`, then reassign from the
   DM's select and assert the token, the eye and a brighter mask arrive on the player's tab.
   This is the row the browser gate was missing.

### Why this was worth two walks

Six local rows over two seats passed while the deployed build stranded a player at the
door, because every one of them entered the state under test through a command the UI does
not offer. The pin added here is the cheap general defence: at least one row per claimed
mechanic must reach the state the way a player reaches it.

## 3. Browser walk (second walk, `5199a83`)

Deployed stack, compose project `gate-tvf`, app at `http://localhost:5622`. Campaign
"Emberhold Gate Walk" hosted through the real `HostSetup` UI on
`session/testdata/emberhold-crypt.mapbuilder` ("Emberhold Crypt", 13 rooms), starting room
"Vestibule of Ash" (`room-1gt6btp`), invite code `WC8MMS`. Two player seats, Aria and Borin.

| # | Station | Verdict | Reading |
|---|---|---|---|
| 1 | Host: create campaign, upload map, pick starting room, enter table | PASS | Server auth, campaign creation, map upload and starting-room selection all clean. `fog.byScene[...].rooms['room-1gt6btp'] = {status:'revealed'}` confirmed server-side. Friction confirmed: **"Visible to players" is unchecked by default** on the Scenes panel — see §5.8. |
| 2 | Token library, Fog → Token vision, place the party | PASS | Four defs created through the real form and verified in the store: Scout (sight 6, normal), Nightstalker (sight 6, darkvision), Torchbearer (sight 6, carried light bright 4 / dim 8 cells = 20/40 ft, `#ffbb66`), Watcher (sight 6, normal). All four placed, all four `ownerId: null`. |
| 3 | Player A joins; DM hands a token over | **PASS — the blocked station, unblocked** | Aria joined and saw **zero tokens listed** — the redaction rule, working. DM set Scout's Owner select to Aria: Aria's TOKENS panel listed Scout immediately, the room lit around it, and `sweepSources() === 1`. The other three unclaimed tokens standing in the same lit room became visible to her too — ownership governs *control*, visibility follows the fog reveal, which is the intended semantic. Screenshot: full Vestibule lit, three doorways (Stair Arch open, two closed) onto solid black — walls and doors occlude correctly. |
| 4 | Live drag + door reveal, both seats | PASS | Dragging Scout across the room: the sweep followed the drag live and clipped cleanly at the west wall, no bleed past the boundary. DM opened "Gallery Door" — the log row "DM opened Gallery Door" appeared instantly on Aria's tab and the corridor beyond lit in the same frame. No reload. |
| 5 | Darkness, darkvision, carried torch (art exhibit) | PASS | Light → Darkness applied (`ambient:'darkness'`, log "Darkness closes in."). Three exhibit frames captured; judgment in §4. |
| 6 | DM fog brush → partial reveal on the player seat | PASS | Armed "Fog brush — revealing", painted a small L of a few cells inside the otherwise unexplored Reliquary. DM room list flipped Reliquary to "Partly seen"; Aria's tab rendered that same L and nothing else, isolated in black. |
| 7 | Explore lock resists a sighted token standing in it | PASS | Scout (owned, sighted) moved to the Sealed Vault centroid. `fog.rooms` never gained a `room-mxez1n` entry on either tab; the DM's room list held "Sealed Vault: Locked · Unrevealed" throughout. The DM's manual reveal (clicking the room row) flipped it to `status:'revealed'` immediately. |
| 8 | Sight link across the ownership boundary | PASS | Unassigned Watcher linked to Scout via the "Shares sight with" chip (`sharesSightWith` written bidirectionally). Moving the still-unowned Watcher into Torchlit Chamber took Aria's `memoryCells()` 177 → 280 and `sweepSources()` 3 → 4: a DM-authored link makes an unclaimed token's eye count toward an owning player's mask, as documented. |
| 9 | Player B joins; Individual / Party share divergence | PASS, with a finding | Borin joined, DM assigned Watcher to him (Scout↔Watcher unlinked first, since station 8's link would have masked the divergence). Vision share → Individual: Aria's list narrowed to her 3 tokens, Borin's to his 1, both confirmed by store read, and `memoryCells()` diverged (Aria 280, Borin 323) with two screenshots showing genuinely different lit areas and panels. Back to Party: `tokCount` and `memoryCells` merged live to 323 on both tabs with no reload. **Finding: the live sweep does not recompute on a share-mode flip for an already-open tab** — §5.1. |
| 10 | Reload persistence of per-seat memory | PASS | Aria's `memoryCells()` / `sweepSources()` byte-identical (323 / 4) before and after a full page reload; reconnected to the same identity automatically. |
| 11 | Hygiene sweep | PASS | `read_console_messages(onlyErrors)` on all three tabs post-reload: zero errors. Network filtered to `localhost:5622` / `5620`: pack index and pack manifest both 200; one long-lived Web Worker script load reported "pending", which is what watching an open Worker connection looks like, not a failed request. Zero real failures. |

Two walk-procedure notes, neither a product defect:

- The first placement attempt at station 2 landed all four tokens at y ≈ −3.5, outside the
  Vestibule's real polygon (x 4.25–13.75, y 10.25–17.75) — a misread of the DM's zoomed-out
  canvas, caught by cross-checking `screenOf()` against the room boundary and corrected with
  the same `tokens/move` a drag issues. Worth noting only because a DM at 16% zoom has the
  same trap available.
- Station 5's first attempt was inconclusive: the Vestibule is small enough that
  Torchbearer's 40 ft dim radius covered nearly the whole room from a central position, so
  there was no torch-pool-versus-void contrast to judge. The party was spread to the corners
  (Torchbearer SW, Scout NE, Nightstalker SE) to get a clean read. That is a property of the
  test room, not of the light model.

## 4. Darkvision and darkness look

**Verdict: PASS against `docs/art-style-guide.md`.** Judged on the three frames captured
at station 5 on the deployed stack, in Darkness, on the dressed Emberhold Crypt art.

- **Frame A (full room, three tokens).** Torchbearer stands in a bright, fully saturated
  warm-gold pool. Scout — no light, no darkvision — is nearly swallowed in near-black, the
  token barely legible against the dark. Watcher, in the zone the party explored in daylight,
  reads as a dim memory tone. That is rule 4's dark-crypt palette on the deployed frame:
  near-black surround, grey floors, one or two strong warm glows doing all the colour work
  (`docs/art-style-guide.md:19`), and rule 5's painted lighting rather than a neutral wash.
- **Frame B (zoom, Torchbearer).** Rich, full-colour, high-contrast floor texture — the
  "currently lit" tier reading as the guide's baked warm glow rather than as a flat
  brightness multiplier. Grid stays subtle inside the pool (rule 2); floor centre stays open
  and readable under the token (rule 6).
- **Frame C (zoom, Nightstalker).** A clean diagonal boundary: desaturated brownish-grey
  terrain — darkvision's own reveal, distinctly duller and cooler than the torch's gold — on
  one side, solid pitch-black void on the other, exactly at the edge of Nightstalker's sight
  range. The three tiers (bright-lit / darkvision-grey / void) are separable at a glance and
  hold their separation on real art rather than on a sampled patch.

Two honest limits on this verdict:

- The **void edge is geometric, not torn.** Rule 5 asks dungeon negative space to be pure
  black with a *rocky torn edge*; the deployed void edge is the sweep polygon's own boundary
  — clean, and in frame C a literal straight diagonal. It reads correct rather than painted.
  The bite treatment shipped in `de4359e` softens the light pools, not the sight-range
  terminator. Recorded as look debt in §5.9, not as a gate failure: the guide's rule is about
  *authored map art* negative space, and the sweep terminator is a runtime mask.
- The automated tier's three numbers (`sprint3-vision` "darkvision reads shape without
  colour") — darkvision brighter than void by `mean > dark.mean + 4`, dimmer than a torch
  pool, at under half the torchlight's chroma — agree with what the deployed frames show.
  They were never the disputed part; the composition-level questions the first walk could
  not answer are the ones frames A–C settle.

## 5. Known misses and follow-ups

Notes, not issues. Nothing here is filed; the list exists so the next phase starts from a
written record rather than from memory.

1. **Live sweep does not recompute on a vision-share flip (moderate, reproducible, new).**
   Flipping Vision share Individual↔Party on an *already-connected* tab does not reliably
   recompute the client's live sight sweep (`FogRenderer`'s `eyes` / `sources`). The data
   layer is correct and live throughout — token-list redaction, `region`, `memoryCells` all
   update — but `sweepSources()` stuck at the pre-flip value on Borin's tab in both
   directions (individual→party held at 1 instead of 4) until a full page reload, which
   corrected it instantly. **Not a data leak**: the redaction payload was always right. The
   consequence is a stale rendered mask for a connected player immediately after the DM
   changes share mode. Seam is the sweep/eyes recomputation in
   `session/client/src/modules/fog/FogRenderer.ts` and `visionSight.ts`, not the broader fog
   pipeline — the merge back to Party updated `tokCount` and `memoryCells` live and correctly
   on both tabs. Highest-priority item on this list.
2. **Region deltas for the DM socket on large individual-share maps.**
   `packages/mechanics/src/fog/region.ts:56` — the region mask is rebroadcast whole on every
   write. One record at the 512×512 ceiling is ~43KB of base64; a DM in individual share
   holds the party record plus one per seat, which passes the socket's 256KiB frame cap at
   roughly five seats, and a second vision scene multiplies it again. The constant bounds one
   record and does not bound the frame. Fix is deltas — broadcast the cells a write turned on
   — not a larger cap.
3. **Raster-mask path to the plan's 2ms.** §1.3's floor is Clipper-bound. A raster /
   composited mask is the route to ~2ms and is a phase of its own, not a tune.
4. **Token appear/disappear softening.** `docs/2026-08-15-token-vision-p2-spec.md:162` marks
   it P6 polish; unbuilt by choice. A token entering or leaving entitlement pops. Presentation
   only, and visible at station 9 when the share flip moved tokens on and off the panels.
5. **Night lit-reach memos.** `session/client/src/modules/fog/fog.ts:460` — `litReach` and
   `darkReach` are not memoized where the four polygons above them are, because a carried
   torch moves with the party rather than with the map. A per-mover memo is a slot each on the
   polygon identities, worth writing the day a table plays a whole session in the dark. The
   gate's night median (~20.5ms vs ~13.2ms in daylight) is inside the pinned bound and the fps
   guard covers both.
6. **Fog reset has no DM control and no session-log row.** The `fog reset` command exists and
   is exercised only by command dispatch from
   `session/client/e2e/triggers-flagship.spec.ts:169`, because no UI surfaces it. If reset is
   a DM action it needs a control and a log row so the table can see it happened; if it is
   internal, say so and stop treating its absence as a gap.
7. **Brush stroke → RenderTexture blit.** `session/client/src/modules/fog/FogOverlay.ts:152` —
   the region wash is a fresh `Graphics` rebuild per redraw, a few thousand rects at the
   512×512 ceiling. Station 6's L-shaped stroke did not stutter; recorded because the ceiling
   is known. If a stroke ever stutters, draw the wash into a RenderTexture and blit it.
8. **Scene "Visible to players" defaults to off, silently.** Hit on both walks. A newly
   uploaded scene is not visible to players and nothing on the DM's side says so — the player
   seat renders an empty table until the DM finds the toggle on the Scenes panel. Host-flow
   paper cut, unrelated to fog, and a plausible first-session support ticket.
9. **The sight-range terminator is a clean geometric edge** (§4). Rule 5's "rocky torn edge"
   is about authored negative space, so this is look debt rather than a violation, but a
   low-amplitude noise displacement on the sweep boundary is what would close the gap between
   "correct" and "painted".

## 6. Deployment and teardown

Two of the three compose services are in this flow — the DM hosts through `session-client`'s
`HostSetup` UI, which takes the `.mapbuilder` upload directly, so the `map-goblin` editor
service was not started.

- Built at `5199a83` with `docker compose -p gate-tvf build --no-cache game-server
  session-client` — both images exit 0, no stale reuse (the M4 stale-image trap checked
  explicitly).
- The first walk's `gate-tvf_game-server-data` volume was dropped before the rebuild and
  recreated by compose, so the second walk was a true first run against an empty DB.
- Ports, 562x lane per the repo's compose defaults: `game-server` host `5620` → container
  `8787`; `session-client` host `5622` → container `80`. (`map-goblin` would take `5621`.)
- Smoke: app `/` → 200. API proxy verified end to end — `/api/campaigns` through
  `http://localhost:5622/api/...` returns 200 with valid auth and matches the direct
  `:5620` response.
- `RestartCount=0` and `Status=running` on `gate-tvf-game-server-1` and
  `gate-tvf-session-client-1` through the whole walk; no restart loops.
- Admin pass printed once on first run and used for the walk: `g5CfbHnErIXV`. Not
  recoverable from the DB, so a teardown with `-v` invalidates it.
- Walk map on the host: `D:\Labs\map-goblin\session\testdata\emberhold-crypt.mapbuilder`.

**Teardown**: `docker compose -p gate-tvf down -v` from `D:\Labs\map-goblin`. The `-v` drops
`gate-tvf_game-server-data` along with the admin-pass hash and the hosted campaign. The stack
was left running after the walk so §5.1 can be reproduced against the same deployment — tear
it down once that reproduction is done.

## 7. Source read during the walk

Read-only; no edits were made during either walk.

- `session/server/src/fog/vision.ts`, `session/server/src/fog/sweep.ts` — the documented
  rules every station's verdict was checked against.
- `session/client/src/modules/fog/FogRenderer.ts`,
  `session/client/src/modules/fog/visionSight.ts` — the seam for §5.1.
- `session/client/src/modules/tokens/drag.ts` — the move payload a drag issues, used to
  reposition tokens at station 2.
- `packages/mechanics/src/triggers/types.ts`.
- `docs/2026-08-15-token-vision-p6-spec.md` (checklist), `docs/2026-08-15-token-vision-fog-plan.md`
  (budget adjudication), `docs/art-style-guide.md` (§4).
