# Sprint 1 — "The Table Exists": Brainstorm · Spec · Plan

**Date:** 2026-07-27 · **Tracker:** [`./2026-07-27-game-runner-5-sprint-tracker.md`](./2026-07-27-game-runner-5-sprint-tracker.md) (S1.0–S1.13)
**Sprint demo:** DM hosts on desktop, player joins from a phone via link, both see the same lit dungeon, pixel-identical.

---

## 1. Brainstorm — decisions made now so lanes don't collide

**D1 — Workspace layout.** Add `session/*` to `pnpm-workspace.yaml`: `session/server` (`@dnd/game-server`, Node) and `session/client` (`@dnd/session-client`, Vite SPA, dev port 5174). Follows the session-platform docs' naming; keeps `packages/*` for libraries, apps at top level like `canvas`.

**D2 — Protocol types live in `@dnd/core/src/shared/protocol.ts`.** Core is already the shared dependency of every consumer; a separate protocol package is ceremony. Written FIRST (task A0) so server and client lanes run in parallel against the same types.

**D3 — The server never runtime-imports `@dnd/core`.** Core depends on pixi.js; a Node server must not pull a WebGL renderer. Rule: `import type` only, enforced by ESLint (`@typescript-eslint/consistent-type-imports` + `no-restricted-imports` for value imports of `@dnd/core` in the server package). Consequence: the server treats `.mapbuilder` as schema-validated JSON — no geometry math server-side. Rooms are computed in the editor (Lane B) and arrive inside the file.

