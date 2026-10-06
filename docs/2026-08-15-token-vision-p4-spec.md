# P4 spec — token-vision fog: DM controls

Parent plan: `docs/2026-08-15-token-vision-fog-plan.md`. Prereqs: P1+P2 (2a14beb) and
P3 (ecacadd + its findings-fix commit). P3 landed API relevant here: the shared
light rule is `packages/mechanics/src/fog/light.ts` (`lightSources`); the server
party assembly is `sweep.ts` `partyVision(map, tokens, doors, overrides|null)` with
`Eye`/`seen()` — the P4 link closure widens ITS eye set (and `vision.ts` party rooms
+ `inSight`); client sweeps/lights are `visionSight.ts` `sweepAll`/`litArea`/
`placedLights`; SessionControls now builds its env selects from a typed `ENV_DIALS`
table (the ambient dial is `env-ambient`). Suite baselines to not regress:
mechanics 294+, server 198+, client unit 375+, core 1007+, typecheck 7/7, sprint3
e2e 20 rows (fog 10 + vision 10) — exact numbers will be a bit higher after the P3
findings-fix commit; read `git log` and the suites' own output for the live baseline. The approved mockups are the visual contract:
`docs/mockups/2026-08-15-token-vision-fog-mockups.html` — P4 section (Fog panel v2,
Sight & light panel, brush/lock canvas sketch). This is UI work: the impeccable bar
applies — match Moss chrome exactly, and do a REAL screenshot check of each surface
against the mockup before calling it done.

Scope: Fog panel v2, the fog brush, room-list derived states, Sight & light editing
(instance + library), sight links (state + commands + chips + party-mode effect),
editor zone lock checkbox. Rooms mode + player seat behavior untouched except where
stated. No per-viewer divergence (P5).

## Verified seam facts (scouted 2026-08-15)

- `FogTool.tsx` (157 lines): panel `{id:'fog', title:'Fog', roles:['dm'], order:25}`;
  `send(action,payload)` → `sendCommand('fog',…)`; `armed = activeTool === 'fog'` via
  `useActiveTool` (session/tools.ts — `ToolId = 'fog'`, union-of-one by design, Escape
  handling + `ActiveToolIndicator` bottom-left chrome included; a brush is a SUB-MODE
  of the armed fog tool, not a new ToolId). `bulk(next,message)` = set-bulk + undo
  toast (`showToast`, `UNDO_TOAST_MS`). Room list `data-testid="fog-rooms"`, per-room
  `data-fog-status`, click sends `fogActionFor(status)`. Styling idiom: Moss tokens
  (`surface-2/3`, `border-default/focus`, `text-primary/secondary`, `ease-out-quart`,
  `motion-reduce:transition-none`); the conceal toggle (L106-125, `role="switch"`,
  manual ✓ chip) is the switch pattern to copy.
- `FogOverlay.ts` (209 lines): world-space tint + screen-space hover; document-capture
  pointer listeners; `toolArmed()` gates clicks on `activeTool === 'fog'`;
  `worldPointOf(engine, e)` (renderer/overlayLayer.ts:120-125) converts pointer →
  world; `onDown` hit-tests `roomAt` and sends reveal/hide. Redraw gated on an
  identity tuple incl. `hoverRoomId`.
- Cell math: reuse `packages/mechanics/src/fog/region.ts` — world→cell is
  `[Math.floor(x) - frame.minX, Math.floor(y) - frame.minY]` (the `cellsCoveredByPolygon`
  convention, cell-centre at +0.5); `Cell = [col,row]`; server validates `region-set`
  cells against the frame. `snapDivision` is a false lead (editor placement snap).
- `TokenPanel.tsx` (146 lines): shared table panel `{id:'tokens', order:15, ALL_ROLES}`;
  selection via `useTokenInteraction` (`selectedId`, drag.ts:42-56); DM-only block
  (`isDm && …`, L115-137, Hide/Delete) is where Sight & light + link chips go. Moss
  tokens here.
