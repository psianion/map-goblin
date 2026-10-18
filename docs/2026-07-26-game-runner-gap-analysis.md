# Game Runner Gap Analysis — Path to a Live, Synced Roll20/Owlbear Alternative

**Date:** 2026-07-26
**Goal state:** Game Runner active with everything planned (tokens, fog, lighting, doors, scenes, combat, dice/chat) working in real-time sync — on browser AND as a Discord Activity with identical controls.

---

## 1. Where we actually are (code reality vs. docs)

The repo today is a **map editor only**. Code comments themselves mark the Game Runner as "future."

| Area | Status | Evidence |
|---|---|---|
| SP1 core extraction (`@dnd/core`) | **DONE** | `packages/core/` real: types, geometry (Clipper2 WASM), Zustand store, PixiJS engine, tools, lighting |
| Lighting engine (ClockwiseSweep) | **DONE, runtime-grade** | `packages/core/src/engine/lighting/` — live recompute on wall/door/light change, FBO compositing, quadtree segment index |
| Wall/door occlusion model | **DONE (data+math)** | `shared/occlusion.ts` — `blocksVision/Light/Movement/Sound` per wall type; door open/closed feeds raycaster live |
| Multi-map storage | **PARTIAL** | Create/switch/persist maps in IndexedDB; "scenes" in the editing sense only, no live activation/broadcast |
| Doors interaction | **PARTIAL** | State changed via properties panel only; no click-to-toggle play interaction (rooms-doors plan adds 3-state click cycle) |
| Rooms topology (fog foundation) | **NOT STARTED** | `rooms-doors.md` plan (13 tasks) unimplemented; no `roomDetection.ts` in core |
| Game server (SP2) | **ABSENT** | No `session/` dir, no ws/better-sqlite3 deps anywhere; docker-compose is static nginx only |
| Session client (SP3) | **ABSENT** | No second app, no routes/modes in canvas |
| `@dnd/mechanics` (SP4) | **ABSENT** | Package doesn't exist |
| Tokens | **ABSENT** | `AnyChild = Shape \| Asset \| Light \| Door` — no token entity at all |
| Fog of war | **ABSENT** | `FogTransition` is a cosmetic map-switch fade, not fog |
| Dice / chat / initiative / HP / conditions / templates / ping | **ABSENT** | Zero hits; ruler exists only as an editor drawing tool |
| vault-engine / vault-cli | **ABSENT** | Empty scaffolding, no source, no package.json |

**Every checkbox in every game-runner/session-platform plan doc is unchecked.** The plans are intent, not progress.

### What carries over for free (the moat)
- The ClockwiseSweep lighting engine is exactly the engine V3 "dynamic lighting with per-player LOS" needs — it already exists and runs at 60fps.
- The occlusion flag model (`blocksVision/Light/Movement/Sound` + door state) is already Foundry-parity wall data. Maps authored in the editor need **zero re-tracing** for play — the core differentiator vs. Roll20/Owlbear.
- `@dnd/core` is injectable (setNotify, setMapDBFactory, …) — designed for a second consumer. Still Pixi/Zustand-coupled, which is fine since the session client is also Pixi/Zustand.

---

## 2. Gap map: planned → built, in dependency order

```
SP2 server ──► SP3 Phase 1 (connectivity) ──► Phase 2 (dice module)
                                                    │
rooms-doors (editor, @dnd/core) ────────────┐       ▼
                                            ├──► Phase 3 (tokens)  ◄── UNPLANNED
                                            └──► Phase 4 (fog+doors) ◄── UNPLANNED
                                                    ▼
                                     Phase 5 (initiative/HP/conditions/ruler) ◄── UNPLANNED
                                                    ▼
                                     Phase 6 (templates, chat/log, DDB bridge) ◄── UNPLANNED
```

| Milestone | Plan doc | Status | Blocking |
|---|---|---|---|
| SP2 game server (ws, SQLite, auth, ModuleRegistry) | `2026-03-31-sp2-game-runner-server.md` (10 tasks) | Planned, 0% | Nothing — **start here** |
| Rooms & doors in core | `2026-04-03-rooms-doors.md` (13 tasks) | Planned, 0% | Nothing — parallel with SP2 |
| Phase 1: two screens one map | `session-platform-phase1.md` (8 tasks) | Planned, 0% | SP2 |
| Phase 2: role UI + scenes + dice | `session-platform-phase2.md` (6 tasks) | Planned, 0% | Phase 1 |
| Phase 3: tokens module | **NO PLAN EXISTS** | — | Phase 2 |
| Phase 4: fog + doors modules | **NO PLAN EXISTS** | — | Phase 3 + rooms-doors |
| Phase 5: initiative, HP, conditions, ruler | **NO PLAN EXISTS** | — | Phase 3 |
| Phase 6: templates, chat/session log, D&D Beyond bridge | **NO PLAN EXISTS** (scope only in game-runner-design) | — | Phase 2 |
| Dynamic lighting w/ per-player LOS | Deferred to V3 by design | — | Phase 4 |