**D4 — "Quick Host" is reinterpreted.** A browser SPA cannot spawn a child-process server (session-platform-design §7.1 assumed a desktop context; also unreachable inside Discord's iframe). Sprint 1 ships **Connect to Server** as the only path, with HostSetup showing a copy-paste one-liner (`docker compose up game-server` / `pnpm --filter @dnd/game-server start`). Child-process Quick Host is deferred to a possible desktop wrapper. → decision log.

**D5 — `redactForRole` is a structural choke point, not a feature.** `Broadcaster` owns the only socket-send path; `send()` is private, everything outbound flows through `redactForRole(state, role)`. Sprint 1 redaction is minimal (strip other players' identity/session tokens and server-internal fields) — the point is that Sprint 3's fog redaction becomes a function body change, not a plumbing change. Unit test asserts no outbound path bypasses it.

**D6 — Auth: three token kinds, one WS gate.** (a) **Admin pass** — printed to server console on first run, stored hashed; authorizes campaign CRUD + DM role. (b) **Invite code** — 6-char unambiguous alphabet, maps to the active session (RoomManager). (c) **Session token** — HMAC-signed `{identityId, campaignId, role, exp}`; the only thing accepted at WS upgrade (`?token=`). HTTP does issuance, WS does realtime. Discord OAuth later becomes just another issuance endpoint (gap-analysis §5) — nothing else changes.

**D7 — Map upload over HTTP, not WS.** `.mapbuilder` files reach 20MB; multipart POST with the DM token, server validates + stores, broadcasts a scene-available update. WS frames stay small (< 20KB budget).

**D8 — Protocol versioned from message 1.** `protocolVersion` in `join`; server rejects mismatches with a typed error. Costs one integer now, saves a migration nightmare with long-lived self-hosted servers.

**D9 — Discord-proofing baked in (S1.12).** All client network/asset URLs resolve through one `endpoints.ts` (`{ httpBase, wsBase, assetBase }`); token issuance isolated in one auth module; GameTable lays out container-relative (no `100vw/vh` assumptions).

**D10 — Testing shape.** Server: vitest against a real `ws` server on an ephemeral port (no mocks for the sync tests) — the 6-client < 100ms metric is a test, not a hope. Client: Playwright multi-context (DM + players in one browser). Regression: canvas's existing test files must stay green (Lane B touches core).

---

## 2. Spec

### 2.1 Repo layout after Sprint 1

```
map-goblin/
├── canvas/                     # unchanged (editor; Lane B adds RoomPanel etc.)
├── packages/core/              # + shared/protocol.ts, engine/roomDetection.ts,
│                               #   shared/roomUtils.ts, tools/DoorTool changes
├── session/
│   ├── server/                 # @dnd/game-server — Node, TS strict ESM
│   │   └── src/
│   │       ├── index.ts        # boot: config, db, http, ws
│   │       ├── http.ts         # REST endpoints (join/resolve/upload/campaigns)
│   │       ├── ws/ClientConnection.ts
│   │       ├── ws/SessionManager.ts     # sessions, heartbeat, presence
│   │       ├── ws/CommandRouter.ts      # validate role → dispatch to module
│   │       ├── ws/Broadcaster.ts        # ONLY send path; redactForRole inside
│   │       ├── auth.ts         # HMAC tokens, admin pass, invite codes (RoomManager)
│   │       ├── db/             # migrations + stores (Campaign/Map/Session/Identity/Pass)
│   │       ├── modules/registry.ts      # ModuleRegistry + ping module
│   │       └── mapImport.ts    # .mapbuilder schema validation (JSON-only, D3)
│   └── client/                 # @dnd/session-client — Vite SPA :5174
│       └── src/
│           ├── endpoints.ts    # D9 — single URL config surface
│           ├── session/        # WebSocketClient (auto-reconnect), SessionProvider,
│           │                   # store.ts (Zustand), SyncMiddleware, auth.ts (issuance)
│           ├── pages/          # Landing, HostSetup, JoinSession, GameTable
│           ├── renderer/GameRenderer.tsx  # mounts @dnd/core read-only
│           └── components/     # ConnectionStatus, PlayerList, InviteCodeChip
└── docs/                       # this doc + tracker
```

### 2.2 Protocol (`@dnd/core/src/shared/protocol.ts`)

```ts
export const PROTOCOL_VERSION = 1;

export type Role = 'dm' | 'player';

export interface PlayerInfo {
  identityId: string; name: string; role: Role; connected: boolean;
}

export interface SessionState {
  protocolVersion: number;
  sessionId: string; campaignId: string;
  activeSceneId: string | null;
  scenes: { id: string; name: string }[];        // metadata only; map data fetched via HTTP
  players: PlayerInfo[];
  modules: Record<string, unknown>;              // empty in S1; module slices from S2
}

export type ClientMessage =
  | { type: 'join'; protocolVersion: number }     // token already presented at WS upgrade
  | { type: 'command'; module: string; action: string; payload: unknown; seq: number }
  | { type: 'ping'; t: number };

export type ServerMessage =
  | { type: 'session-state'; state: SessionState; you: PlayerInfo }   // full snapshot (join/reconnect)
  | { type: 'state-update'; module: string; state: unknown }
  | { type: 'scene-changed'; sceneId: string }
  | { type: 'player-joined' | 'player-left'; player: PlayerInfo }
  | { type: 'dm-disconnected' } | { type: 'dm-reconnected' }
  | { type: 'session-ended' }
  | { type: 'error'; code: 'protocol-mismatch' | 'unauthorized' | 'invalid-command' | 'banned'; message: string }
  | { type: 'pong'; t: number };
```

### 2.3 HTTP API (issuance + heavy payloads)

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/campaigns` | admin pass | create campaign → DM session token |
| `POST /api/campaigns/:id/maps` | DM token | multipart `.mapbuilder` upload (≤ 20MB) → validate → store → scene listed |
| `GET  /api/maps/:id` | session token | fetch map JSON for rendering (server strips nothing in S1; S3 redacts) |
| `GET  /api/resolve/:code` | — | invite code → `{ campaignId, sessionId }` (404 if none active) |
| `POST /api/join` | — | `{ code, name }` → player session token (identityId minted server-side) |
| `POST /api/sessions` | DM token | start/end session for a campaign; returns invite code |

### 2.4 SQLite schema (migration 001)

```sql
CREATE TABLE campaigns  (id TEXT PK, name TEXT, created_at INT, updated_at INT);
CREATE TABLE maps       (id TEXT PK, campaign_id TEXT REFERENCES campaigns, name TEXT,
                         data TEXT /*JSON*/, size_bytes INT, imported_at INT);
CREATE TABLE sessions   (id TEXT PK, campaign_id TEXT, invite_code TEXT UNIQUE,
                         active_scene_id TEXT, active INT, created_at INT);
CREATE TABLE identities (id TEXT PK, campaign_id TEXT, name TEXT, role TEXT,
                         banned INT DEFAULT 0, last_seen INT);
CREATE TABLE passes     (id TEXT PK, campaign_id TEXT NULL /*null = server admin*/,
                         token_hash TEXT, expires_at INT NULL);
CREATE TABLE module_state (campaign_id TEXT, module TEXT, state TEXT /*JSON*/,
                           PRIMARY KEY (campaign_id, module));   -- empty until S2
```

### 2.5 Server behavior contracts

- **Heartbeat:** server pings every 15s; 2 missed → disconnect, `player-left` (connected=false, identity retained).
- **Reconnect:** same session token → full `session-state` snapshot replaces client state wholesale (no deltas — per session-platform-design).
- **DM disconnect:** broadcast `dm-disconnected`; session stays alive read-only (players see banner); `dm-reconnected` on return.
- **Broadcaster:** `broadcast(update)` iterates clients → `redactForRole(update, client.role)` → private `#send`. No other send path exists (D5).
- **CommandRouter:** role check → ModuleRegistry dispatch → module handler mutates → persist → broadcast. Unknown module/action → typed `invalid-command` error, connection stays open.
- **ModuleRegistry:** `register({name, commands, initialState, handler})`; ping-pong module proves the loop end-to-end (client `command:ping` → module → broadcast).

### 2.6 Session client behavior contracts

- **WebSocketClient:** exponential backoff reconnect (0.5s→8s cap), resumes with same token, replaces store state on `session-state`.
- **Store (Zustand):** `{connection, you, session: SessionState, mapData}` — SyncMiddleware pattern established (outbound commands tagged with `seq`; inbound updates flagged so they don't re-send) even though S1 has only ping.
- **Pages:** Landing (Host / Join) → HostSetup (server URL + admin pass → create campaign → upload map → start session → invite code + copy-paste server one-liner per D4) | JoinSession (code or `/join/:code` link + name) → GameTable.
- **GameTable:** GameRenderer mounts `@dnd/core` engine read-only (no tools), renders the active scene's map with full lighting; local pan/zoom; ConnectionStatus; PlayerList; DM sees InviteCodeChip. Container-relative sizing (D9).

### 2.7 Rooms & doors in core (Lane B — scope frozen from rooms-doors plan)

The 13 tasks of `labs-docs/.../2026-04-03-rooms-doors.md` with the tracker's canonical types: `Room {id, name, boundary, centroid, area, isPathway}`, door-owned `roomA/roomB`, 3-state click-cycle (closed→open→locked), Clipper2 room detection, stable centroid-hash IDs, door sprites + DoorTool preview, RoomPanel, backfill-on-load (no format version bump). Acceptance: Cragmaw-style 8-room benchmark map detects ≥ 90% correctly; rooms serialize into `.mapbuilder` so the server never computes them (D3).

### 2.8 Doc surgery (S1.0 — checklist in tracker)

Supersede header on `game-runner-plan.md`; fix fog-phase reference in session-platform-design; canonicalize 3-state doors + Room type in game-runner-design; fold Pass system + RoomManager into its auth section. Add D4 (Quick Host reinterpretation) to the design doc's hosting section.

### 2.9 Acceptance

Sprint 1 is done when every metric row in the tracker's **Sprint 1 Success metrics** table is `[x]` with its listed verification, and the ⭐ demo runs: create campaign → upload a lit dungeon → start session → phone joins via link < 5s → pixel-identical render → DM kills tab, rejoins, state intact.

---

## 3. Plan — lanes, order, agents

Model routing (this session): **Fable** = main-loop reasoning/review of returned work · **Opus 5** = all implementation/task agents · **Sonnet 5** = read-only/context-mode/bash-survey agents only · no Haiku.

| # | Lane / task | Depends on | Agent | Deliverable gate |
|---|---|---|---|---|
| A0 | Protocol types in `@dnd/core/shared/protocol.ts` (§2.2) | — | Opus (small, first) | `pnpm --filter @dnd/core check` green |
| L0 | Doc surgery (§2.8) | — | Opus | Tracker S1.0 boxes checked |
| A1 | Server scaffold + ws lifecycle: ClientConnection, SessionManager, heartbeat | A0 | Opus | Unit: connect/heartbeat/disconnect |
| A2 | CommandRouter + Broadcaster with `redactForRole` + ModuleRegistry + ping module | A1 | Opus | Unit: no-bypass test, ping round-trip |
| A3 | SQLite migrations + stores | A1 (parallel A2) | Opus | Unit: persistence across restart |
| A4 | Auth (HMAC tokens, admin pass, RoomManager invite codes) + HTTP API + map upload/validation | A2, A3 | Opus | Integration: full join flow via HTTP+WS |
| B1 | Core: Room types/utils, door-room binding, Clipper2 room detection, stable IDs | — | Opus | Unit + Cragmaw benchmark ≥ 90% |
| B2 | Core/canvas: DoorTool 3-state cycle, door sprites + preview, RoomPanel, backfill-on-load | B1 | Opus | Canvas tests green (all existing files) |
| C1 | Client scaffold: endpoints.ts, WebSocketClient, store + SyncMiddleware skeleton | A0 | Opus | Unit: reconnect/backoff vs mock server |
| C2 | Pages + flows: Landing, HostSetup, JoinSession, auth module | C1, A4 | Opus | Manual flow against live server |
| C3 | GameTable + GameRenderer (read-only core mount) + ConnectionStatus/PlayerList | C1, B1 (rooms in file) | Opus | Renders uploaded map w/ lighting |
| I1 | Integration wiring + fixes end-to-end | A4, C3 | Opus | Demo script passes by hand |
| I2 | Playwright multi-context suite + timed metrics (join < 5s, 6-client < 100ms, pixel-diff, reconnect) | I1 | Opus | Tracker S1 metrics table all `[x]` |
| I3 | ⭐ Demo + tracker/decision-log update | I2 | Fable (main loop) | M1 gate checked |

**Critical path:** A0 → A1 → A2/A3 → A4 → I1 → I2. Lanes B and C run beside it (three parallel streams after A0: server, core-rooms, client).

**Standing rules for every agent:** ponytail full (lazy-correct, no speculative abstraction); server package `import type`-only from `@dnd/core` (D3, lint-enforced); no new deps beyond `ws`, `better-sqlite3` (server) and `react`/`vite`/`tailwind` already used elsewhere; every non-trivial lane leaves its runnable check behind; no AI attribution in commits.