- `TokenLibraryPanel.tsx`: the "Sight & light (S3)" stub is L190-196 — disabled
  inputs in a `<details>`; `save()` sends only name/size/disposition/imageAssetId.
  NOTE this panel uses older `neutral-*` classes — keep new controls consistent with
  their host panel.
- `tokens/module.ts`: `UPDATE_FIELDS = ['name','size','disposition','elevation','z']`
  (L39) — adding `'sight','light'` makes them DM-only AUTOMATICALLY via the existing
  guard (non-DM may only set `name`, L233-243). `parseDefFields` already validates +
  round-trips sight/light (`validate.ts:154-197`: `parseSight`/`parseLight`,
  `VISION_MODES`, `COLOR_MAX=32`) — `library-upsert` and `place` carry them today;
  only instance `update` is missing them.
- Sight links: NO link state exists anywhere (grepped). Plug points: the party filter
  in `sweep.ts` `partySight` (L70-73: `ownerId !== null && !hidden && range > 0`), the
  rooms-mode party assembly in `vision.ts` `compute()` (L141-146), and the own-token
  exemption in `tokens/module.ts` `inSight` (L107).
- Editor: `canvas/src/components/properties/ZoneProperties.tsx` (`PropertyField` +
  `ToggleSwitch` + `UpdateChildCommand(label, layerId, childId, before, after)` via
  undoManager); wire after the Shape field, gate on `shape.kind !== 'point'`;
  `ZoneChild.blocksAutoExplore?` already in schema, round-trips automatically.

## 1. Fog panel v2 (FogTool.tsx — match the approved mockup)

- **Mode**: segmented two-option control "Rooms | Token vision" → `set-mode`
  (`data-testid="fog-mode"`). Always visible.