**The single biggest planning gap: everything past dice is unscheduled.** Phase 2 ships only the dice module; tokens, fog, doors, combat — the actual game — have feature specs (game-runner-design.md) but no implementation plans mapped onto the current `table/`-style architecture.

---

## 3. Doc drift to resolve BEFORE building (1 hour of doc surgery saves weeks)

1. **`2026-03-19-game-runner-plan.md` is architecturally obsolete** — its `src/runner/` + top-level `server/` layout was superseded by SP1's monorepo split. Mark it superseded; keep it only as the feature-scope reference (combat, templates, DDB bridge, chat) for the missing Phase 3–6 plans.
2. **Fog scheduling contradiction** — session-platform-design says fog lands "in Phase 2"; phase2.md contains zero fog work. Write the Phase 3/4 plans and fix the reference.
3. **Door states** — game-runner-design says 2-state (open/closed); rooms-doors + module protocol say 3-state (closed→open→locked). Adopt 3-state as canonical; update game-runner-design.
4. **Room type mismatch** — design doc's `Room {id, boundary, centroid, connectedDoors}` vs rooms-doors' `Room {id, name, boundary, centroid, area, isPathway}` + door-owned `roomA/roomB`. Adopt the rooms-doors shape (door-owned binding is better) as the canonical type consumed by the fog module.
5. **Undocumented server concepts** — Pass system (SP2 task 8) and RoomManager (phase1 task 4) exist nowhere in the design doc's auth model. Fold both into game-runner-design's auth section so V1 auth is one coherent story: localStorage UUID + session token + invite code (RoomManager) + admin passes + ban list.

---

## 4. Design gaps the plans don't cover (brainstorm findings)

### 4.1 Server-side fog redaction is specced as a requirement but not as a mechanism
The P2P analysis makes server-enforced fog a **hard security requirement** (players must not be able to pull hidden geometry from network/memory — the Owlbear v1 flaw). But session-platform-design's sync model is "full `SessionState` snapshot replace" on join/reconnect. Nothing in SP2/SP3 tasks describes **per-role snapshot redaction** — stripping unrevealed rooms' geometry, hidden tokens, secret doors, and DM-only notes from player-bound snapshots and broadcasts. This must be a first-class server concern (a `redactForRole(state, role)` pass in the Broadcaster) or the whole architecture inherits Owlbear v1's flaw over a WebSocket instead of WebRTC. **Add to SP2 scope before building the Broadcaster.**

### 4.2 Lighting's role in V1 play is undefined
V1 fog is room-based; per-player LOS lighting is V3. But the lighting engine ships in `@dnd/core`, so the session renderer will draw full lighting for everyone. Decide explicitly for V1:
- **DM view:** full lighting (trivially works today).
- **Player view:** lighting rendered within revealed rooms only (lighting composited after the fog mask — cheap, looks great, no LOS math), or no darkness at all for players?
Recommendation: composite lighting under the fog mask in V1. It reuses everything and makes V1 visually beat Owlbear immediately, while real per-player LOS stays V3.

### 4.3 No "explored but dark" fog memory in V1
Foundry's persistent additive fog texture is called out in the steal-sheet as the model to steal, and competitor research lists exploration memory as a Phase-1 quality gate — but game-runner-design's V1 fog has only `never_revealed / revealed / re_hidden_by_dm`. Cheap V1 upgrade: keep a per-room `wasEverRevealed` flag and render those rooms desaturated/dimmed instead of black. Room-granular, no textures, no raycasting.

### 4.4 Editor↔runner live editing ("no mode switch") isn't in any phase plan
The roadmap's flagship promise — "DM draws a wall mid-session → players see it in 200ms, indistinguishable from Canvas" — has no implementation home. Phase 1–2 build a session client whose map comes from a static `.mapbuilder` import. Live map mutation during a session (walls/doors edited in-session propagating to fog/lighting/clients) is a sync-layer feature nobody has specced. Decide: V1 = re-import updated map (design doc's answer), flagship live-editing = V2. Fine — but write it down so the roadmap promise has a scheduled owner.

### 4.5 Token vision fields should be in the schema from day one
Foundry steal-sheet: `sight{range,angle,visionMode}`, `light{dim,bright,...}`, `disposition`, `elevation`, `hidden`. V1 doesn't implement vision, but the Token type should carry `sight`/`light` fields (nullable) from Phase 3 so V3 dynamic lighting is a renderer feature, not a schema migration across live campaigns.

### 4.6 Competitor pain points → concrete UI requirements for the session client
- Active mode/layer permanently visible (Roll20 layer confusion).
- Mark-a-spell-area in ≤2 clicks mid-combat (template bar, no settings dialog).
- DM sees hidden objects at full opacity with a badge, never ghosted (Owlbear pain).
- Escape always cancels any in-progress tool (Foundry bug).

