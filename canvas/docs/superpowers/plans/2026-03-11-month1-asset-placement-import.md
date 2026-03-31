# Month 1: Asset Placement + Image Import Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Date:** 2026-03-11
**Track:** Tools Dev
**Sprint:** Month 1, Phase 2 (starts after Systems Dev Phase 1 gate)

**Goal:** Implement asset placement from the library browser and image import via file picker, drag-and-drop, and clipboard paste.

**Architecture:** Asset placement tool integrates with the existing tool state machine pattern (`src/engine/tools/`). A 50%-opacity preview sprite follows the cursor grid-snapped to full cell boundaries. `PlaceAssetCommand` and `PlaceImageCommand` integrate with the existing `UndoManager` singleton. Image import normalizes all three entry points through a single shared pipeline function.

**Tech Stack:** PixiJS v8 (`Sprite`, `Assets`), existing `Command` pattern (`src/store/commands.ts`), `undoManager` singleton (`src/store/undoManager.ts`), Zustand store actions, `sonner` for toasts, existing `gridSnap` middleware

---

## Codebase Orientation

Before writing any code, read and understand these files:

| File | Why |
|------|-----|
| `src/engine/tools/DrawingTool.ts` | The interface every tool implements |
| `src/engine/tools/ToolManager.ts` | How tools are registered and how `switchTool` works |
| `src/engine/tools/registerTools.ts` | Where to add `AssetPlacementTool` registration |
| `src/engine/tools/SelectTool.ts` | Reference for state machine pattern and undo usage |
| `src/engine/tools/ObjectTool.ts` | Reference for how the `object` tool works with `PlacedObject` |
| `src/store/commands.ts` | All existing commands; `MoveObjectCommand` is the closest reference |
| `src/store/undoManager.ts` | Singleton; call `undoManager.execute(cmd)` |
| `src/store/types.ts` | `PlacedObject`, `ToolSettings`, `ImagesLayer`, `ToolType` |
| `src/store/slices/assets.ts` | `trackRecentUse` action |
| `src/canvas/useCanvasInput.ts` | Where to add drag-and-drop and clipboard listeners |
| `src/canvas/gridSnap.ts` | Grid snap math: `Math.round(x / interval) * interval` where `interval = 1 / snapDivision` |
| `src/engine/subscribeToStore.ts` | Pattern for subscribing to store and updating PixiJS |

**Key invariants:**
- `1 world unit = 1 grid cell` (from `inputMiddleware.ts` header comment)
- `1 grid cell = 256px at export resolution`
- Asset cell footprint: `cellWidth = spriteWidth / 256`, `cellHeight = spriteHeight / 256`
- Placement snaps to full cell boundaries (snapDivision = 1, i.e., `interval = 1.0`)
- `ToolType` is a union in `src/store/types.ts` — must add `'assetPlacement'` to it
- Tools are registered in `src/engine/tools/registerTools.ts`

---

## ⚠️ Prerequisites

Before starting any task, verify all four conditions are met:

- [x] `src/store/types.ts` has `PlacedObject` with fields: `id`, `layerId`, `objectType: 'image' | 'door' | 'stairs' | 'text'`, `position`, `rotation`, `scale`, `tint`, `groupId?`, `properties`
  - **Note:** The Systems Dev gate may expand `PlacedObject` to also include `assetId`, `flipX`, `flipY`. Check what's present and use whatever is there — do not add fields yourself; coordinate with Systems Dev.
- [x] `src/store/slices/assets.ts` exports `trackRecentUse(assetId: string)` action (already present as of Sprint 4)
- [x] `src/assets/manifest.json` exists (created by Systems Dev Phase 1)
- [x] Systems Dev Phase 1 gate is marked complete (store types updated, PIXI.Assets manifest skeleton ready)

If any prerequisite is missing, **stop** and wait. Do not proceed without the full `PlacedObject` type and the manifest file.

---

## Sub-task 1 — Store Type Extension for `assetId` + `ToolType`

**Goal:** Extend `PlacedObject` with the `assetId` field (if Systems Dev has not already added it) and add `'assetPlacement'` to `ToolType`. This is the only store-touching work in this track.

**Coordinate with Systems Dev before this step.** If they have already added `assetId`, `flipX`, `flipY` to `PlacedObject`, skip the `PlacedObject` change and only do the `ToolType` addition.

### 1.1 — Add `'assetPlacement'` to `ToolType`

- [x] Open `src/store/types.ts`
- [x] Find the `ToolType` union (currently: `'select' | 'object' | 'rectangle' | 'polygon' | 'regularPolygon' | 'path' | 'wall' | 'light' | 'ruler'`)
- [x] Add `'assetPlacement'` to the union
- [x] If `PlacedObject` is missing `assetId?: string`, add it as an optional field now. If Systems Dev already added it, leave it as-is.
- [x] Run `pnpm typecheck` — must pass with zero errors

### 1.2 — Add store actions for placed objects (if not provided by Systems Dev)

Systems Dev's Phase 2 work includes `addPlacedObject` and `removePlacedObject` store actions. Check `src/store/store.ts` and `src/store/slices/layers.ts` for these.

- [x] Open `src/store/store.ts` — look for `addPlacedObject` and `removePlacedObject` in `MapBuilderStore`
- [x] If they exist: proceed to Sub-task 2
- [x] If they do NOT exist yet: add minimal stubs to `src/store/slices/layers.ts`:

```typescript
// In LayerActions interface:
addPlacedObject: (layerId: string, obj: PlacedObject) => void;
removePlacedObject: (layerId: string, objId: string) => void;

// In createLayersSlice implementation:
addPlacedObject: (layerId, obj) =>
  set((state) => {
    const layer = state.layers.find((l) => l.id === layerId);
    if (layer?.type === 'images') {
      layer.objects.push(obj);
    }
  }),
removePlacedObject: (layerId, objId) =>
  set((state) => {
    const layer = state.layers.find((l) => l.id === layerId);
    if (layer?.type === 'images') {
      layer.objects = layer.objects.filter((o) => o.id !== objId);
    }
  }),
```