- **Vision-only controls** (rendered when the scene's `fogModeOf === 'vision'`):
  - Auto-explore switch (conceal-toggle idiom) → `set-auto-explore`.
  - Vision share segmented "Party | Individual" → `set-share` (works now; behavioral
    divergence is P5 — no disclaimer text needed, the DM sees party behavior).
  - **Fog brush**: a brush section arming a brush sub-mode of the fog tool — a
    Reveal/Hide pair (which op the brush paints). Brush state is a small zustand/
    local store in the fog module (NOT a new ToolId); `ActiveToolIndicator` label
    reads "Fog · Brush" while active (extend `TOOL_LABEL` composition minimally).
    1-cell brush v1; `ponytail:` size slider later.
- **Room list**: keep click-to-reveal/hide. Derived display states (client-side,
  mechanics untouched): status `re_hidden` with ≥1 region bit inside the room →
  label "Partly seen"; room overlapping any `blocksAutoExplore` circle/rect zone →
  a "Locked" chip beside the label (DM doc has zones; overlap = zone shape vs room
  polygon bbox test is enough — `ponytail:` note precision ceiling). Existing labels
  otherwise (`FOG_STATUS_LABEL`).
- Reveal all / hide all / conceal keep their exact behavior + undo toasts.

## 2. The brush (FogOverlay.ts)

When fog tool is armed AND brush mode is on: pointer down + drag paints cells —
convert `worldPointOf` → `[col,row]` via the region.ts frame convention, accumulate a
deduped stroke set, dispatch `region-set { op, cells }` batched (flush on pointerup
and every ~12 cells mid-drag so the player-seat updates feel live); hover shows a
1-cell highlight instead of the room highlight; room-click behavior unchanged when
brush is off. Escape exits the tool as today. `stopPropagation` like room clicks so
a brush stroke never pans/grabs. The server latches brushed rooms (P2 §5) — no extra
client work to make brushed cells render for players.

## 3. Sight & light editing

- **TokenPanel** (selected token, DM-only block): "Sight & light" section — sight
  range (numeric, labeled with the map's unit via `mapSettings.cellScale`, stored in
  cells), vision mode select Normal/Darkvision, carried light dim + bright (numeric)
  + color (the existing color-input idiom if one exists in Moss panels, else a text
  hex field validated to `COLOR_MAX`), and None/clear affordances (sight and light
  are nullable). Dispatch via `tokens` `update` — server change: add `'sight','light'`
  to `UPDATE_FIELDS` reusing `parseSight`/`parseLight` for validation (the existing
  role guard makes them DM-only; add the mechanics test proving a player cannot set
  sight on their own token). `angle` is not surfaced (cones non-goal) — write 360.
- **TokenLibraryPanel**: replace the disabled S3 stub with live def-level inputs
  (same fields, wired into the existing form state + `library-upsert`; keep that
  panel's styling generation).

## 4. Sight links

- **State**: `Token.sharesSightWith?: string[]` (instance-level, scene-scoped,
  symmetric — maintained by the command, absent ≡ []).
- **Command**: `tokens` `set-sight-link { id, otherId, linked: boolean }`, DM-only,
  validates both tokens exist in the scene, maintains symmetry both directions,
  no self-links.
- **Mechanics effect (party mode)**: the sight-source set becomes the transitive
  closure of (claimed tokens) over link edges — an unclaimed familiar linked to a
  claimed token contributes its sweep and its carried light entitlement. Apply the
  SAME closure in: `sweep.ts` `partySight` filter, `vision.ts` `compute()` party
  rooms (rooms mode), and the `inSight` own-token exemption (a token linked to one
  of MY claimed tokens is always visible to me — matters fully in P5, harmless now).
  Hidden tokens stay excluded everywhere (hidden trumps links).
- **UI**: "Shares sight with" chips in the TokenPanel section (mockup) — chips for
  current links (click × to unlink), an add control listing other scene tokens.
- **Client mask**: the party closure must match server-side — extend visionSight's
  token filter identically (one shared predicate in mechanics so the three server
  call sites + client cannot drift; put the closure helper in
  `packages/mechanics/src/tokens/` and import everywhere).

## 5. Editor zone lock checkbox

`ZoneProperties.tsx`: `PropertyField` "Blocks auto-explore" + `ToggleSwitch`, after
Shape, gated `shape.kind !== 'point'`, `UpdateChildCommand` undo pattern, reading
`zone.blocksAutoExplore ?? false`. Round-trips automatically; server check exists
(P1). One editor-side test if the file has a test idiom; otherwise the e2e lock row
(P6) covers it.

## 6. Tests (phase gate)

- Mechanics: UPDATE_FIELDS widening (valid sight/light round-trip on `update`;
  player denied even on own token; bad payloads Reject); `set-sight-link` (symmetry,
  unlink, self-link Reject, DM-only, unknown ids Reject); closure helper (chain of
  links, hidden excluded, no links = claimed only).
- Server: linked unclaimed token extends the party sweep (region bits/room latch it
  alone could produce) and its wire effect (a token visible only through the
  familiar's sweep ships to the player; unlink → next update stops shipping it).
- Client unit: brush cell math (pointer world → cell across a non-zero frame origin);
  stroke dedupe + batch flush; room-list derived states (Partly seen / Locked) from
  fixtures; panel components dispatch the right commands (existing component-test
  idiom).
- e2e (extend sprint3-vision.spec.ts): a DRIVE-THE-REAL-UI row — DM arms the fog
  tool from the panel, flips mode via the segmented control, brushes cells on the
  canvas, player-seat pixels show exactly those cells as memory; and a Sight & light
  row — DM sets a token's sight range/mode through the panel and the player mask
  changes accordingly. (Earlier rows that drive commands via `sendCommand` stay —
  they pin the wire; these pin the chrome.)
- Full gate: all unit suites + typecheck + FULL sprint3 e2e (fog 10/10 + all vision
  rows) green, exact numbers. Screenshot comparison of Fog panel + Sight & light
  section against the mockup as part of the implementer's visual check.

## 7. Non-goals (P4)

Per-viewer divergence + per-identity memory (P5); brush size/shape options; link
GROUPS as named entities (pairwise links + closure only); token vision cones; any
player-facing UI (players get no fog controls, ever); editor zone panel redesign.
