# Paint brush per layer — plan

2026-08-30. Status: awaiting approval (v2 — reframed from "per-layer terrain" after user feedback). No code.

## Problem

The terrain brush is a general paint brush trapped in one job. Its strokes go to a per-map singleton — three global 2048×2048 splatmaps (2 texture-weight slots + the PR #112 tint map) rendered once at the very bottom of the scene (`sceneGraph.ts:116-130`), and `TerrainTool` deliberately ignores the active layer (`TerrainTool.ts:56-61`). So:

- Paint on a tracing layer above a battlemap image lands invisibly under the image.
- You cannot paint a green tint over a tree asset to add leaves — strokes can never render above anything.
- Multi-layer / multi-floor maps can't have distinct paint per level.

Wanted: strokes belong to the **active layer** and render on top of that layer's content. Paint over assets = paint on their layer (or a layer above). Ground = the existing global terrain, or paint on a lower layer. Layers compose; the brush just paints where you are.

## Design

**Model.** Additive, zero migration. The global terrain stays exactly as-is — it is the map's ground. Each `DungeonLayer` gains:

- `paint?: TerrainData` (same shape — palette, bounds, visible, opacity) — optional, absent until first stroke, following the `floorBleed?`/`rooms?` additive-field precedent.
- Pixels: `terrainSplats` slice grows `byLayer: Record<layerId, [Blob|null ×3]>` beside the global `pngs`. Lazily allocated (3× 2048² RGBA ≈ 48 MB GPU per painted layer; lazy allocation is the mitigation).

Same splat machinery, so both textured strokes and pure tint strokes work per layer for free.

**Render position.** New `paint` sublayer per DungeonLayer, added **above `objects`, below `labels`** in the layer's own container (`sceneGraph.ts:230`). Paint on a layer covers that layer's assets (the leaves-on-tree case) and everything below the layer (the trace-over-image case). Want paint *under* your objects instead? Put it on a layer below — layers are the z-control, the brush doesn't grow its own. NOT clipped to `mergedFloor`; the existing floor-clipped echo of the global terrain (`floorWallRenderer.ts:523-529`) is untouched.

**Brush routing.** Active layer = Background layer or the pinned `__terrain__` row → global ground splats, today's behavior verbatim. Active = a DungeonLayer → that layer's paint surface. `TerrainTool` gains `editsActiveLayer = true` so the standard lock/hidden gating applies — a locked Battlemap layer refuses the stroke with the normal warning instead of painting somewhere invisible. Undo: `TerrainStrokeCommand` gains a layer key.

**Engine lift (the bulk).** `TerrainRenderer` goes from module singleton to one instance per painted surface (global + per layer), created lazily; `paintStamp`, stroke commands, brush preview, and the store subscription take a target.

**Semantics split that simplifies the table work:** per-layer paint is decoration — it renders, exports, and publishes, but it does NOT feed the fog "painted ground" gate. Only the global ground terrain keeps that role (`session/client paintedArea.ts` unchanged). The table just needs to *draw* per-layer paint at the right z.

## Touch points

| Area | Change |
|---|---|
| `exportPipeline.ts` / `mapBounds.ts` | content bounds union per-layer `paint.bounds` |
| `shadowPass.ts` | none — decoration paint casts/clips no shadows (global terrain path unchanged) |
| `mapTextureRefs.ts` | walk per-layer palettes |
| `mapFormat.ts` / `saveLoad.ts` / `autosave.ts` / `mapIO.ts` | serialize `byLayer` splats; format `3.1 → 3.2`, additive, no migration step |
| `session/client` renderer | draw each visible layer's paint surface at its z; `paintedArea.ts` untouched |
| `session/server sceneMap.ts` | pass `byLayer` PNGs through; bounds union |
| `LayerPanel.tsx` | per-layer paint visibility/opacity where `paint` exists (mirror `SublayerVisibility`); pinned global Terrain row stays as "Map ground" |
| `TerrainProperties.tsx` / `ToolPopover.tsx` | show which surface the brush targets (active layer name vs "Map ground") |

## Phases

1. **Core engine** — renderer instancing, per-layer store fields, brush routing + `editsActiveLayer`, layer-keyed undo, `paint` sublayer in scene graph. Feature works live in the editor.
2. **Persistence + derived** — save/load/autosave, format bump, export bounds, textureRefs.
3. **Session** — publish per-layer splats, table client draws them, server bounds. Table walk.
4. **UI + tests** — LayerPanel rows, properties/toolbar target indicator, impeccable pass, unit tests per phase.

Each phase lands green before the next; single branch stacked on `canvas-map-flows` (which still carries the uncommitted pack-catalog fix — commit it first or fold it in).

## Known limits (v1)

- **Coverage window**: splats span a fixed 128×128-cell area at the origin (`TERRAIN_EXTENT_HALF = 64`) — already smaller than Goblin Warren (86×113); strokes outside it are lost. Pre-existing; not widened here, but per-layer surfaces make "size the splat to the map frame" a natural follow-up.
- **Resolution**: 16 px/cell (2048/128). Fine for ground; leaf-scale detailing over a 2-cell tree gets ~32 px of paint — soft. Acceptable for v1; bumping per-layer splat density (or sizing splats to content bounds) is the follow-up if detailing demands it.
- No per-floor table semantics; per-layer paint just draws wherever its layer draws.

## Open decisions

1. Paint z inside a layer: above `objects` / below `labels` (recommended). Alternative — configurable per layer — deferred as YAGNI.
2. StampScatter double-scale bug (`StampScatterTool.ts:177`): fix alongside Phase 1, or leave parked?