- [x] Add the action signatures to `MapBuilderStore` interface in `src/store/types.ts` if adding stubs
- [x] Run `pnpm typecheck` — must pass

### 1.3 — Add `addCustomImage` store action (if not provided by Systems Dev)

This action stores a base64 image by generated ID so it can be referenced by `PlacedObject.assetId` and embedded in save files.

- [x] Check if `addCustomImage(id: string, base64: string): void` exists in `src/store/store.ts`
- [x] If not: add it to `src/store/slices/assets.ts` and `AssetsSlice` state (`customImages: Record<string, string>`)

```typescript
// State addition to AssetsSlice in types.ts:
customImages: Record<string, string>;

// Slice action:
addCustomImage: (id, base64) =>
  set((state) => {
    state.assets.customImages[id] = base64;
  }),
```

- [x] Update initial state in `src/store/store.ts` to include `customImages: {}`
- [x] Run `pnpm typecheck`

### 1.4 — Unit test: store actions

File: `src/store/slices/assets.test.ts` (create if absent)

```typescript
describe('trackRecentUse', () => {
  it('caps recentlyUsed at 10 items', () => {
    // push 11 unique assetIds, verify length === 10
  });
  it('deduplicates: re-used ID moves to front', () => {
    // push ['a', 'b'], then trackRecentUse('a'), verify ['a', 'b']
  });
});
```

- [x] Write and run tests: `pnpm test`

**Commit:** `feat(store): add assetPlacement ToolType + addPlacedObject/removePlacedObject actions`

---

## Sub-task 2 — Image Import Pipeline

**Goal:** A single async function `importImageFile(file: File): Promise<PlacedObject>` that all three entry points call. The function validates, optionally resizes, registers with PIXI.Assets, stores the base64, and returns a ready-to-place `PlacedObject`.

### 2.1 — Create `src/canvas/importImage.ts`

- [x] Create the file `src/canvas/importImage.ts`
- [x] Import dependencies:

```typescript
import { Assets } from 'pixi.js';
import { useStore } from '@/store/store';
import type { PlacedObject } from '@/store/types';
import { toast } from 'sonner';
```

- [x] Implement `generateId()` helper using `crypto.randomUUID()`:

```typescript
function generateId(): string {
  return crypto.randomUUID();
}
```

- [x] Implement `fileToBase64(file: File): Promise<string>`:

```typescript
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

- [x] Implement `resizeImageToMax(base64: string, maxPx: number): Promise<string>` using OffscreenCanvas:

```typescript
async function resizeImageToMax(base64: string, maxPx: number): Promise<string> {
  const img = await createImageBitmap(await (await fetch(base64)).blob());
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
  const w = Math.floor(img.width * scale);
  const h = Math.floor(img.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  img.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return fileToBase64(new File([blob], 'resized.png', { type: 'image/png' }));
}
```

- [x] Implement the main export `importImageFile(file: File, viewportCenter: { x: number; y: number }): Promise<PlacedObject>`:

```typescript
export async function importImageFile(
  file: File,
  viewportCenter: { x: number; y: number },
): Promise<PlacedObject> {
  const VALID_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
  if (!VALID_TYPES.includes(file.type)) {
    throw new Error(`Unsupported image format: ${file.type}. Use PNG, JPEG, SVG, or WebP.`);
  }

  // Check dimensions
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();

  let base64 = await fileToBase64(file);

  // Warn and resize if oversized
  const MAX_IMPORT_PX = 4096;
  const RESIZE_TARGET_PX = 2048;
  if (width > MAX_IMPORT_PX || height > MAX_IMPORT_PX) {
    toast.warning(
      `Image is ${width}×${height}px — resizing to max ${RESIZE_TARGET_PX}px for performance.`,
    );
    base64 = await resizeImageToMax(base64, RESIZE_TARGET_PX);
  }

  // Generate stable IDs
  const assetId = generateId();
  const objectId = generateId();

  // Register base64 in store for save/load embedding
  useStore.getState().addCustomImage(assetId, base64);

  // Register with PIXI.Assets
  await Assets.load({ alias: assetId, src: base64 });

  // Auto-size: 5 grid cells wide (scale = 5.0 in world units)
  const AUTO_SCALE_CELLS = 5;

  const obj: PlacedObject = {
    id: objectId,
    layerId: '',           // caller fills this in from activeLayerId
    objectType: 'image',
    assetId,
    position: { x: viewportCenter.x, y: viewportCenter.y },
    rotation: 0,
    scale: AUTO_SCALE_CELLS,
    tint: '#ffffff',
    groupId: undefined,
    properties: {},
  };

  return obj;
}
```

**Note:** `layerId` is left empty — the caller assigns it from `useStore.getState().ui.activeLayerId` immediately before creating the command.

### 2.2 — Unit tests for `importImageFile`

File: `src/canvas/importImage.test.ts`

```typescript
// These tests run in a browser (Vitest browser mode via Playwright)
// because they use createImageBitmap, OffscreenCanvas, FileReader

describe('importImageFile', () => {
  it('rejects unsupported MIME types with an error', async () => {
    const file = new File(['data'], 'test.gif', { type: 'image/gif' });
    await expect(importImageFile(file, { x: 0, y: 0 })).rejects.toThrow('Unsupported');
  });

  it('returns a PlacedObject with objectType image and scale 5', async () => {
    // Create a tiny 1×1 PNG using canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    const file = new File([blob], 'test.png', { type: 'image/png' });
    const obj = await importImageFile(file, { x: 10, y: 20 });
    expect(obj.objectType).toBe('image');
    expect(obj.scale).toBe(5);
    expect(obj.position).toEqual({ x: 10, y: 20 });
    expect(obj.assetId).toBeTruthy();
  });
});
```

- [x] Run `pnpm test` — browser tests must pass

**Commit:** `feat(canvas): add importImageFile pipeline (validate, resize, base64, PIXI.Assets register)`

---

## Sub-task 3 — `PlaceAssetCommand` and `PlaceImageCommand`

**Goal:** Two undo-able commands in `src/store/commands.ts` for placing objects.

### 3.1 — Add `PlaceObjectCommand` to `src/store/commands.ts`

Both asset placement and image import share the same underlying command. Use a single `PlaceObjectCommand`:

- [x] Open `src/store/commands.ts`
- [x] Add to the bottom of the file:

```typescript
/**
 * Command for placing a new object on an images layer.
 * Used by both asset placement (from library) and image import.
 */
export class PlaceObjectCommand implements Command {
  readonly label: string;
  private layerId: string;
  private obj: PlacedObject;

  constructor(label: string, layerId: string, obj: PlacedObject) {
    this.label = label;
    this.layerId = layerId;
    this.obj = obj;
  }

  execute(): void {
    const store = useStore.getState();
    store.addPlacedObject(this.layerId, { ...this.obj, layerId: this.layerId });
    store.trackRecentUse(this.obj.assetId ?? this.obj.id);
  }

  undo(): void {
    useStore.getState().removePlacedObject(this.layerId, this.obj.id);
  }
}
```

- [x] Add the `PlacedObject` import at the top: `import type { Command, DungeonStyle, PlacedObject } from './types';`
- [x] Run `pnpm typecheck`

### 3.2 — Unit tests for `PlaceObjectCommand`

File: `src/store/commands.test.ts` (create if absent, or add to existing)

```typescript
describe('PlaceObjectCommand', () => {
  it('execute adds object to images layer', () => {
    // Setup: create an ImagesLayer in the store
    // Execute command
    // Assert: layer.objects.length === 1
  });

  it('undo removes object from images layer', () => {
    // Execute then undo
    // Assert: layer.objects.length === 0
  });

  it('execute calls trackRecentUse with assetId', () => {
    // Spy on store.trackRecentUse
    // Execute command
    // Assert spy called with correct assetId
  });
});
```

- [x] Run `pnpm test`

**Commit:** `feat(commands): add PlaceObjectCommand with undo support`

---

## Sub-task 4 — Asset Placement Tool State Machine

**Goal:** Implement `AssetPlacementTool` — a new `DrawingTool` that shows a 50%-opacity preview sprite snapped to cell boundaries and places objects via `PlaceObjectCommand`.

### 4.1 — Create `src/engine/tools/AssetPlacementTool.ts`

- [x] Create the file
- [x] Import from PixiJS: `Sprite, Assets, Container` from `'pixi.js'`
- [x] Import from project:

```typescript
import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { PlaceObjectCommand } from '@/store/commands';
import { generateId } from '@/canvas/importImage'; // or inline a helper
import { toast } from 'sonner';
```

- [x] Define the state machine type:

```typescript
type PlacementState = 'IDLE' | 'PREVIEWING';
```

- [x] Implement the class:

```typescript
export class AssetPlacementTool implements DrawingTool {
  readonly type = 'assetPlacement' as const;

  private state: PlacementState = 'IDLE';
  private previewSprite: Sprite | null = null;
  private selectedAssetId: string | null = null;
  private worldContainer: Container;

  constructor(worldContainer: Container) {
    this.worldContainer = worldContainer;
  }

  /**
   * Called by the asset browser when the user clicks an asset.
   * Activates placement mode with the given asset.
   */
  activateForAsset(assetId: string): void {
    this.selectedAssetId = assetId;
    this.state = 'PREVIEWING';
    this.createPreviewSprite(assetId);
  }

  onPointerDown(point: Point, _event: PointerEvent): void {
    if (this.state !== 'PREVIEWING' || !this.selectedAssetId) return;
    this.placeAsset(point);
  }

  onPointerMove(point: Point, _event: PointerEvent): void {
    if (this.state !== 'PREVIEWING' || !this.previewSprite) return;
    const snapped = snapToCell(point);
    this.previewSprite.position.set(snapped.x, snapped.y);
  }

  onPointerUp(_point: Point, _event: PointerEvent): void {
    // No-op: placement happens on pointerdown
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    }
  }

  getPreview(): PreviewShape | null {
    // Preview is a PixiJS sprite, not a PreviewShape — return null
    return null;
  }

  cancel(): void {
    this.deactivate();
    // Return to select tool
    useStore.getState().setActiveTool('select');
  }

  isActive(): boolean {
    return this.state !== 'IDLE';
  }

  private placeAsset(point: Point): void {
    const store = useStore.getState();
    const layerId = store.ui.activeLayerId;
    const layer = store.layers.find((l) => l.id === layerId);

    if (!layer || layer.type !== 'images') {
      toast.error('Switch to an images layer to place assets');
      return;
    }

    const snapped = snapToCell(point);
    const obj = {
      id: generateId(),
      layerId,
      objectType: 'image' as const,
      assetId: this.selectedAssetId!,
      position: snapped,
      rotation: 0,
      scale: this.computeScaleFromAsset(this.selectedAssetId!),
      tint: '#ffffff',
      groupId: undefined,
      properties: {},
    };

    const cmd = new PlaceObjectCommand('Place asset', layerId, obj);
    undoManager.execute(cmd);

    // Check continuous placement setting
    if (!store.tools.settings.continuousPlacement) {
      this.cancel();
    }
    // If continuousPlacement is true: stay in PREVIEWING state with same asset
  }

  private computeScaleFromAsset(assetId: string): number {
    // Derive cell footprint from PIXI.Assets texture dimensions
    const texture = Assets.get(assetId);
    if (!texture) return 1;
    // cellWidth = spriteWidth / 256 (the export-resolution standard)
    return texture.width / 256;
  }

  private createPreviewSprite(assetId: string): void {
    this.destroyPreviewSprite();
    const texture = Assets.get(assetId);
    if (!texture) return;

    const sprite = new Sprite(texture);
    sprite.alpha = 0.5;
    sprite.anchor.set(0.5);
    // Scale to cell footprint in world units
    // sprite width in world = cellWidth = texture.width / 256
    // but PixiJS world unit = 1 cell → sprite.scale = 1/(256) world/px cancels out
    // Actually: 1 px in world = 1/256 cells, sprite has texture.width px
    // sprite.scale.set(1/256) makes 1px = 1/256 world units, so full sprite = cellWidth cells ✓
    sprite.scale.set(1 / 256);
    this.worldContainer.addChild(sprite);
    this.previewSprite = sprite;
  }

  private destroyPreviewSprite(): void {
    if (this.previewSprite) {
      this.worldContainer.removeChild(this.previewSprite);
      this.previewSprite.destroy({ texture: false });
      this.previewSprite = null;
    }
  }

  private deactivate(): void {
    this.state = 'IDLE';
    this.selectedAssetId = null;
    this.destroyPreviewSprite();
  }
}

