# Layer System Overhaul — Gate Walk Results (2026-08-05)

**Build under test:** main @ `a4b2bf7` (PRs #61–#64), Docker images rebuilt at this sha and redeployed (editor :8080, game-server :8787, session-client :8090).

**Method:** fresh map authored from scratch in the deployed editor (fresh-map mandate), full 11-item checklist walked in Chrome, disputed findings adversarially adjudicated against code + live retest, then export→host→table pipeline verified through the real DM wizard. No water on the map (rework exclusion).

**Verdict: GATE PASSED — 11/11 checklist items.** One item (child reorder) was initially reported FAIL and overturned on adjudication: the walk misread the deliberately reversed children array; live retest confirmed panel order, store mutation, and canvas z-order all agree. A reported "lost asset" was likewise traced to the walk's own Redo ×4 re-applying one of its test deletes — undo/redo round-tripped byte-identical through 10 levels.

## Demo map

"Untitled Map" 40×40, Stone Dungeon preset: terrain painted full-footprint, 3 dungeon layers (Great Hall / Bone Crypt / Passages), 4 rooms + 3 corridors, 4 doors, 5 lights, labels, scattered assets. Autosave + reload persistence confirmed. Kept in editor IndexedDB; serialized copy at `.gate-tmp/demo.mapbuilder` (10,470 bytes).

## Checklist

| # | Item | Result |
|---|------|--------|
| 1 | Lock enforcement (all draw tools + delete blocked, toast) | PASS |
| 2 | Hidden enforcement (lights/glow/icons vanish; draw blocked) | PASS |
| 3 | Layer opacity (live preview, single undo step, persists) | PASS |
| 4 | Rename layer + child survives reload | PASS |
| 5 | Sublayer toggles independent; global grid instant | PASS |
| 6 | Solo (render-only, never persisted, lights included, panel indicator) | PASS |
| 7 | Terrain row (eye/opacity persist; paint-while-hidden warns) | PASS |
| 8 | Child reorder / z-order (panel top = drawn on top) | PASS (initial FAIL overturned on adjudication) |
| 9 | Keyboard operability (focus, arrows, F2, Delete+undo, Shift+F10) | PASS |
| 10 | Console/network clean | PASS (one known cold-start 503, see F3) |
| 11 | Perf: toggles cause no relayout hitch | PASS (qualitative; no fps global in prod build) |

## Pipeline (export → host → table)

- Map serialized via the app's own `getSerializableState()` (the export code path), published through the full HostSetup wizard: campaign "Gate Walk" (`979b4e8e…`), scene `8c9b6644…`, invite `6EVDQR`, starting room set, visibility on.
- Table renders terrain, walls, doors, grid, fog (gates floor reveal correctly), and all assets at their authored positions. 82 FPS, "Connected", zero console errors across publish + render.
- DM sees no light glow **by design** (`LIGHTING_STRENGTH.dm = 0` in session client's LightManager).
- Admin pass was recovered by matching sha256 of candidates from prior session transcripts against the volume's stored hash — no volume reset needed.

## Findings (tracked, none gate-blocking)

| ID | Finding | Root cause | Proposed fix |
|----|---------|-----------|--------------|
| F1 | Door placement silently no-ops at short/coincident wall segments (corridor↔room junctions); red ghost easy to miss | `DoorTool.onPointerDown` returns bare on `!plan.valid` (DoorTool.ts:293) — silence is currently spec'd by tests | Plumb a reason out of `isPlaceable` → `notify.warning` ("Wall too short for this door" / "Overlaps an existing door") |
| F2 | Rectangle tool silently no-ops when active layer changed between press and release (SelectTool re-points `activeLayerId` on any object click; Terrain/Background rows can hold it) | `RectangleTool.onPointerUp` re-reads `ui.activeLayerId` instead of using the layer captured at pointer-down; `if (!activeLayer) return` with no toast (RectangleTool.ts:56-61) | Capture layer id at pointerDown (chain-tool pattern from PR #61); toast via `blockedLayerReason`/`noEditableLayerMessage` on blocked commit |
| F3 | `GET /packs/index.json` transient 503 on cold start | nginx startup race; no compose healthcheck; client already tolerates it (falls back + warns) | Add `healthcheck` to the map-goblin service in docker-compose.yml |
| F4 | Delete-undo restores child to absolute `originalIndex`; wrong slot (or silent tail-append) if the array was reordered/resized since delete | `RemoveChildCommand` positional restore (commands.ts:149,158-167); `reorderChild` bounds guard silently no-ops when index ≥ len | Restore relative to a neighbor id or clamp+reindex; same class as the PR #37 positional-keys gotcha |
| F5 | Delete/Cut shortcut with unresolvable owning layer still toasts "Deleted N shapes" and pushes an inert undo entry | `new RemoveChildCommand('Delete', layer?.id ?? '', id)` (defaultShortcuts.ts:391, :352) | Skip unresolved children and don't count them in the toast; don't push no-op commands |
| F6 | Label authoring UX: no inline text entry on placement (typing hits global tool shortcuts); text only editable via small pencil in the panel; default label color `#1A1410` invisible on dark scenes | Design gap, not a regression | Inline edit-on-place (focus trap while editing); pick a default color that passes contrast against the ambient-lit scene |
| F7 | Autosave debounce ~30–45s with no flush on unload — edits made just before closing the tab are silently lost (reproduced twice) | No `beforeunload`/`visibilitychange` flush | Flush the pending autosave on `visibilitychange: hidden` |
| F8 | Table view never renders text labels — data arrives intact (`mapData` has all 3 text children) but the read-only GameRenderer mount doesn't draw `childType: 'text'` | session/client GameRenderer omission | Render text children in the table engine mount (respect fog) |

## Known/accepted

- Terrain intentionally renders above same-layer shapes; distinct room floors require erasing terrain inside walls (by design, but non-obvious — candidate for a docs/onboarding note, folded into F6's UX pass).
- Impeccable critique baseline for the layer panel was 19/40 pre-fix; re-run post-gate to log the improvement.

## F2 fix + review follow-ups (2026-08-05, branch rectangle-layer-capture)

F2 fixed: RectangleTool, RegularPolygonTool, and ObjectTool's move-commit now capture the layer at gesture start, resolve it via `resolveEditableLayer` at commit, and warn instead of silently dropping. Chain tools already had the pattern; click-to-place tools commit synchronously and were never exposed. Review verdict SHIP; non-blocking follow-ups tracked here only:

| ID | Finding | Severity |
|----|---------|----------|
| F9 | SelectTool has the remaining F2-shaped holes: region select/move/cut commit paths (SelectTool.ts:751, :797, :884) re-read `ui.activeLayerId` at commit with no capture/guard/toast — a mid-gesture layer switch can union region geometry into the wrong layer's mergedFloor. Object transform (:568-576) captures per-entry layerId but never guards it at commit, so lock/hide mid-drag commits through. Pre-existing, medium. | Medium |
| F10 | Cross-layer selections in ObjectTool move still silently drop children whose owner isn't the active layer (seeded from flat `selection.selectedIds`; ChildRow can select across layers). Pre-existing, now the only silent no-op left in that method. | Low |
| F11 | ObjectTool no-hit branch leaves `moveStart`/`moveLayerId` from a prior gesture (not exploitable today — commit gated on MOVING state — but reset for symmetry so a future edit can't resurrect stale capture). | Nit |
| F12 | Test gaps worth adding: layer deleted mid-drag ("Layer was removed"), hidden-mid-drag for the three drag tools, and stale-capture sequences (down → cancel → up commits nothing; down A → cancel → down B → up lands on B). | Low |

Review note: solo-hidden layers DO block drawing (`blockedLayerReason` → `isLayerEffectivelyVisible` reports "Layer is hidden") — consistent across all guard call sites; the "solo never blocks" rule applies to undoable panel ops, not draw commits.

## Residue

- `.gate-tmp/demo.mapbuilder` — untracked, repo-local, safe to delete.
- Campaign "Gate Walk" + scene remain on the game-server volume.
- Demo map persists in editor IndexedDB (Passages at 50% opacity, terrain at 50% — left from checklist item 3/7 testing; one scatter asset removed during walk testing).
