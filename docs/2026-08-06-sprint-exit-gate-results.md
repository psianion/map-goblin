# Sprint-exit gate walk — maps → scenes → game v1 (2026-08-06)

**Verdict: PASSED with tracked findings.** Every gate criterion was exercised live on a
freshly authored demo map against the Docker-deployed three-image stack. One rendering
finding (texture fills on the table client) is the only console error anywhere in the
walk; everything else ran clean at 60 FPS.

## Deployment

- Gate build: branch `gate-sprint-exit` @ `77af1b2` = the full M2→M5 stack (`worktree-time-weather`
  @ `6e7e3fe`) **plus M1 merged in** (`worktree-scene-switch-swap` @ `daae408`). One conflict
  (`sprint2-scenes.spec.ts`, both sides had fixed the same locator; took the stricter
  `button[data-scene-id]` side). The merge is gate-only — the ship sequence still rebases
  and merges the five branches individually.
- Pre-deploy verification of the merged tree: typecheck 7/7 packages, client unit 323/323,
  scene-switch e2e 3/3, time-weather 2/2, triggers-flagship 5/5.
- All three images rebuilt (explicit `Image … Built` for each — the M4 stale-image trap
  checked) and deployed as compose project `sprint-exit` on 8080/8787/8090, fresh volume.
  Both nginx `/api` proxies verified against the live server (401 from the auth guard).
