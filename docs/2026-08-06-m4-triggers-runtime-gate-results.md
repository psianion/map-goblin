# M4 gate walk — triggers runtime (2026-08-06)

Deployment: all three images from `worktree-triggers-runtime` @ `6e06802` (M4 stack: mechanics `e320637`, runtime+client `7f0a589`, review fixes + flagship e2e `b292a61`, lockfile `6e06802`), compose project `triggers-runtime`, fresh volume. Protocol 4 on both sides.

## Demo map: "Duskwell Priory" (authored fresh for this gate)

Built from scratch in the deployed editor at 8080 per the "better maps now" call: a stone-dungeon main level (great hall + corridor + east room + cellar via passage) and a wood-tavern chapel annex on its own layer behind a real door; four lights; map label; two prep triggers — **Chapel litany** (point zone in the annex, room-revealed, player-visible text) and **Rotten floor** (rect zone across the cellar, enter-region trap, DEX save DC 12, 2d6 damage). Zone badges verified during authoring: point zone over another layer's room showed "NOT INSIDE A ROOM", cleared when dragged into its own room.

## Walk

1. **Publish** — the editor's stored token (minted against the previous volume) failed signature verification and the dialog fell back to the password step cleanly (the 401-recovery path, live). Fresh pass → create campaign "Duskwell" → published. REST verify: both triggers stored; `resolved` carries **no inert flags** (zones resolved to rooms, damage formula validated).
2. **Host** — HostSetup listed Duskwell as an existing campaign; Map step library-first; starting-room select populated from the fetched doc; opened on the main-level room. DM table rendered with the chapel dark behind its closed door and the Triggers panel showing both triggers, enabled, log empty ("placement outside the zone cascaded silently — no spurious triggers frame").
3. **Trap flow** — DM created and placed a "Hero" token in the hall; player Mirena joined (seeing only the revealed sprawl — no chapel, no door), claimed Hero, dragged it into the cellar: **the prompt card appeared over her map** ("The boards give way into the cistern below! · DEX save · DC 12 · Roll"). Her redacted state at that moment: exactly one prompt (hers), `fired`/`armed`/`disabled`/log all **empty**. The DM's card carried Roll + Dismiss. She rolled: card resolved on both sides, outcome toast + log line "Mirena's DEX save: 15 vs DC 12 — success"; DM trigger log gained the entry; Rotten floor shows **Fired**.
4. **Room text** — DM revealed the chapel via the fog tool: "Chapel litany" fired through the `fog.reveal` cascade; the text toasted on the DM screen and landed in Mirena's log (player-visible entry); her view gained the chapel *and* its door row only after the reveal. Chapel litany shows **Fired**.
5. **Consoles** — zero errors on editor, DM table, player table.

## Verdict: PASS

## Deployment incident (fixed during the gate)

The first table connect failed with "server speaks protocol 4, client sent 3": the initial `docker compose build` had failed for **all** images on a stale `pnpm-lock.yaml` (mechanics gained a runtime `@dnd/core` dep during review fixes without a lockfile sync), and `compose up` silently started stale M3-era images for editor/session-client while only game-server got rebuilt after the fix. Lockfile synced in `6e06802`; all three images rebuilt; the walk then proceeded. Two lessons for ship time: (a) a package.json dependency change requires `pnpm install` + committing the lockfile or `--frozen-lockfile` image builds fail, (b) `docker compose up` after a failed build silently reuses old images — check image build lines, not container status.

## Suite state at gate

Typecheck+lint clean workspace-wide. Unit: mechanics 226, core 924, canvas 242, client 296, server 159. E2E: triggers-flagship 5/5 (room text on single reveal AND Reveal All, trap→card→roll→outcomes, definition-leak probe incl. the initiative secret, DM-move cascade), publish-dialog 4/4, publish-library 4/4, session-flow green.

## Tracked / deferred

- `scenes.activate` mid-session doesn't evaluate room-revealed triggers (plan scopes v1 to session start; `CASCADES` gains `scenes: ['activate']` when wanted).
- Cascade re-reads tokens/fog module state per event (prep itself now memoized); measure on a heavy table before optimizing further.
- Table renderer requires `style`/`sublayerVisibility` on layers (crashes on hand-rolled docs missing them — canvas always emits them); hardening candidate.
- Scene name published as "Untitled Map" (drawer rename raced the publish serialize); renamed at the table via SessionControls if desired.
- Light-action log entries are DM-only until M5 applies overrides client-side with real wording.
- Protocol 4 requires all three images deployed together — PR body item.
