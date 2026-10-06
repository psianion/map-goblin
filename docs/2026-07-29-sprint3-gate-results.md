# Sprint 3 gate results — The Dark Is Real

Branch `sprint-3-the-dark-is-real`. Gate walked 2026-07-29 (two browser walkthroughs against
the deployed Docker stack), fix-and-review wave completed 2026-07-30. Spec:
`docs/2026-07-28-sprint3-spec-plan.md`.

## Setup

- Stack: `docker compose up` — game-server :8787, editor :8080, session-client :8090.
  Admin pass read from `docker compose logs game-server` (regenerated with the volume).
- Map: `session/testdata/emberhold-crypt.mapbuilder` — 13 rooms, 206 walls, 13 doors
  (1 secret "Cracked Slab", 2 locked, 3 archways), 4 torches in the Torchlit Chamber
  (the default always-visible room), water, terrain splats, 20+ props. Content budget is
  pinned by `gateMap.test.ts` so the dressing cannot silently thin out.
- Two seats throughout: DM tab hosting, player tab joined.

## §2.6 rows — final state

| Row | Verdict |
|---|---|
| Fog reveal/hide/reset, DM-only, bulk + per-room | PASS (walk 1 + walk 2) |
| Undo window after bulk fog change | PASS (walk 2; walk-1 "failure" was toast expiry between actions, not a defect) |
| Doors: toggle any seat, lock/unlock/reveal-secret DM-only | PASS |
| Secret door probe indistinguishable from nonexistent door | PASS (wire-verified) |
| Secret door reveal reaches player live | PASS after fix (walk 1 caught client-side stripping) |
| Zero unrevealed data on the player: wire | PASS — >50 forbidden needles over live frames + reconnect snapshot |
| Zero unrevealed data on the player: client memory | PASS after fix wave — 205 forbidden ids searched over ~208 KB of loaded state, zero hits; this row caught and fixed a door-name leak (below) |
| Reveal is atomic (geometry + fog in one apply) | PASS |
| Re-hide retracts geometry, party keeps own tokens | PASS |
| Movement fenced to party sight; re-hidden room stays walkable | PASS |
| Persistence across `docker compose restart` | PASS (walk 2: state byte-identical after restart) |
| DM never ghosted; Escape exits tools; indicator always present | PASS |
| Console errors / failed network requests | ZERO across both walks and the fix-wave live pass |
| 60fps with fog mask active | **MISS — documented, tracked** (see Performance) |

## Walk 1 (2026-07-29) — found and fixed

1. Fog hover highlight invisible — drawn under the lighting multiply; moved to a
   screen-space overlay layer.
2. Revealed secret door never reached the player — client's legacy loader stripped every
   authored-secret door regardless of what the server sent; both sides unified on the
   server's doors slice.
