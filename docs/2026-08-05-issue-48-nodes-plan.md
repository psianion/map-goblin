# Issue #48 + node editing overhaul — implementation plan (2026-08-05)

Design source: `docs/2026-08-05-issue-48-ui-mockups.html` (approved). Scope: canvas context menus, transform controls, node editing UX, full-bezier pen tool. Three PRs, in order; each squash-merges to main independently. Node UX and beziers land together as one nodes PR.

## Ground rules

- Overlays are theme-free white + ink; chrome keeps the theme accent. One shared constants module, no overlay reads the theme.
- One undo entry per gesture everywhere (existing `CompositeCommand` path), including menu slider rows.
- Existing straight-polygon shapes remain valid untouched; bezier tangents are optional per-vertex additions.
- Impeccable review pass over all new chrome before ship; Docker + Chrome gate walk at session exit on a dressed demo map.

## PR 1 — Transform controls (issue #48, half 1)

**Repro pass first** (before any rewiring): Docker dev build, walk every gizmo handle × child type (asset, text, shape, water, light) with `window.__store` watching commits. Record which of "does not work at all" reproduces vs is the non-uniform-scale gap. Findings go in the PR body.

Then:

1. `packages/core/src/engine/overlayPalette.ts` (new): white/ink constants + handle metrics. Gizmo and node overlays import from here; delete hardcoded `0x6c63ff`, `0xffffff` accents in `TransformGizmo.ts`.
2. `childTransform.ts:125-134`: assets/text get `scaleX`/`scaleY` (schema: keep `scale` as legacy read fallback, write both); negative scale = flip. Water/shape ring remap already exact — untouched.
3. `TransformGizmo.ts`: restyle (squares/pills/rotate circle, double-ring selected), idle handles fade during drag, live measurement chip (Pixi text, mono, grid-square units).
4. Shortcuts (`defaultShortcuts.ts`): Ctrl+D duplicate (reuses paste offset), Shift+H / Shift+V flips, arrow nudge = 1 square, Shift+arrows = ¼ square.
5. Floating action bar: DOM component positioned from selection bounds (store subscription + camera transform), hides during drags, clamps to viewport. Verbs: flip H/V, rotate 90°, duplicate, swap (assets), delete, "…" → context menu (wired in PR 2; until then opens nothing and ships hidden behind the PR 2 merge if needed — decide at PR time, prefer landing bar in PR 2 if the stub feels dead).
6. Properties panel: `TransformSection` (X/Y/W/H in squares, angle, ratio lock, flip toggles, rotate 90°) rendered by `PropertiesPanel.tsx` for transformable children.

Tests: `childTransform.test.ts` extended (non-uniform, negative, legacy `scale` fallback); nudge/duplicate shortcut tests; bar position math unit test.

## PR 2 — Context menu system (issue #48, half 2; closes #48)

1. Row vocabulary: extend `ContextMenuItem` in `canvas/src/components/ui/context-menu.tsx` to a typed union — `action | submenu | toggle | slider | swatches | thumbStrip` (+ existing separator/danger/disabled flags, icons, kbd hints, group labels, identity header slot). Renderer switches on row type only. Keyboard nav extended to embedded rows (sliders: arrows adjust, Home/End skip).
2. Registry: `canvas/src/canvas/menuRegistry.ts` — `registerMenu(kind, (ctx) => rows)`, ctx = { child, layer, selection, activeTool, store }. Shared verbs (duplicate, move-to-layer, delete) + danger slot appended by the builder. Mixed multi-select = intersection (shared verbs only). Locked/hidden layers render disabled, mirroring layer-panel rules.
3. Capture: `useCanvasInput` handles button-2 before tool dispatch (hit-test → selection adjust → open menu); tools drop ad-hoc right-click no-ops. Empty ground → canvas menu (paste here, select all in layer, zoom to fit).
4. Per-type builders, this PR: asset (header, swap strip from manifest tag/category neighbors, "More…" → asset browser pre-filtered), light (radius/intensity sliders live-writing via `updateChild` with one undo per gesture, color swatches, flicker toggle if the store has it — else omit), wall (edit nodes, add door here, flip direction, style submenu), door (open/close, style submenu, flip swing), text/shape (basic verbs). **Deferred verbs** (need new mechanics, tracked in PR body): door "slide along wall", light "recenter on prop", shape "convert to hole".
5. Wire the floating bar's "…" to the menu.

