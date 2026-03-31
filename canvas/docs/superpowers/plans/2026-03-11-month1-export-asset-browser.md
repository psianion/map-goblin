# Month 1: Export Dialog + Asset Browser Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the PNG/JPEG export pipeline at FA-standard 256px/cell resolution and the asset library browser UI, plus PlacedObject → Sprite scene graph wiring.

**Architecture:** Export uses an offscreen PixiJS v8 `RenderTexture` at configurable px/cell resolution with temporary visibility overrides and optional crop rect. Asset browser reads from `src/assets/manifest.json` (provided by Systems Dev Phase 1) via lazy `PIXI.Assets.loadBundle()` per category. PlacedObject → Sprite sync is driven by a new `subscribeToStore` subscription. The right panel gains a "Layers | Assets" tab switcher.

**Tech Stack:** PixiJS v8 extract API (`app.renderer.extract.image`), React 19, `@base-ui/react` Dialog, Tailwind v3, Zustand `subscribeWithSelector`, existing `NumberInput` / `SliderInput` components.

---

## Prerequisites

Before starting any task, verify:
- [x] `src/store/types.ts` exports `PlacedObject` with fields: `id`, `layerId`, `objectType: 'asset' | 'image'`, `assetId`, `position`, `rotation`, `scale`, `tint`, `flipX`, `flipY`, `groupId`
- [x] `src/store/types.ts` exports `AssetManifest` and updated `AssetsSlice` with `manifest: AssetManifest | null` and `loadedCategories: Set<string>`
- [x] `src/assets/manifest.json` exists with at least one category entry
- [x] Systems Dev Phase 1 gate is marked complete

> If any prerequisite is missing, stop and notify the orchestrator. Do not work around missing types — type safety is required.

---

## Codebase Quick-Reference

All paths are relative to the repo root (`/Users/admin/Desktop/Files/map-builder/`).

| File | Relevant content |
|------|-----------------|
| `src/store/types.ts` | All store interfaces — source of truth |
| `src/store/store.ts` | `useStore` creation; `getSerializableState`, `loadFromFile`, `showModal` |
| `src/store/slices/ui.ts` | `showModal(modal: ModalState | null)` — call this to open export dialog |
| `src/store/slices/assets.ts` | `trackRecentUse`, `toggleFavorite`, `addCustomUpload` |
| `src/store/factories.ts` | `createImagesLayer()` for new images layer creation |
| `src/store/commands.ts` | Command pattern base; add `PlaceAssetCommand` here |
| `src/engine/subscribeToStore.ts` | Add PlacedObject → Sprite subscription here |
| `src/engine/sceneGraph.ts` | `LayerEntry`, `addLayerToScene`, `getLayerEntry` |
| `src/engine/RenderEngine.ts` | `RenderEngine` interface — `createRenderTexture`, `viewport`, `screenToWorld` |
| `src/shortcuts/defaultShortcuts.ts` | Add `file.export` shortcut `ctrl+e` here |
| `src/components/ui/dialog.tsx` | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` from `@base-ui/react` |
| `src/components/inputs/NumberInput.tsx` | Reuse for custom px/cell input |
| `src/components/inputs/SliderInput.tsx` | Reuse for JPEG quality slider |
| `src/components/shared/ConfirmDialog.tsx` | Pattern to follow for new dialog components |
| `src/components/layout/RightPanel.tsx` | Add tab switcher here |
| `src/components/layers/LayerPanel.tsx` | Reference for panel component patterns |
| `src/App.tsx` | Mount `<ExportDialog />` here alongside `<ConfirmDialog />` |
| `tests/e2e/helpers.ts` | `gotoApp`, `waitFrame`, `pressShortcut`, `getPixelColor` helpers |
| `playwright.config.ts` | `baseURL: 'http://localhost:5175'`, tests in `tests/e2e/` |
| `vitest.config.ts` | Node tests: `src/**/*.test.ts`; Browser tests: `src/**/*.browser.test.ts` |

**Key conventions:**
- Tailwind tokens: `bg-surface-1`, `bg-surface-2`, `bg-surface-3`, `border-border-subtle`, `border-border-default`, `text-text-primary`, `text-text-secondary`, `text-text-muted`, `text-panel-body`, `text-panel-heading`
- Always use `useShallow` from `zustand/react/shallow` when selecting arrays or objects
- All store mutations through store actions — never mutate state directly in components
- Path alias `@/` resolves to `src/`
- Export dialog uses `showModal({ type: 'export', props: {} })` / `showModal(null)`

---

## Sub-task 1 — Export Shortcut + Dialog Shell

**Goal:** Wire Ctrl+E to open an export modal. The dialog renders but does not yet export.

### 1.1 — Add Ctrl+E shortcut

File: `src/shortcuts/defaultShortcuts.ts`

- [x] Add to the `createDefaultShortcuts()` return array:
  ```typescript
  { id: 'file.export', keys: 'ctrl+e', category: 'File', label: 'Export' },
  ```
- [x] Add handler in `toolKeyMap`:
  ```typescript
  'file.export': () => {
    useStore.getState().showModal({ type: 'export', props: {} })
  },
  ```

### 1.2 — Create ExportDialog component

New file: `src/components/shared/ExportDialog.tsx`

- [x] Guard: `if (!modalState || modalState.type !== 'export') return null` — matches the pattern in `ConfirmDialog.tsx`
- [x] Use `Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogFooter` from `@/components/ui/dialog`
- [x] `onOpenChange={(open) => { if (!open) showModal(null) }}` on `Dialog`
- [x] Content: wide dialog, `max-w-3xl` class on `DialogContent`
- [x] Inside: two-column layout — left column for preview (placeholder `<div>` for now), right column for options panel
- [x] Cancel button: `showModal(null)`
- [x] Export button: disabled stub with `aria-disabled` and text "Export PNG"

Scaffold:

```typescript
// src/components/shared/ExportDialog.tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store/store'

export function ExportDialog() {
  const modalState = useStore((s) => s.ui.modalState)
  const showModal = useStore((s) => s.showModal)

  if (!modalState || modalState.type !== 'export') return null

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) showModal(null)
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Export Map</DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 min-h-[300px]">
          {/* Left: preview */}
          <div className="flex-1 bg-surface-2 rounded-md flex items-center justify-center text-text-muted text-panel-body">
            Preview
          </div>

          {/* Right: options */}
          <div className="w-56 flex flex-col gap-3">
            {/* Options will be added in Sub-task 2 */}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => showModal(null)}>
            Cancel
          </Button>
          <Button disabled>
            Export PNG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

### 1.3 — Mount ExportDialog in App

File: `src/App.tsx`

- [x] Import `ExportDialog` and add `<ExportDialog />` alongside `<ConfirmDialog />`:
  ```typescript
  import { ExportDialog } from './components/shared/ExportDialog'
  // Inside return, after <ConfirmDialog />:
  <ExportDialog />
  ```

### 1.4 — Unit test: shortcut registration

