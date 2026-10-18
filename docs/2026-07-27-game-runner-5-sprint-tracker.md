# Game Runner — 5-Sprint Plan & Living Tracker

**Created:** 2026-07-27 · **Status:** ACTIVE — this is the single tracking doc from here to release.
**Goal:** From map-editor-only to a released, best-in-class game runner — browser + Discord Activity — with tokens, fog, lighting, doors, scenes, combat, dice/chat all live-synced.
**Companion analysis:** [`./2026-07-26-game-runner-gap-analysis.md`](./2026-07-26-game-runner-gap-analysis.md)
**Referenced planning docs** (SP2, session-platform, rooms-doors, game-runner design): archived in `D:\Labs\labs-docs\map-goblin\{plans,upcoming}\` — labs-docs is the archive, new docs live here.

**Best-in-class bar (what we're beating):**
- **Owlbear Rodeo:** join speed & zero setup → we match join UX and beat it with real lighting + auto fog.
- **Roll20:** live-play feature set → we match combat/dice/chat and beat its layer confusion & drawing friction.
- **Foundry:** depth of wall/light/vision data → we inherit it free from the editor, without the setup tax.

**Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (add note) · ⭐ = the sprint demo moment

---

## Sprint overview

| # | Name | Visible outcome (the demo) | Milestone |
|---|------|----------------------------|-----------|
| 1 | The Table Exists | Player on a second device joins via link and sees the DM's lit map, pixel-identical | First multiplayer render — **DONE** |
| 2 | Things Move | Tokens drag live across clients; dice roll in chat; DM switches scenes | Module pipeline proven — **DONE** |
| 3 | The Dark Is Real | Room-by-room fog reveal, synced doors, lighting under fog | **Owlbear-killer — DONE** (shipped 2026-07-30, PR #36) |
| 4 | Finish Canvas & Table | Both apps look and feel finished: brand surface, chrome design system, real door sprites, editor polish, honest 60fps | **Web app looks the part** |
| 5 | Run the Fight | Full combat encounter end-to-end: initiative, HP, conditions, templates, ruler, log | **Roll20-parity core** |
| 6 | Ship the Web App | Packaged, hardened, documented browser release | **Web release** |
| — | Discord Activity | Same session in a Discord voice channel | **PARKED** (2026-07-30) |

Dependency spine: S1 (server+client plumbing) → S2 (mechanics pipeline+tokens) → S3 (fog needs tokens+rooms) → S4 (design system before combat UI) → S5 (combat needs tokens+chrome) → S6 (release needs all). Discord parked — its seams (endpoints.ts, auth.ts) stay dormant.

> **Re-plan 2026-07-30 (web-first pivot):** the original S4 (combat) and S5 (Discord+release)
> are re-ordered. The editor and table are not visually ready — the brand audit
> (`2026-07-30-brand-design-audit.md`) documents the gaps — so a finish/polish sprint runs
> first and combat lands on the settled design system. Discord is parked entirely until the
> web app ships. `dungeon-classic` remains the development pack (never redistributed) while
> forge is fixed in parallel. New Sprint 4 spec: `2026-07-30-sprint4-spec-plan.md`.

---

## Sprint 1 — The Table Exists · **STATUS: COMPLETE (2026-07-27) — M1 gate passed**

**Spec & plan:** [`./2026-07-27-sprint1-spec-plan.md`](./2026-07-27-sprint1-spec-plan.md)
*Scope sources: SP2 server plan (10 tasks), rooms-doors plan (13 tasks), session-platform Phase 1 (8 tasks), gap-analysis §3 doc surgery.*

### Tasks
- [x] **S1.0 Doc surgery** — done 2026-07-27: superseded header on game-runner-plan; fog-phase + Quick Host notes in session-platform-design (§7.1, §9.3); Room type, 3-state doors, Pass/RoomManager notes in game-runner-design (lines ~158, ~355, ~612)
- [x] **S1.1 SP2 server scaffold** — done 2026-07-27: `@dnd/game-server` (session/server), ws + better-sqlite3, D3 lint fence proven (value imports of @dnd/core rejected); protocol types (A0) in `@dnd/core/shared/protocol.ts`
- [x] **S1.2 Session lifecycle** — done 2026-07-27: ClientConnection, SessionManager, ws-frame heartbeat (15s, 2-miss disconnect), dm-disconnect/reconnect contracts, 6 real-socket tests green
- [x] **S1.3 Command routing + broadcast** — done 2026-07-27: Broadcaster is the only send path (`deliver()` takes post-redaction serialized frames; source-scan test asserts exactly one `.send(` site, mutation-checked), redactForRole exported with S3 doc note, CommandRouter with data-driven role gating — check green
- [x] **S1.4 SQLite persistence** — done 2026-07-27: migration runner + spec §2.4 schema, five stores on prepared statements, one-active-session enforced by partial unique index, size_bytes computed server-side, 12 tests incl. close/reopen persistence — check green
- [x] **S1.5 Map import** — done 2026-07-27: raw-JSON upload w/ dual size cap (Content-Length + mid-stream cutoff, drained not RST), schema validation JSON-only per D3, cross-campaign fetch = 404
- [x] **S1.6 Auth** — done 2026-07-27: HMAC-SHA256 session tokens, admin pass (console-printed, hash-stored), 6-char invite codes, WS-upgrade token verification, bans enforced at token spend (403/401 tested); /api/join never honors caller-supplied identity (DM-token-minting hole closed)
- [x] **S1.7 ModuleRegistry** — done 2026-07-27: register/dispatch with per-action role arrays, ModuleContext {sessionId, sender, broadcast}, ping module round-trip test through the full stack
- [x] **S1.8 Rooms & doors in `@dnd/core`** — done 2026-07-27: B1 (Room type, roomUtils FNV-1a stable IDs, bindDoorToRooms, Clipper2 detectRooms — Cragmaw benchmark 100%) + B2 (DoorTool 3-state click-cycle w/ undo, sprite lookup w/ glyph fallback + red locked tint, debounced roomSync covering backfill-on-load, RoomPanel w/ rename + highlight). Core 378 tests, canvas 62 tests green. Note: no UI deletes walls today; cascade command pinned by test, uncalled. — room detection (Clipper2 flood-fill), stable room IDs, `isPathway`, door-room binding, door sprites, DoorTool click-cycle, RoomPanel, format backfill on load
- [x] **S1.9 Session client scaffold** — done 2026-07-27: `@dnd/session-client` on 5174, WebSocketClient (jittered backoff 0.5s→8s, same-token resume, ping/latency), Zustand store (wholesale snapshot replace, module-slice updates, seq/applyingRemote SyncMiddleware skeleton), endpoints.ts D9 seam, hand-rolled 25-line router (react-router deferred), real-ws vitest suite — check green
- [x] **S1.10 Host + join flows** — done 2026-07-27: Landing, HostSetup 4-step (server URL w/ scheme-defaulting setServerUrl, admin pass, D4 one-liners, campaign create, map upload, invite code + join link), JoinSession (link pre-fill, resolve-on-mount, readable errors), auth.ts = single issuance module w/ Discord OAuth seam noted — 23 client tests green. Note: docker compose lacks a game-server service yet (one-liner shown in UI) → I1
- [x] **S1.11 GameTable page** — done 2026-07-27: GameRenderer runs core's exact boot chain (init→sceneGraph→LightManager→renderLoop→subscriptions), read-only via tool omission, cursor-anchored zoom w/ canvas's clamps, map fetch→store seam tested, browser-verified (textures/lighting/pan/zoom live). ResizeObserver pattern copied from canvas but needs one Playwright assertion in I2 (hidden-tab rAF caveat). publicDir temporarily points at canvas/public for packs — repoint to server assetBase later.
- [x] **S1.12 Discord-proofing (cheap now)** — done 2026-07-27 across C1/C2/C3: endpoints.ts single URL surface + setServerUrl, auth.ts sole issuance module (Discord OAuth = third function there), container-relative GameTable/renderer. I1 note: deployed client needs /api + /ws reverse-proxy mapping (dev proxy exists; docker nginx mapping → S1 gate task)
- [x] **G1 docker session-client (unnumbered)** — done 2026-07-27: multi-stage Dockerfile + nginx (SPA fallback, /api + /ws proxy w/ verified 101 Switching Protocols through the proxy, `client_max_body_size 20m` — nginx's 1MB default silently 413'd map uploads in Docker only), compose service on :8090. Known ceiling: nginx resolves game-server IP at startup; restart proxy if that container is recreated.
- [x] **I1 integration (unnumbered)** — done 2026-07-27: 4 seam bugs fixed (activeSceneId fallback, join-path dev proxy, renderer boot status, frameMap via core's computeMapWorldBounds); demo-dungeon fixture (5 rooms, 3 door states, 3 lights, textured floors); E2E `@sprint1-flow` green 4× from clean data dir; game-server Dockerfile + compose service verified (build, serve, volume persistence, tsx not pnpm for SIGTERM)
- [x] ⭐ **S1.13 Demo** — done 2026-07-27 on the DEPLOYED Docker stack (localhost:8090) via Claude-in-Chrome: DM hosted (admin pass → campaign → 6.5KB map upload → session → invite VTAF3V), two players joined via link in separate tabs, all three tables rendered the lit dungeon identically (open door spilling light into corridor, locked door red), rosters live-synced, latency 2–5ms. (Phone substituted by second/third browser contexts — same link flow.)

### Success metrics
| Metric | Target | Verified by | Status |
|---|---|---|---|
| Player join (link → rendered map) | < 5s, no install/signup | Playwright timed scenario | [x] 2.3–4.0s (5 runs, prod build, GPU chromium — metrics.spec.ts) |
| Render parity DM vs player | Pixel-identical | Playwright screenshot diff, 2 contexts | [x] 0 of 737,280 px differ, max channel delta 0/255 |
| Multi-client sync | 6 clients, state update < 100ms | SP2 V2 test (6 ws clients, timestamped) | [x] worst 2.0ms over 5 rounds |
| Server startup | < 3s | SP2 V4 test | [x] 792–1303ms cold spawn incl. secret mint (startup.test.ts) |
| Reconnect | Full snapshot resume, no data loss | Kill client mid-session, rejoin test | [x] 127–410ms; roster catches up player who joined while dark |
| Campaign persistence | Survives server restart | SP2 V3 test | [x] kill/restart 483–599ms; same session/scenes/token/map bytes |
| Room auto-detection | ≥ 90% correct on standard dungeons | Cragmaw-style 8-room benchmark map | [x] 100% — 15/15 regions, 7/7 corridors flagged, 14/14 doors bound, IDs stable across runs (roomDetection.test.ts) |
| Quality gates | `pnpm check` green on all packages; existing 41 canvas test files still pass | CI | [x] core 43 files/378 · canvas 10/62 · client 5/23 · server 4/32 — all green (root pnpm check) |

---

## Sprint 2 — Things Move · **STATUS: COMPLETE (2026-07-28) — M2 gate passed** (PR #34; gate results: `2026-07-28-sprint2-gate-results.md`)

*Scope sources: session-platform Phase 2 (6 tasks) + Tokens module (previously unplanned — spec from game-runner-design §tokens).*

### Tasks
- [ ] **S2.1 Role-gated UI** — `useRole()`, SessionControls (DM), GameLog (shared), panel registry with role filtering
- [ ] **S2.2 Scenes** — SceneSwitcher (DM), `.mapbuilder` import in-session, activation broadcast, per-map token positions remembered
- [ ] **S2.3 `@dnd/mechanics` scaffold** — module contract types (Logic / Server handler / Client UI / Pixi overlay), tree-shaken subpath exports
- [ ] **S2.4 Roll ingestion module (D&D Beyond primary — decided 2026-07-27)** — roll event schema with `source: 'dndbeyond' | 'manual'` + pre-resolved results accepted server-side; Beyond20 listener in session client (custom-domain DOM events `Beyond20_RenderedRoll` → our roll command over WS); GameLog display with player attribution + breakdown; whisper flag honored (DM-private stays private). **Native dice engine (parser/roller/DicePanel/`/r`) DEFERRED** — ~10% manual players type results in chat until then
- [ ] **S2.5 Tokens module — schema & library** — Token type **including nullable `sight{range,angle,visionMode}` + `light{dim,bright,color,angle}` + `disposition` + `elevation` + `hidden` from day one** (gap-analysis §4.5); DM token library CRUD, portraits, sizes tiny→gargantuan
- [ ] **S2.6 Tokens module — play** — drag w/ grid snap, optimistic update + rubber-band correction (~150ms), server validation (players: own token, revealed cells only; DM: anything), player claim-and-customize, DM-hidden tokens **rendered full-opacity + badge for DM** (pain-point #3)
- [ ] **S2.7 TokenRenderer overlay** — Pixi layer, HP-less rings for now, selection, z-order
- [ ] ⭐ **S2.8 Demo** — DM drags a goblin, player's screen follows in real time; player rolls an attack from their D&D Beyond sheet and it lands in every client's log, attributed; DM flips to map 2 and back — tokens where they were left

### Success metrics
| Metric | Target | Verified by | Status |
|---|---|---|---|
| Token move latency | < 100ms across 6 clients | Timestamped ws test | [ ] |
| Token perf | 20 tokens, zero fps drop (60fps) | FPS counter on benchmark map | [ ] |
| DDB roll ingestion | Roll on a real D&D Beyond sheet → correct result/breakdown in-app, attributed to the rolling player | Beyond20 walkthrough in the Chrome gate + unit tests on event→command translation | [ ] |
| Roll sync | Result + breakdown on all clients, whispers private | Playwright 2-context scenario (synthetic Beyond20 events) | [ ] |
| Scene switch | < 2s, token positions restored per map | Playwright timed scenario | [ ] |
| Module contract | Roll ingestion + Tokens built on ModuleRegistry with zero platform changes | Code review: could a 3rd party have written it? | [ ] |
| Ownership enforcement | Player cannot move others' tokens / into unrevealed cells (server-rejected) | Malicious-client test (forged ws commands) | [ ] |

---

## Sprint 3 — The Dark Is Real ⚔ Owlbear-killer milestone · **STATUS: COMPLETE (2026-07-30) — shipped as PR #36 (`f11d342`)** (gate results: `2026-07-29-sprint3-gate-results.md`; fps 60 target is the one open metric, cured by S4's layer cache)

*Scope sources: game-runner-design §fog + §doors; gap-analysis §4.1–4.3 (previously unplanned as implementation).*
*Spec & plan: `2026-07-28-sprint3-spec-plan.md` — adds door concealment (room-graph reachability, DM toggle), four extra acceptance rows (reconnect redaction, hide-retraction, explored-survives-reload, reduced-motion), the dressed-demo-map mandate, and PR #34 review debts (D14).*

### Tasks
- [ ] **S3.1 Fog module — state & commands** — per-room `never_revealed / revealed / re_hidden_by_dm` + **`wasEverRevealed` memory flag** (gap-analysis §4.3); `fog-reveal/hide/reset`; persisted to SQLite on every mutation
- [ ] **S3.2 Server-side redaction (THE security feature)** — player-bound snapshots & broadcasts strip unrevealed-room geometry, hidden tokens, secret doors, DM notes via S1.3's `redactForRole`; DM client unaffected
- [ ] **S3.3 FogRenderer** — player: unrevealed = solid black, `wasEverRevealed` re-hidden = desaturated/dimmed "explored" look; DM: full map with fog tint overlay; 300ms reveal fade
- [ ] **S3.4 Lighting under fog** — composite existing ClockwiseSweep lighting output beneath the player fog mask (gap-analysis §4.2); DM sees full lighting always
- [ ] **S3.5 Doors module** — `door-toggle/lock` synced; closed doors block sight between revealed rooms; opening does NOT auto-reveal (DM controls drama); secret doors invisible to players until DM reveals
- [ ] **S3.6 DM fog UX** — click-room reveal/re-hide, Reveal All / Hide All, corridor zones behave as rooms
- [ ] ⭐ **S3.7 Demo** — party at a locked door; DM unlocks, player opens it, DM clicks the room beyond: torchlit chamber fades in on every screen; DM re-hides a cleared room — players see it dimmed "explored," not black

### Success metrics
| Metric | Target | Verified by | Status |
|---|---|---|---|
| Reveal propagation | < 200ms to all clients | Timestamped ws test | [ ] |
| **Fog is server-enforced** | Player ws frames + memory contain **zero** unrevealed geometry / hidden tokens / secret doors | **WS frame capture + client state dump inspection** (the anti-Owlbear-v1 test) | [ ] |
| Fog persistence | Survives server restart & DM disconnect | Restart test | [ ] |
| Door → fog → lighting chain | Door toggle updates sight blocking + lighting shadows live on all clients | Playwright visual, 2 contexts | [ ] |
| Perf with fog + lighting | 60fps, 4 lights + 200 walls + 20 tokens | FPS benchmark map | [ ] |
| DM never loses visibility | All hidden/secret entities full-opacity + badge on DM canvas | Playwright visual | [ ] |
| Zero-setup claim | Editor-authored map → playable with working fog/doors/lighting with no manual masking steps | End-to-end import test | [ ] |

---

## Sprint 4 — Finish Canvas & Table (re-plan 2026-07-30)

**Spec & plan:** `2026-07-30-sprint4-spec-plan.md`. Brand surface (Good Goblin naming, titles, favicons, READMEs), chrome design system (`chrome-style-guide.md`, shared tokens across canvas + session), editor UX audit + fixes, real door sprites, layer cache (#17) restoring the asserted 60fps-target row, door-toggle hitch (#18), blast door (#12), DM rejoin (#21), party rooms on the wire (#22), terrain splat redaction (#23), explored-dim review (#14), undo-toast hazard (#19), shared Button/PanelListRow (#25), forge maturation lane (exit: one regenerated category passing the art guide). Gate walks **both apps**.

*Design inputs (decided 2026-07-30, spec §1.6): `docs/design/chrome-directions.html` (rules + accent choice) and `docs/design/moss-system.html` (component system). Moss accent, ink & grain with sans headers, one self-hosted text face.*

⚠ Bare `#n` below and in the spec are **tracker task numbers**. They collide with GitHub issue numbers only at 19 — GitHub #19 is the node-based wall renderer (deferred S5+), tracker #19 is the undo-toast hazard.

### Tasks
- [ ] **S4.1 Brand & docs surface** (D1) — titles + favicons both apps (editor loses "map-builder-scaffold" + Vite icon), stale-facts pass, new `session/client` + `session/server` + repo-root READMEs, PRODUCT.md naming/voice/platform sections, art-guide ink-weight reconciliation
- [ ] **S4.2 Chrome design system** (D2) — `docs/chrome-style-guide.md` transcribing the design docs; **#25** shared `Button` + `PanelListRow`; canvas onto the same token values; typeface unification (self-hosted face, Google Fonts CDN removed from canvas); radius scale + Sonner tokens; reduced-motion verification in canvas
- [ ] **S4.3 Editor finish** (D3) — UX audit walk of the full authoring loop → fix list → fixes; real door sprites (locked/secret states, glyph = missing-asset fallback only); PixiJS `loadParser` migration; pack-install join budget parallelised
- [ ] **S4.4 Table perf** (D4) — **#17** layer cache (static floors/walls/terrain/props into cached render textures, invalidate on geometry/terrain only) and **#18** skip the mergedFloor Clipper2 union on state-only door toggles
- [ ] **S4.5 Table robustness** (D4) — **#12** render-loop blast door, **#21** DM rejoin restores the DM seat, **#19** undo-toast click hazard, **#14** explored-dim brightness review
- [ ] **S4.6 Table protocol** (D4) — **#22** server names party rooms on the wire, **#23** terrain splats cropped to explored AABB for players
- [ ] **S4.7 Forge maturation** (D5, GitHub #35) — pipeline fixed end-to-end against dungeon-classic; exit is **one** regenerated category passing an art-guide side-by-side
- [ ] ⭐ **S4.8 Demo** — open the editor: real name, real favicon, chrome that matches the map's hand; author a map through the full loop with no console noise; host it; the player seat holds its fps floor on a dressed map with fog live, and both apps look like one product

### Success metrics
| Metric | Target | Verified by | Status |
|---|---|---|---|
| Player-seat fps, post-layer-cache | ≥55fps asserted, 60 recorded, solo seat, dressed map | sprint4 e2e fps row (replaces S3's ratio-only guard) | [ ] |
| Door toggle hitch | < 50ms for state-only toggles | e2e timing row | [ ] |
| Join time preserved | < 5s with parallel pack install | S1 metrics spec re-run | [ ] |
| One design system | Changed chrome in both apps on shared tokens; no raw palette values in touched files | Review + grep | [ ] |
| Same typeface, no CDN | Both apps in one self-hosted face; zero external webfont requests | Gate-walk network panel + grep | [ ] |
| Chrome contrast | ≥4.5:1 on measured pairs (incl. day `text-muted` on `surface-1`) | Measured numbers in the gate doc | [ ] |
| No codename leaks | Zero "scaffold"/"map-goblin" strings user-facing in built bundles | String grep of `dist` | [ ] |
| Editor in the gate | Full authoring loop on the deployed stack: zero console errors, zero failed requests | Docker+Chrome walk (editor joins the gate this sprint) | [ ] |
| Reduced motion | Honored in canvas JS animations incl. map-switch fog transition | Playwright emulation row | [ ] |
| DM rejoin | Tab close → rejoin restores the full DM seat, token semantics unchanged | e2e row | [ ] |
| Splat redaction | Player receives explored-cropped splats only; bytes bound asserted | Wire test | [ ] |
| Forge | One category regenerated, passes art-guide side-by-side vs the dev pack | Review lane | [ ] |

---

## Sprint 5 — Run the Fight ⚔ Roll20-parity core (was Sprint 4)

*Scope sources: game-runner-design §combat, §templates, §chat/log (previously unplanned as implementation).*

### Tasks
- [ ] **S4.1 Initiative module** — auto-populate from map tokens, manual entry, sort, Next Turn synced, add/remove mid-encounter
- [ ] **S4.2 HP module** — quick damage/heal popup, HP bar with 4 DM-configurable visibility modes (all / approximate-bloodied / DM-only / hidden), 0-HP indicator
- [ ] **S4.3 Conditions module** — full 5e SRD condition list, icon overlays (max 4 + overflow), synced
- [ ] **S4.4 Ruler module** — click-drag + waypoints, 5e diagonal rule (5/10/5 alternating) + configurable, local-only by default, DM one-shot broadcast (5s)
- [ ] **S4.5 Templates module** — cone/sphere/line/cube/cylinder, presets + custom size, drag+rotate+snap, affected-token auto-highlight, DM lock, **≤ 2 clicks to place** (pain-point #2)
- [ ] **S4.6 Chat & session log** — text chat, DM whisper, speak-as-NPC, player posts as claimed token; session log = full chronological event feed (rolls, HP, doors, fog, joins, moves), searchable, export as markdown
- [ ] **S4.7 Live-play UX guarantees** — active tool/mode permanently visible (pain-point #1); **Escape always cancels any in-progress tool** (pain-point #4); toasts for DM-overridden actions
- [ ] ⭐ **S4.8 Demo** — a real encounter: roll initiative, move on turns, fireball template highlights 3 tokens, damage drops one to 0, condition icons, whispered rumor, export the session log

### Success metrics
| Metric | Target | Verified by | Status |
|---|---|---|---|
| Full combat scenario | DM + 3 players, complete encounter, no desync | Playwright multi-context E2E | [ ] |
| Turn advance sync | < 100ms | Timestamped test | [ ] |
| Template placement | ≤ 2 clicks, no settings dialog | UX walkthrough + Playwright click count | [ ] |
| HP visibility modes | All 4 modes render correctly per role | Playwright visual per mode | [ ] |
| Escape convention | Cancels every in-progress tool, everywhere | Automated tool-state test sweep | [ ] |
| Session log | Every event type captured; markdown export matches feed | Unit + E2E | [ ] |
| Ruler accuracy | 5/10/5 diagonals correct incl. waypoints | Unit tests vs known distances | [ ] |

---

## Sprint 6 — Ship the Web App 🚀 (was Sprint 5, Discord tasks PARKED 2026-07-30)

> Web-release scope stays live: S5.6 hardening, S5.8 collateral, self-host, resilience.
> All Discord tasks below (S5.1–S5.5, S5.7, S5.9's Discord half) are **parked** until the
> web app ships; kept verbatim for when the surface is picked back up.

*Scope sources: gap-analysis §5 (Discord feasibility research), ecosystem roadmap release gates.*

### Tasks
- [ ] **S5.1 Discord app setup** — enable Activities on the `uxie` application (portal toggle, auto entry-point command); URL mappings for game server WSS + vault CDN
- [ ] **S5.2 Discord client build** — `endpoints.ts` Discord variant (`/.proxy/` prefixes), `@discord/embedded-app-sdk` bootstrap, `patchUrlMappings()` fallback for 3rd-party code
- [ ] **S5.3 Discord auth bridge** — SDK OAuth code → server exchange endpoint → same session token at WS upgrade; `identify` scope prefills player name; invite-code flow untouched for browser
- [ ] **S5.4 Iframe UX pass** — voice-channel side-panel + overlay + resize handling; hide "Quick Host" inside Discord (localhost unreachable — Connect-to-Server only)
- [ ] **S5.5 Mobile Activity spike** — 1000+-sprite map on Discord mobile runtime; record fps/memory; set supported-platform claim from data
- [ ] **S5.6 Release hardening** — docker-compose for game server (extend existing packaging), edge cases (expired invite, server crash mid-session, malformed import, DM-disconnect read-only mode), error surfacing
- [ ] **S5.7 Discord smoke-test ritual** — scripted in-Discord session checking every network path (CSP failures are silent and Discord-only)
- [ ] **S5.8 Release collateral** — README/quickstart, self-host guide, demo campaign + demo map bundled
- [ ] **S5.9 Dice inside Discord** — extensions can't reach the Activity iframe, so Beyond20 doesn't work there; either ship the deferred native dice engine here or document DDB-in-a-browser-tab as the Activity dice path
- [ ] ⭐ **S5.10 Demo** — the release demo: same campaign, two players in a Discord voice channel Activity + one in a browser tab, DM in browser — fog reveal, token moves, dice rolls flowing across all three, identically

### Success metrics
| Metric | Target | Verified by | Status |
|---|---|---|---|
| Cross-surface parity | Browser + Discord clients in one session: fog/lighting/doors/tokens/dice identical behavior & controls | Side-by-side scripted session | [ ] |
| Discord join | Launch → rendered map < 5s | Timed in-Discord test | [ ] |
| Zero CSP blocks | No `blocked:csp` in a full session inside Discord | S5.7 smoke test, network log | [ ] |
| Mobile Activity | ≥ 30fps mid-range phone on benchmark map (else documented as unsupported) | S5.5 spike data | [ ] |
| Self-host | `docker compose up` → hosting a session < 5 min from clone | Fresh-machine walkthrough | [ ] |
| Session resilience | DM disconnect → players read-only → DM return resumes; server restart → campaign intact | E2E tests | [ ] |
| Release gate | All S1–S4 metric tables fully `[x]`; `pnpm check` + full test suite green | CI | [ ] |

---

## Cross-sprint tracking

### Standing verification gate (EVERY sprint, no exceptions — added 2026-07-27)
Before a sprint's milestone is checked: deploy the full stack on local Docker (`docker compose up`), then walk **every success metric of that sprint** end-to-end via Claude-in-Chrome on the local endpoints — real browser, real deployed containers, not dev servers. Pass requires: all sprint features behave as specced in the walkthrough, **zero console errors**, **zero failed/blocked network requests** (read via browser console + network inspection). Findings go in the sprint's metric table; any error found reopens the sprint.
- [x] S1 gate (2026-07-27: full host+2-player walkthrough on docker stack; console = zero errors, only PixiJS `loadParser` deprecation warnings; network = zero 4xx/5xx in nginx access log across entire session, all proxy paths live; findings: ghost "Someone" roster identity from an empty-name join → S2 backlog) · [x] S2 gate (2026-07-28 — `2026-07-28-sprint2-gate-results.md`) · [x] S3 gate (2026-07-29/30 — two walks + fix wave, `2026-07-29-sprint3-gate-results.md`) · [ ] S4 gate (walks BOTH apps) · [ ] S5 gate · [ ] S6 gate

### Milestone gates
- [x] **M1** (end S1): First multiplayer render — join < 5s, pixel-identical — PASSED 2026-07-27 (join 2.3–4.0s, 0px diff, gate walked on docker+Chrome)
- [x] **M2** (end S2): Module pipeline proven — roll ingestion + tokens as true modules — PASSED 2026-07-28 (PR #34)
- [x] **M3** (end S3): **Owlbear-killer** — playable lit/fogged session, zero setup, server-enforced fog — PASSED, shipped 2026-07-30 (PR #36; fps 60 target carried to S4 as the one open metric)
- [ ] **M4** (end S4): **Web app looks the part** — both apps on one design system, brand surface real, asserted fps row green
- [ ] **M5** (end S5): **Roll20-parity core** — full combat live
- [ ] **M6** (end S6): **Web release** — packaged, documented, self-hostable (Discord parked)

### Risk register
| Risk | Sprint | Mitigation | Status |
|---|---|---|---|
| Redaction bolted on late → Owlbear-v1 security flaw | S1/S3 | `redactForRole` hook built into Broadcaster in S1.3, tested by frame inspection in S3 | [ ] open |
| Room detection < 90% on real maps | S1 | Freeform fog polygon fallback is the designed V2 escape hatch; benchmark early | [ ] open |
| Discord CSP failures invisible in browser dev | S5 | S5.7 smoke ritual; URL mappings registered before S5.2 coding | [ ] open |
| Mobile Activity perf unknown | S5 | S5.5 spike before any parity promise | [ ] open |
| Quick Host unusable in Discord | S5 | Connect-to-Server only inside Activity; strengthens `keep/` case | [ ] accepted |
| Beyond20 is now the PRIMARY dice path — a DDB React rewrite that breaks Beyond20 breaks ~90% of our rolls | S2+ | We consume Beyond20's stable event API (not DDB's DOM) — upstream breakage is Beyond20's to fix, historically fast; manual chat entry is the stopgap; native dice engine is the permanent escape hatch (deferred, see decision log) | [ ] open |
| No dice path inside Discord Activity (extensions can't inject into the iframe) | S5 | S5.9: ship native dice engine by release, or document DDB-in-browser-tab alongside the Activity | [ ] open |
| `vault-engine`/`vault-cli` are empty stubs | any | Not on the critical path (local FS assets in V1); CDN only matters for `keep/` | [ ] accepted |
| Ghost "Someone" roster identity — an empty-name /api/join minted an identity during the S1 gate walkthrough; roster shows a dimmed stray entry | S2 | Reject/trim empty names at /api/join; consider pruning never-connected identities from the roster snapshot | [ ] open (S1 gate finding) |
| PixiJS `[Assets] "loadParser" is deprecated, use "parser"` warnings ×20 on every table load | S2+ | Core engine asset-loading API migration; cosmetic but noisy in every console | [ ] open (S1 gate finding) |
| Serial pack install eats ~85% of join budget (94 files fetched serially + serial texture upload in core's firstBootInstall/AssetPackManager; ~2.7s of a ~3.1s join) | S2 | Fix in `packages/core`: Promise.all the fetch loop, parallelize/defer texture upload; naive client-side deferral risks permanently untextured map (renderers don't re-trigger). Schedule as an early S2 task. Also: headless-shell Playwright measures SwiftShader not GPU — metrics config pins `channel: 'chromium'` + ANGLE | [ ] open (I2 finding) |

### Decision log
| Date | Decision | Source |
|---|---|---|
| 2026-03-31 | Node.js + ws + SQLite self-hosted (dropped CF Workers/DO/R2) | design-doc changelog |
| 2026-03-31 | No P2P/WebRTC for game data (Owlbear v1 post-mortem) | P2P-vs-SaaS analysis |
| 2026-04-01 | State-snapshot sync, server-authoritative, no CRDT | session-platform-design |
| 2026-07-26 | Discord Activity = second surface on same client (endpoints config + auth bootstrap, not a fork); host on `uxie` app | gap analysis §5 |
| 2026-07-27 | 5-sprint plan adopted; fog redaction pulled forward to S1; token sight/light schema from S2; lighting-under-fog in V1 (S3) | this doc |
| 2026-07-27 | Deferred past release: per-player LOS lighting (V3 — engine ready), live in-session map editing, audio, native voice, accounts/OAuth, mobile-first player view | this doc |
| 2026-07-27 | S1 decisions: protocol types in `@dnd/core/shared/protocol.ts`; server `import type`-only from core (no pixi in Node), `.mapbuilder` = validated JSON server-side; Quick Host reinterpreted — Connect-to-Server + copy-paste one-liner (browser can't spawn processes; Discord iframe can't reach localhost); map upload via HTTP not WS; protocol versioned from message 1 | sprint1 spec §1 |
| 2026-07-27 | Map upload is raw JSON body with Content-Length + streamed-byte cap, NOT multipart — .mapbuilder is JSON; multipart parsing without a dep isn't worth it | A4 |
| 2026-07-27 | **D&D Beyond (via Beyond20) is the primary dice path** — ~90% of players roll from DDB sheets; native dice engine (parser/roller/DicePanel/`/r`) deferred past S2. Manual players (~10%) type results in chat until it ships. Revisit at S5 — Discord Activity iframe can't run extensions, so it has no dice path without the native engine | user directive |
| 2026-07-30 | **Web-first pivot:** Discord Activity parked until the web app ships; polish sprint (new S4 "Finish Canvas & Table") runs before combat (now S5); web release is S6 | user directive |
| 2026-07-30 | `dungeon-classic` = development pack only (FA-derived, never redistributed); forge fixed in parallel while tools are perfected against it; replacement pack generation deferred until tools settle | user directive |
| 2026-07-30 | Brand canon: product **Good Goblin**, runner = **the Table**; "map-goblin" is repo codename only, never user-facing | user directive (memory) |
| 2026-07-30 | **Chrome accent = Moss** (`#3f6b34` day / `#86b566` night). Goblin yellow-green is brand/marketing only and never enters the interface | user decision, `design/chrome-directions.html` |
| 2026-07-30 | **Chrome finish = ink & grain, sans headers** — shared grain/ink-weight stylesheet ships; no serif in any in-app surface | user decision, `design/chrome-directions.html` |
| 2026-07-30 | **One self-hosted text face** for both apps, system sans fallback; Google Fonts CDN removed from canvas (a live table never waits on a CDN); Cinzel is marketing-only | user decision, `design/moss-system.html` |
| 2026-07-30 | Chrome defaults taken without a decision round: editor day / table night, switchable, remembered per user · goblin "quiet" toggle hides thresholds only · radius 6/4/2 · Sonner on tokens · semantic `success` = accent with shape carrying presence | sprint4 spec §1.7 |

### Doc-surgery checklist (S1.0 detail) — COMPLETE 2026-07-27
- [x] `2026-03-19-game-runner-plan.md` → header: SUPERSEDED (feature scope still authoritative for S4 specs)
- [x] `session-platform-design.md` §9.3 → fog phase reference corrected to this doc's S3 (+ §7.1 Quick Host deferral note)
- [x] `game-runner-design.md` → doors: 3-state canonical; auth: + Pass system + RoomManager
- [x] Canonical `Room` type = rooms-doors shape; noted in both design docs
