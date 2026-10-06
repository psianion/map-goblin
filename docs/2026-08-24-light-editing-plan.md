# Light editing — canvas fixes, light-on-asset, live DM edits at the table

Date: 2026-08-24. Status: PLAN, awaiting approval. Nothing below is built.

## What's broken / missing (verified today on Fieldstone Keep, dev canvas)

| # | Symptom | Root cause (file:line) |
|---|---------|------------------------|
| B1 | Clicking a light icon selects the floor shape or the lamp asset under it | `packages/core/src/engine/hitTest.ts:91-101` tests labels → assets → doors → *rest*; lights are in *rest*, so any co-located asset/shape wins |
| B2 | Lights with nothing under them are still near-impossible to hit | `hitTest.ts:80` hit radius is 0.5 **world** cells; the icon is a fixed **12 screen px** (`LightingRenderer.ts:333`). At 12 % zoom 0.5 cells ≈ 2 px |
| B3 | Light tool popover: picking a colour closes the picker, colour unchanged | `canvas/src/components/toolbar/ToolPopover.tsx:76-84` capture-phase `pointerdown` closes the popover for any target outside `panelRef`; `ColorField` portals its picker to `body` (`inputs/ColorField.tsx:141`), so the first click in the picker is "outside" and unmounts it |
| B4 | Can't drag a light | Consequence of B1/B2 — `SelectTool` move + `UpdateChildCommand` path exists and works for multi-select (`SelectTool.ts:559-670`); never reachable |
| M1 | Moving a lamp asset leaves its light behind | No link between a `LightChild` and an asset — `packages/core/src/shared/types.ts:167-177` has no parent/attach field |
| M2 | DM cannot edit lights at the table | Table boots the same `LightingRenderer` with icons off (`session/client/src/renderer/GameRenderer.tsx:113`); the only live light state is on/off via `triggers.lightOverrides` (`packages/mechanics/src/triggers/types.ts:82`, `module.ts:533-548`, client `modules/triggers/lightSync.ts`) |
| M3 | Canvas edits don't reach the table live | By design: canvas → `PublishDialog` → `PUT /api/scenes/:id/publish` → new map row → `scene-changed` → table hot-swaps the doc (`http.ts:406-447`, `SessionManager.ts:270-294`, `GameRenderer.tsx:190-205`). Works, just not "live" |

Not a bug after all: "lights added via `addChild` don't render a pool" — `LightManager.syncFromStore` dirties every new id; what I saw was a hidden tab not painting.

## Design decisions (small on purpose)