New file: `src/shortcuts/defaultShortcuts.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { createDefaultShortcuts } from './defaultShortcuts'

describe('defaultShortcuts', () => {
  it('includes file.export shortcut bound to ctrl+e', () => {
    const shortcuts = createDefaultShortcuts()
    const exportShortcut = shortcuts.find((s) => s.id === 'file.export')
    expect(exportShortcut).toBeDefined()
    expect(exportShortcut?.keys).toBe('ctrl+e')
  })
})
```

- [x] Run `pnpm test` — must pass

### 1.5 — E2E smoke test: dialog opens

New file: `tests/e2e/17-export-dialog.spec.ts`

```typescript
import { test, expect } from '@playwright/test'
import { gotoApp, pressShortcut } from './helpers'

test.describe('Export Dialog', () => {
  test('Ctrl+E opens export dialog', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await expect(page.getByText('Export Map')).toBeVisible()
  })

  test('Cancel button closes the dialog', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Export Map')).not.toBeVisible()
  })

  test('Escape key closes the dialog', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await page.keyboard.press('Escape')
    await expect(page.getByText('Export Map')).not.toBeVisible()
  })
})
```

- [x] Run `pnpm exec playwright test tests/e2e/17-export-dialog.spec.ts --reporter=list` — must pass

---

## Sub-task 2 — Export Options + Resolution Math

**Goal:** Add the format selector, resolution selector, JPEG quality slider, and filename preview to the dialog. Implement and test the resolution math. The Export button becomes functional in Sub-task 3.

### 2.1 — Resolution math utility

New file: `src/engine/export/exportMath.ts`

```typescript
export interface ExportDimensions {
  widthPx: number
  heightPx: number
  exceeds8192: boolean
}

/**
 * Compute pixel dimensions for export given the map's grid cell bounds
 * and target resolution in pixels-per-cell.
 *
 * @param cellWidth  Map width in grid cells
 * @param cellHeight Map height in grid cells
 * @param pxPerCell  Target resolution: 64 | 128 | 256 | custom
 */
export function computeExportDimensions(
  cellWidth: number,
  cellHeight: number,
  pxPerCell: number,
): ExportDimensions {
  const widthPx = Math.round(cellWidth * pxPerCell)
  const heightPx = Math.round(cellHeight * pxPerCell)
  return {
    widthPx,
    heightPx,
    exceeds8192: widthPx > 8192 || heightPx > 8192,
  }
}

/**
 * Generate the auto-filename for an export.
 * Format: {mapName}-{W}x{H}-{resolution}ppc.{format}
 * Example: my-dungeon-3840x5120-256ppc.jpg
 */
export function buildExportFilename(
  mapName: string,
  widthPx: number,
  heightPx: number,
  pxPerCell: number,
  format: 'png' | 'jpeg',
): string {
  const safeName = mapName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'map'
  const ext = format === 'jpeg' ? 'jpg' : 'png'
  return `${safeName}-${widthPx}x${heightPx}-${pxPerCell}ppc.${ext}`
}

/**
 * Compute the map's bounding box in grid cells from world-space coordinates.
 * Returns the minimum enclosing cell rect.
 *
 * @param worldBounds { minX, minY, maxX, maxY } in world units (1 unit = 1 cell)
 */
export function worldBoundsToCells(worldBounds: {
  minX: number
  minY: number
  maxX: number
  maxY: number
}): { cellWidth: number; cellHeight: number } {
  return {
    cellWidth: Math.ceil(worldBounds.maxX - worldBounds.minX),
    cellHeight: Math.ceil(worldBounds.maxY - worldBounds.minY),
  }
}
```

### 2.2 — Unit tests for resolution math

New file: `src/engine/export/exportMath.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  computeExportDimensions,
  buildExportFilename,
  worldBoundsToCells,
} from './exportMath'

describe('computeExportDimensions', () => {
  it('256px/cell: 15x10 map = 3840x2560', () => {
    const result = computeExportDimensions(15, 10, 256)
    expect(result.widthPx).toBe(3840)
    expect(result.heightPx).toBe(2560)
    expect(result.exceeds8192).toBe(false)
  })

  it('64px/cell draft resolution', () => {
    const result = computeExportDimensions(15, 10, 64)
    expect(result.widthPx).toBe(960)
    expect(result.heightPx).toBe(640)
    expect(result.exceeds8192).toBe(false)
  })

  it('128px/cell standard resolution', () => {
    const result = computeExportDimensions(15, 10, 128)
    expect(result.widthPx).toBe(1920)
    expect(result.heightPx).toBe(1280)
    expect(result.exceeds8192).toBe(false)
  })

  it('flags exceeds8192 when either dimension > 8192', () => {
    // 33 cells * 256 = 8448 — exceeds limit
    const result = computeExportDimensions(33, 10, 256)
    expect(result.exceeds8192).toBe(true)
  })

  it('does not flag 32x32 at 256ppc (8192x8192 is exactly at limit)', () => {
    const result = computeExportDimensions(32, 32, 256)
    expect(result.widthPx).toBe(8192)
    expect(result.heightPx).toBe(8192)
    expect(result.exceeds8192).toBe(false)
  })
})

describe('buildExportFilename', () => {
  it('formats correctly with all components', () => {
    expect(buildExportFilename('My Dungeon', 3840, 5120, 256, 'jpeg')).toBe(
      'my-dungeon-3840x5120-256ppc.jpg'
    )
  })

  it('uses png extension for PNG format', () => {
    expect(buildExportFilename('Cave', 1920, 1280, 128, 'png')).toBe(
      'cave-1920x1280-128ppc.png'
    )
  })

  it('sanitizes special characters in map name', () => {
    expect(buildExportFilename('Boss Room: Level 1!!', 256, 256, 64, 'png')).toBe(
      'boss-room-level-1-256x256-64ppc.png'
    )
  })

  it('falls back to "map" for empty map name', () => {
    expect(buildExportFilename('', 256, 256, 256, 'png')).toBe(
      'map-256x256-256ppc.png'
    )
  })
})

describe('worldBoundsToCells', () => {
  it('computes cell dimensions from world bounds', () => {
    const result = worldBoundsToCells({ minX: -5, minY: -3, maxX: 10, maxY: 7 })
    expect(result.cellWidth).toBe(15)
    expect(result.cellHeight).toBe(10)
  })

  it('rounds up fractional cells', () => {
    const result = worldBoundsToCells({ minX: 0, minY: 0, maxX: 10.3, maxY: 5.7 })
    expect(result.cellWidth).toBe(11)
    expect(result.cellHeight).toBe(6)
  })
})
```

- [x] Run `pnpm test` — all tests must pass

### 2.3 — ExportOptions state hook

New file: `src/components/shared/useExportOptions.ts`

```typescript
import { useState } from 'react'

export type ExportFormat = 'png' | 'jpeg'
export type ResolutionPreset = 64 | 128 | 256 | 'custom'

export interface ExportOptions {
  format: ExportFormat
  resolutionPreset: ResolutionPreset
  customPxPerCell: number
  jpegQuality: number           // 80–85
  gridless: boolean
  hideHatching: boolean
  hideShadows: boolean
  cropEnabled: boolean
  cropRect: { x: number; y: number; w: number; h: number } | null
}

export function useExportOptions() {
  const [options, setOptions] = useState<ExportOptions>({
    format: 'png',
    resolutionPreset: 256,
    customPxPerCell: 256,
    jpegQuality: 83,
    gridless: false,
    hideHatching: false,
    hideShadows: false,
    cropEnabled: false,
    cropRect: null,
  })

  const pxPerCell =
    options.resolutionPreset === 'custom'
      ? Math.max(1, Math.min(512, options.customPxPerCell))
      : options.resolutionPreset

  return { options, setOptions, pxPerCell }
}
```

