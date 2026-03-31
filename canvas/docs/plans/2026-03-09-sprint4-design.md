# Sprint 4 Design — Selection, Undo/Redo, Layers, Visual Effects

**Date:** 2026-03-09
**Status:** Approved
**Prerequisite:** Sprint 2-3 complete (drawing tools, geometry pipeline, grid, snap)

---

## Overview

Sprint 4 completes the editing workflow with full undo/redo, selection tools, visual effects (hatching, shadows, presets), and layer system completion. This is the densest sprint — parallelizable across two tracks.

---

## 1. Undo/Redo System

### Architecture
- `UndoManager` singleton living outside Zustand (not middleware). Maintains undo/redo stacks with 100-op cap.
- `Command` interface: `execute()`, `undo()`, `label: string`.
- `CompositeCommand` groups multi-step ops (e.g., style preset apply touches ~15 properties = 1 undo step).
- `trackedSet(store, path, value)` utility — wraps any property change in a `ChangePropertyCommand` and routes through UndoManager. Enforces discipline so devs don't accidentally mutate store without undo support.

### Geometry Undo
- **Snapshot approach** (matches Dungeon Scrawl's `shapeMemory` pattern). Each draw/erase operation saves a full copy of the merged floor polygon before the boolean op. Undo restores the previous snapshot.
- ~1-2MB for 100 ops on a complex map — acceptable.
- ShapeRecords array also snapshotted (needed to rebuild render caches).

### Non-Undoable Operations
Pan, zoom, saves, exports, panel toggles.

### Debouncing
Slider/color picker changes accumulate into one command (fires on `onChangeEnd`, not every intermediate value).

### Reactive State
`canUndo`/`canRedo` booleans in Zustand UI slice, updated by UndoManager after each operation. Already stubbed from Sprint 1.

---

## 2. Selection System

### Select Tool (V key on dungeon layers)
- **Box-select:** click-drag draws selection rectangle. Clipper2 intersection test against merged floor polygon to determine selected region.
- **Move:** drag selected geometry. Preview shows semi-transparent floating copy at cursor.
- **Copy/Paste/Cut:** Ctrl+C copies selected floor polygon to clipboard (in-memory). Ctrl+V enters paste mode with floating preview. Ctrl+X = copy + erase. Paste finalizes on click — runs boolean union on target layer.
- **Cross-layer paste:** paste adopts target layer's style (colors, roughness, hatching).
- **Transform handles:** screen-space resize handles at corners/edges + rotation handle above. Shift constrains aspect ratio. Shift+rotate snaps to 15-degree increments.
- **Delete:** Delete/Backspace erases selected region (boolean difference).

### Object Tool (V key on images layers)
- Click-select or box-select placed objects (images, assets).
- Same transform handles (move, resize, rotate).
- Drag threshold (3px) to distinguish click from move.
- Multi-select via Shift+click. Ctrl+A selects all on active layer.
- Z-ordering via array position. Context menu or shortcuts for bring forward/send back.

### Shared Infrastructure
- Selection state in Zustand: `selectedRegion` (polygon for dungeon) or `selectedObjectIds` (array for images).
- All selection operations produce Commands for undo.
- Escape or click on empty canvas to deselect.

---

## 3. Visual Effects

### Hatching/Crosshatching (geometry-based via Clipper2)
- Generate hatching band by offsetting the roughened floor boundary via `InflatePaths`.
  - **Standard:** negative offset for exterior band.
  - **Inverted:** positive offset for interior band (both supported in Sprint 4).
- Boolean intersection clips the band to the floor region.
- Fill band with parallel lines at configurable angle, then clip via Clipper2 intersection.
- Four styles: crosshatch (two line sets at 45/-45), lines (single direction), horizontal, none.
- Configurable: band width, line spacing, line thickness.
- Cached in render cache — regenerate only on geometry or roughness change.

### Decorative Shadow Casting
- Offset copy of roughened floor polygon by configurable (x, y) vector.
- Renders in the Shadow sublayer (below Floor in render order).
- Multiply blend mode. Configurable color and opacity.
- Independent from the future dynamic lighting system (Sprint 5).

### Style Presets (8 presets)
- A preset is a plain object defining ~15 properties: floor color, wall color, wall width, shadow color/offset/opacity, hatching style/width/spacing, background color, roughness amplitude.
- Applying a preset replaces all style properties on the target layer via `CompositeCommand` (one undo step).
- **Presets:** Standard, Classic, Crosshatch, Parchment, Blueprint, Graph Paper, Sandstone, Slate.
- UI: preset selector in properties panel with CSS color swatches as thumbnails.
- User-saveable custom presets stored in localStorage.

### Per-Layer Color Control
- Already partially done (Sprint 1 color pickers). Sprint 4 wires changes through UndoManager with debounced commands.

---

## 4. Layer System Completion

### Dungeon Layer Sublayers (render pipeline)
- Five sublayers render in fixed order within each layer's RenderTexture: Shadow → Floor → Grid (stencil-clipped) → Hatching → Walls.
- Each sublayer is a PixiJS Container, independently togglable via the existing sublayer visibility toggles.
- Shadow sublayer uses Multiply blend (already isolated by RenderTexture wrapping from Sprint 1).

### Images Layer
- Container for placed objects (images, assets). Fully managed by Object Tool.
- Multiple images layers supported. Already has add/remove from Sprint 1.

### Background Layer
- Already functional (solid color fill from Sprint 1). Sprint 4 adds optional tiled texture via PixiJS TilingSprite (world-space, camera-relative).
- Background lock boolean — prevents style preset from overriding background settings.

### Layer Operations through Undo
- Add/remove/reorder layers all produce Commands.
- Delete layer with content shows confirmation dialog (already built in Sprint 1).
- Hidden layer = can't draw (show toast warning). Locked layer = can't draw/move but can change styles.

---

## 5. Task Breakdown

| Task | Effort | Dependencies |
|------|--------|-------------|
| 4.1 Undo/Redo (Command pattern, UndoManager, trackedSet, snapshot geometry undo) | 4-5d | None — do first |
| 4.2 Select Tool (box-select, copy/paste/cut, transform handles, cross-layer paste) | 3-4d | 4.1 |
| 4.3 Object Tool (click/box select, transform, multi-select, z-ordering) | 3-4d | 4.1 |
| 4.4 Sublayer render pipeline completion (shadow→floor→grid→hatching→walls) | 2-3d | None |
| 4.5 Hatching + inverted hatching (Clipper2 band generation, 4 styles) | 3-4d | 4.4 |
| 4.6 Decorative shadows (offset polygon, multiply blend) | 1d | 4.4 |
| 4.7 Style presets (8 presets, CompositeCommand, user-saveable) | 3-4d | 4.1, 4.5, 4.6 |
| 4.8 Background texture (TilingSprite, background lock) | 1d | 4.1 |
| 4.9 Per-layer colors through undo + layer op commands | 1d | 4.1 |

**Total: ~22-30 days**

## 6. Parallelization Strategy

- **Track A:** 4.1 (Undo) → 4.2 (Select) → 4.3 (Object)
- **Track B:** 4.4 (Sublayer pipeline) → 4.5 (Hatching) → 4.6 (Shadows) → 4.7 (Presets) → 4.8-4.9 (Background + colors)
- Track B can start immediately since sublayer pipeline doesn't need undo. Undo wiring gets added when Track A delivers 4.1.

## 7. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Geometry undo strategy | Snapshot per operation | Matches Dungeon Scrawl's shapeMemory. Simple, fast, ~1-2MB for 100 ops. |
| Hatching direction | Both standard + inverted | Architecturally near-free (flip InflatePaths offset sign). Avoids revisiting in Sprint 10. |
| Style preset count | 8 | Standard, Classic, Crosshatch, Parchment, Blueprint, Graph Paper, Sandstone, Slate. |
| Selection scope | Full (box-select, copy/paste/cut, transform handles) | No deferral. |

## 8. Exit Criteria

- [ ] Undo/redo works for all drawing operations (Ctrl+Z/Ctrl+Shift+Z)
- [ ] Select tool: box-select, copy/paste/cut, floating preview, cross-layer paste
- [ ] Object tool: select, move, rotate, scale placed objects
- [ ] Sublayer toggles work independently within dungeon layers
- [ ] Hatching renders at dungeon edges (both standard and inverted)
- [ ] Decorative shadows render with proper multiply blend
- [ ] 8 style presets apply coordinated visual themes
- [ ] Per-layer colors editable with undo support
- [ ] Background texture + lock functional
- [ ] All operations undoable
- [ ] No TypeScript errors, ESLint clean, all tests pass
