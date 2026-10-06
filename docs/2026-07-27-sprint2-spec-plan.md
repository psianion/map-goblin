# Sprint 2 — "Things Move" — Brainstorm · Spec · Plan

*2026-07-27. Companion to `2026-07-27-game-runner-5-sprint-tracker.md` (S2 section). Grounded on S1 code contracts as shipped (PR #33).*

---

## §1 Brainstorm — decisions

**D1. Tokens are session state, NOT map content.** Core's `AnyChild`/`.mapbuilder` model stays untouched — no `childType: 'token'`. Tokens live in the tokens module's state (scene-scoped), rendered by a session-client Pixi overlay. Authored maps stay portable; live-play state stays in the game server's DB. Core ships **zero token code** this sprint.

**D2. `@dnd/mechanics` = pure logic + types + server modules. React/Pixi client code stays in session/client.** Mechanics has no pixi/react/DOM deps → the server may runtime-import it (D3 ESLint rule untouched — it only guards `@dnd/core`). Subpath exports per module: `@dnd/mechanics/rolls`, `@dnd/mechanics/tokens`. The "Client UI / Pixi overlay" quadrants of the module contract are fulfilled via the client-side **panel registry** (D8) and a renderer registered from client module folders (`session/client/src/modules/<name>/`). Third-party test: a new module = 1 mechanics folder + 1 client folder + 2 `register*` calls; zero platform edits.

**D3. GameModule contract v2 (the real platform work).** S1's handler `(action, payload, ctx)` has no state access, no persistence, no redaction. v2:

- `ctx.state` (current module state), `ctx.setState(next)` — setState **persists to `module_state` and broadcasts a redacted `state-update`** in one call. Handlers never call `ctx.broadcast` for state (it remains for ephemeral messages).
- Optional `redact(state, viewer)` per module — see D4.
- `initialState` finally does its job: seeds `module_state` on first touch.

**D4. Redaction goes per-viewer, stays one choke point.** `Redactor` signature widens from `(msg, role)` to `(msg, viewer: {role, identityId})`. For `state-update` and `session-state` messages the redactor consults the module registry and applies each module's `redact(state, viewer)` to its slice. Built as `buildRedactor(registry)` so Broadcaster still takes one injected function; the S1 no-bypass tests (spy redactor + single-`.send(`-site scan) survive unchanged. First real customers: hidden tokens (DM-only) and private rolls (roller+DM).

**D5. Module state scoping & persistence.** One row per `(campaign_id, module_id)` in the existing `module_state` table (schema shipped in S1, store class new). Scene-scoping is internal to the module's state shape (`tokens.byScene[sceneId]`), which is what makes "token positions remembered per map" free. Persist on **every** `setState` — better-sqlite3 WAL, rows are a few KB; measure before optimizing. Rolls log capped at last **200** entries in state (full history is a later feature).

**D6. Scenes = a tiny platform module, not a new message path.** `activeSceneId` already lives in SessionState top-level and `scene-changed` already exists; the client already clears+refetches map data on it. So: register a `scenes` GameModule (`commands: { activate: ['dm'] }`) whose handler calls `stores.sessions.setActiveScene` (already exists) and broadcasts `scene-changed`. In-session import = the existing `POST /api/campaigns/:id/maps` endpoint + SceneSwitcher refetching the snapshot scene list (SceneSource is already read fresh per snapshot). ~25 lines of new server code.

**D7. Rolls: ingest, don't compute.** Per the 2026-07-27 directive, no dice engine. `RollEvent`: pre-resolved results only, `source: 'dndbeyond' | 'manual'`. Beyond20 listener = one `window.addEventListener('Beyond20_RenderedRoll', …)` in the client translating the event detail (defensively — every string length-capped, total must be numeric) into `rolls:post`. Manual fallback = one text input in GameLog posting free text (`"stealth 17"`) as `source:'manual'`. Attribution = the session tab's own identity (any roll landing in your tab is yours); DDB character name rides along as display data. Server treats the payload as untrusted display data — validated shape, never trusted math.

**D8. Client plug-in points: `useRole()` + panel registry.** `useRole()` reads `you.role` off the session store. Panel registry: module-level array + `registerPanel({id, title, roles, order, component})`; GameTable's existing `<aside>` renders registered panels filtered by role. SessionControls (DM: SceneSwitcher + session info) and GameLog (shared) are themselves registered panels — the registry's first proof.

**D9. Token move sync rides the existing per-module `state-update`.** During drag: move the sprite locally (optimistic), send `tokens:move` throttled at ~10 Hz + final on drop. Each accepted move → `setState` → per-module broadcast (small — the tokens slice only, not the session snapshot). Rejection → client receives authoritative slice, sprite tweens back over ~150ms. `msg.seq` stays client-side-only (S1 ponytail flag stands).

**D10. Ownership validation server-side; fog check is a stub seam.** Move/update: DM anything; player only `token.ownerId === sender.identityId`. Place/delete/hide/library-CRUD: DM only. Claim: player, only if `ownerId === null && !hidden`. Cell-reveal check = `canOccupy(token, pos, state): true` stub called on every move, tightened by S3 fog — with a test pinning that it's called.

**D11. Token images: SQLite blobs, same pattern as maps.** New `assets` table + `POST /api/campaigns/:id/assets` (DM, ≤ 2 MB, magic-byte sniff png/jpg/webp) + `GET /api/assets/:id` (session member, `Cache-Control: immutable` — asset ids are content-addressed-ish random, never rewritten). Tokens without a portrait render as a colored disc + initials with a disposition-colored ring (friendly green / neutral yellow / hostile red).

**D12. Token library lives in tokens-module state, not a new table.** `state.library: Record<defId, TokenDef>` (campaign-scoped by D5). Placing = instantiating a def into `byScene[sceneId]`. Avoids a table + store + migration for what is a small JSON map. Ceiling: a campaign with thousands of defs — revisit then.

**D13. Grid snap in world units.** 1 world unit == 1 grid cell (confirmed from core). Sizes in cells: tiny 0.5, small/medium 1, large 2, huge 3, gargantuan 4. Odd-width tokens snap centers to cell centers (`floor(x)+0.5`), even-width to intersections (`round(x)`). Tiny renders 0.5 but snaps like size 1 (ponytail: half-cell snapping when someone asks).

**D14. PROTOCOL_VERSION → 2.** Client+server ship together; a stale tab gets `protocol-mismatch` and refreshes. Cheaper than reasoning about additive compatibility.

**D15. S1 gate debts scheduled here.** (a) Serial pack install → parallelize fetch + texture upload in core's `firstBootInstall`/`AssetPackManager` (own lane, it's 85% of join time); (b) empty-name `/api/join` → trim + reject 400 (rides the platform lane); (c) PixiJS `loadParser` deprecation → stretch inside the perf lane.

