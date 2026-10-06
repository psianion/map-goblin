# Sprint 3 — "The Dark Is Real" — Brainstorm · Spec · Plan

*2026-07-28. Companion to `2026-07-27-game-runner-5-sprint-tracker.md` (S3 section). Grounded on S2 contracts as shipped (PR #34). Scope sources: game-runner-design §fog + §doors; gap-analysis §4.1–4.3, §4.6.*

---

## §1 Brainstorm — decisions

**D1. Fog is session state in a `fog` mechanics module, room-granular, scene-scoped.** Per-room record: `{ status: 'never_revealed' | 'revealed' | 're_hidden', wasEverRevealed: boolean }` — `wasEverRevealed` latches true on first reveal, forever. State shape `fog.byScene[sceneId][roomId]`; rooms absent from the record are `never_revealed` (new rooms need no migration). Commands `reveal / hide / reset / set-bulk`, all DM-only. Persistence and broadcast come free from S2's `setState` (persists + redacted broadcast in one call).

**D2. Doors are authored content with a session-state overlay.** The editor's rooms-doors wall data (Foundry-parity occlusion flags + door state) is the authored default; the `doors` module overlays live state per door: `{ open, locked, revealed }` (`revealed` only meaningful for secret doors). `doors.byScene[sceneId][doorId]`, seeded lazily from map data on first touch. Commands: `toggle` (any role — but locked rejects, and non-DM toggles of unrevealed secret doors reject as `unknown-door`, leaking nothing), `lock`/`unlock` (dm), `reveal-secret` (dm). Opening a door never auto-reveals fog (DM controls drama).

**D3. Door sight is two layers, not two modes** (decision 2026-07-28). **Layer 1 — light blocking, always on:** a closed door is a wall segment for the ClockwiseSweep lighting pass; light stops spilling through. Free — it's already how the editor's lighting engine treats the parity wall data; the runner just feeds it live door state. **Layer 2 — concealment, DM toggle per scene (`concealBehindDoors`, default ON):** player visibility = revealed rooms **reachable** from any player-token-occupied room through open, non-secret doors — a BFS over the rooms-and-doors graph (line of sight at room resolution; no raycasting). Revealed-but-unreachable rooms render in the explored-dim look and their **entities are withheld by the redactor** (players don't watch the goblin pace behind a closed door). Toggle OFF ⇒ visibility = the revealed set, doors only affect lighting.

**D4. Redaction covers three paths, and geometry has a two-tier policy.** Paths: (a) join/reconnect snapshot, (b) incremental broadcasts, (c) **retraction on hide** — `fog:hide` and reachability loss must actively command player clients to drop the affected entities; redacting future frames isn't enough if last-known positions linger in client memory. Geometry policy: `never_revealed` room geometry is stripped from everything player-bound (map payload, snapshots, broadcasts) — the anti-Owlbear guarantee; `wasEverRevealed` geometry **stays** in player payloads (they saw it; without it a reload renders explored rooms black and fails persistence) while entities inside are withheld whenever the room isn't currently visible. Secret doors are stripped until `revealed`. Deliberate, documented leak: once seen, room geometry is permanently client-side.

**D5. Map geometry redaction lives in the map endpoint + reveal deltas — no refetch on reveal.** The full map rides `GET /api/campaigns/:id/maps/:mapId`; for player-role requests the server filters it through `redactMapForViewer(map, fogState)` (rooms + room-assigned children). A `fog:reveal` broadcast to players carries the newly available rooms' map slice **in the same message** as the state change (atomic — no window where the client knows a room is revealed but has no geometry). Payloads stay small: textures shipped in asset packs at join; a reveal delta is placement JSON only. Child→room assignment: point-in-polygon on the child's center, computed once per map load and cached.

**D6. Unzoned map area is unrevealable** (decision 2026-07-28). Children outside every room/corridor polygon are DM-only, rendered black for players, no command can reveal them. Safe default; the zero-setup claim holds; DMs learn to zone in the editor. Corridor zones are rooms in every code path — no special casing.

**D7. Re-hide with the party inside is allowed; your own token never disappears** (decision 2026-07-28). Token visibility rule for players, in order: your own claimed token — always visible; otherwise visible iff its room is currently visible (D3). No server rejection rule for occupied rooms; a DM plunging the party into darkness is legitimate drama, and a player always keeps their anchor.

**D8. `canOccupy` stub (S2 D10) becomes real.** Player moves are rejected into: `never_revealed` rooms, unzoned cells, and (when `concealBehindDoors` is on) revealed-but-unreachable rooms. DM moves anything anywhere. The S2 pin-test that `canOccupy` is called on every move now guards real behavior.

**D9. Reveal All / Hide All apply instantly with a 5s undo toast** (decision 2026-07-28). No confirm modal mid-play. Client captures the scene's fog slice before the bulk op; undo re-sends it via `fog:set-bulk`. Single DM in V1 ⇒ no undo/concurrent-edit races.

**D10. FogRenderer: one mask, rebuilt only on mutation.** Player view: a single Pixi mask built from the visible-room polygons, lighting output composited beneath it (render-texture pass), applied over the world container. `never_revealed`/unzoned = solid black. Explored-dim (re-hidden or unreachable) = desaturate + ~35% brightness on those rooms' render — must read as "explored, stale" at a glance on a bad panel: clearly distinct from both black and live. Reveal = 300ms ease-out alpha fade per room, lighting already composited when the fade starts (black → finished torchlit room, never black → flat room → lights pop). `prefers-reduced-motion` ⇒ instant cut. Mask/geometry rebuild happens only on fog/door/reachability mutations, never per frame — that's what keeps the 60fps gate comfortable.

**D11. DM fog tool: a toolbar mode, never a dialog.** Activate "Fog" → hovering highlights the room polygon under the cursor with its current state; click toggles reveal/re-hide; Escape exits the tool (S4.7 guarantee, built now). Active-tool indicator permanently visible (pain-point #1, matters the moment there are two tools). Reveal All / Hide All live in the fog tool's bar. DM canvas grammar, kept restrained: unrevealed = fog tint; revealed = clean; re-hidden = tint + small "explored" glyph. Hidden tokens and secret doors on the DM view: **always full opacity + badge, never ghosted** (the Owlbear pain, gap-analysis §4.6).

**D12. Lighting under fog = composite, not recompute.** The existing ClockwiseSweep output is drawn beneath the player fog mask (gap-analysis §4.2 recommendation). Door toggles update the lighting engine's wall input live on all clients. DM always sees full lighting. Real per-player LOS stays V3; token `sight`/`light` schema fields (shipped S2) remain dormant.

**D13. PROTOCOL_VERSION → 3.** Same rationale as S2 D14: client+server ship together, stale tabs refresh.

**D14. PR #34 review debts scheduled here** (drop any fixed before merge): (a) `uploadAsset` failed-read path uses `failBody` like `uploadMap` (crash-path fix); (b) GameLog renders server-stamped attribution, character name as secondary display only (forged-name fix); (c) `move`/`update` gain the `hidden` guard `claim` already has; (d) pack-install frame pacing measured during install (Amendment B2 regression); (e) join p95 < 1.5s row stays open — re-run properly this gate.

**D15. The gate walks a dressed map** (standing mandate 2026-07-28). The demo/test map is re-authored in the editor at full current capability (terrain, water, vault assets). Reveal-latency and fps numbers are only honest with real payloads; the S3 demo (torchlit chamber) doubles as the art-style trend check.

---

## §2 Spec

### §2.1 Protocol & shared types (packages/core `shared/protocol.ts` — version bump only)

```ts
export const PROTOCOL_VERSION = 3;
// modules gains: { fog: FogState, doors: DoorsState } in snapshots (redacted per viewer).
// state-update for fog may carry a `mapDelta` field: rooms' map slices newly visible to that viewer (D5).
```

### §2.2 `@dnd/mechanics` — fog & doors modules

```
packages/mechanics/src/fog/{types.ts,module.ts,visibility.ts,module.test.ts}
packages/mechanics/src/doors/{types.ts,module.ts,module.test.ts}
```

**Fog** (`fog/types.ts`):

```ts
export type RoomFogStatus = 'never_revealed' | 'revealed' | 're_hidden';
export interface RoomFog { status: RoomFogStatus; wasEverRevealed: boolean }
export interface SceneFog {
  rooms: Record<string, RoomFog>;      // absent roomId ⇒ never_revealed
  concealBehindDoors: boolean;         // default true (D3 layer 2)
}
export interface FogState { byScene: Record<string, SceneFog> }
```

| action | roles | validation |
|---|---|---|
| `reveal` / `hide` | dm | roomId exists in scene's room set; `hide` requires `wasEverRevealed` (⇒ status `re_hidden`) |
| `reset` | dm | scene back to all-`never_revealed` (wasEverRevealed cleared — a true reset) |
| `set-bulk` | dm | full `rooms` record replace (Reveal All / Hide All / undo, D9) |
| `set-conceal` | dm | boolean toggle (D3) |

**`visibility.ts` (pure, shared by redactor + renderer + canOccupy):** `visibleRooms(sceneFog, doors, roomGraph, playerRoomIds): Set<roomId>` — revealed rooms, intersected (when `concealBehindDoors`) with BFS reachability from player-occupied rooms through open non-secret doors. Party-global: one set for the player role, not per player. Recomputed only on fog/door/token-room-change mutations, cached on the module context.

**Doors** (`doors/types.ts`):

```ts
export interface DoorLiveState { open: boolean; locked: boolean; revealed: boolean }
export interface DoorsState { byScene: Record<string, Record<string, DoorLiveState>> }
// seeded lazily from authored map door data on first command touching the scene
```

| action | roles | validation |
|---|---|---|
| `toggle` | ANY_ROLE | locked ⇒ `door-locked` error; non-DM on unrevealed secret door ⇒ `unknown-door` (no existence leak) |
| `lock` / `unlock` | dm | — |
| `reveal-secret` | dm | door is authored secret |

Redact (doors): non-DM viewers get secret doors stripped entirely until `revealed` (D4).
Redact (fog): players receive only `{status, wasEverRevealed}` of rooms with `wasEverRevealed` (never_revealed rooms absent — their ids/count don't leak); DM state untouched.
Redact (tokens — extends S2 rule): for players, drop tokens whose room is not in `visibleRooms`, **except the viewer's own claimed token** (D7). Hidden-token rule from S2 still applies on top.

### §2.3 Server changes (session/server)

1. **`redactMapForViewer(map, sceneFog, doors)`** (new, used by both paths below): strips `never_revealed`-room and unzoned geometry/children, secret doors; keeps `wasEverRevealed` geometry (D4). Child→room index built once per map load (point-in-polygon on center), cached per map version.
2. **`http.ts` map GET**: player-role requests pass through `redactMapForViewer`. DM path unchanged.
3. **Broadcaster/redactor**: fog `state-update` to players carries `mapDelta` for rooms newly entering their visible/explored set (atomic with the state change, D5); hide/reachability-loss broadcasts carry entity retraction (the tokens slice re-redacted — S2's per-module `state-update` already does this; the pin is a test that it happens on fog mutations too, D4c).
4. **`canOccupy` (tokens module)**: implemented per D8; uses `visibleRooms` + unzoned check.
5. **PR #34 debts** per D14 (a)–(c).
6. **Boot**: register `fog`, `doors`; `PROTOCOL_VERSION` 3.

### §2.4 Client changes (session/client)

1. **`modules/fog/FogRenderer.ts`**: per D10 — visible-set mask, lighting composited beneath, explored-dim filter, 300ms ease-out reveal fade (reduced-motion ⇒ cut), solid black for never-revealed/unzoned. Subscribes to fog + doors + tokens module state; rebuilds on mutation only.
2. **`modules/fog/FogTool.tsx` + toolbar**: DM fog mode per D11 — room hover highlight with state, click toggle, Escape exits, Reveal All / Hide All + undo toast (D9), conceal-behind-doors toggle (per scene). Active-tool indicator component (shared shell affordance — S4 will add tools to it).
3. **`modules/doors/DoorRenderer.ts` + interactions**: door sprites reflect open/locked/secret-revealed; click to toggle (any role), DM context affordance for lock/reveal-secret; locked feedback toast on player attempt. Door state changes feed the lighting engine's wall input live (D12).
4. **DM canvas overlays**: fog tint on unrevealed, explored glyph on re-hidden, full-opacity + badge for hidden tokens and secret doors (D11).
5. **Map delta ingestion**: `mapDelta` on fog `state-update` appends rooms' geometry to the loaded scene (same loader path as initial `loadSceneMap`, scoped to the delta).

### §2.5 Core changes (packages/core)

- `shared/protocol.ts`: `PROTOCOL_VERSION = 3`. Nothing else — editor-maps-zero-retracing holds; the lighting engine is consumed, not modified. (If feeding live door state to ClockwiseSweep needs a hook, it's an exported option, not a behavior change to the editor.)
- D14(d): pack-install frame-pacing measurement rides the perf harness, not core logic.

### §2.6 Acceptance (tracker S3 metrics + four added rows + D14e carry-over)

| Metric | Verified by |
|---|---|
| Reveal propagation < 200ms | timestamped ws test on the **dressed map** (D15), largest room — payload included |
| Fog is server-enforced (zero unrevealed data client-side) | ws frame capture (join snapshot **and** broadcasts) + player client memory dump: no unrevealed geometry, hidden tokens, secret doors, DM notes |
| **[added] Redaction covers reconnect** | frame capture on a mid-session reload's join snapshot specifically |
| **[added] Hide retracts** | after `fog:hide` / door-close concealment, player memory dump has zero entities from that room |
| Fog persistence across restart/DM-disconnect | restart test; fog + door state identical after `docker compose restart` |
| **[added] Explored memory survives player reload** | reload mid-session ⇒ re-hidden rooms render dimmed, not black |
| Door → fog → lighting chain live | Playwright 2-context: door toggle updates sight blocking + lighting shadows on both clients |
| Perf: 60fps, 4 lights + 200 walls + 8 tokens (amended 2026-07-29, was 20) | fps benchmark **on the player's seat** — the DM's canvas has no mask, wash, hold-out or fade on it — on the dressed map, fog active, mid-reveal included. Twenty is logged as a reference number only: a real table is one DM and four to seven players. Target 60fps; the E2E asserts a 55fps regression floor. **Currently red** (measured 2026-07-29: 21.8fps player / 19.5fps DM control with both tabs live, 36.7fps player with the DM tab closed, against the ~60 the DM alone has always read) — a known miss, fix is the S4 mask layer cache |
| DM never loses visibility | Playwright visual: hidden/secret entities full-opacity + badge on DM canvas |
| **[added] Reduced-motion reveal path** | Chrome gate with `prefers-reduced-motion` emulated: reveal cuts, no fade |
| Zero-setup: editor map → playable fog/doors/lighting | end-to-end import of the dressed map, no manual masking |
| (carry-over, D14e) join p95 < 1.5s | metrics spec re-run, a real p95 this time |

Standing Docker+Chrome gate closes the sprint — every row walked in the browser against the deployed stack, dressed demo map, zero console errors / failed requests.

---

## §3 Plan — lanes & waves (Opus agents, file-fenced)

| Lane | Scope | Files (fence) | Depends on |
|---|---|---|---|
| **B1 debts** | D14 (a)–(d) PR #34 fixes (skip any fixed pre-merge) | `session/server/src/http.ts`, `session/client/src/components/GameLog.tsx`, `packages/mechanics/src/tokens/**`, perf harness | — |
| **A1 demo map** | author the dressed gate map in the editor (terrain, water, vault assets, rooms+corridors zoned, secret door, locked door, 4 lights) | map file / campaign fixture only | — |
| **F1 fog+doors mechanics** | fog & doors modules, `visibility.ts` BFS, redact fns, tests | `packages/mechanics/src/fog/**`, `packages/mechanics/src/doors/**` | — |
| **M2 server redaction** | `redactMapForViewer` + map GET, mapDelta broadcasts, retraction, `canOccupy` real, protocol 3, module registration | `session/server/**`, `packages/core/src/shared/protocol.ts` | F1 |
| **U2 DM fog UX** | FogTool, toolbar mode + active-tool indicator, undo toast, door interactions, DM overlays | `session/client/src/modules/fog/FogTool*`, `modules/doors/**` (UI), toolbar shell | F1 types |
| **R2 renderer** | FogRenderer, lighting compositing, explored-dim, reveal fade + reduced-motion, mapDelta ingestion | `session/client/src/modules/fog/FogRenderer*`, loader delta path | F1 types, M2 (mapDelta shape) |
| **I2 integration** | §2.6 rows: frame capture, memory dumps, reload tests, Playwright 2-context, fps bench | `session/client/e2e/**`, `session/server/src/*.test.ts` | M2, U2, R2 |
| **V gate** | Docker rebuild + browser walkthrough of every §2.6 row on A1's map | — | I2, A1 |

**Waves**: 1 = B1 ∥ A1 ∥ F1 → 2 = M2 ∥ U2 → 3 = R2 ∥ I2 (server-side rows start with M2) → 4 = V.
Fences of note: `http.ts` is B1-then-M2 (sequenced, not parallel); toolbar shell is U2-only; `protocol.ts` is M2-only; core untouched otherwise.
10-minute watchdog loop runs whenever agents are in flight (standing mandate).

## §4 Risks (sprint-local)

- **Core map shape vs room assignment** — child→room point-in-polygon assumes children have a sensible center and rooms are polygons; verify actual `@dnd/core` map schema at F1 start before committing `redactMapForViewer`'s shape. A child straddling rooms belongs to the room containing its center; revisit if dressed maps make this look wrong.
- **Reveal latency on dressed maps** — mitigated by design: textures ship in asset packs at join; reveal deltas are placement JSON. If a monster room's delta still breaches 200ms, split geometry-vs-decoration in the delta and fade decoration in late.
- **Explored-geometry retention is a deliberate leak** — players keep `wasEverRevealed` geometry client-side forever (D4). Documented here so the frame-capture test doesn't flag it as a failure.
- **Reachability recompute cost** — BFS is per-mutation and party-global (one set), never per-message or per-frame. If token room-changes get chatty at 10 Hz drag, recompute only on room-boundary crossings, not every move.
- **Mask rebuild cost on big maps** — rebuild only on mutation (D10); if a full-map Reveal All still hitches, render room masks to a cached texture incrementally.
- **Lighting engine door hook** — if ClockwiseSweep's wall input isn't hot-swappable at runtime, the hook is added as a core exported option (M2's one allowed core touch beyond the version bump); editor behavior must not change.

---

## Amendment — 2026-07-28: a player-facing scene always has a visible room

Shipped after the S3 lanes landed, from the gate walkthrough: a player could be handed a
scene with nothing in it at all, and on every map authored before this sprint that was the
*only* thing they could be handed. Two cases, one rule each. Both are **read-time** rules —
nothing is seeded, nothing is migrated, no `wasEverRevealed` latch is set by either of them —
and both live in one exported helper, `effectiveFog(fog, rooms, partyRoomIds)` in
`packages/mechanics/src/fog/visibility.ts`, which the server's vision cache and the player's
fog renderer both run their fog through so the two cannot drift.

**1. A map with zero zoned rooms is everyone's, whole.** No rooms means room-granular fog has
nothing to be granular about: no scrim, no geometry redaction, doors sliced unfiltered (there
are no room bindings to slice on), tokens redacted by the S2 hidden rule alone, and
`canOccupy` permissive as it already was. Every pre-S3 map is such a map.

**2. On a zoned map with nothing revealed, one default room is effectively visible.** The
largest room that is not a pathway, lowest room id breaking a tie, falling back to the
largest room of any kind if every room is a pathway. It applies whenever no room is stored
as `revealed` — a fresh session, after `reset`, after a Hide All — and it stops applying the
instant the DM reveals any real room, at which point the effective set is stored state again
and the default room goes dark with everything else. Concealment is off while the fallback is
in play: routing it through the reachability BFS would put a party standing elsewhere
straight back into the dark, which is the thing this exists to prevent. The default room's
geometry and the entities inside it reaching players is accepted — it is the point.

### What this supersedes

- **D6 is narrowed, not repealed.** On a map that *has* rooms, everything outside every room
  polygon is still unrevealable and still DM-only, and an unzoned child is still DM-only.
  What is repealed is the consequence for a map with *no* rooms: "unzoned map renders black
  forever" is no longer the behavior, because there is no zoning to fall short of.
- **D7's total darkness is no longer reachable by players.** A DM may still re-hide the room
  the party is standing in, and their own claimed token is still always theirs — but Hide All
  now bottoms out at the default room rather than at an empty screen. The DM's own view is
  untouched: the fog panel still reads *stored* status, so a scene the DM has revealed
  nothing in reads `Unrevealed` on every row, default room included.
- **D4's two-tier geometry policy is unchanged in kind.** The default room's geometry is
  handed over while the fallback applies and is absent from a fresh map GET once it stops —
  the copy already on a client stays there, exactly as the documented leak says it does.
- **D8 is unchanged in rule and wider in effect:** the default room is occupiable, so a fresh
  table is not a map a player cannot step onto.

### Consequences worth knowing

- Revealing the default room itself hands over no reveal delta on a warm vision cache — the
  player already holds that geometry. Nothing is missing client-side; the frame that says
  `revealed` simply has nothing to carry.
- While the fallback applies, `occupiable` is every explored room rather than every explored
  room the party can walk to, because concealment is off for the fallback. It re-narrows the
  moment a real room is revealed.
- The client picks the default room from the rooms *it holds geometry for*, which is a subset
  of the map's. The server keeps the fallback room in that subset for exactly this reason, so
  the largest room on the client is the largest room on the server.
- Not built, and not wanted until asked: any per-scene "default room" override, and any hint
  in the DM's fog panel that a room is currently standing in as the fallback. The panel shows
  stored state and the DM's canvas is never masked, so nothing there is wrong — it is just
  silent about a rule the player is feeling.

### Found while implementing it: the client was fogging by rooms the server does not have

The rule above is not enough on its own, because the two seats did not agree on what a room
*is*. Core backfills `layer.rooms` from wall and floor geometry after every load
(`packages/core/src/store/roomSync.ts` — the migration path for files saved before rooms
existed) and overwrites whatever the document carried. The server reads `layer.rooms` off the
file and nothing else. On `demo-dungeon.mapbuilder` that is 0 rooms on disk against 4 in the
client's store, so the client masked and tinted four rooms no fog command can even name while
the server fogged nothing at all.

Both client fog layers now read their rooms from the document the server sent
(`serverRooms(mapData)` in `session/client/src/modules/fog/fog.ts`) instead of from core's
store — the redacted copy a player holds *is* the set their mask is a statement about, and
the DM's is the file. That is what the S1 render-parity row was failing on: the two canvases
are now pixel-identical on the demo map (0.0000% of 737,280 px differ, max channel delta 0).

Still on core's store, and worth a decision: `FogTool.tsx` builds the DM's room list the same
way, so on a map nobody zoned the DM is offered four rooms to reveal and the server rejects
every click with `no room '…' in that scene`. Same one-line fix, left alone here because the
panel was outside this change's fence.