/** Snap a world-space point to the nearest full grid cell boundary. */
function snapToCell(point: Point): Point {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}
```

**Note on PixiJS sprite scaling:** In this engine `1 world unit = 1 grid cell`. A texture that is `W` pixels wide at 256px/cell = `W/256` grid cells. PixiJS Sprite renders at pixel-native size by default. So `sprite.scale.set(1/256)` maps each texture pixel to `1/256` of a world unit, making the full sprite span `W/256` world units (= `W/256` grid cells). Verify this is correct by checking how other sprites render in the engine before committing.

- [x] Run `pnpm typecheck`

### 4.2 — Register `AssetPlacementTool` in `registerTools.ts`

- [x] Open `src/engine/tools/registerTools.ts`
- [x] Import `AssetPlacementTool`
- [x] Add registration:

```typescript
const assetPlacementTool = new AssetPlacementTool(worldContainer);
manager.registerTool(assetPlacementTool);
```

- [x] Export a module-level reference so the asset browser can call `activateForAsset`:

```typescript
let _assetPlacementToolRef: AssetPlacementTool | null = null;

export function getAssetPlacementTool(): AssetPlacementTool | null {
  return _assetPlacementToolRef;
}
```

Set `_assetPlacementToolRef = assetPlacementTool` after creation.

- [x] Run `pnpm typecheck`

### 4.3 — Update `ToolManager` to not require Clipper for `assetPlacement`

- [x] Open `src/engine/tools/ToolManager.ts`
- [x] `CLIPPER_TOOLS` set does NOT include `'assetPlacement'` — verify this is already handled (the set only lists `rectangle`, `polygon`, `regularPolygon`, `path`, `wall`). Asset placement does not need Clipper.
- [x] No change needed if `CLIPPER_TOOLS` is an allowlist — confirm and document.

### 4.4 — Vitest unit tests for `AssetPlacementTool`

File: `src/engine/tools/AssetPlacementTool.test.ts`

These are unit tests that mock PIXI.Assets and the store:

```typescript
describe('AssetPlacementTool', () => {
  it('starts in IDLE state', () => {
    const tool = new AssetPlacementTool(mockContainer);
    expect(tool.isActive()).toBe(false);
  });

  it('becomes active after activateForAsset', () => {
    // mock Assets.get to return a fake texture
    // call activateForAsset('asset-id')
    expect(tool.isActive()).toBe(true);
  });

  it('cancel() returns to IDLE and sets activeTool to select', () => {
    // activateForAsset, then cancel()
    expect(tool.isActive()).toBe(false);
    expect(useStore.getState().tools.activeTool).toBe('select');
  });

  it('placeAsset shows toast error if active layer is not images', () => {
    // Set activeLayerId to a dungeon layer
    // Call onPointerDown
    // Assert toast.error was called
  });

  it('exits placement after one click when continuousPlacement is false', () => {
    // continuousPlacement = false
    // onPointerDown on an images layer
    // expect tool.isActive() === false
  });

  it('stays in PREVIEWING after click when continuousPlacement is true', () => {
    // continuousPlacement = true
    // onPointerDown on an images layer
    // expect tool.isActive() === true
  });

  it('snapToCell rounds to nearest integer', () => {
    // Tested indirectly via preview sprite position
    // Or extract snapToCell and test directly if exported
  });
});
```

- [x] Run `pnpm test`

**Commit:** `feat(tools): add AssetPlacementTool state machine with grid-snap preview and PlaceObjectCommand`

---

## Sub-task 5 — Image Import Entry Points

**Goal:** Wire three entry points that all call `importImageFile(file, viewportCenter)` and then dispatch a `PlaceObjectCommand`.

Create a shared handler function first, then attach it to each entry point.

### 5.1 — Shared handler `handleImageImport`

Add this to `src/canvas/importImage.ts` (the same file from Sub-task 2):

```typescript
import { undoManager } from '@/store/undoManager';
import { PlaceObjectCommand } from '@/store/commands';
import type { RenderEngine } from '@/engine/RenderEngine';

/**
 * Shared handler called by all three import entry points.
 * Validates, imports, places at viewport center via undo-able command.
 */