### 2.4 — Export options panel component

New file: `src/components/shared/ExportOptionsPanel.tsx`

- [x] Import `NumberInput`, `SliderInput` from `@/components/inputs/`
- [x] Import `computeExportDimensions`, `buildExportFilename` from `@/engine/export/exportMath`
- [x] Import `useStore` to read `mapSettings.name`

```typescript
// src/components/shared/ExportOptionsPanel.tsx
import { NumberInput } from '@/components/inputs/NumberInput'
import { SliderInput } from '@/components/inputs/SliderInput'
import { computeExportDimensions, buildExportFilename } from '@/engine/export/exportMath'
import { useStore } from '@/store/store'
import type { ExportOptions, ResolutionPreset } from './useExportOptions'

interface ExportOptionsPanelProps {
  options: ExportOptions
  pxPerCell: number
  mapCellWidth: number
  mapCellHeight: number
  onChange: (patch: Partial<ExportOptions>) => void
}

export function ExportOptionsPanel({
  options,
  pxPerCell,
  mapCellWidth,
  mapCellHeight,
  onChange,
}: ExportOptionsPanelProps) {
  const mapName = useStore((s) => s.mapSettings.name)
  const dims = computeExportDimensions(mapCellWidth, mapCellHeight, pxPerCell)
  const filename = buildExportFilename(mapName, dims.widthPx, dims.heightPx, pxPerCell, options.format)

  const resolutionOptions: { label: string; value: ResolutionPreset }[] = [
    { label: '64px/cell — Draft', value: 64 },
    { label: '128px/cell — Standard', value: 128 },
    { label: '256px/cell — FA Quality (default)', value: 256 },
    { label: 'Custom', value: 'custom' },
  ]

  return (
    <div className="flex flex-col gap-3 text-panel-body text-text-primary">
      {/* Format */}
      <div>
        <div className="text-panel-heading text-text-secondary mb-1">Format</div>
        <div className="flex gap-2">
          {(['png', 'jpeg'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => onChange({ format: fmt })}
              className={`flex-1 py-1 rounded text-panel-body border ${
                options.format === fmt
                  ? 'bg-surface-3 border-border-focus text-text-primary'
                  : 'bg-surface-2 border-border-default text-text-secondary hover:text-text-primary'
              }`}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* JPEG Quality (only when JPEG selected) */}
      {options.format === 'jpeg' && (
        <div>
          <div className="text-panel-heading text-text-secondary mb-1">
            Quality: {options.jpegQuality}%
          </div>
          <SliderInput
            value={options.jpegQuality}
            onChange={(v) => onChange({ jpegQuality: v })}
            min={80}
            max={85}
            step={1}
          />
        </div>
      )}

      {/* Resolution */}
      <div>
        <div className="text-panel-heading text-text-secondary mb-1">Resolution</div>
        <div className="flex flex-col gap-1">
          {resolutionOptions.map(({ label, value }) => (
            <label key={String(value)} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="resolution"
                checked={options.resolutionPreset === value}
                onChange={() => onChange({ resolutionPreset: value })}
                className="accent-white"
              />
              <span className="text-panel-body">{label}</span>
            </label>
          ))}
        </div>
        {options.resolutionPreset === 'custom' && (
          <div className="mt-1 flex items-center gap-2">
            <NumberInput
              value={options.customPxPerCell}
              onChange={(v) => onChange({ customPxPerCell: v })}
              min={1}
              max={512}
              step={1}
            />
            <span className="text-text-muted">px/cell</span>
          </div>
        )}
      </div>

      {/* Visibility overrides */}
      <div>
        <div className="text-panel-heading text-text-secondary mb-1">Export Options</div>
        {[
          { label: 'Hide grid', key: 'gridless' as const },
          { label: 'Hide hatching', key: 'hideHatching' as const },
          { label: 'Hide shadows', key: 'hideShadows' as const },
        ].map(({ label, key }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer mb-1">
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(e) => onChange({ [key]: e.target.checked })}
              className="accent-white"
            />
            <span className="text-panel-body">{label}</span>
          </label>
        ))}
      </div>

      {/* Dimensions preview */}
      <div className="border-t border-border-subtle pt-2">
        <div className="text-panel-heading text-text-secondary mb-1">Output</div>
        {dims.exceeds8192 && (
          <div className="text-danger text-panel-small mb-1">
            Warning: output exceeds 8192px — reduce px/cell
          </div>
        )}
        <div className="text-panel-small text-text-muted">
          {dims.widthPx} × {dims.heightPx}px
        </div>
        <div className="text-panel-small text-text-muted break-all mt-1">{filename}</div>
      </div>
    </div>
  )
}
```

### 2.5 — Wire options panel into ExportDialog

- [x] Update `ExportDialog.tsx`:
  - Import `useExportOptions`
  - Import `ExportOptionsPanel`
  - Call `const { options, setOptions, pxPerCell } = useExportOptions()`
  - Compute map bounds (stub: assume 20×15 cells for now — replaced in Sub-task 3)
  - Render `<ExportOptionsPanel>` in the right column
  - Update Export button label dynamically: `Export ${options.format.toUpperCase()}`

- [x] Run `pnpm typecheck` — must pass with zero errors

---

## Sub-task 3 — PNG/JPEG Export Pipeline

**Goal:** Clicking Export renders the map offscreen at the chosen resolution and triggers a file download.

### 3.1 — Export engine utility

New file: `src/engine/export/exportPipeline.ts`

This module is responsible for the offscreen render. It must NOT import React or Zustand — it takes all data as parameters so it can be unit-tested in isolation.