1. **Selection**: hit-test lights **first** (they are drawn on top), with a hit radius of `max(0.5, ICON_PX / zoom)` cells. `hitTestChildren` gets an optional `{ zoom }`; `SelectTool` already has `engine.stage().scale.x`. No new gizmo — the existing generic handles scale `radius` (`childTransform.ts:153-216`), that stays.
2. **Colour picker**: the popover's outside-click handler ignores targets inside `[data-color-picker]`; `ColorField` marks its portal root. Same fix covers every `ColorField` inside `ToolPopover` (floor/wall colours too).
3. **Light-on-asset (M1)**: add `attachedTo?: string` (asset child id) to `LightChild`. Rules, all in core:
   - `LightTool` sets it when a light is placed within 0.5 cells of an asset's centre; `LightProperties` shows an "Attached to <asset name> · detach" row.
   - `SelectTool.beginTransformSession` pulls attached lights into the session when their asset moves (same composite command, one undo). Moving the light alone keeps the link (new offset). Deleting the asset deletes attached lights.
   - Serialises as a plain field; old files load unchanged. Table ignores it (it's an authoring convenience).
4. **Live DM edits (M2)** extend the **existing** triggers slot instead of a new module:
   - `SceneTriggers.lightEdits: Record<lightId, Partial<{visible, radius, featherRadius, intensity, color, position}>>`; `lightOverrides` (boolean) folds into `lightEdits[id].visible` with a read-compat shim so saved `module_state` rows keep working.
   - New DM-only command `triggers.set-light { lightId, patch }` and `triggers.reset-light { lightId }`, persisted via the generic `ctx.setState` → `module_state`, broadcast as today.
   - Client `lightSync.ts` applies the whole patch onto the `LightChild` (today it only flips `visible`); `LightingRenderer` re-reads next frame — no new render code.
   - Server vision: `fog/sweep.ts litIn` and `vision.ts:210-215` read radius/position/visible through the edits, so player sight follows the DM's change. This is the one place correctness matters (darkness sight).
   - Republish keeps edits (keyed by light id, scene-scoped). A "bake edits into the map" action is **out of scope**; noted as follow-up.
5. **Table DM UI (M2)**: DM seat only. A "Lights" mode in the rail turns icons on (`setIconsVisible(true)`); click → popover with Radius / Bright zone / Intensity / Colour / On-off / Reset; drag moves. Controls are rebuilt in `session/client` with its own slider/colour primitives (canvas components aren't shared), matching the Moss chrome and the rail-and-popover shell from #103. Player seat never sees icons; light state arrives through `state-update` as today.
6. **Canvas → table (M3)**: no new sync. The publish path is the sync; the table edits are the live path. Document this in the publish dialog copy ("table edits to lights are kept on republish").

## Team — one contained workflow per step, ≤5 agents, Fable adjudicates between steps

Orchestrator/guide: **Opus** (reviews every diff against this doc, the art/chrome guides, and runs `impeccable` on step 4). Workers: **Sonnet**. No Haiku. Each step ends with tests green + a short report; I gate before the next step starts. No agent run over 60 min; steps are sized for that.

| Step | Agents | Scope | Done when |
|------|--------|-------|-----------|
| 1 Canvas fixes | 2 Sonnet + guide | B1, B2, B3 in `hitTest.ts`, `SelectTool.ts`, `ToolPopover.tsx`, `ColorField.tsx`; tests in `hitTest.test.ts` (light over asset wins; zoom-scaled radius) and a ToolPopover test (picker click doesn't close) | vitest green; I verify B4 drag + panel edits live in Chrome on Fieldstone |
| 2 Attach | 1 core Sonnet + 1 canvas Sonnet + guide | M1: type + `LightTool` + `SelectTool` session + delete cascade + `LightProperties` row; tests for move-with-asset and delete cascade | green; live check: drag Kitchen Hearth asset, light follows, one undo |
| 3 Mechanics + server | 2 Sonnet + guide | M2 data: `triggers` types/actions/compat shim, `lightSync.ts` full patch, `sweep.ts`/`vision.ts` reads; tests in `packages/mechanics` and `session/server/src/fog` (player sight changes when radius edited) | green; REST/WS smoke from a script |
| 4 Table DM UI | 2 Sonnet + Opus impeccable guide | Rail "Lights" mode, icon toggle for DM, popover, drag; mockup of the popover **to the user first** before build (UI fork rule) | user picks mockup; then built; impeccable review pass |
| 5 Gate | me + 1 Sonnet | Docker images rebuilt, DM + player seats on Fieldstone in Chrome: edit a light at the table, player sight updates, republish from canvas keeps the edit; zero console/network errors | gate report in `docs/` |

Ship: one branch `light-editing`, one squash PR after step 5. Steps 1–2 could ship alone as a first PR if step 3–4 slip — say so and I'll split.

## Out of scope (tracked here, not built)

- Baking table light edits back into the `.mapbuilder`.
- Light radius handle as a dedicated ring gizmo (generic handles suffice).
- Token visibility reset for the next table test — separate small task after this plan, per the user's note.
- Map-card name not updating after a programmatic `loadFromFile` (dev-only path).

## Risks

- `triggers` state shape change touches persisted `module_state` rows → compat shim + a migration test, not a DB migration.
- Vision sweep reads lights from the cached `SceneMap`; edits must be applied per-request without invalidating the cache (cache holds geometry; edits are overlaid).
- Table popover drag vs. fog brush / token drag input arbitration in the rail shell — guide checks against #103's input modes.