3. Undo "not working" — exonerated at wire, mouse, and JS level; the click landed after the
   5 s toast expired and hit the armed canvas. Tracked as a UX hazard (task #19).
4. 17 fps reading — decomposed: second live tab halves the rate; underneath, the lighting
   composite ran every frame even when unchanged — fixed with a signature guard
   (4 gradient uploads/frame → 0). Residual is GPU fill cost on dressed content.

## Walk 2 (2026-07-29) — found and fixed

5. Hover, secret door, undo confirmed fixed live.
6. "Flat grey box" in explored rooms — the explored dim stacked on 5 % ambient collapsed a
   70-level texture to 2.4 levels; explored rooms now held out of the lighting multiply, so
   dimmed terrain is visible. Pinned numerically in tests.
7. "Frozen player tokens" — spec-correct concealment behind shut doors; conceal-off
   delivered 13/13 live at the wire, twice.
8. Real bug from the same evidence: client/server drift when a player's token stands in
   geometry the client no longer holds — now fails dark (sentinel), clean protocol fix
   tracked (task #22).

## Fix-and-review wave (2026-07-30)

A spec-compliance audit and a UI review over the whole sprint, then fixes:

- **Door-name leak (new find, fixed)** — the client-memory search caught "Reliquary" in
  player state: door children carry authored names ("Reliquary Door") through the map GET
  even when they touch unexplored rooms. The server now blanks a door's name until both
  sides are explored; the client falls back to "Door N", the DM keeps real names.
- **Scene-tagged deltas (fixed)** — with two scenes cached, a fog write could attach the
  wrong scene's geometry delta; the client discards deltas for scenes it is not viewing,
  so the revealed room had nothing to draw. Deltas are now tagged with the scene the
  command wrote (including retraction re-sends), with a two-scene regression test.
- **Client door graph unified (fixed)** — the player's visibility BFS took rooms from the
  server document but door bindings from the local store, which recomputes them from
  partial geometry. Doors now come off the server document too; a regression test corrupts
  the local copy and proves the server's version wins in both directions.
- **DM hover carries fog state (fixed)** — hover now tints by status (torchlight /
  parchment / slate per the art guide) instead of one colour.
- **Contrast + tokens (fixed)** — panel headings and connection status were off the design
  token system and under WCAG AA; both files moved onto tokens.
- **A11y (fixed)** — room/door rows announce their action ("Reveal X · Unrevealed"),
  truncated names got tooltips, the toast lifts clear of the tool indicator on narrow
  panes.
- **Core lighting changes vindicated** — the three in-sprint changes to the lighting
  renderer were audited input-by-input and pinned with 8 mutation-checked tests; the
  resize reorder fixed a real one-frame blank-on-resize; source unchanged, tests added.
- **Client memory dump completed** — see §2.6 row above.

## Performance (the one open row)

Target: 60 fps (§2.6). Load re-specced 2026-07-29 to 8 tokens — a table is one DM and
four to seven players; the spec's 20 stays as a logged reference.

Honest numbers, player seat, dressed map, production build:

- Both tabs live (harness reality, one GPU): **20–27 fps steady** at 8 tokens across runs
  (final gate run: 26.6 steady / 27.6 mid-reveal, DM's unmasked canvas 23.6 at the same
  moment) — two live contexts halve each other, which is a harness artifact, not
  production (real players run on their own machines).
- DM tab closed (closest to a real player): **36.7 fps** at 20 tokens, against ~60 for the
  unmasked editor on the same map — the fog stack costs roughly 40 % of the frame budget.
- 60 fps holds at 906×510; the miss is GPU fill cost on dressed content at full size
  (Intel UHD 630).

The previous green reading measured the DM's unmasked canvas with the player closed — an
instrument error, corrected. Absolute fps on this box swings 2× with background load
(12–27 fps on identical code), so the e2e row now guards what is stable: the player seat
must stay within ratio of the same-moment DM control (0.88–1.12 observed across all
loads), plus a renderer-alive floor. The 60 fps target stands and is recorded in the row;
the Sprint-4 mask layer cache (task #17) is the work that chases it, with the door-toggle
polygon rebuild skip (task #18) behind it.

## Known leaks and non-blockers

- Explored-but-re-hidden geometry stays on the player — the spec's one sanctioned leak
  (documented in spec §4).
- Terrain splat bitmaps ship whole-map to players (~53 % of map bytes) — tracked as task
  #23 with a costed fix path (crop-to-explored-bounds preferred over per-polygon masking).
- On a map with zero zoned rooms, players receive the whole file — consequence of the
  approved always-one-visible-room rule; revisit if unzoned play becomes a real mode.
- Door sprites are still glyphs; dungeon-classic pack is not redistributable as-is.

## Suite state at close

Mechanics 148 · server 107 · client unit 168 · core 447 · e2e sprint3 rows all green with
the performance row guarded as above. Typecheck and lint clean across the workspace.

Open follow-ups: tasks #12, #14, #17–#19, #21–#23, #25.
