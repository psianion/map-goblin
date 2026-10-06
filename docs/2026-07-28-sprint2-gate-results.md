# Sprint 2 — "Things Move" — Gate Results

*2026-07-28. Docker stack (game-server :8787, session-client :8090), walked in Chrome. Companion to `2026-07-27-sprint2-spec-plan.md` §2.6.*

## Automated acceptance (e2e, pre-gate)

| Metric | Target | Measured |
|---|---|---|
| Token move latency, 6 ws clients | < 100ms | worst 2.0–3.3ms |
| Browser drag latency (3 tokens, observer tab) | < 100ms | worst 22–30ms |
| Scene switch | < 2s | 73–240ms |
| 20 tokens fps (prod build, ANGLE) | ≥ 55 | 60.1–60.4 |
| Join p95 (post-P1 pack parallelization) | < 1.5s | fetch phase 0.4s bench; gate joins rendered in ~2–3s incl. first boot, snapshot connect RTT 3–120ms |
| Whisper privacy | absent from other players' frames | pinned at browser + raw-ws level (e2e) and confirmed in gate |
| Ownership enforcement | forged commands refused | pinned by e2e (unauthorized + state unchanged) |

## Gate walkthrough (deployed stack, 3 live tabs: DM, Borin, Mira→Rell)

Everything passed: host wizard (campaign, map upload, invite), two player joins, role-filtered panels, presence log, token library create (disc + initials + disposition ring), click-to-place with server snap, DM drag sync, player claim ("held by Borin") + own-token drag, unowned-drag refused locally, hide (DM eye-slash + `hidden` tag; dropped entirely from player canvas, list, and fresh join snapshots), manual roll, synthetic Beyond20 attack + whisper (🔒 for roller + DM, absent for third player), in-session second-map upload, scene switch propagated to all tabs, per-scene token state, exact position restore after round-trip with hidden state preserved.

**Cleanliness:** zero console errors on all tabs, zero Pixi deprecation warnings (loadParser fix confirmed live), zero non-2xx responses across the entire session (client access log + server log).

## Findings

1. **Reload lost the seat** (S1-era gap, surfaced by the gate): token lived only in React state; F5 = "Disconnected" + empty sidebar. **Fixed same day** — seat persisted per-tab in sessionStorage, cleared on disconnect/session-ended, resumed on table mount; verified live on the redeployed stack.
2. **Double engine rehydrate on one page load** (2× `[AssetPackManager] Rehydrated` same second): cosmetic, no error; likely GameRenderer remount. Not chased.
3. (From I1) Uploading byte-identical map files twice leaves `mergedFloor` undrawn on switch — core `subscribeToStore` equality quirk. Backlog for S3.

## Real-DDB step (user-driven) — PASSED 2026-07-28

Real Dexterity check from a live DDB sheet landed at the table and synced to all three clients (1d20 + 3 = 18, title + formula + total intact). Once per seated tab, per design (each tab ingests as its own identity).

Setup findings for the runbook:
- **Beyond20 custom-domain port bug**: `http://localhost:8090/*` never works — Beyond20's permission check strips the tab URL's port before matching, while Chrome re-serializes the grant *with* the port. The working entry is **`http://localhost:*/*`** (or Site access → "On all sites"). The map-goblin tab must be reloaded after granting; DDB tab needs no reload. Verified line in table-tab console: `Beyond20: Custom Domain module loaded: localhost`.
- No page-side handshake exists; the passive capture-phase `Beyond20_RenderedRoll` listener is sufficient. Custom domains only ever receive `rendered: 'fallback'` events — never dedup by dropping those (comment corrected in beyond20.ts).

4. **Minor**: real ability-check payloads carry the character name differently than the fixture shape — entries fall back to the player name (roll content intact). Capture a real payload into `beyond20.fixtures.ts` and adjust `characterName` extraction. Backlog, S3-adjacent.

**Sprint 2 gate: CLOSED. All §2.6 rows verified.**