---

## 5. Discord Activities as a second surface

**Verdict: feasible, moderate effort, no blocker.** An Activity is an SPA in an iframe attached to a **Discord Application** (not a bot per se) — and we already have two apps with Application IDs: `hq-vgc/apps/bot` (guild-scoped community bot, wrong fit) and **`uxie`** (personal hub bot with a per-product `src/integrations/<product>/` pattern — the natural host; enabling Activities is a Developer Portal toggle, which auto-creates a "Launch" entry-point command). Running privately in our own servers needs **no Discord review**; verification only matters if we ever want App Directory discovery.

### Hard constraints (Embedded App SDK, verified mid-2026)
- **SPA only** — page navigation breaks the SDK's postMessage connection. Our session client is already an SPA. ✓
- **Everything goes through Discord's proxy** (`<CLIENT_ID>.discordsays.com`): relative requests need a `/.proxy/` prefix; every external host (WS server, vault CDN) must be pre-registered as a URL Mapping or gets **silently CSP-blocked** — failures only reproduce inside Discord, not in browser dev.
- **WebSockets work through the proxy; WebRTC/WebTransport do not.** Our WebSocket-only sync decision (no-P2P, from the Owlbear post-mortem) is accidentally also the Discord-compatible one. ✓
- **`localhost` is unreachable from the iframe** — the design doc's "Quick Host" (spawn server as child process, §7.1 session-platform-design) cannot work as an Activity. Only "Connect to Server" (public WSS endpoint / future `keep/` hosting) is viable there. Quick Host stays a browser-only path.
- **Auth:** Discord OAuth is available (SDK gets a code, our server exchanges it) but **not required** — invite-code/session-token auth can be kept as-is. Nice-to-have: `identify` scope to prefill the player's display name.
- **Unknowns:** proxy latency and Discord *mobile* Activity performance for a PixiJS renderer with large map textures are undocumented — needs an early spike, not a late discovery.

### What to bake in now (cheap now, painful retrofit)
1. **One endpoints config.** Every fetch/WS/asset URL in the session client resolves through a single `endpoints.ts`. Browser build: direct URLs. Discord build: `/.proxy/`-mapped. The SDK's `patchUrlMappings()` (monkey-patches fetch/WebSocket/XHR) is the fallback for third-party code, but our own code should just use the config.
2. **Token issuance pluggable, token presentation uniform.** Invite-code flow and Discord OAuth both converge on "client presents a session token at WS upgrade" — SP2's auth middleware needs no fork, only a second issuance endpoint.
3. **Iframe-tolerant viewport.** The canvas/panels must handle Discord's resizable side-panel/overlay container, not assume full browser viewport — do the resize pass once, in Phase 1, and it serves both surfaces.

Same PixiJS canvas, same `@dnd/core`, same controls — lighting, fog, doors all render client-side from synced state, so **feature parity in Discord is automatic** once the transport works. The Discord build is the browser client with a different endpoints file and auth bootstrap, NOT a fork.

### Risks
1. URL-mapping misses = silent CSP failures visible only inside Discord → keep a Discord smoke-test in CI ritual once the Activity exists.
2. Quick Host incompatible → Discord users need a public server (accelerates the case for `keep/` managed hosting).
3. Mobile perf unvalidated → spike with a 1000+-sprite map in the mobile Activity runtime before promising parity there.
4. Second launch surface = ongoing maintenance (SDK churn, proxy quirks) for a subset of users — worth it only after the browser runner is real (schedule after Phase 4, as in §6).

---

## 6. Recommended sequence to "active with everything, in sync"

1. **Doc surgery** (§3) + add fog redaction to SP2 scope (§4.1). Write Phase 3–6 plans from game-runner-design's feature specs on the current architecture.
2. **SP2 server** (10 tasks) ∥ **rooms-doors in core** (13 tasks) — independent, parallel.
3. **Phase 1** connectivity (two screens, one map) — first end-to-end demo.
4. **Phase 2** role UI + scene switcher + dice module — proves the module pipeline.
5. **Phase 3** tokens (schema includes sight/light fields, §4.5).
6. **Phase 4** fog (room-based + `wasEverRevealed` dimming, lighting under fog mask) + door click-toggle syncing.
   → **This is the "Owlbear-killer" milestone: playable session, tokens, fog, lit maps, zero setup.**
7. **Phase 5** initiative, HP/conditions, ruler broadcast.
8. **Phase 6** templates, chat/session log, D&D Beyond bridge.
   → **This is the "Roll20-parity" milestone.**
9. **Discord Activity build** — endpoints config + Discord auth bootstrap + URL mappings (start the app-review process early; can begin any time after Phase 4).
10. **V3 track:** per-player LOS lighting (ClockwiseSweep already built), live in-session map editing, audio, native voice.