---

## §2 Spec

### §2.1 Protocol & shared types (packages/core `shared/protocol.ts` — the only core file touched, plus version bump)

```ts
export const PROTOCOL_VERSION = 2;
// SessionState, ClientMessage, ServerMessage: UNCHANGED. modules: Record<string, unknown>
// now actually populated in snapshots: { rolls: RollsState, tokens: TokensState } (redacted per viewer).
```

### §2.2 `@dnd/mechanics` (new workspace package)

```
packages/mechanics/
  package.json        // name @dnd/mechanics, ships TS source like core; deps: NONE (pure)
  src/rolls/{types.ts,module.ts,module.test.ts}
  src/tokens/{types.ts,module.ts,validate.ts,module.test.ts}
  src/contract.ts     // re-exports GameModule/ModuleContext types (source of truth moves here from server)
```

`contract.ts` (v2 — server's `registry.ts` imports these types from mechanics):

```ts
export interface Viewer { role: Role; identityId: string }

export interface ModuleContext<S> {
  campaignId: string; sessionId: string; activeSceneId: string | null;
  sender: Viewer;
  players: readonly PlayerInfo[];
  state: S;
  setState(next: S): void;                    // persist + redacted broadcast, one call
  broadcast(msg: ServerMessage): void;        // ephemeral only (unchanged from S1)
}

export interface GameModule<S = unknown> {
  name: string;
  commands: Record<string, readonly Role[]>;
  initialState: S;
  handler(action: string, payload: unknown, ctx: ModuleContext<S>): CommandError | void;
  redact?(state: S, viewer: Viewer): S;       // pure; default = identity
}
```

**Rolls** (`rolls/types.ts`):

```ts
export interface RollEvent {
  id: string;                                  // server-minted
  at: number;                                  // server timestamp
  identityId: string; playerName: string;      // server-stamped from sender/roster
  source: 'dndbeyond' | 'manual';
  characterName?: string;                      // ≤ 60 chars, display only
  title?: string;                              // e.g. "Longsword: Attack", ≤ 100
  formula?: string;                            // e.g. "1d20+7 (adv)", ≤ 100
  breakdown?: string;                          // e.g. "17 + 7", ≤ 200 — display only, never recomputed
  total?: number;                              // finite number
  text?: string;                               // manual entries, ≤ 200
  visibility: 'public' | 'private';            // private ⇒ roller + DM only
}
export interface RollsState { log: RollEvent[] }   // capped: last 200
```

Commands: `rolls: { post: ANY_ROLE }`. Payload = client-supplied fields only (`source, characterName, title, formula, breakdown, total, text, visibility`); server mints `id/at/identityId/playerName`, validates caps, appends, trims to 200. Redact: `log.filter(e => e.visibility === 'public' || viewer.role === 'dm' || e.identityId === viewer.identityId)`.

**Tokens** (`tokens/types.ts`):

```ts
export type TokenSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export const SIZE_CELLS: Record<TokenSize, number> = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
export type Disposition = 'friendly' | 'neutral' | 'hostile';

export interface TokenDef {                    // library entry (campaign-scoped)
  id: string; name: string;                    // name ≤ 60
  imageAssetId: string | null;
  size: TokenSize; disposition: Disposition;
  sight: { range: number; angle: number; visionMode: 'normal' | 'darkvision' } | null;   // schema-only until S3
  light: { dim: number; bright: number; color: string; angle: number } | null;           // schema-only until S3
}

export interface Token extends TokenDef {      // placed instance (scene-scoped)
  defId: string | null;                        // provenance; instance fields already copied
  x: number; y: number;                        // world units == grid cells
  elevation: number; z: number;                // z = draw order within overlay
  hidden: boolean;                             // DM-only visibility
  ownerId: string | null;                      // identityId of claiming player
}

export interface TokensState {
  library: Record<string, TokenDef>;
  byScene: Record<string, Record<string, Token>>;
}
```

Commands & permissions:

| action | roles | validation (beyond role) |
|---|---|---|
| `library-upsert` / `library-delete` | dm | caps; delete leaves placed instances intact |
| `place` | dm | def exists or inline fields; snapped server-side too |
| `move` | ANY_ROLE | player ⇒ `ownerId === sender`; `canOccupy()` stub (D10); finite coords |
| `update` (name/size/disposition/elevation/z) | dm; player ⇒ own token, `name` only | caps |
| `hide` / `delete` | dm | — |
| `claim` | player | `ownerId === null && !hidden`; sets `ownerId = sender` |

Redact: for non-DM viewers, drop tokens with `hidden: true` from every scene (whole object — position of a hidden token is exactly what must not leak). DM state untouched.

### §2.3 Server changes (session/server)

1. **`db/stores.ts` + migration v2**: `ModuleStateStore { get(campaignId, moduleId): unknown|undefined; put(campaignId, moduleId, state: unknown): void }` over the existing `module_state` table (no schema change needed) **+ migration v2 adds `assets` table**: `(id TEXT PK, campaign_id TEXT, mime TEXT, bytes BLOB, size INTEGER, created_at INTEGER)`.
2. **`modules/registry.ts`**: types now imported from `@dnd/mechanics/contract` (runtime import OK — mechanics is pure). `dispatch` builds `ModuleContext` with `state` loaded via ModuleStateStore (lazy, seeded from `initialState`), `setState` = put + broadcast redacted `state-update`. Registry gains `snapshotModules(campaignId, viewer)` for join snapshots.
3. **`ws/Broadcaster.ts`**: `Redactor = (msg, viewer: Viewer) => ServerMessage`; `buildRedactor(registry)` applies module `redact` to `state-update` / `session-state` slices. Single `.send(` site and injected-spy test shape unchanged.
4. **`ws/SessionManager.ts`**: snapshot populates `modules` via registry (per-viewer at send time — snapshot content flows through the redactor like everything else).
5. **`modules/scenes.ts`**: per D6. `{ activate: ['dm'] }` → `setActiveScene` + `scene-changed` broadcast. Rejects unknown sceneId (must be in campaign's maps).
6. **`http.ts`**: assets upload/download endpoints per D11 (`readBody(req, 2*1024*1024)`, magic-byte sniff, `requireSession` DM for POST / member for GET).
7. **`/api/join`**: `name.trim()`; empty after trim → 400 `{ error: 'name-required' }` (kills the ghost-"Someone" S1 finding).
8. **Boot** (`index.ts`): register `scenes`, `rolls`, `tokens` modules; `PROTOCOL_VERSION` 2 flows from core.

### §2.4 Client changes (session/client)

1. **`session/panels.ts`**: `registerPanel({id, title, roles, order, component})` + `usePanels(role)`; GameTable `<aside>` renders from it. **`useRole()`** in `session/store.ts` selectors. **`useModuleState<T>(module)`** selector over `session.modules`.
2. **`components/SessionControls.tsx`** (DM panel, order 0): SceneSwitcher (scene list from snapshot, active highlighted, click → `scenes:activate`; upload-new-map button reusing the existing upload helper + snapshot refresh), session info.
3. **`components/GameLog.tsx`** (shared panel, order 50): merged feed of roll events (from `rolls` module state) + join/leave lines (client-side from roster deltas); private rolls badged "🔒 whisper"; manual-roll text input at the bottom (posts `rolls:post` `source:'manual'`).
4. **`modules/rolls/beyond20.ts`**: `window.addEventListener('Beyond20_RenderedRoll', handler)` mounted for the session's lifetime; translates `event.detail` → `rolls:post` payload (defensive field extraction, whisper flag → `visibility:'private'`). Fixture file of captured real Beyond20 payloads drives unit tests.
5. **`modules/tokens/TokenRenderer.ts`**: new Pixi container added to `sceneGraph.worldContainer` right after `layerContainer` (via `getEngineSingleton()`); one sprite (or disc+initials fallback) per token in the active scene, subscribed to `useModuleState('tokens')`; selection outline; z/elevation ordering; **DM sees hidden tokens full-opacity + eye-slash badge** (players never receive them at all — D4).
6. **`modules/tokens/drag.ts`**: pointer handlers on token sprites (role/ownership-aware locally — server still validates); grid snap per D13; optimistic sprite move; `tokens:move` throttled 10 Hz + on drop; rubber-band tween ~150ms on authoritative mismatch.
7. **`modules/tokens/TokenLibraryPanel.tsx`** (DM panel, order 10): library list, create/edit (name, size, disposition, portrait upload, sight/light fields present-but-collapsed "S3"), click-to-place mode.
8. **Player claim UX**: click an unowned token → "Claim" affordance; owned token shows owner ring/name.

### §2.5 Core changes (packages/core) — perf lane only

- `firstBootInstall` / `AssetPackManager`: parallelize the 94-file fetch loop (`Promise.all`, concurrency-capped ~8) and texture upload; target join p95 < 1.5s (was 2.3–4.0s, ~2.7s of it serial pack install). Stretch: `loadParser` → `parser` migration (kills the ×20 console warnings, S1 gate finding).
- `shared/protocol.ts`: `PROTOCOL_VERSION = 2`. Nothing else.

### §2.6 Acceptance (maps to tracker S2 metrics)

| Tracker metric | Verified by |
|---|---|
| Token move < 100ms across 6 clients | timestamped ws test: N raw ws clients, `tokens:move` → all `state-update` receipts |
| 20 tokens @ 60fps | metrics spec (prod build, `channel:'chromium'` + ANGLE) on benchmark map + 20 tokens |
| DDB roll ingestion | unit tests on Beyond20 fixture payloads → command translation; real-sheet click in the Chrome gate (user-assisted — needs the user's DDB tab; synthetic `CustomEvent` path automated) |
| Roll sync + whisper privacy | Playwright 2-context: dispatch synthetic `Beyond20_RenderedRoll` in player context; assert public roll on both, private roll absent from other player, present for DM — **and absent from the raw ws frames** (anti-Owlbear check, early) |
| Scene switch < 2s, positions restored | Playwright timed: place tokens on map A, switch to B, back to A, assert positions + elapsed |
| Module contract | code review vs D2's third-party test: zero platform edits for rolls/tokens beyond `register` calls |
| Ownership enforcement | forged-client test: raw ws client sends `tokens:move` for someone else's token / `hide` as player → `unauthorized`, state unchanged |
| (carry-over) join p95 < 1.5s | metrics spec re-run after P1 |

Standing Docker+Chrome gate closes the sprint (all metrics walked on the deployed stack, zero console errors / failed requests). The real-DDB step needs you at the wheel for the sheet click — I can't log into DDB.

---

## §3 Plan — lanes & waves (Opus agents, file-fenced)

| Lane | Scope | Files (fence) | Depends on |
|---|---|---|---|
| **P1 perf** | D15a pack-install parallelization + measure; stretch loadParser | `packages/core/src/**` (asset/loader only) | — |
| **M1 platform** | mechanics scaffold + contract v2, ModuleStateStore + migration v2, registry/Broadcaster/SessionManager changes, scenes module, assets endpoints, empty-name reject, PROTOCOL_VERSION 2 | `packages/mechanics/src/contract.ts`, `session/server/**`, `packages/core/src/shared/protocol.ts`, root workspace files | — |
| **U1 client shell** | panel registry, useRole/useModuleState, SessionControls + SceneSwitcher, GameLog shell | `session/client/src/components/**`, `pages/GameTable.tsx`, `session/panels.ts`, `session/store.ts` | spec only (commands fixed here) |
| **R1 rolls** | `mechanics/src/rolls/*` + tests; client beyond20.ts + GameLog roll entries + manual input | `packages/mechanics/src/rolls/**`, `session/client/src/modules/rolls/**`, GameLog append-only | M1 (contract), U1 (GameLog exists) |
| **T1 tokens server** | `mechanics/src/tokens/*` (module, validate, redact) + tests | `packages/mechanics/src/tokens/**` | M1 |
| **T2 tokens client** | TokenRenderer, drag, TokenLibraryPanel, claim UX | `session/client/src/modules/tokens/**` | T1 types, U1 registry |
| **I1 integration** | Playwright scenarios §2.6, ws latency + forged-client tests, metrics additions | `session/client/e2e/**`, `session/server/src/*.test.ts` | R1, T1, T2 |
| **V gate** | Docker rebuild + Claude-in-Chrome walkthrough of every S2 metric (user assists DDB step) | — | I1 |

**Waves**: 1 = P1 ∥ M1 ∥ U1 → 2 = R1 ∥ T1 → 3 = T2 ∥ I1(server-side parts can start with T1) → 4 = V.
Fences of note: `http.ts` + `registry.ts` are M1-only (R1/T1 touch mechanics + client only); `GameTable.tsx`/`panels.ts` are U1-only (later lanes call `registerPanel`, never edit the shell); `protocol.ts` is M1-only.
10-minute watchdog loop runs whenever agents are in flight (standing mandate).

## §4 Risks (sprint-local)

- **Beyond20 payload shape drift** — mitigated: fixture-driven translation with defensive extraction; unknown fields ignored; worst case rolls arrive title-less but land.
- **Optimistic drag vs 10 Hz authoritative echo fighting the sprite** — rule: while dragging locally, ignore inbound positions for the dragged token; reconcile on drop.
- **`getEngineSingleton` lifecycle** (set during boot, cleared on unmount) — TokenRenderer mounts via a ready-callback/effect after boot completes, not module import time.
- **Module snapshot size growth** — rolls capped at 200; tokens are small; snapshot stays KB-scale. Revisit if `session-state` frames exceed ~100 KB.