export async function handleImageImport(
  file: File,
  engine: RenderEngine,
): Promise<void> {
  const store = useStore.getState();
  const layerId = store.ui.activeLayerId;
  const layer = store.layers.find((l) => l.id === layerId);

  if (!layer || layer.type !== 'images') {
    toast.error('Switch to an images layer to import images');
    return;
  }

  try {
    // Get viewport center in world coordinates
    const vp = engine.viewport();
    const center = engine.screenToWorld(vp.width / 2, vp.height / 2);

    const obj = await importImageFile(file, center);
    obj.layerId = layerId;

    const cmd = new PlaceObjectCommand('Import image', layerId, obj);
    undoManager.execute(cmd);

    toast.success(`Image imported (${obj.id.slice(0, 6)}…)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    toast.error(`Import failed: ${message}`);
  }
}
```

### 5.2 — File picker entry point

The file picker is triggered by a button in the toolbar or an "Import Image" menu item. This is a React component responsibility but the import logic lives here.

- [x] Create `src/canvas/useImageFilePicker.ts`:

```typescript
import { useCallback, useRef } from 'react';
import type { RenderEngine } from '@/engine/RenderEngine';
import { handleImageImport } from './importImage';

export function useImageFilePicker(engine: RenderEngine | null) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const open = useCallback(() => {
    if (!engine) return;
    let input = inputRef.current;
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp';
      inputRef.current = input;
    }
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) await handleImageImport(file, engine);
      input!.value = ''; // Reset so same file can be re-picked
    };
    input.click();
  }, [engine]);

  return open;
}
```

- [x] The `open` function is called by the toolbar "Import Image" button (wired in UI Dev's asset browser panel — coordinate with UI Dev to expose this hook)

### 5.3 — Drag-and-drop on canvas entry point

- [x] Open `src/canvas/useCanvasInput.ts`
- [x] Inside the `useEffect`, after the existing `auxclick` listener, add drag-and-drop listeners on `canvasEl`:

```typescript
// ─── Image drag-and-drop ──────────────────────────────
const onDragOver = (e: DragEvent) => {
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
};

const onDrop = async (e: DragEvent) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) {
    await handleImageImport(file, engine);
  }
};

canvasEl.addEventListener('dragover', onDragOver);
canvasEl.addEventListener('drop', onDrop);
```

- [x] Add to cleanup in the return function:

```typescript
canvasEl.removeEventListener('dragover', onDragOver);
canvasEl.removeEventListener('drop', onDrop);
```

- [x] Import `handleImageImport` at the top of `useCanvasInput.ts`
- [x] Run `pnpm typecheck`

### 5.4 — Clipboard paste entry point

- [x] Open `src/canvas/useCanvasInput.ts`
- [x] Add a `paste` listener on `document` (not canvas — paste events fire on document):

```typescript
// ─── Clipboard paste ──────────────────────────────────
const onPaste = async (e: ClipboardEvent) => {
  // Don't intercept pastes into text inputs
  if (isTextInput(document.activeElement)) return;

  const item = Array.from(e.clipboardData?.items ?? [])
    .find((i) => i.type.startsWith('image/'));
  if (!item) return;

  e.preventDefault();
  const file = item.getAsFile();
  if (file) {
    await handleImageImport(file, engine);
  }
};

document.addEventListener('paste', onPaste);
```

- [x] Add to cleanup: `document.removeEventListener('paste', onPaste);`
- [x] Run `pnpm typecheck`

### 5.5 — Integration smoke test

Manual verification steps (also covered by E2E in Sub-task 8):

- [x] Start dev server: `pnpm dev`
- [x] Add an Images layer in the layer panel
- [x] Select the Images layer as active
- [x] Try dragging a PNG file from Finder onto the canvas — verify it appears at viewport center
- [x] Verify Ctrl+Z undoes the placement
- [x] Try Ctrl+V with an image in the clipboard — verify placement
- [x] Switch to a Dungeon layer and try drag-drop — verify toast error appears

**Commit:** `feat(canvas): wire image import via drag-drop, clipboard paste, and file picker`

---

## Sub-task 6 — Continuous Placement Mode

**Goal:** When `ToolSettings.continuousPlacement` is true, the `AssetPlacementTool` stays active after each placement. Add a toggle to the ToolPropsBar.

### 6.1 — Verify store field

- [x] Open `src/store/types.ts` — `ToolSettings.continuousPlacement: boolean` already exists
- [x] Open `src/store/store.ts` — verify initial value is `false` in the initial state
- [x] `updateToolSettings({ continuousPlacement: true/false })` action already exists in `src/store/slices/tools.ts`

No store changes needed.

### 6.2 — Wire continuous placement into `AssetPlacementTool`

The tool already reads `store.tools.settings.continuousPlacement` in `placeAsset()` (implemented in Sub-task 4). Verify this logic:

```typescript
if (!store.tools.settings.continuousPlacement) {
  this.cancel(); // exits and returns to select tool
}
// If continuousPlacement: remain in PREVIEWING, same sprite follows cursor
```

- [x] Confirm the logic is in place from Sub-task 4

### 6.3 — ToolPropsBar toggle

The ToolPropsBar is owned by UI Dev. Coordinate with UI Dev to expose the toggle. The Tools Dev contribution is:

- [x] Export a React hook `useContinuousPlacement()` from `src/canvas/importImage.ts` or a new file `src/hooks/useContinuousPlacement.ts`:

```typescript
import { useStore } from '@/store/store';

export function useContinuousPlacement() {
  const value = useStore((s) => s.tools.settings.continuousPlacement);
  const toggle = useStore((s) => s.updateToolSettings);
  return {
    continuousPlacement: value,
    setContinuousPlacement: (v: boolean) => toggle({ continuousPlacement: v }),
  };
}
```

- [x] UI Dev will consume this hook in the ToolPropsBar checkbox
- [x] Run `pnpm typecheck`

### 6.4 — Unit test: continuous placement

Add to `src/engine/tools/AssetPlacementTool.test.ts`:

```typescript
describe('continuousPlacement', () => {
  it('remains active after placement when continuousPlacement=true', () => {
    useStore.getState().updateToolSettings({ continuousPlacement: true });
    // activate, pointerDown on images layer
    expect(tool.isActive()).toBe(true);
  });

  it('deactivates after placement when continuousPlacement=false', () => {
    useStore.getState().updateToolSettings({ continuousPlacement: false });
    // activate, pointerDown on images layer
    expect(tool.isActive()).toBe(false);
  });
});
```

- [x] Run `pnpm test`

**Commit:** `feat(tools): continuous placement mode toggle`

---

## Sub-task 7 — Recently Used Tracking + Center-to-View Placement

**Goal:** Every `PlaceObjectCommand.execute()` calls `trackRecentUse`. Add a "Place at view center" convenience function for the asset browser.

### 7.1 — Verify `trackRecentUse` is called in `PlaceObjectCommand`

- [x] Open `src/store/commands.ts` — confirm `PlaceObjectCommand.execute()` calls `store.trackRecentUse(this.obj.assetId ?? this.obj.id)`
- [x] Verify store's `trackRecentUse` caps at 10 and deduplicates (implemented in `src/store/slices/assets.ts`)

### 7.2 — "Place at view center" function

This is exposed as a function the asset browser button calls. It does not require a new tool state — it directly places the asset at viewport center.

- [x] Add to `src/canvas/importImage.ts` (or a new `src/canvas/placeAtCenter.ts`):

```typescript
import type { RenderEngine } from '@/engine/RenderEngine';

/**
 * Immediately place an asset at the viewport center without entering
 * placement mode. Creates a PlaceObjectCommand and executes via undoManager.
 */
export function placeAssetAtViewCenter(
  assetId: string,
  engine: RenderEngine,
): void {
  const store = useStore.getState();
  const layerId = store.ui.activeLayerId;
  const layer = store.layers.find((l) => l.id === layerId);

  if (!layer || layer.type !== 'images') {
    toast.error('Switch to an images layer to place assets');
    return;
  }

  const vp = engine.viewport();
  const center = engine.screenToWorld(vp.width / 2, vp.height / 2);
  const snapped = { x: Math.round(center.x), y: Math.round(center.y) };

  const texture = Assets.get(assetId);
  const scale = texture ? texture.width / 256 : 1;

  const obj: PlacedObject = {
    id: crypto.randomUUID(),
    layerId,
    objectType: 'image',
    assetId,
    position: snapped,
    rotation: 0,
    scale,
    tint: '#ffffff',
    groupId: undefined,
    properties: {},
  };

  const cmd = new PlaceObjectCommand('Place at center', layerId, obj);
  undoManager.execute(cmd);
}
```

- [x] Run `pnpm typecheck`

### 7.3 — Unit test: recentlyUsed after placement

Add to store tests:

```typescript
describe('PlaceObjectCommand + trackRecentUse', () => {
  it('execute() adds assetId to recentlyUsed', () => {
    // Create PlaceObjectCommand with assetId = 'test-asset'
    // undoManager.execute(cmd)
    // expect(store.getState().assets.recentlyUsed).toContain('test-asset')
  });

  it('undo() does NOT remove assetId from recentlyUsed', () => {
    // Execute then undo — recentlyUsed should still contain the assetId
    // (undo removes the placed object, not the usage record)
  });
});
```

- [x] Run `pnpm test`

**Commit:** `feat(canvas): add placeAssetAtViewCenter helper + verify trackRecentUse wiring`

---

## Sub-task 8 — PlacedObject → PixiJS Sprite Sync

**Goal:** When a `PlacedObject` is added to an `ImagesLayer`, a corresponding `Sprite` must appear in the PixiJS scene. This is primarily UI Dev's work (they own `subscribeToStore` additions and `ImagesLayer` rendering), but Tools Dev must coordinate and verify the round-trip works.

### 8.1 — Verify `subscribeToStore` handles `ImagesLayer.objects` changes

- [x] Open `src/engine/subscribeToStore.ts`
- [x] Check if there is a subscription watching `imagesLayer.objects` changes → creating/destroying Sprites
- [x] If UI Dev has not yet added this: **do not implement it yourself** — file a coordination note for UI Dev
- [x] If UI Dev has added it: smoke-test by placing an asset and verifying the sprite appears

The subscription pattern to look for in `subscribeToStore.ts`:

```typescript
// Should exist after UI Dev's work:
const unsubObjects = useStore.subscribe(
  (state) => state.layers.filter((l) => l.type === 'images').map((l) => ({ id: l.id, objects: l.objects })),
  (imagesLayers) => {
    for (const { id, objects } of imagesLayers) {
      syncPlacedObjectSprites(id, objects, engine);
    }
  },
);
```

### 8.2 — Sprite scale formula verification

When the `subscribeToStore` subscription creates a Sprite, the scale formula must be:

```
sprite.scale.set(1 / 256)  // makes 1 texture pixel = 1/256 world units
```

And the `PlacedObject.scale` field represents cell width. If the design changes so that `PlacedObject.scale` is the PixiJS scale factor directly, adjust accordingly. Confirm with UI Dev which convention is used.

- [x] Coordinate with UI Dev to agree on the `PlacedObject.scale` semantic before finalizing

**Commit:** `(coordination — no code change by Tools Dev; verified round-trip with UI Dev)`

---

## Sub-task 9 — End-to-End Tests

**Goal:** Playwright E2E tests covering asset placement and image import flows.

### 9.1 — Create `tests/e2e/17-image-import.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { launchApp, addImagesLayer, selectTool } from './helpers';
import path from 'path';

test.describe('Image Import', () => {
  test.beforeEach(async ({ page }) => {
    await launchApp(page);
    await addImagesLayer(page);
  });

  test('file picker import places image at viewport center', async ({ page }) => {
    // Click "Import Image" button (toolbar or asset panel)
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="import-image-btn"]'),
    ]);
    await fileChooser.setFiles(path.join(__dirname, 'fixtures/test-1x1.png'));
    // Verify a sprite appeared (canvas pixel comparison or DOM assertion)
    await expect(page.locator('[data-testid="layer-panel"]')).toBeVisible();
    // Verify undo works
    await page.keyboard.press('Control+z');
  });

  test('drag-and-drop on canvas imports image', async ({ page }) => {
    const canvas = page.locator('canvas');
    const file = {
      name: 'test-1x1.png',
      mimeType: 'image/png',
      buffer: Buffer.from(/* 1×1 transparent PNG bytes */ '...', 'base64'),
    };
    await canvas.dispatchEvent('dragover', { dataTransfer: createDataTransfer(file) });
    await canvas.dispatchEvent('drop', { dataTransfer: createDataTransfer(file) });
    // Verify toast or canvas change
  });

  test('wrong layer shows error toast', async ({ page }) => {
    // Switch to a dungeon layer (not images)
    await page.click('[data-testid="layer-dungeon"]');
    // Try drag-drop
    // Verify toast with error message
    await expect(page.locator('.sonner-toast')).toContainText('images layer');
  });
});
```

**Note:** The `createDataTransfer` helper must simulate a DataTransfer with files — Playwright supports this via `page.evaluate` + `DataTransfer` API. Use a 1×1 transparent PNG fixture stored in `tests/e2e/fixtures/test-1x1.png`.

- [x] Create `tests/e2e/fixtures/test-1x1.png` — a minimal 1×1 transparent PNG (67 bytes, standard format)
- [x] Create `tests/e2e/20-image-import.spec.ts` (and `21-asset-placement.spec.ts`)

### 9.2 — Create `tests/e2e/18-asset-placement.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { launchApp, addImagesLayer } from './helpers';

test.describe('Asset Placement Tool', () => {
  test.beforeEach(async ({ page }) => {
    await launchApp(page);
    await addImagesLayer(page);
  });

  test('clicking asset in browser activates placement mode', async ({ page }) => {
    // Open asset browser panel
    await page.click('[data-testid="panel-tab-assets"]');
    // Click first asset thumbnail
    await page.click('[data-testid="asset-thumbnail"]:first-child');
    // Verify cursor changes (optional: check active tool in store via evaluate)
    const activeTool = await page.evaluate(() =>
      (window as any).__mapBuilderStore?.getState().tools.activeTool
    );
    expect(activeTool).toBe('assetPlacement');
  });

  test('Escape exits placement mode and returns to select tool', async ({ page }) => {
    // Activate placement mode
    await page.click('[data-testid="panel-tab-assets"]');
    await page.click('[data-testid="asset-thumbnail"]:first-child');
    // Press Escape
    await page.keyboard.press('Escape');
    const activeTool = await page.evaluate(() =>
      (window as any).__mapBuilderStore?.getState().tools.activeTool
    );
    expect(activeTool).toBe('select');
  });

  test('placement on dungeon layer shows toast error', async ({ page }) => {
    // Ensure active layer is dungeon
    await page.click('[data-testid="panel-tab-assets"]');
    await page.click('[data-testid="asset-thumbnail"]:first-child');
    // Click on canvas (dungeon layer active)
    await page.click('canvas', { position: { x: 400, y: 300 } });
    await expect(page.locator('.sonner-toast')).toContainText('images layer');
  });

  test('continuous placement: stays active after placement', async ({ page }) => {
    await addImagesLayer(page);
    // Enable continuous placement toggle
    await page.click('[data-testid="continuous-placement-toggle"]');
    // Activate asset placement
    await page.click('[data-testid="panel-tab-assets"]');
    await page.click('[data-testid="asset-thumbnail"]:first-child');
    // Place once
    await page.click('canvas', { position: { x: 400, y: 300 } });
    // Tool should still be active
    const activeTool = await page.evaluate(() =>
      (window as any).__mapBuilderStore?.getState().tools.activeTool
    );
    expect(activeTool).toBe('assetPlacement');
  });

  test('undo removes placed asset', async ({ page }) => {
    await addImagesLayer(page);
    await page.click('[data-testid="panel-tab-assets"]');
    await page.click('[data-testid="asset-thumbnail"]:first-child');
    await page.click('canvas', { position: { x: 400, y: 300 } });
    // Verify object count = 1
    let count = await page.evaluate(() => {
      const s = (window as any).__mapBuilderStore?.getState();
      const layer = s?.layers.find((l: any) => l.type === 'images');
      return layer?.objects.length ?? 0;
    });
    expect(count).toBe(1);
    // Undo
    await page.keyboard.press('Control+z');
    count = await page.evaluate(() => {
      const s = (window as any).__mapBuilderStore?.getState();
      const layer = s?.layers.find((l: any) => l.type === 'images');
      return layer?.objects.length ?? 0;
    });
    expect(count).toBe(0);
  });
});
```

### 9.3 — Run the E2E tests

- [x] Start dev server: `pnpm dev`
- [x] Run: `pnpm exec playwright test tests/e2e/20-image-import.spec.ts tests/e2e/21-asset-placement.spec.ts --reporter=list`
- [x] Fix failures until all tests pass

**Commit:** `test(e2e): add image import and asset placement E2E tests`

---

## Sub-task 10 — Final Integration + `pnpm check`

**Goal:** All checks pass before declaring the track complete.

### 10.1 — Full check run

- [x] `pnpm typecheck` — zero TypeScript errors
- [x] `pnpm lint` — zero ESLint warnings (using `--max-warnings 0`)
- [x] `pnpm test` — all unit tests pass
- [ ] `pnpm exec playwright test --reporter=list` — E2E suite 90+ pass (regressions would be a blocker)

### 10.2 — Manual integration checklist

- [x] File picker: PNG import places object, Ctrl+Z undoes
- [x] File picker: JPEG import works
- [ ] File picker: SVG import works
- [x] File picker: GIF rejected with toast error
- [x] Drag-and-drop: PNG onto canvas places object at drop position (mapped to viewport center)
- [x] Clipboard paste: Ctrl+V with image in clipboard works
- [x] Clipboard paste: Ctrl+V in a text input does NOT trigger import
- [ ] Asset placement: click asset in browser, sprite previews at cursor, snaps to grid
- [ ] Asset placement: click to place, verify PixiJS sprite appears in scene
- [ ] Asset placement: Escape exits, returns to select tool
- [ ] Continuous placement: toggle on, place multiple assets, verify tool stays active
- [ ] Continuous placement: toggle off, place one asset, verify return to select
- [x] Wrong layer: all three import paths show correct toast and do NOT place
- [x] RecentlyUsed: after 3 placements, `assets.recentlyUsed` has those assetIds in reverse order
- [ ] "Place at view center": button in asset browser places at correct world position

### 10.3 — Coordinate with UI Dev

Before final commit, verify:

- [ ] UI Dev has wired `setActiveTool('assetPlacement')` in the asset browser thumbnail click handler
- [ ] UI Dev has wired the `useImageFilePicker` hook to the import button
- [ ] UI Dev has added the continuous placement checkbox to the ToolPropsBar
- [ ] UI Dev's `subscribeToStore` subscription renders Sprites for all `ImagesLayer.objects`
- [ ] The `data-testid` attributes in E2E tests match what UI Dev actually renders

**Final commit:** `feat(month1-tools): complete asset placement + image import track`

---

## File Map

Summary of all files created or modified by this track:

| File | Status | Description |
|------|--------|-------------|
| `src/store/types.ts` | MODIFY | Add `'assetPlacement'` to `ToolType`; confirm `PlacedObject.assetId` present |
| `src/store/slices/layers.ts` | MODIFY (if needed) | Add `addPlacedObject`, `removePlacedObject` actions |
| `src/store/slices/assets.ts` | MODIFY (if needed) | Add `addCustomImage`, `customImages` state |
| `src/store/commands.ts` | MODIFY | Add `PlaceObjectCommand` |
| `src/engine/tools/AssetPlacementTool.ts` | CREATE | Full tool state machine |
| `src/engine/tools/registerTools.ts` | MODIFY | Register `AssetPlacementTool`, export `getAssetPlacementTool()` |
| `src/canvas/importImage.ts` | CREATE | `importImageFile`, `handleImageImport`, `placeAssetAtViewCenter` |
| `src/canvas/useImageFilePicker.ts` | CREATE | React hook for file picker |
| `src/canvas/useCanvasInput.ts` | MODIFY | Add `dragover`, `drop`, `paste` listeners |
| `src/hooks/useContinuousPlacement.ts` | CREATE | Hook for ToolPropsBar checkbox |
| `src/store/slices/assets.test.ts` | CREATE | Store action unit tests |
| `src/store/commands.test.ts` | MODIFY | `PlaceObjectCommand` unit tests |
| `src/engine/tools/AssetPlacementTool.test.ts` | CREATE | Tool unit tests |
| `tests/e2e/17-image-import.spec.ts` | CREATE | Playwright import flow tests |
| `tests/e2e/18-asset-placement.spec.ts` | CREATE | Playwright placement flow tests |
| `tests/e2e/fixtures/test-1x1.png` | CREATE | Minimal PNG fixture |

**Files explicitly NOT modified by this track:**
- `src/engine/subscribeToStore.ts` — UI Dev adds PlacedObject → Sprite sync
- `src/components/` — UI Dev owns all component files
- `src/assets/manifest.json` — Systems Dev creates and owns
- `src/store/slices/tools.ts` — no changes needed (`continuousPlacement` already present)

---

## Coordination Checkpoints

| Checkpoint | When | With whom | What to align |
|-----------|------|-----------|---------------|
| Store types finalized | Before Sub-task 1 | Systems Dev | Confirm `PlacedObject` fields, `addCustomImage` action |
| Sprite rendering live | Before Sub-task 9 | UI Dev | Confirm `subscribeToStore` subscription in place for visual E2E tests |
| ToolPropsBar toggle | Before Sub-task 6 | UI Dev | Confirm `data-testid="continuous-placement-toggle"` exists |
| Asset browser wiring | Before Sub-task 9 | UI Dev | Confirm asset thumbnail click calls `setActiveTool('assetPlacement')` and `activateForAsset()` |
| `data-testid` contract | Before Sub-task 9 | UI Dev | Agree on all testid strings used in E2E specs |

---

## Known Edge Cases and Pitfalls

**1. PixiJS Sprite scale formula**
The relationship between world units, grid cells, and texture pixels is critical. `1 world unit = 1 grid cell = 256px at export`. A sprite that is `W` pixels wide should occupy `W/256` grid cells in the scene. Therefore:
- `sprite.scale.set(1/256)` → each texture pixel maps to `1/256` world units → full sprite = `W/256` world units = `W/256` grid cells
- Verify by checking the grid renderer: `1 grid cell` should visually match `1 world unit` at zoom=1

**2. `OffscreenCanvas` in Safari**
Safari supports `OffscreenCanvas` only from Safari 16.4+. For older Safari, the resize path will throw. Add a try/catch around the resize logic and fall back to a `<canvas>` element approach:

```typescript
async function resizeImageToMax(base64: string, maxPx: number): Promise<string> {
  try {
    // OffscreenCanvas path ...
  } catch {
    // Fallback: create an <img> + <canvas> in-document
    return resizeViaHTMLCanvas(base64, maxPx);
  }
}
```

**3. `Assets.get()` returns `null` if asset not loaded**
`PIXI.Assets.get(assetId)` returns `undefined` if the asset hasn't been loaded yet. The `createPreviewSprite` and `computeScaleFromAsset` methods must handle this gracefully (fall back to scale=1, show no preview until loaded). Use `Assets.load()` before calling `get()`:

```typescript
const texture = Assets.get(assetId) ?? await Assets.load(assetId);
```

**4. Preview sprite in worldContainer vs overlayContainer**
The preview sprite must be in `worldContainer` (camera-transformed) so it follows the cursor in world space. Do NOT add it to `overlayContainer` (screen-space HUD). Verify the `worldContainer` reference passed to `AssetPlacementTool` is the correct container.

**5. Paste event conflicts with existing Ctrl+V in SelectTool**
`SelectTool.onKeyDown` already handles `Ctrl+V` for pasting floor geometry. The new `document.paste` event listener in `useCanvasInput.ts` will fire for all pastes, including when the select tool is active. Distinguish: if clipboard item is an image (starts with `image/`), handle as image import. SelectTool's `Ctrl+V` reads `ClipboardEvent` via `useStore.getState().selection.clipboard` (a geometry clipboard, not an image). The two paths are mutually exclusive — the paste handler checks `item.type.startsWith('image/')` before acting.

**6. `generateId` must be exported for reuse**
The `AssetPlacementTool` needs `generateId` from `importImage.ts`. Export it explicitly:
```typescript
export function generateId(): string { return crypto.randomUUID(); }
```

**7. `RenderEngine.viewport()` signature**
Check `src/engine/RenderEngine.ts` for the actual `viewport()` return type. It likely returns `{ x, y, width, height, zoom }`. Use `vp.width / 2` and `vp.height / 2` as screen-space coordinates, then call `engine.screenToWorld(...)` to convert to world space.

**8. `canvasEl.addEventListener` for drop events**
The `canvasEl` is a `<canvas>` element. It does not receive `drop` events by default unless `dragover` is also handled and `e.preventDefault()` is called in `dragover`. The implementation in Sub-task 5.3 does this correctly — do not omit the `dragover` handler.

**9. `isTextInput` check for paste**
The existing `isTextInput` helper in `useCanvasInput.ts` checks for `INPUT`, `TEXTAREA`, `SELECT`, and `isContentEditable`. The paste listener uses this to avoid intercepting pastes into the layer name field or other inputs. Reuse the existing helper directly.

**10. Undo/redo after image import**
After undo removes a placed image object, the PixiJS Sprite must be removed from the scene by `subscribeToStore`. This works automatically if UI Dev's subscription fires on `ImagesLayer.objects` changes. Do not add manual sprite removal in `PlaceObjectCommand.undo()` — the subscription handles it.