Tests: registry builder unit tests (per kind, locked layer, multi-select intersection); capture-order test (right-click never reaches active tool); menu keyboard nav on embedded rows.

## PR 3 — Node editing overhaul (UX + full beziers + ring identity)

One PR, two phases committed in order on the same branch. Phase A (straight-geometry UX) must be fully walkable before phase B starts, so a bezier slip stalls the branch, never corrupts it.

**Phase A — editing UX (straight geometry)**

1. `wallNodeOverlay.ts` / `shapeNodeOverlay.ts`: overlayPalette adoption, 11px handles / ≥20px hit, square vertices, `+` insert pucks on hovered edge only, double-ring selected.
2. Edit state: rope-dash outline (ink under white) on the active ring, 15% dim on everything else (engine overlay quad), both removed on exit.
3. Discoverability: `StatusBar.tsx` gets a mode slot ("Editing wall · Great Hall · outer ring") + contextual key hints; near-node chip (Pixi text) with the top 3 keys follows the selected node. Delete-below-3-points shows a status-bar notice instead of silently refusing.
4. Esc order unchanged (cancel drag → exit). Double-click-elsewhere exit unchanged.

**Phase B — full beziers + ring identity**

1. Schema (`shared/types.ts`): optional per-vertex `tIn`/`tOut` tangent points on shape/water rings. Absent = straight edge. No migration needed.
2. `packages/core/src/shared/bezier.ts` (new): flatten (fixed world-unit tolerance — calibration knob, documented), de Casteljau split, project-point-to-curve. Lives in core so editor and table flatten identically.
3. Flatten integration: one flatten pass per edit feeding `computeMergedFloor` / Clipper2 / walls / fog; renderers draw the flattened ring (tolerance fine enough at max zoom). Stone layout already arc-length parametrized — curved rings reuse it.
4. Pen interactions in `shapeNodeEdit.ts` + overlays: click = corner, click-drag = smooth (symmetric tangents), Alt-drag breaks pair, double-click toggles corner↔smooth, edge-drag bows a straight edge, tangent arms only on selected + neighbors, smooth anchors render as circles.
5. Ring identity fix (replaces the positional-key fragility): on `mergedFloor` recompute, remap `floorWallEdits` keys old→new by ring similarity (centroid + area nearest match); unmatched edits drop with an undo entry rather than silently retargeting. If this balloons mid-PR, fallback = document the limitation loudly in code + status bar warning, and track.

Tests: phase A — overlay state tests extend existing `wallNodeOverlay.test.ts`, hint-content unit tests. Phase B — bezier math (flatten tolerance, split preserves shape, projection); straight-compat (no tangents → identical rings to today); pen edit unit tests per interaction; ring remap tests (edit shape → edits follow their ring).

## Session exit gate

Docker images rebuilt at final main; full editor walk in Chrome on a dressed demo map (curved cave room + curved riverbank + straight rooms): menus on every child type, all gizmo handles, flips, nudge, bar, panel section, pen tool end-to-end, fog/lighting/walls correct on curved rings. Zero console/network errors. Impeccable review pass over menus/bar/panel/status chrome. Art-style-guide check on overlay legibility over the demo map.

## Risks

- Beziers are the long pole; they sit in PR 3's phase B, sequenced last, so a slip delays the nodes PR but never the two issue-#48 PRs.
- Flatten tolerance is a knob, not a constant to argue about: start 0.05 world units, tune at the gate walk.
- Menu embedded rows must not regress the existing layer-panel menus — the union stays backward compatible (`label + onSelect` still works).