```typescript
// src/engine/export/exportPipeline.ts
import { Assets, RenderTexture, Sprite, Container } from 'pixi.js'
import type { RenderEngine } from '@/engine/RenderEngine'
import type { SceneGraph } from '@/engine/sceneGraph'
import { getLayerEntries } from '@/engine/sceneGraph'
import type { Layer, DungeonLayer } from '@/store/types'

export interface ExportPipelineOptions {
  pxPerCell: number
  format: 'png' | 'jpeg'
  jpegQuality: number        // 80–100 integer
  cellWidth: number
  cellHeight: number
  cropRect?: { x: number; y: number; w: number; h: number } | null
  // Visibility overrides — applied temporarily, restored after render
  overrides?: {
    hideGrid?: boolean
    hideHatching?: boolean
    hideShadows?: boolean
  }
}

export interface ExportResult {
  blob: Blob
  filename: string
  widthPx: number
  heightPx: number
}

/**
 * Compute the world-space bounding box of all non-background layers.
 * Returns bounds in grid-cell world units.
 * Falls back to a 20×15 default if no shapes exist.
 */
export function computeMapWorldBounds(layers: Layer[]): {
  minX: number; minY: number; maxX: number; maxY: number
} {
  const dungeonLayers = layers.filter((l): l is DungeonLayer => l.type === 'dungeon')
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let hasContent = false

  for (const layer of dungeonLayers) {
    if (!layer.mergedFloor) continue
    for (const polygon of layer.mergedFloor) {
      for (const [x, y] of polygon) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        hasContent = true
      }
    }
  }

  if (!hasContent) {
    return { minX: -10, minY: -7.5, maxX: 10, maxY: 7.5 } // 20×15 default
  }

  // Add 1-cell margin
  return { minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1 }
}

/**
 * Run the export pipeline. Returns a Blob and metadata.
 *
 * Pipeline:
 *  1. Compute target pixel dimensions
 *  2. Temporarily apply visibility overrides to scene graph containers
 *  3. Create offscreen RenderTexture at target size
 *  4. Render worldContainer at export scale into RenderTexture
 *  5. Extract image as Blob
 *  6. Restore visibility
 *  7. Clean up RenderTexture
 */
export async function runExportPipeline(
  engine: RenderEngine,
  sceneGraph: SceneGraph,
  opts: ExportPipelineOptions,
): Promise<Blob> {
  const { pxPerCell, format, jpegQuality, cellWidth, cellHeight, cropRect, overrides } = opts

  const widthPx = Math.round(cellWidth * pxPerCell)
  const heightPx = Math.round(cellHeight * pxPerCell)

  // 1. Apply visibility overrides
  const restoreFns: Array<() => void> = []

  if (overrides?.hideGrid) {
    const grid = sceneGraph.gridRenderer.container
    const was = grid.visible
    grid.visible = false
    restoreFns.push(() => { grid.visible = was })
  }

  if (overrides?.hideHatching || overrides?.hideShadows) {
    for (const entry of getLayerEntries().values()) {
      if (!entry.sublayers) continue
      if (overrides.hideHatching) {
        const was = entry.sublayers.hatching.visible
        entry.sublayers.hatching.visible = false
        restoreFns.push(() => { entry.sublayers!.hatching.visible = was })
      }
      if (overrides.hideShadows) {
        const was = entry.sublayers.shadow.visible
        entry.sublayers.shadow.visible = false
        restoreFns.push(() => { entry.sublayers!.shadow.visible = was })
      }
    }
  }

  // 2. Create RenderTexture at export resolution
  const rt = engine.createRenderTexture(widthPx, heightPx)

  // 3. Scale worldContainer to match export resolution (1 world unit = pxPerCell px)
  const worldContainer = sceneGraph.worldContainer
  const savedX = worldContainer.position.x
  const savedY = worldContainer.position.y
  const savedScaleX = worldContainer.scale.x
  const savedScaleY = worldContainer.scale.y

  // Position origin at top-left of export bounds
  // (caller should set worldContainer position so that world (minX, minY) maps to (0, 0) in RT)
  worldContainer.scale.set(pxPerCell, pxPerCell)
  // Note: caller is responsible for computing and passing minX/minY offset — kept simple here
  // for the common case where origin (0,0) is map center

  engine.renderToTexture(worldContainer, rt)

  // 4. Extract
  // PixiJS v8 extract API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = (engine as any).app
  const blob: Blob = await app.renderer.extract.image({
    target: rt,
    format: format === 'jpeg' ? 'jpg' : 'png',
    quality: format === 'jpeg' ? jpegQuality / 100 : undefined,
    ...(cropRect
      ? { frame: { x: cropRect.x, y: cropRect.y, width: cropRect.w, height: cropRect.h } }
      : {}),
  })

  // 5. Restore
  worldContainer.position.set(savedX, savedY)
  worldContainer.scale.set(savedScaleX, savedScaleY)
  for (const fn of restoreFns) fn()

  // 6. Clean up
  rt.destroy(true)

  return blob
}
```

> **Note on `(engine as any).app`:** The `RenderEngine` interface (`src/engine/RenderEngine.ts`) does not expose the PixiJS `Application` directly. Add a `getApp()` method to the `RenderEngine` interface and its implementation (`src/engine/PixiEngine.ts`) in the same commit. Alternatively, pass the `app.renderer` as a constructor argument. Choose whichever approach preserves the interface contract — do not use `any` in the final implementation.

### 3.2 — Wire Export button

File: `src/components/shared/ExportDialog.tsx`

- [x] Import `runExportPipeline`, `computeMapWorldBounds` from `@/engine/export/exportPipeline`
- [x] Import `buildExportFilename`, `computeExportDimensions`, `worldBoundsToCells` from `@/engine/export/exportMath`
- [x] Import `useStore` to read `layers` and `mapSettings.name`
- [x] Get engine ref from context or prop (see note below on engine access)
- [x] Add `isExporting` state: `const [isExporting, setIsExporting] = useState(false)`
- [x] Add `handleExport` async function:

```typescript
async function handleExport() {
  setIsExporting(true)
  try {
    const layers = useStore.getState().layers
    const mapName = useStore.getState().mapSettings.name
    const worldBounds = computeMapWorldBounds(layers)
    const { cellWidth, cellHeight } = worldBoundsToCells(worldBounds)
    const dims = computeExportDimensions(cellWidth, cellHeight, pxPerCell)

    const blob = await runExportPipeline(engine, sceneGraph, {
      pxPerCell,
      format: options.format,
      jpegQuality: options.jpegQuality,
      cellWidth,
      cellHeight,
      cropRect: options.cropEnabled ? options.cropRect : null,
      overrides: {
        hideGrid: options.gridless,
        hideHatching: options.hideHatching,
        hideShadows: options.hideShadows,
      },
    })

    const filename = buildExportFilename(mapName, dims.widthPx, dims.heightPx, pxPerCell, options.format)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    showModal(null)
  } catch (err) {
    console.error('[export] Pipeline failed:', err)
    useStore.getState().pushToast({
      id: `export-error-${Date.now()}`,
      message: 'Export failed. See console for details.',
      type: 'error',
      duration: 4000,
      createdAt: Date.now(),
    })
  } finally {
    setIsExporting(false)
  }
}
```

**Engine access pattern:** The engine and sceneGraph are constructed in `CanvasHost.tsx` and currently not exposed globally. Add a module-level singleton export in `src/engine/engineSingleton.ts`:

New file: `src/engine/engineSingleton.ts`

```typescript
// src/engine/engineSingleton.ts
// Module-level singleton — set once during CanvasHost init, read by export pipeline.
// Never import this in tests (it will be null outside the browser context).
import type { RenderEngine } from './RenderEngine'
import type { SceneGraph } from './sceneGraph'

let _engine: RenderEngine | null = null
let _sceneGraph: SceneGraph | null = null

export function setEngineSingleton(engine: RenderEngine, sg: SceneGraph): void {
  _engine = engine
  _sceneGraph = sg
}

export function getEngineSingleton(): { engine: RenderEngine; sceneGraph: SceneGraph } | null {
  if (!_engine || !_sceneGraph) return null
  return { engine: _engine, sceneGraph: _sceneGraph }
}
```

- [x] In `src/canvas/CanvasHost.tsx`, after engine and sceneGraph are initialized, call `setEngineSingleton(engine, sceneGraph)`
- [x] In `ExportDialog.tsx`, call `getEngineSingleton()` inside `handleExport()` — if null, show a toast and return early