- Note for ship: main moved again during the gate (`dba1f55`, PRs #77–#79, canvas-side).
  The ship-time rebase target is that, not the stack's base `6b2dc7c`.

## Demo map — "The Drowned Bell" (authored fresh, per the Duskwell precedent)

Flooded riverside shrine-turned-taproom, built start-to-finish in the deployed editor:

- Three rooms on three layers (the material split *and* the door semantics require it —
  see findings): stone taproom (Layer 1), wood-tavern bell shrine (Layer 2), dark-stone
  cellar (Layer 3). Two doors, night ambient, "The Drowned Bell" label.
- Lights: **Hearthfire** (named, flicker, authored dark — the proximity trigger kindles
  it), plus auto-named shrine and cellar lights.
- Prep: **Bell Shrine** (point, room-revealed → text), **Cellar Echo** (point,
  room-revealed → text), **Rotten Stair** (rect, enter-region → trap, DEX save, 2d6),
  **River Bell** (circle, enter-region → WIS check DC 12), **Hearth Warmth** (circle r3,
  within-radius → light Hearthfire on, shown to players).
- Second scene **Riverside Jetty** (wood dock, river via the water tool, one lantern) for
  the mid-session switch.
- Both published into campaign "The Drowned Bell" via the editor's publish dialog
  (admin pass → create campaign → publish; the republish and prep-only paths were then
  exercised live mid-session, below).

## Gate criteria — all walked

1. **Room text, single reveal.** DM revealed the taproom → "The taproom holds its
   breath…" landed in the player log and toast; trigger badged Fired. The trigger itself
   had arrived **mid-session** (added in the editor and delivered live), doubling as
   proof that prep changes reach a running table.
2. **Room text, bulk reveal.** DM Reveal All → the still-unrevealed shrine's text fired
   from `fog.set-bulk` ("The drowned bell hangs green with river-rot…"), player log +
   toast.
3. **Proximity light.** Token entered the Hearth Warmth radius → within-radius fired,
   DM trigger log and player log both read exactly "Hearthfire lights" (M5's named-light
   narration, author toggle honored), store-level relight confirmed. (Visual caveat
   under findings.)
4. **Trap + roll.** Token entered Rotten Stair → prompt card "DEX save · **DC 12**" —
   the DC that had been changed 13→12 by the mid-session **prep-only PUT**, proving the
   resolver refresh live. Token was unclaimed at that point (session re-mint dropped the
   claim), so the card went to the DM — the plan's documented default. Server rolled:
   "Someone's DEX save: 17 vs DC 12 — success," logged both seats.
5. **Ability check.** Token entered the River Bell circle → WIS check card on the
   claimant only (Sable), server rolled: "Sable's WIS check: 5 vs DC 12 — failure,"
   outcome toast + log on both seats, card cleared.
6. **Weather change.** DM Environment control → Dusk + Rain: "· Dusk, Rain" badge in
   both status bars, delta narration "Dusk settles." in the logs. Environment proved
   per-scene: the Jetty showed no badge and its own "Not set" selects; switching back
   restored Dusk/Rain.
7. **Mid-session scene switch.** Drowned Bell → Riverside Jetty → back. Old scene stayed
   painted until the new one was ready (build-then-swap observed live), camera refit,
   player fog correct on both scenes (Jetty = void until revealed), and the return trip
   restored map, tokens, doors and environment intact. (Frame-level no-blank proof is
   the scene-switch e2e's frame sampler, 3/3 on this build.)
8. **Prep-only edit mid-session.** Trap DC edited in the editor → publish dialog said
   "Only trigger prep has changed." → PUT → no scene-changed, no table reload, and the
   next trap fire used the new DC (see 4).

Also exercised beyond the checklist: **mid-session full republish** of the active scene
(adding a zone is map data, not prep — the dialog said so and the table swapped to the
new mapId in place, fog/tokens preserved); **session re-mint recovery** (the DM re-hosted
the campaign after a dead tab; module state — fog, fired triggers, log history, tokens —
survived fully); the **session-start room-revealed evaluation** (the starting room's text
fired at host time and reached the joining player's log).

Perf: DM seat steady 60–61 FPS / ~16.6 ms through the whole walk incl. switches; player
seat 60 FPS focused (1–2 FPS only while the tab was backgrounded — Chrome rAF
throttling, the known caveat); WS latency 2–50 ms. Console: zero errors on the editor;
on both table seats the only errors all session were the texture-fill loads below.

## Findings (fix-or-track; none block the gate)

**F1 — Table client cannot load layer texture fills; DM canvas can go black after a
live republish (recovers on reload).** `/textures/floors/...` URLs 404 into the SPA
fallback on 8090 → "source image could not be decoded" on every map load (the only
console error in the walk). Rooms normally render fine off pack textures/colors, but
after the live republish swap the DM canvas repainted its floors black until a reload;
the player canvas was unaffected. Ship-time fix: serve the texture dirs in the
session-client image (or resolve fills from the installed pack), and harden the swap
repaint against decode failures. The scene-switch e2e probe (containers/camera) is
blind to paint-level failures — only the live walk caught this.

**F2 — Cross-layer doors have no room-graph edge: players can never traverse them.**
Editor `roomSync.ts` binds a door's `roomA`/`roomB` against **its own layer's** rooms
only, so a door between rooms on different layers gets a null side; server
`visibility.ts` skips null-sided doors, so the D8 occupiable BFS never crosses — the
player gets "You can't move there" through a visibly open door forever, while DM moves
(not fog-gated) pass. Any multi-material build hits this because material presets are
per-layer, which *forces* rooms onto different layers. Duskwell never player-crossed
its annex door, so M4 missed it. Fix candidates: bind doors against all layers' rooms
in roomSync, or rebind null-sided doors server-side at `sceneMap.index()` (its
`roomsAlong` already probes across layers). Walked around at the gate with DM-driven
moves — which the trigger cascade handles correctly.

**F3 — Layer-scoped prep pickers with no cross-layer awareness.** The zone "room" badge
and the light picker both only see the zone's own layer: a zone in a Layer-2 room shows
"NOT INSIDE A ROOM" if it lives on Layer 3, and the light action says "No lights on this
layer — TRIGGER IS INERT" for a light one layer over. Consistent with F2's root cause.
Authoring works once you know the convention, but nothing says it — needs either
cross-layer resolution or explicit copy.

**F4 — Zone deletion silently orphans its triggers, and orphans are unreachable.**
Deleting a zone that had a trigger produced no confirm (M2 shipped a two-step confirm —
possible regression, or a panel-focus path around it) and the trigger survives in prep
as "Inert — zone was deleted" in the DM panel, with no editor UI to reach or delete it
(the Triggers panel is zone-scoped). Server-side inert handling is correct; the
authoring lifecycle isn't.

**F5 — Doc name vs list name.** Renaming a map in the editor's list doesn't touch the
doc name that publish uses: both scenes published as "Untitled Map" and needed renaming
at the table (scene rename works and persists — the re-host wizard showed the new names).

**F6 — New-map creation wipes the installed-packs slice.** After + New Map the asset
browser shows no packs until a page reload rehydrates them (engine log confirms the
pack survives; only the store slice is reset).

**F7 — Publish dialog hash freezes the editor.** ~13 s at 0 FPS computing the map hash
before the dialog opened on this 3-layer map (hash includes terrain splat bytes, M3).
Needs a worker or incremental hash.

**F8 — Session/identity papercuts.** DM identity lives in per-tab sessionStorage: a
dead DM tab cannot reclaim its seat; re-hosting works but mints a new invite code and
drops player claims (Sable had to rejoin and the token claim was lost — which is also
why the trap demo hit the DM-prompt default). Claim is only offered when the token is
visible/lit, so an unclaimed token in a dim room is unclaimable. Also: token-type sight
edits don't retro-apply to placed tokens (delete/re-place required).

**Observations (decide-at-ship, not defects):**
- The table renderer draws no light pools — relight is narration + store state; luminance
  is editor-only today. If v1 wants visible relight at the table, LightingRenderer needs
  enabling there.
- "You can't move there" never says why (wall vs fog vs door) — with F2 live, players
  can't tell a bug from a rule.
- Trigger rows in the DM panel show only the trigger name ("Trigger 1" ×7) — the zone
  name is the meaningful label; prompt-card text truncates with no way to read the rest.
- Rooms all derive as per-layer "Room 1", so the starting-room picker offered three
  indistinguishable "Room 1" options (and my blind pick landed on the cellar).
- The landing page's "How it works" copy still says "uploads a .mapbuilder map" —
  pre-M3 copy.

## What this build already carries (from the branch verification)

Unit lanes on the merged tree all green; e2e green: scene-switch 3/3, time-weather 2/2,
triggers-flagship 5/5 (plus doors 18/18, publish-library 4/4, sprint2 and session-flow
on the constituent branches this week). The sprint3-fog `virgin.lit` failure remains the
pre-existing main issue (reproduced byte-identically on plain main), tracked for a
ship-time issue.

## State left behind

Compose project `sprint-exit` running on 8080/8787/8090 (campaign "The Drowned Bell,"
two scenes, walked session live; volume `sprint-exit_game-server-data`). The three
Chrome tabs (editor, DM seat, player seat) were left open for inspection. Branch
`gate-sprint-exit` @ `77af1b2` exists only for this gate; the ship sequence starts from
the five milestone branches, rebasing M1 onto `dba1f55`.