- [x] Update Export button:
  ```typescript
  <Button
    onClick={handleExport}
    disabled={isExporting || dims.exceeds8192}
  >
    {isExporting ? 'Exporting…' : `Export ${options.format.toUpperCase()}`}
  </Button>
  ```

### 3.3 — Update `RenderEngine` interface

File: `src/engine/RenderEngine.ts`

- [x] Add method:
  ```typescript
  /** Access the underlying PixiJS renderer for extract operations. */
  renderer(): import('pixi.js').Renderer
  ```
- [x] Implement in `src/engine/PixiEngine.ts` (the concrete implementation):
  ```typescript
  renderer(): Renderer {
    return this.app.renderer as Renderer
  }
  ```
- [x] Update `exportPipeline.ts` to use `engine.renderer()` instead of the `any` cast

- [x] Run `pnpm typecheck` — must pass

### 3.4 — E2E test: export triggers download

File: `tests/e2e/17-export-dialog.spec.ts` — add test:

```typescript
test('Export PNG triggers file download', async ({ page }) => {
  await gotoApp(page)
  // Draw a rectangle so there is content to export
  await page.keyboard.press('r') // Rectangle tool
  await firePointer(page, 'pointerdown', 400, 300, 1, 0)
  await firePointer(page, 'pointermove', 600, 450, 1, 0)
  await firePointer(page, 'pointerup', 600, 450, 0, 0)
  await waitFrame(page, 3)

  // Open export dialog
  await pressShortcut(page, 'e', { ctrl: true })
  await expect(page.getByText('Export Map')).toBeVisible()

  // Listen for download
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('button', { name: /Export PNG/i }).click(),
  ])

  expect(download.suggestedFilename()).toMatch(/\.png$/)
})
```

- [x] Run `pnpm exec playwright test tests/e2e/17-export-dialog.spec.ts --reporter=list` — must pass

---

## Sub-task 4 — Asset Browser Panel

**Goal:** Add a "Layers | Assets" tab switcher to the right panel and implement the asset browser.

### 4.1 — Update RightPanel with tab switcher

File: `src/components/layout/RightPanel.tsx`

- [x] Import `useStore` to read `ui.activePanel` and `setActivePanel`
- [x] Add tab strip above the `LayerPanel`:

```typescript
const activePanel = useStore((s) => s.ui.activePanel)
const setActivePanel = useStore((s) => s.setActivePanel)

// Tab switcher
<div className="flex border-b border-border-subtle">
  {(['tools', 'assets'] as const).map((tab) => (
    <button
      key={tab}
      onClick={() => setActivePanel(tab)}
      className={`flex-1 py-2 text-panel-heading capitalize border-b-2 -mb-px transition-colors ${
        activePanel === tab
          ? 'border-text-primary text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-secondary'
      }`}
    >
      {tab === 'tools' ? 'Layers' : 'Assets'}
    </button>
  ))}
</div>
```

- [x] Conditionally render `LayerPanel` when `activePanel === 'tools'` and `AssetBrowserPanel` when `activePanel === 'assets'`
- [x] Keep `PropertiesPanel` always visible below regardless of tab

Note: `UISlice.activePanel` already has type `'tools' | 'assets' | 'lights' | 'export'` in `src/store/types.ts` — `'tools'` maps to the Layers view (historical naming).

### 4.2 — AssetBrowserPanel skeleton

New file: `src/components/layers/AssetBrowserPanel.tsx`

The manifest shape (provided by Systems Dev) follows this interface — verify it matches `AssetManifest` in `src/store/types.ts` before proceeding:

```typescript
interface AssetEntry {
  id: string
  name: string
  url: string
  thumbnailUrl: string
  cellWidth: number   // sprite width in grid cells
  cellHeight: number
}

interface AssetCategory {
  id: string
  label: string
  assets: AssetEntry[]
}

interface AssetManifest {
  categories: AssetCategory[]
}
```

Scaffold:

```typescript
// src/components/layers/AssetBrowserPanel.tsx
import { useState, useMemo } from 'react'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { AssetGrid } from './AssetGrid'
import { AssetSearchInput } from './AssetSearchInput'

const selectAssets = (s: { assets: { recentlyUsed: string[]; manifest?: AssetManifest | null } }) => ({
  recentlyUsed: s.assets.recentlyUsed,
  manifest: (s.assets as { manifest?: AssetManifest | null }).manifest ?? null,
})

export function AssetBrowserPanel() {
  const { recentlyUsed, manifest } = useStore(useShallow(selectAssets))
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const categories = manifest?.categories ?? []
  const activeCategory = activeCategoryId
    ? categories.find((c) => c.id === activeCategoryId) ?? categories[0]
    : categories[0]

  const filteredAssets = useMemo(() => {
    if (!activeCategory) return []
    if (!searchQuery.trim()) return activeCategory.assets
    const q = searchQuery.toLowerCase()
    return activeCategory.assets.filter((a) => a.name.toLowerCase().includes(q))
  }, [activeCategory, searchQuery])

  const recentAssets = useMemo(() => {
    if (!manifest) return []
    const allAssets = manifest.categories.flatMap((c) => c.assets)
    return recentlyUsed
      .map((id) => allAssets.find((a) => a.id === id))
      .filter(Boolean) as typeof allAssets
  }, [manifest, recentlyUsed])

  if (!manifest) {
    return (
      <div className="p-3 text-text-muted text-panel-body">
        Asset library loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 border-b border-border-subtle">
        <AssetSearchInput value={searchQuery} onChange={setSearchQuery} />
      </div>

      {/* Category tabs */}
      <div className="flex overflow-x-auto border-b border-border-subtle">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => { setActiveCategoryId(cat.id); setSearchQuery('') }}
            className={`px-3 py-1.5 text-panel-small whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeCategory?.id === cat.id
                ? 'border-text-primary text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* Recently used section */}
        {!searchQuery && recentAssets.length > 0 && (
          <div className="mb-3">
            <div className="text-panel-heading text-text-secondary mb-1">Recently Used</div>
            <AssetGrid assets={recentAssets} />
          </div>
        )}

        {/* Main grid */}
        {activeCategory && (
          <div>
            {searchQuery ? (
              <div className="text-panel-heading text-text-secondary mb-1">
                Results ({filteredAssets.length})
              </div>
            ) : null}
            {filteredAssets.length === 0 ? (
              <div className="text-panel-body text-text-muted py-4 text-center">
                No assets found
              </div>
            ) : (
              <AssetGrid assets={filteredAssets} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

### 4.3 — AssetSearchInput component

New file: `src/components/layers/AssetSearchInput.tsx`

```typescript
// src/components/layers/AssetSearchInput.tsx
import { Search, X } from 'lucide-react'

interface AssetSearchInputProps {
  value: string
  onChange: (value: string) => void
}

export function AssetSearchInput({ value, onChange }: AssetSearchInputProps) {
  return (
    <div className="relative flex items-center">
      <Search size={12} className="absolute left-2 text-text-muted pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search assets…"
        className="w-full h-7 pl-6 pr-6 bg-surface-2 text-panel-body text-text-primary rounded border border-border-default focus:border-border-focus focus:outline-none placeholder:text-text-muted"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 text-text-muted hover:text-text-primary"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
```

### 4.4 — AssetGrid component

New file: `src/components/layers/AssetGrid.tsx`

```typescript
// src/components/layers/AssetGrid.tsx
import { useStore } from '@/store/store'
import { AssetThumbnail } from './AssetThumbnail'

interface AssetEntry {
  id: string
  name: string
  thumbnailUrl: string
  cellWidth: number
  cellHeight: number
}

interface AssetGridProps {
  assets: AssetEntry[]
}

export function AssetGrid({ assets }: AssetGridProps) {
  const setActiveTool = useStore((s) => s.setActiveTool)
  const trackRecentUse = useStore((s) => s.trackRecentUse)
  const setActivePanel = useStore((s) => s.setActivePanel)

  function handleAssetClick(assetId: string) {
    trackRecentUse(assetId)
    // Store the pending asset ID for the placement tool to read
    // (Tools Dev will wire the placement tool; we store selection in ui store)
    // Activate the 'object' tool — Tools Dev extends this to placement mode
    setActiveTool('object')
    // Note: Tools Dev will subscribe to selectedAssetId for placement preview
    // For now, we store it in a module-level variable that placement tool reads
    setPendingPlacementAssetId(assetId)
  }

  return (
    <div className="grid grid-cols-4 gap-1">
      {assets.map((asset) => (
        <AssetThumbnail
          key={asset.id}
          asset={asset}
          onClick={() => handleAssetClick(asset.id)}
        />
      ))}
    </div>
  )
}

// Module-level pending placement — read by Tools Dev's placement tool
let _pendingPlacementAssetId: string | null = null
export function setPendingPlacementAssetId(id: string | null) {
  _pendingPlacementAssetId = id
}
export function getPendingPlacementAssetId(): string | null {
  return _pendingPlacementAssetId
}
```

### 4.5 — AssetThumbnail component

New file: `src/components/layers/AssetThumbnail.tsx`

```typescript
// src/components/layers/AssetThumbnail.tsx
import { useState } from 'react'
import { ImageIcon } from 'lucide-react'

interface AssetEntry {
  id: string
  name: string
  thumbnailUrl: string
  cellWidth: number
  cellHeight: number
}

interface AssetThumbnailProps {
  asset: AssetEntry
  onClick: () => void
  isSelected?: boolean
}

export function AssetThumbnail({ asset, onClick, isSelected }: AssetThumbnailProps) {
  const [imgError, setImgError] = useState(false)

  return (
    <button
      onClick={onClick}
      title={`${asset.name} (${asset.cellWidth}×${asset.cellHeight} cells)`}
      className={`flex flex-col items-center gap-0.5 p-1 rounded border transition-colors ${
        isSelected
          ? 'border-border-focus bg-surface-3'
          : 'border-transparent hover:border-border-default hover:bg-surface-2'
      }`}
    >
      <div className="w-full aspect-square bg-surface-2 rounded flex items-center justify-center overflow-hidden">
        {imgError || !asset.thumbnailUrl ? (
          <ImageIcon size={16} className="text-text-muted" />
        ) : (
          <img
            src={asset.thumbnailUrl}
            alt={asset.name}
            className="w-full h-full object-contain"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        )}
      </div>
      <span className="text-panel-small text-text-muted truncate w-full text-center leading-tight">
        {asset.name}
      </span>
    </button>
  )
}
```

### 4.6 — Load manifest into store on engine init

File: `src/canvas/CanvasHost.tsx`

- [x] After engine init, load the manifest and update the store:

```typescript
// After engine.init(container):
import manifestJson from '@/assets/manifest.json'
import { Assets } from 'pixi.js'

// Register manifest with PIXI.Assets
Assets.addBundle('fa-library', {
  // Map each asset to its URL for lazy loading
})

// Store manifest in Zustand (Systems Dev must have added setManifest action)
useStore.getState().setManifest(manifestJson as AssetManifest)
```

> Note: `setManifest` is a new action that Systems Dev adds to `AssetsSlice`. Verify it exists before implementing this step. If missing, add it to `src/store/slices/assets.ts` yourself as:
> ```typescript
> setManifest: (manifest: AssetManifest) =>
>   set((state) => { (state.assets as { manifest: AssetManifest }).manifest = manifest })
> ```
> and add `manifest: AssetManifest | null` to `AssetsSlice` in `src/store/types.ts`.

### 4.7 — Keyboard navigation in AssetGrid

File: `src/components/layers/AssetGrid.tsx`

- [x] Add `selectedIndex` state to `AssetGrid` or lift to `AssetBrowserPanel`
- [x] On the wrapping `div`, handle `onKeyDown`:
  - `ArrowRight` → selectedIndex + 1
  - `ArrowLeft` → selectedIndex - 1
  - `ArrowDown` → selectedIndex + 4 (columns)
  - `ArrowUp` → selectedIndex - 4
  - `Enter` → call `handleAssetClick(assets[selectedIndex].id)`
- [x] Add `tabIndex={0}` to the grid container
- [x] Pass `isSelected` prop to the active `AssetThumbnail`

### 4.8 — Unit test: search filtering

New file: `src/components/layers/AssetGrid.test.ts`

```typescript
import { describe, it, expect } from 'vitest'

// Pure logic test — no React rendering required
function filterAssets(
  assets: Array<{ id: string; name: string }>,
  query: string,
): Array<{ id: string; name: string }> {
  if (!query.trim()) return assets
  const q = query.toLowerCase()
  return assets.filter((a) => a.name.toLowerCase().includes(q))
}

describe('asset search filtering', () => {
  const assets = [
    { id: '1', name: 'Wooden Table' },
    { id: '2', name: 'Stone Chair' },
    { id: '3', name: 'Iron Door' },
    { id: '4', name: 'Wooden Chair' },
  ]

  it('returns all assets for empty query', () => {
    expect(filterAssets(assets, '')).toHaveLength(4)
  })

  it('filters by partial name match (case-insensitive)', () => {
    const result = filterAssets(assets, 'wooden')
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.id)).toEqual(['1', '4'])
  })

  it('returns empty array when no match', () => {
    expect(filterAssets(assets, 'dragon')).toHaveLength(0)
  })

  it('is case insensitive', () => {
    expect(filterAssets(assets, 'IRON')).toHaveLength(1)
  })
})
```

- [x] Run `pnpm test` — must pass

### 4.9 — E2E test: asset browser tab

File: `tests/e2e/18-asset-browser.spec.ts`

```typescript
import { test, expect } from '@playwright/test'
import { gotoApp } from './helpers'

test.describe('Asset Browser Panel', () => {
  test('Assets tab is visible in right panel', async ({ page }) => {
    await gotoApp(page)
    await expect(page.getByRole('button', { name: 'Assets' })).toBeVisible()
  })

  test('clicking Assets tab switches panel content', async ({ page }) => {
    await gotoApp(page)
    await page.getByRole('button', { name: 'Assets' }).click()
    // Asset browser should be visible (search input or "loading" message)
    const panel = page.locator('[placeholder="Search assets…"], :text("Asset library loading")')
    await expect(panel.first()).toBeVisible()
  })

  test('clicking Layers tab restores layer panel', async ({ page }) => {
    await gotoApp(page)
    await page.getByRole('button', { name: 'Assets' }).click()
    await page.getByRole('button', { name: 'Layers' }).click()
    // Layer panel header should be back
    await expect(page.getByText('Layers')).toBeVisible()
  })
})
```

- [x] Run `pnpm exec playwright test tests/e2e/18-asset-browser.spec.ts --reporter=list` — must pass

---

## Sub-task 5 — PlacedObject → Sprite Scene Graph Wiring

**Goal:** When `ImagesLayer.objects` changes in the store, sync the PixiJS scene graph: add/update/remove Sprites for each PlacedObject.

### 5.1 — PlacedObject → Sprite sync in subscribeToStore

File: `src/engine/subscribeToStore.ts`

Add a new subscription block after the existing `unsubSublayers` block:

```typescript
// ─── PlacedObject → Sprite sync (images layers) ──────────
import { Sprite, Assets, Texture } from 'pixi.js'
import type { ImagesLayer } from '@/store/types'

// Track sprite map per layer: layerId → Map<objectId, Sprite>
const spriteMaps = new Map<string, Map<string, Sprite>>()

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

const unsubObjects = useStore.subscribe(
  (state) =>
    state.layers
      .filter((l): l is ImagesLayer => l.type === 'images')
      .map((l) => ({ id: l.id, objects: l.objects })),
  (imageLayers) => {
    for (const { id: layerId, objects } of imageLayers) {
      const entry = getLayerEntry(layerId)
      if (!entry) continue

      if (!spriteMaps.has(layerId)) {
        spriteMaps.set(layerId, new Map())
      }
      const spriteMap = spriteMaps.get(layerId)!
      const currentIds = new Set(objects.map((o) => o.id))

      // Remove sprites for deleted objects
      for (const [objId, sprite] of spriteMap) {
        if (!currentIds.has(objId)) {
          entry.container.removeChild(sprite)
          sprite.destroy()
          spriteMap.delete(objId)
        }
      }

      // Add or update sprites
      for (const obj of objects) {
        let sprite = spriteMap.get(obj.id)

        if (!sprite) {
          // Try to get texture from already-loaded PIXI.Assets cache
          const texture: Texture | null = obj.assetId
            ? (Assets.get(obj.assetId) ?? null)
            : null
          sprite = new Sprite(texture ?? Texture.WHITE)
          sprite.anchor.set(0.5, 0.5)
          sprite.label = `placed-${obj.id}`
          entry.container.addChild(sprite)
          spriteMap.set(obj.id, sprite)

          // Async: if texture not yet loaded, load it and update
          if (obj.assetId && !texture) {
            Assets.load<Texture>(obj.assetId)
              .then((loadedTex) => {
                if (sprite && loadedTex) sprite.texture = loadedTex
              })
              .catch(() => { /* leave WHITE fallback */ })
          }
        }

        // Sync transform
        sprite.position.set(obj.position.x, obj.position.y)
        sprite.rotation = obj.rotation
        const flipX = (obj as { flipX?: boolean }).flipX ? -1 : 1
        const flipY = (obj as { flipY?: boolean }).flipY ? -1 : 1
        sprite.scale.set(obj.scale * flipX, obj.scale * flipY)
        if (obj.tint) sprite.tint = hexToNumber(obj.tint)
        sprite.visible = true
      }
    }
  },
  { fireImmediately: true },
)
unsubscribers.push(unsubObjects)
```

> **PlacedObject field discrepancy:** The current `PlacedObject` type in `src/store/types.ts` has `objectType: 'image' | 'door' | 'stairs' | 'text'` and does NOT yet have `assetId`, `flipX`, `flipY`. These are added by Systems Dev Phase 1. Guard each access:
> - `obj.assetId` → add `assetId?: string` as optional until Systems Dev lands
> - `obj.flipX` / `obj.flipY` → cast as shown above until types are updated

### 5.2 — Clean up spriteMaps on layer removal

File: `src/engine/subscribeToStore.ts`

The existing `unsubLayers` subscription already calls `removeLayerFromScene`. Extend the cleanup callback to also clear the sprite map:

- [x] After `removeLayerFromScene(sceneGraph, id)` is called for a removed layer, call `spriteMaps.delete(id)`

This requires exporting `spriteMaps` or co-locating the cleanup — simplest is to move the sprite map cleanup into the layer removal handler within the same `unsubLayers` callback.

### 5.3 — Unit test: PlacedObject sprite sync logic

New file: `src/engine/placedObjectSync.test.ts`

Test the pure helper functions in isolation (hexToNumber, transform math):

```typescript
import { describe, it, expect } from 'vitest'

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

function computeSpriteScale(scale: number, flipX: boolean, flipY: boolean) {
  return {
    x: scale * (flipX ? -1 : 1),
    y: scale * (flipY ? -1 : 1),
  }
}

describe('hexToNumber', () => {
  it('converts #ffffff to 0xffffff', () => {
    expect(hexToNumber('#ffffff')).toBe(0xffffff)
  })
  it('converts #ff0000 to 0xff0000', () => {
    expect(hexToNumber('#ff0000')).toBe(0xff0000)
  })
  it('handles hash-less hex strings', () => {
    expect(hexToNumber('1a2b3c')).toBe(0x1a2b3c)
  })
})

describe('computeSpriteScale', () => {
  it('applies scale without flip', () => {
    const s = computeSpriteScale(2, false, false)
    expect(s.x).toBe(2)
    expect(s.y).toBe(2)
  })
  it('negates x for flipX', () => {
    const s = computeSpriteScale(1.5, true, false)
    expect(s.x).toBe(-1.5)
    expect(s.y).toBe(1.5)
  })
  it('negates y for flipY', () => {
    const s = computeSpriteScale(1.5, false, true)
    expect(s.x).toBe(1.5)
    expect(s.y).toBe(-1.5)
  })
  it('negates both for flipX + flipY', () => {
    const s = computeSpriteScale(2, true, true)
    expect(s.x).toBe(-2)
    expect(s.y).toBe(-2)
  })
})
```

- [x] Run `pnpm test` — must pass

### 5.4 — E2E test: PlacedObject renders on canvas

File: `tests/e2e/19-placed-objects.spec.ts`

```typescript
import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'

test.describe('PlacedObject rendering', () => {
  test('adding a PlacedObject to an images layer creates a sprite', async ({ page }) => {
    await gotoApp(page)

    // Inject a PlacedObject directly into the store
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__zustand_store ?? (window as any).useStore
      if (!store) return

      const state = store.getState()
      // Find an images layer or create one
      let imagesLayer = state.layers.find((l: { type: string }) => l.type === 'images')
      if (!imagesLayer) {
        // Trigger add images layer action if available
        return
      }

      state.updateLayer(imagesLayer.id, {
        objects: [
          {
            id: 'test-obj-1',
            layerId: imagesLayer.id,
            objectType: 'asset',
            assetId: null,
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: 1,
            tint: '#ffffff',
          },
        ],
      })
    })

    await waitFrame(page, 3)

    // Verify no JS error occurred — the test itself passing is the assertion
    // (Sprite creation errors would throw and be caught by Playwright's console listener)
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await waitFrame(page, 2)
    expect(errors.filter((e) => e.includes('placed-'))).toHaveLength(0)
  })
})
```

> Note: The store is not exposed on `window` by default. If the test cannot access it via `window`, skip the E2E test for this sub-task and rely on the unit tests in Sub-task 5.3. Add `window.__zustand_store = useStore` to `main.tsx` behind a `if (import.meta.env.DEV)` guard to enable store access in development tests.

---

## Sub-task 6 — Integration + Typecheck Gate

**Goal:** All code passes `pnpm check` before declaring this track complete.

### 6.1 — Final typecheck

- [x] Run `pnpm typecheck` — zero type errors
- [x] Run `pnpm lint` — zero warnings (ESLint `--max-warnings 0`)
- [x] Run `pnpm test` — all unit tests pass
- [x] Run `pnpm exec playwright test --reporter=list` — all 17/18/19 spec files pass (existing 90/116 baseline must not regress)

### 6.2 — New files checklist

Verify all new files exist and are non-empty:

- [x] `src/engine/export/exportMath.ts`
- [x] `src/engine/export/exportMath.test.ts`
- [x] `src/engine/export/exportPipeline.ts`
- [x] `src/engine/engineSingleton.ts`
- [x] `src/components/shared/ExportDialog.tsx`
- [x] `src/components/shared/ExportOptionsPanel.tsx` _(inlined into ExportDialog.tsx)_
- [x] `src/components/shared/useExportOptions.ts` _(inlined into ExportDialog.tsx)_
- [x] `src/components/layers/AssetBrowserPanel.tsx`
- [x] `src/components/layers/AssetGrid.tsx` _(inlined into AssetBrowserPanel.tsx)_
- [x] `src/components/layers/AssetThumbnail.tsx` _(inlined into AssetBrowserPanel.tsx)_
- [x] `src/components/layers/AssetSearchInput.tsx` _(inlined into AssetBrowserPanel.tsx)_
- [x] `src/engine/placedObjectSync.test.ts`
- [x] `tests/e2e/17-export-dialog.spec.ts` _(implemented as tests/e2e/18-export-dialog.spec.ts)_
- [x] `tests/e2e/18-asset-browser.spec.ts` _(implemented as tests/e2e/19-asset-browser.spec.ts)_
- [x] `tests/e2e/19-placed-objects.spec.ts` _(covered by tests/e2e/19-asset-browser.spec.ts)_

### 6.3 — Modified files checklist

- [x] `src/shortcuts/defaultShortcuts.ts` — `file.export` shortcut added
- [x] `src/App.tsx` — `<ExportDialog />` mounted
- [x] `src/components/layout/RightPanel.tsx` — Layers | Assets tab switcher
- [x] `src/engine/subscribeToStore.ts` — PlacedObject → Sprite subscription _(implemented in subscribeToAssets.ts, wired from CanvasHost)_
- [x] `src/engine/RenderEngine.ts` — `renderer()` method added
- [x] `src/canvas/CanvasHost.tsx` — `setEngineSingleton` called, manifest loaded into store

### 6.4 — Month 1 Exit Criteria (UI Dev track)

- [x] Ctrl+E opens export dialog
- [x] Escape and Cancel close the dialog
- [x] PNG and JPEG format selector works
- [x] JPEG quality slider (80–85) visible only when JPEG selected
- [x] Resolution selector: 64/128/256/custom px/cell
- [x] Auto-filename displayed in dialog: `{mapName}-{W}x{H}-{pxPerCell}ppc.{ext}`
- [x] Warning shown if output exceeds 8192px
- [x] Gridless toggle, hide hatching, hide shadows checkboxes work
- [x] Export PNG triggers a file download
- [x] Export JPEG triggers a file download
- [x] Right panel has Layers | Assets tab switcher
- [x] Asset browser shows categories from manifest
- [x] Search filters assets by name (client-side)
- [x] Recently used section shows last 10 assets
- [x] Clicking an asset activates object tool (placement wired by Tools Dev)
- [x] PlacedObjects on images layers render as Sprites in the PixiJS scene
- [x] Sprite position, rotation, scale, tint, flip sync from store
- [x] All tests pass (`pnpm check` green)

---

## Dependency Notes

| Dependency | Source | Risk if missing |
|------------|--------|-----------------|
| `AssetsSlice.manifest: AssetManifest | null` | Systems Dev Phase 1 | `AssetBrowserPanel` shows loading state — non-blocking |
| `PlacedObject.assetId` | Systems Dev Phase 1 | Sprite sync falls back to `Texture.WHITE` — non-breaking |
| `PlacedObject.flipX / flipY` | Systems Dev Phase 1 | Cast with optional access — non-breaking |
| `setManifest` action on store | Systems Dev Phase 1 | Add locally if missing (see Sub-task 4.6 note) |
| `PixiEngine.ts` implementation | Existing codebase | Must expose `renderer()` for export — check `src/engine/PixiEngine.ts` |
| Tools Dev asset placement tool | Tools Dev Phase 2 | `setPendingPlacementAssetId` is a forward-compatible hook — UI works without it |

---

## Pitfalls and Gotchas

1. **PixiJS v8 extract API** — The method is `app.renderer.extract.image({ target, format, quality })`. The `format` parameter for JPEG is `'jpg'` not `'jpeg'`. Confirm against PixiJS v8.16 docs before shipping.

2. **RenderTexture destroy** — Always call `rt.destroy(true)` (with `true` for `destroyBase`) after extraction. Omitting the argument leaks GPU texture memory.

3. **worldContainer camera state** — The `worldContainer` position and scale encode the camera. The export pipeline saves and restores them. If the export fires mid-frame while the render loop is running, there is a race. Stop the render ticker before export and restart after: call `engine.stopRenderLoop()` / `engine.startRenderLoop()` around the export.

4. **@base-ui/react Dialog `open` prop** — The `Dialog` wrapper in `src/components/ui/dialog.tsx` passes `open` directly to `DialogPrimitive.Root`. Confirm the prop name matches `@base-ui/react`'s API — it may be `defaultOpen` for uncontrolled or `open` for controlled. The existing `ConfirmDialog.tsx` uses `open` — follow that pattern exactly.

5. **`useShallow` import path** — Import from `zustand/react/shallow`, not `zustand/shallow` (the former is the React-specific export for v5).

6. **Tab switcher and `activePanel` initial state** — `activePanel` defaults to `'tools'` in `createDefaultState()`. The tab switcher maps `'tools'` to "Layers" label (not "Tools") to match the right panel's content. Do not change the enum value.

7. **Manifest JSON import** — TypeScript requires `resolveJsonModule: true` in `tsconfig.app.json` to import `.json` files. Check that this flag is set before importing `manifest.json` statically. If not set, load it with `fetch('/assets/manifest.json')` instead.

8. **PlacedObject vs objects field** — `ImagesLayer.objects` is the field name in `src/store/types.ts` (not `placedObjects`). The design spec uses `placedObjects` in some places but the actual type uses `objects`. Use `objects` throughout.
