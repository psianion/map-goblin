# Month 1: Systems Dev — Foundation + Save/Load Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Establish the store type foundation, asset manifest pipeline, and complete save/load system for Month 1.

**Architecture:** All store type additions are co-located in `src/store/types.ts` (single source of truth), with slice action additions in their respective slice files. The save/load pipeline is implemented as a standalone service module (`src/io/saveLoad.ts`) that calls existing store actions, keeping I/O concerns separated from state management. The IndexedDB autosave wraps the same service in a debounced dirty-flag subscriber wired via `src/io/autosave.ts`.

**Tech Stack:** TypeScript, Zustand 5 (immer), fflate, PIXI.Assets, File System Access API, IndexedDB

---

## Prerequisites

Before starting Phase 1, verify the following are true:
- `pnpm check` passes on the current codebase (all tests green, zero lint warnings, types clean)
- You are on the `main` branch (or the designated Month 1 feature branch)

---

## Phase 1 — Foundation (Gate Tasks)

---

### Task 1: Store Type Additions

**Files:**
- Modify: `src/store/types.ts`
- Modify: `src/store/factories.ts`
- Modify: `src/store/store.ts` (factories.ts `createDefaultState` type exclusion list)
- Modify: `src/store/slices/assets.ts`
- Create: `src/store/slices/assets.test.ts`

**Context:** The existing `Light` type is missing `name` and `visible`. `PlacedObject` is generic and needs concrete asset fields. `AssetsSlice` needs manifest state. `SerializedMapData` is still v1.0.

---

- [x] **Step 1.1 — Write failing tests for expanded Light type**

  Create `src/store/slices/assets.test.ts` with the following tests (they will fail because the types don't exist yet):

  ```typescript
  // src/store/slices/assets.test.ts
  import { describe, it, expect, beforeEach } from 'vitest'
  import { useStore } from '../store.ts'
  import type { Light, PlacedObject, AssetManifest } from '../types.ts'

  describe('AssetsSlice — manifest state', () => {
    beforeEach(() => {
      useStore.getState().resetToDefault()
    })

    it('initializes with null manifest', () => {
      const { manifest } = useStore.getState().assets
      expect(manifest).toBeNull()
    })

    it('setManifest stores manifest and exposes categories', () => {
      const manifest: AssetManifest = {
        categories: [
          {
            id: 'furniture',
            label: 'Furniture',
            assets: [
              {
                id: 'chair-01',
                name: 'Chair',
                url: '/assets/chair-01.png',
                thumbnailUrl: '/assets/chair-01-thumb.png',
                cellWidth: 1,
                cellHeight: 1,
              },
            ],
          },
        ],
      }
      useStore.getState().setManifest(manifest)
      expect(useStore.getState().assets.manifest).toEqual(manifest)
    })

    it('markCategoryLoaded adds categoryId to loadedCategories', () => {
      useStore.getState().markCategoryLoaded('furniture')
      expect(useStore.getState().assets.loadedCategories).toContain('furniture')
    })

    it('markCategoryLoaded is idempotent', () => {
      useStore.getState().markCategoryLoaded('furniture')
      useStore.getState().markCategoryLoaded('furniture')
      const loaded = useStore.getState().assets.loadedCategories
      expect(loaded.filter((id) => id === 'furniture')).toHaveLength(1)
    })
  })

  describe('Light type — name and visible fields', () => {
    beforeEach(() => {
      useStore.getState().resetToDefault()
    })

    it('addLight accepts a light with name and visible fields', () => {
      const light: Light = {
        id: 'l1',
        position: { x: 0, y: 0 },
        color: '#ffffff',
        radius: 5,
        intensity: 0.8,
        falloff: 'quadratic',
        name: 'Torch',
        visible: true,
      }
      useStore.getState().addLight(light)
      const stored = useStore.getState().lights[0]
      expect(stored.name).toBe('Torch')
      expect(stored.visible).toBe(true)
    })

    it('updateLight can toggle visible', () => {
      const light: Light = {
        id: 'l2',
        position: { x: 1, y: 1 },
        color: '#ff8800',
        radius: 3,
        intensity: 1.0,
        falloff: 'linear',
        name: 'Lantern',
        visible: true,
      }
      useStore.getState().addLight(light)
      useStore.getState().updateLight('l2', { visible: false })
      expect(useStore.getState().lights[0].visible).toBe(false)
    })
  })

  describe('PlacedObject — expanded fields', () => {
    it('PlacedObject type accepts all required fields', () => {
      // Type-level test: this will fail to compile if fields are missing
      const obj: PlacedObject = {
        id: 'obj-1',
        layerId: 'layer-1',
        objectType: 'asset',
        assetId: 'chair-01',
        position: { x: 5, y: 10 },
        rotation: 0,
        scale: 1,
        tint: '#ffffff',
        groupId: null,
        flipX: false,
        flipY: false,
      }
      expect(obj.assetId).toBe('chair-01')
      expect(obj.groupId).toBeNull()
    })

    it('PlacedObject objectType accepts image', () => {
      const obj: PlacedObject = {
        id: 'obj-2',
        layerId: 'layer-1',
        objectType: 'image',
        assetId: 'custom-img-abc123',
        position: { x: 0, y: 0 },
        rotation: Math.PI / 4,
        scale: 2,
        tint: '#ff0000',
        groupId: null,
        flipX: true,
        flipY: false,
      }
      expect(obj.objectType).toBe('image')
      expect(obj.flipX).toBe(true)
    })
  })
  ```

- [x] **Step 1.2 — Run tests to confirm failure**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm test 2>&1 | tail -30
  ```

  Expected: compilation errors or test failures due to missing fields on `Light`, `PlacedObject`, `AssetManifest`, `setManifest`, `markCategoryLoaded`.

- [x] **Step 1.3 — Update `src/store/types.ts`**

  **Expand `Light` interface** (add `name` and `visible`):

  ```typescript
  export interface Light {
    id: string
    position: { x: number; y: number }
    color: string        // hex
    radius: number       // world units
    intensity: number    // 0–1
    falloff: 'linear' | 'quadratic'
    name: string         // NEW — display name in layer panel
    visible: boolean     // NEW — visibility toggle
  }
  ```

  **Replace `PlacedObject` interface** (concrete asset fields replacing the generic `properties` bag):

  ```typescript
  export interface PlacedObject {
    id: string
    layerId: string
    objectType: 'asset' | 'image'
    assetId: string                  // manifest asset ID or custom upload ID
    position: { x: number; y: number }
    rotation: number                 // radians
    scale: number                    // uniform scale factor
    tint: string                     // hex color overlay
    groupId: string | null
    flipX: boolean
    flipY: boolean
  }
  ```

  **Add `AssetEntry`, `AssetCategory`, `AssetManifest` interfaces** (new, insert after `AssetRef`):

  ```typescript
  export interface AssetEntry {
    id: string
    name: string
    url: string
    thumbnailUrl: string
    cellWidth: number    // sprite width / 256 — footprint in grid cells
    cellHeight: number   // sprite height / 256
  }

  export interface AssetCategory {
    id: string
    label: string
    assets: AssetEntry[]
  }

  export interface AssetManifest {
    categories: AssetCategory[]
  }
  ```

  **Expand `AssetsSlice` interface** (add manifest fields and new actions):

  ```typescript
  export interface AssetsSlice {
    manifest: AssetManifest | null
    loadedCategories: string[]
    recentlyUsed: string[]    // asset IDs, max 10
    favorites: string[]       // asset IDs
    customUploads: AssetRef[]
    setManifest: (manifest: AssetManifest) => void
    markCategoryLoaded: (categoryId: string) => void
  }
  ```

  **Update `SerializedMapData` version string type** (leave value as `'1.0'` for now — Task 3 bumps it):

  ```typescript
  export interface SerializedMapData {
    version: string
    mapSettings: MapSettings
    grid: Pick<GridConfig, 'visible' | 'snapDivision' | 'style'>
    layers: Layer[]
    lights: Light[]
    placedObjects: PlacedObject[]      // NEW
    customImages: Record<string, string>  // NEW: id → base64 data URL
  }
  ```

  **Add new actions to `MapBuilderStore` interface** (in the assets actions section):

  ```typescript
  setManifest: (manifest: AssetManifest) => void
  markCategoryLoaded: (categoryId: string) => void
  addPlacedObject: (layerId: string, obj: PlacedObject) => void
  removePlacedObject: (layerId: string, objId: string) => void
  updatePlacedObject: (layerId: string, objId: string, patch: Partial<PlacedObject>) => void
  ```

- [x] **Step 1.4 — Update `src/store/slices/assets.ts`**

  Add `setManifest` and `markCategoryLoaded` actions:

  ```typescript
  import type { StateCreator } from 'zustand'
  import type { AssetManifest, AssetRef, MapBuilderStore } from '../types.ts'

  export interface AssetActions {
    toggleFavorite: (assetId: string) => void
    trackRecentUse: (assetId: string) => void
    addCustomUpload: (ref: AssetRef) => void
    removeCustomUpload: (id: string) => void
    setManifest: (manifest: AssetManifest) => void
    markCategoryLoaded: (categoryId: string) => void
  }

  export const createAssetsSlice: StateCreator<
    MapBuilderStore,
    [['zustand/immer', never]],
    [],
    AssetActions
  > = (set) => ({
    toggleFavorite: (assetId) =>
      set((state) => {
        const idx = state.assets.favorites.indexOf(assetId)
        if (idx === -1) state.assets.favorites.push(assetId)
        else state.assets.favorites.splice(idx, 1)
      }),
    trackRecentUse: (assetId) =>
      set((state) => {
        state.assets.recentlyUsed = [
          assetId,
          ...state.assets.recentlyUsed.filter((id) => id !== assetId),
        ].slice(0, 10)
      }),
    addCustomUpload: (ref) =>
      set((state) => {
        state.assets.customUploads.push(ref)
      }),
    removeCustomUpload: (id) =>
      set((state) => {
        state.assets.customUploads = state.assets.customUploads.filter(
          (u) => u.id !== id
        )
      }),
    setManifest: (manifest) =>
      set((state) => {
        state.assets.manifest = manifest
      }),
    markCategoryLoaded: (categoryId) =>
      set((state) => {
        if (!state.assets.loadedCategories.includes(categoryId)) {
          state.assets.loadedCategories.push(categoryId)
        }
      }),
  })
  ```

- [x] **Step 1.5 — Update `src/store/slices/layers.ts`**

  Add `addPlacedObject`, `removePlacedObject`, `updatePlacedObject` to `LayerActions` and the slice implementation:

  ```typescript
  // Add to LayerActions interface:
  addPlacedObject: (layerId: string, obj: PlacedObject) => void
  removePlacedObject: (layerId: string, objId: string) => void
  updatePlacedObject: (layerId: string, objId: string, patch: Partial<PlacedObject>) => void
  ```

  Implementations (add to the returned object in `createLayersSlice`):

  ```typescript
  addPlacedObject: (layerId, obj) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId)
      if (layer && layer.type === 'images') {
        layer.objects.push(obj)
      }
    }),
  removePlacedObject: (layerId, objId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId)
      if (layer && layer.type === 'images') {
        const idx = layer.objects.findIndex((o) => o.id === objId)
        if (idx >= 0) layer.objects.splice(idx, 1)
      }
    }),
  updatePlacedObject: (layerId, objId, patch) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId)
      if (layer && layer.type === 'images') {
        const obj = layer.objects.find((o) => o.id === objId)
        if (obj) Object.assign(obj, patch)
      }
    }),
  ```

  Also import `PlacedObject` from types at the top of the file.

- [x] **Step 1.6 — Update `src/store/factories.ts`**

  Update `createDefaultState` to include new `assets` fields:

  ```typescript
  assets: {
    manifest: null,
    loadedCategories: [],
    favorites: [],
    recentlyUsed: [],
    customUploads: [],
  },
  ```

  Update the `MapBuilderState` exclusion type to include new action names:

  ```typescript
  | 'setManifest' | 'markCategoryLoaded'
  | 'addPlacedObject' | 'removePlacedObject' | 'updatePlacedObject'
  ```

- [x] **Step 1.7 — Update `src/store/store.ts`**

  The `getSerializableState` function currently omits `placedObjects` and `customImages`. Add them (with empty defaults until Task 3 fully wires them):

  ```typescript
  getSerializableState: (): SerializedMapData => {
    const s = get()
    return {
      version: '1.0',
      mapSettings: s.mapSettings,
      grid: {
        visible: s.grid.visible,
        snapDivision: s.grid.snapDivision,
        style: s.grid.style,
      },
      layers: s.layers,
      lights: s.lights,
      placedObjects: s.layers
        .filter((l) => l.type === 'images')
        .flatMap((l) => (l.type === 'images' ? l.objects : [])),
      customImages: {},
    }
  },
  ```

  Also update `loadFromFile` to restore placed objects into their layers and add the new store actions to the main store object:

  ```typescript
  // In the store's main returned object, spread the new slice:
  ...createAssetsSlice(set, get, api),   // already present
  // The new methods (setManifest, markCategoryLoaded) are included via the slice

  // In loadFromFile, after restoring lights:
  // Restore placed objects into their respective image layers
  if (data.placedObjects) {
    for (const obj of data.placedObjects) {
      const layer = state.layers.find((l) => l.id === obj.layerId && l.type === 'images')
      if (layer && layer.type === 'images') {
        layer.objects.push(obj)
      }
    }
  }
  ```

- [x] **Step 1.8 — Fix the `store.test.ts` serialization test**

  The existing test checks `data.version` is `'1.0'`. That test must still pass. Verify it still checks the correct shape and update to also assert `placedObjects` exists:

  ```typescript
  it('getSerializableState returns correct shape', () => {
    const data = useStore.getState().getSerializableState()
    expect(data.version).toBe('1.0')
    expect(data.mapSettings.name).toBe('Untitled Map')
    expect(data.layers).toHaveLength(2)
    expect(data.lights).toEqual([])
    expect(data.placedObjects).toEqual([])       // NEW assertion
    expect(data.customImages).toEqual({})         // NEW assertion
  })
  ```

- [x] **Step 1.9 — Run `pnpm check` and confirm green**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm check
  ```

  Expected: all tests pass including the new `assets.test.ts` tests. Zero type errors, zero lint warnings.

- [x] **Step 1.10 — Commit**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && git add src/store/types.ts src/store/factories.ts src/store/store.ts src/store/slices/assets.ts src/store/slices/assets.test.ts src/store/slices/layers.ts src/store/store.test.ts && git commit -m "$(cat <<'EOF'
  feat(store): expand types for Month 1 — Light name/visible, PlacedObject, AssetManifest, v1.0 schema additions

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: PIXI.Assets Manifest Skeleton

**Files:**
- Create: `src/assets/manifest.json`
- Create: `src/engine/assetManifest.ts`
- Modify: `src/engine/PixiRenderEngine.ts` (add bundle registration on init)
- Create: `src/engine/assetManifest.test.ts`

**Context:** We need a static `manifest.json` that defines the five asset categories. The engine registers bundles from it on init so that UI Dev can call `PIXI.Assets.loadBundle(categoryId)` without any coordination. Real sprite URLs are empty arrays for now — adding sprites later requires only editing the JSON, not any TypeScript.

---

- [x] **Step 2.1 — Write failing test for manifest loading**

  Create `src/engine/assetManifest.test.ts`:

  ```typescript
  // src/engine/assetManifest.test.ts
  import { describe, it, expect } from 'vitest'
  import { getManifest, CATEGORY_IDS } from './assetManifest.ts'

  describe('assetManifest', () => {
    it('exports the correct category IDs', () => {
      expect(CATEGORY_IDS).toEqual([
        'furniture',
        'structures',
        'nature',
        'doors',
        'miscellaneous',
      ])
    })

    it('getManifest returns an AssetManifest with all five categories', () => {
      const manifest = getManifest()
      expect(manifest.categories).toHaveLength(5)
      const ids = manifest.categories.map((c) => c.id)
      expect(ids).toEqual(CATEGORY_IDS)
    })

    it('each category has id, label, and assets array', () => {
      const manifest = getManifest()
      for (const category of manifest.categories) {
        expect(typeof category.id).toBe('string')
        expect(typeof category.label).toBe('string')
        expect(Array.isArray(category.assets)).toBe(true)
      }
    })

    it('category labels match expected display names', () => {
      const manifest = getManifest()
      const labelMap: Record<string, string> = {
        furniture: 'Furniture',
        structures: 'Structures',
        nature: 'Nature',
        doors: 'Doors',
        miscellaneous: 'Miscellaneous',
      }
      for (const category of manifest.categories) {
        expect(category.label).toBe(labelMap[category.id])
      }
    })
  })
  ```

- [x] **Step 2.2 — Run tests to confirm failure**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm test 2>&1 | grep -A5 'assetManifest'
  ```

  Expected: `Cannot find module './assetManifest.ts'` or similar.

- [x] **Step 2.3 — Create `src/assets/manifest.json`**

  ```json
  {
    "categories": [
      {
        "id": "furniture",
        "label": "Furniture",
        "assets": []
      },
      {
        "id": "structures",
        "label": "Structures",
        "assets": []
      },
      {
        "id": "nature",
        "label": "Nature",
        "assets": []
      },
      {
        "id": "doors",
        "label": "Doors",
        "assets": []
      },
      {
        "id": "miscellaneous",
        "label": "Miscellaneous",
        "assets": []
      }
    ]
  }
  ```

- [x] **Step 2.4 — Create `src/engine/assetManifest.ts`**

  ```typescript
  // src/engine/assetManifest.ts
  // Typed wrapper around the static manifest.json.
  // Engine Dev uses registerManifestBundles() on init.
  // UI Dev uses getManifest() to drive the asset browser category list.
  import rawManifest from '../assets/manifest.json'
  import type { AssetManifest } from '@/store/types'

  export const CATEGORY_IDS = [
    'furniture',
    'structures',
    'nature',
    'doors',
    'miscellaneous',
  ] as const

  export type CategoryId = (typeof CATEGORY_IDS)[number]

  /**
   * Returns the typed asset manifest.
   * Safe to call at module load time — no async required.
   */
  export function getManifest(): AssetManifest {
    return rawManifest as AssetManifest
  }

  /**
   * Register all categories as PIXI.Assets bundles.
   * Call once during engine initialization (PixiRenderEngine.init()).
   * Each bundle is empty until real sprites are added to manifest.json.
   * Lazy-load individual categories via PIXI.Assets.loadBundle(categoryId).
   */
  export async function registerManifestBundles(): Promise<void> {
    // Dynamic import keeps pixi.js out of unit test environments
    const { Assets } = await import('pixi.js')
    const manifest = getManifest()

    for (const category of manifest.categories) {
      // Build the PIXI bundle format: array of { alias, src } entries
      const bundleAssets = category.assets.map((asset) => ({
        alias: asset.id,
        src: asset.url,
      }))

      // Only register if there are assets to load — empty bundles are no-ops
      if (bundleAssets.length > 0) {
        Assets.addBundle(category.id, bundleAssets)
      }
    }
  }
  ```

- [x] **Step 2.5 — Wire `registerManifestBundles` into `PixiRenderEngine.init()`**

  Open `src/engine/PixiRenderEngine.ts` and locate the `init()` method. Add the manifest registration call after `app.init()` resolves and before the scene graph is built. The exact location depends on the current `init()` body — find the line after `await app.init(...)` succeeds and add:

  ```typescript
  import { registerManifestBundles } from './assetManifest.ts'

  // Inside init(), after app.init() resolves:
  await registerManifestBundles()
  ```

  Also load the manifest into the store so UI can read it:

  ```typescript
  import { getManifest } from './assetManifest.ts'
  import { useStore } from '@/store/store'

  // After registerManifestBundles():
  useStore.getState().setManifest(getManifest())
  ```

- [x] **Step 2.6 — Add JSON import support to `tsconfig.app.json` (if not present)**

  Verify that `tsconfig.app.json` has `"resolveJsonModule": true` in `compilerOptions`. If not, add it. Then verify `vite.config.ts` does not need additional configuration (Vite handles JSON imports natively).

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && grep 'resolveJsonModule' tsconfig.app.json || echo "MISSING — needs to be added"
  ```

  If missing, add to `tsconfig.app.json` compilerOptions:
  ```json
  "resolveJsonModule": true
  ```

- [x] **Step 2.7 — Run `pnpm check` and confirm green**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm check
  ```

  All five `assetManifest.test.ts` tests should now pass.

- [x] **Step 2.8 — Commit**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && git add src/assets/manifest.json src/engine/assetManifest.ts src/engine/assetManifest.test.ts src/engine/PixiRenderEngine.ts && git commit -m "$(cat <<'EOF'
  feat(assets): add PIXI.Assets manifest skeleton with five category bundles

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Serialization Version Bump to v1.1

**Files:**
- Modify: `src/store/types.ts` (SerializedMapData version literal, add migration type)
- Modify: `src/store/store.ts` (getSerializableState v1.1, loadFromFile v1.1 + migration)
- Create: `src/store/migration.ts` (v1.0 → v1.1 migration logic)
- Create: `src/store/migration.test.ts`
- Modify: `src/store/store.test.ts` (update version assertion)

**Context:** The store currently emits version `'1.0'`. We bump to `'1.1'`, add `placedObjects` and `customImages` to the serialized shape, and provide a migration path so that existing `'1.0'` saves can still be loaded cleanly.

---

- [x] **Step 3.1 — Write failing migration tests**

  Create `src/store/migration.test.ts`:

  ```typescript
  // src/store/migration.test.ts
  import { describe, it, expect } from 'vitest'
  import { migrateToLatest, CURRENT_VERSION } from './migration.ts'
  import type { SerializedMapData } from './types.ts'

  describe('migrateToLatest', () => {
    it('exports CURRENT_VERSION as 1.1', () => {
      expect(CURRENT_VERSION).toBe('1.1')
    })

    it('returns v1.1 data unchanged', () => {
      const data: SerializedMapData = {
        version: '1.1',
        mapSettings: {
          name: 'Test',
          gridType: 'square',
          cellScale: { value: 5, unit: 'ft' },
          ambientLight: '#1a1a2e',
        },
        grid: { visible: true, snapDivision: 2, style: 'clean' },
        layers: [],
        lights: [],
        placedObjects: [],
        customImages: {},
      }
      const result = migrateToLatest(data)
      expect(result.version).toBe('1.1')
      expect(result.placedObjects).toEqual([])
      expect(result.customImages).toEqual({})
    })

    it('migrates v1.0 data to v1.1 — adds placedObjects and customImages', () => {
      // v1.0 did not have placedObjects or customImages
      const v10Data = {
        version: '1.0',
        mapSettings: {
          name: 'Old Map',
          gridType: 'square' as const,
          cellScale: { value: 5, unit: 'ft' },
          ambientLight: '#1a1a2e',
        },
        grid: { visible: true, snapDivision: 2 as const, style: 'clean' as const },
        layers: [],
        lights: [],
        // NOTE: no placedObjects or customImages — simulates old format
      }
      const result = migrateToLatest(v10Data as unknown as SerializedMapData)
      expect(result.version).toBe('1.1')
      expect(result.placedObjects).toEqual([])
      expect(result.customImages).toEqual({})
    })

    it('migrates v1.0 lights — adds default name and visible fields', () => {
      const v10Data = {
        version: '1.0',
        mapSettings: {
          name: 'Torch Map',
          gridType: 'square' as const,
          cellScale: { value: 5, unit: 'ft' },
          ambientLight: '#000000',
        },
        grid: { visible: true, snapDivision: 1 as const, style: 'dotted' as const },
        layers: [],
        lights: [
          // v1.0 light — no name or visible field
          { id: 'l1', position: { x: 0, y: 0 }, color: '#fff', radius: 5, intensity: 1, falloff: 'linear' },
        ],
      }
      const result = migrateToLatest(v10Data as unknown as SerializedMapData)
      const light = result.lights[0]
      expect(light.name).toBe('Light')
      expect(light.visible).toBe(true)
    })

    it('throws for unknown versions', () => {
      const badData = { version: '0.9', mapSettings: {}, grid: {}, layers: [], lights: [] }
      expect(() => migrateToLatest(badData as unknown as SerializedMapData)).toThrow(
        /unsupported.*version/i
      )
    })
  })
  ```

- [x] **Step 3.2 — Run tests to confirm failure**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm test 2>&1 | grep -A5 'migration'
  ```

  Expected: `Cannot find module './migration.ts'`.

- [x] **Step 3.3 — Create `src/store/migration.ts`**

  ```typescript
  // src/store/migration.ts
  // Version migration pipeline for SerializedMapData.
  // Each migrator function takes the previous version's data shape and returns the next.
  import type { SerializedMapData, Light } from './types.ts'

  export const CURRENT_VERSION = '1.1' as const

  /**
   * Migrate a saved file from any supported version to the latest version.
   * Mutates and returns the data object (callers should pass structuredClone if needed).
   * Throws for unknown/unsupported versions.
   */
  export function migrateToLatest(data: SerializedMapData): SerializedMapData {
    if (data.version === CURRENT_VERSION) {
      return data
    }

    if (data.version === '1.0') {
      return migrateV10ToV11(data)
    }

    throw new Error(`Unsupported version: "${data.version}" — cannot migrate to ${CURRENT_VERSION}`)
  }

  // ─── v1.0 → v1.1 ──────────────────────────────────────────────────────────

  function migrateV10ToV11(data: SerializedMapData): SerializedMapData {
    // Add missing placedObjects array
    if (!('placedObjects' in data)) {
      (data as SerializedMapData).placedObjects = []
    }

    // Add missing customImages map
    if (!('customImages' in data)) {
      (data as SerializedMapData).customImages = {}
    }

    // Migrate lights: add default name and visible fields
    data.lights = data.lights.map((light): Light => ({
      ...light,
      name: (light as Light & { name?: string }).name ?? 'Light',
      visible: (light as Light & { visible?: boolean }).visible ?? true,
    }))

    data.version = '1.1'
    return data
  }
  ```

- [x] **Step 3.4 — Update `src/store/types.ts` SerializedMapData**

  Change the `version` field to a union literal type (the `string` type allowed anything — the union makes the type exact):

  ```typescript
  export interface SerializedMapData {
    version: '1.0' | '1.1'
    mapSettings: MapSettings
    grid: Pick<GridConfig, 'visible' | 'snapDivision' | 'style'>
    layers: Layer[]
    lights: Light[]
    placedObjects: PlacedObject[]
    customImages: Record<string, string>
  }
  ```

  **Note:** The migration test casts `version: '1.0'` explicitly, so the union type will not break existing test patterns.

- [x] **Step 3.5 — Update `src/store/store.ts`**

  Import `migrateToLatest` and `CURRENT_VERSION`:

  ```typescript
  import { migrateToLatest, CURRENT_VERSION } from './migration.ts'
  ```

  Update `getSerializableState` to emit `'1.1'` and include all new fields:

  ```typescript
  getSerializableState: (): SerializedMapData => {
    const s = get()
    return {
      version: CURRENT_VERSION,
      mapSettings: s.mapSettings,
      grid: {
        visible: s.grid.visible,
        snapDivision: s.grid.snapDivision,
        style: s.grid.style,
      },
      layers: s.layers,
      lights: s.lights,
      placedObjects: s.layers
        .filter((l) => l.type === 'images')
        .flatMap((l) => (l.type === 'images' ? l.objects : [])),
      customImages: {},   // Phase 2 Task 6 populates this
    }
  },
  ```

  Update `loadFromFile` to run migration before restoring state:

  ```typescript
  loadFromFile: (data: SerializedMapData) => {
    if (!data.version) {
      console.warn('loadFromFile: missing version field, aborting load')
      return
    }

    let migrated: SerializedMapData
    try {
      migrated = migrateToLatest(structuredClone(data))
    } catch (err) {
      console.error('loadFromFile: migration failed —', err)
      return
    }

    set((state) => {
      state.mapSettings = migrated.mapSettings
      state.grid = {
        ...state.grid,
        visible: migrated.grid.visible,
        snapDivision: migrated.grid.snapDivision,
        style: migrated.grid.style,
        snapEnabled: true,
      }
      state.layers = migrated.layers

      // Restore placed objects into their image layers
      if (migrated.placedObjects?.length) {
        for (const obj of migrated.placedObjects) {
          const layer = state.layers.find(
            (l) => l.id === obj.layerId && l.type === 'images'
          )
          if (layer && layer.type === 'images') {
            layer.objects.push(obj)
          }
        }
      }

      state.lights = migrated.lights

      state.ui.activeLayerId =
        migrated.layers.find((l) => l.type === 'dungeon')?.id ?? ''
      state.ui.selectedObjectIds = []
      state.ui.expandedLayerIds = []
      state.ui.canUndo = false
      state.ui.canRedo = false
      state.ui.modalState = null
      state.ui.toastQueue = []
      state.tools.activeTool = 'rectangle'
      state.tools.eraseMode = false
      state.tools.roughMode = false
      state.selection.selectedRegion = null
      state.selection.clipboard = null
    })
  },
  ```

- [x] **Step 3.6 — Update `src/store/store.test.ts` version assertion**

  ```typescript
  it('getSerializableState returns correct shape', () => {
    const data = useStore.getState().getSerializableState()
    expect(data.version).toBe('1.1')    // was '1.0'
    expect(data.mapSettings.name).toBe('Untitled Map')
    expect(data.layers).toHaveLength(2)
    expect(data.lights).toEqual([])
    expect(data.placedObjects).toEqual([])
    expect(data.customImages).toEqual({})
  })
  ```

  Also add a new round-trip test:

  ```typescript
  it('loadFromFile v1.1 round-trips all data correctly', () => {
    const original = useStore.getState().getSerializableState()
    original.mapSettings.name = 'Round-Trip Map'
    useStore.getState().loadFromFile(original)
    expect(useStore.getState().mapSettings.name).toBe('Round-Trip Map')
  })

  it('loadFromFile migrates v1.0 data to v1.1', () => {
    const v10: SerializedMapData = {
      version: '1.0',
      mapSettings: {
        name: 'Old Map',
        gridType: 'square',
        cellScale: { value: 5, unit: 'ft' },
        ambientLight: '#000000',
      },
      grid: { visible: true, snapDivision: 2, style: 'clean' },
      layers: useStore.getState().layers,
      lights: [],
      placedObjects: [],
      customImages: {},
    }
    useStore.getState().loadFromFile(v10)
    expect(useStore.getState().mapSettings.name).toBe('Old Map')
  })
  ```

  Add `import type { SerializedMapData } from './types.ts'` at the top if not already present.

- [x] **Step 3.7 — Run `pnpm check` and confirm green**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm check
  ```

  All migration tests should pass. All existing store tests should still pass.

- [x] **Step 3.8 — Commit**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && git add src/store/types.ts src/store/store.ts src/store/store.test.ts src/store/migration.ts src/store/migration.test.ts && git commit -m "$(cat <<'EOF'
  feat(store): bump serialization to v1.1 — placedObjects, customImages, v1.0 migration

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## 🚦 GATE: Phase 1 Complete

Signal to orchestrator that UI Dev and Tools Dev agents can now spawn.
All Phase 2 work below continues in parallel with other agents.

**Verification checklist before signalling:**
- [x] `pnpm check` passes with zero errors and zero warnings
- [x] `src/store/types.ts` exports `Light` (with `name`/`visible`), `PlacedObject` (with `assetId`, `flipX`, `flipY`, etc.), `AssetManifest`, `AssetEntry`, `AssetCategory`
- [x] `src/assets/manifest.json` exists with five categories
- [x] `src/engine/assetManifest.ts` exports `getManifest()` and `registerManifestBundles()`
- [x] `src/store/migration.ts` exports `migrateToLatest()` and `CURRENT_VERSION = '1.1'`
- [x] `getSerializableState()` emits `version: '1.1'` with `placedObjects` and `customImages` fields
- [x] `loadFromFile()` calls `migrateToLatest()` before restoring state

---

## Phase 2 — Save/Load Continuation

---

### Task 4: Native Save/Load (.mapbuilder)

**Files:**
- Run: `pnpm add fflate` (fflate is NOT currently in package.json — must be added)
- Create: `src/io/saveLoad.ts`
- Create: `src/io/saveLoad.test.ts`
- Modify: `src/shortcuts/defaultShortcuts.ts` (wire `file.save` stub)
- Create: `src/hooks/useSaveLoad.ts` (React hook for component-level access)

**Context:** The `file.save` shortcut at line ~59 of `defaultShortcuts.ts` is a stub that only `console.log`s. This task replaces it with a full save pipeline using fflate gzip compression. The File System Access API (Chrome/Edge) is used when available, with a download-fallback for Firefox/Safari.

---

- [x] **Step 4.1 — Install fflate**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm add fflate && pnpm add -D @types/fflate 2>/dev/null || true
  ```

  Note: fflate ships its own TypeScript types, so `@types/fflate` is not needed. Verify:

  ```bash
  grep '"fflate"' /Users/admin/Desktop/Files/map-builder/package.json
  ```

- [x] **Step 4.2 — Write failing unit tests for saveLoad module**

  Create `src/io/saveLoad.test.ts`:

  ```typescript
  // src/io/saveLoad.test.ts
  // NOTE: Tests run in Vitest (jsdom/node) — FSA API is not available.
  // We test the compression/decompression and serialization logic only.
  // E2E Playwright tests cover the full browser save/load flow.
  import { describe, it, expect } from 'vitest'
  import { serializeToBytes, deserializeFromBytes, MAGIC_HEADER } from './saveLoad.ts'
  import type { SerializedMapData } from '@/store/types'

  const SAMPLE_DATA: SerializedMapData = {
    version: '1.1',
    mapSettings: {
      name: 'Test Dungeon',
      gridType: 'square',
      cellScale: { value: 5, unit: 'ft' },
      ambientLight: '#1a1a2e',
    },
    grid: { visible: true, snapDivision: 2, style: 'clean' },
    layers: [],
    lights: [],
    placedObjects: [],
    customImages: {},
  }

  describe('saveLoad — serializeToBytes / deserializeFromBytes', () => {
    it('serializeToBytes returns a Uint8Array starting with the magic header', async () => {
      const bytes = await serializeToBytes(SAMPLE_DATA)
      expect(bytes).toBeInstanceOf(Uint8Array)
      const header = new TextDecoder().decode(bytes.slice(0, MAGIC_HEADER.length))
      expect(header).toBe(MAGIC_HEADER)
    })

    it('deserializeFromBytes round-trips the data correctly', async () => {
      const bytes = await serializeToBytes(SAMPLE_DATA)
      const result = await deserializeFromBytes(bytes)
      expect(result.version).toBe('1.1')
      expect(result.mapSettings.name).toBe('Test Dungeon')
      expect(result.lights).toEqual([])
      expect(result.placedObjects).toEqual([])
    })

    it('deserializeFromBytes throws on invalid magic header', async () => {
      const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03])
      await expect(deserializeFromBytes(bad)).rejects.toThrow(/invalid.*file/i)
    })

    it('serialized bytes are smaller than raw JSON for non-trivial data', async () => {
      // Add some content to make compression meaningful
      const bigData: SerializedMapData = {
        ...SAMPLE_DATA,
        mapSettings: { ...SAMPLE_DATA.mapSettings, name: 'Big Map '.repeat(50) },
      }
      const bytes = await serializeToBytes(bigData)
      const rawJson = new TextEncoder().encode(JSON.stringify(bigData))
      // Gzip should compress repetitive data significantly
      expect(bytes.length).toBeLessThan(rawJson.length)
    })
  })
  ```

- [x] **Step 4.3 — Run tests to confirm failure**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm test 2>&1 | grep -A5 'saveLoad'
  ```

  Expected: `Cannot find module './saveLoad.ts'`.

- [x] **Step 4.4 — Create `src/io/saveLoad.ts`**

  ```typescript
  // src/io/saveLoad.ts
  // Native .mapbuilder save/load pipeline.
  //
  // File format:
  //   [MAGIC_HEADER bytes] + [gzip-compressed UTF-8 JSON of SerializedMapData]
  //
  // Save strategy:
  //   - Chrome/Edge: File System Access API (showSaveFilePicker) — allows overwrite
  //   - Firefox/Safari: URL.createObjectURL download fallback
  //
  // The FSA file handle is stored in module state (not serialized).
  // Ctrl+S reuses the handle for silent overwrite after first explicit save.

  import { gzip, ungzip, strToU8, strFromU8 } from 'fflate'
  import type { SerializedMapData } from '@/store/types'
  import { useStore } from '@/store/store'

  // Magic bytes to identify .mapbuilder files — "MPBLD\x00"
  export const MAGIC_HEADER = 'MPBLD\x00'
  const MAGIC_BYTES = new TextEncoder().encode(MAGIC_HEADER)

  // In-memory FSA file handle — survives the session but not a page reload
  let _currentFileHandle: FileSystemFileHandle | null = null

  export function getCurrentFileHandle(): FileSystemFileHandle | null {
    return _currentFileHandle
  }

  export function clearFileHandle(): void {
    _currentFileHandle = null
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  /**
   * Serialize `SerializedMapData` to a compressed Uint8Array with magic header.
   * Pure function — no side effects.
   */
  export async function serializeToBytes(data: SerializedMapData): Promise<Uint8Array> {
    const json = JSON.stringify(data)
    const jsonBytes = strToU8(json)

    return new Promise((resolve, reject) => {
      gzip(jsonBytes, (err, compressed) => {
        if (err) {
          reject(new Error(`gzip failed: ${err.message}`))
          return
        }
        const result = new Uint8Array(MAGIC_BYTES.length + compressed.length)
        result.set(MAGIC_BYTES, 0)
        result.set(compressed, MAGIC_BYTES.length)
        resolve(result)
      })
    })
  }

  /**
   * Deserialize a Uint8Array produced by `serializeToBytes` back to `SerializedMapData`.
   * Validates the magic header before decompressing.
   */
  export async function deserializeFromBytes(bytes: Uint8Array): Promise<SerializedMapData> {
    // Validate magic header
    const headerBytes = bytes.slice(0, MAGIC_BYTES.length)
    const header = new TextDecoder().decode(headerBytes)
    if (header !== MAGIC_HEADER) {
      throw new Error('Invalid .mapbuilder file — unrecognized header bytes')
    }

    const compressed = bytes.slice(MAGIC_BYTES.length)

    return new Promise((resolve, reject) => {
      ungzip(compressed, (err, decompressed) => {
        if (err) {
          reject(new Error(`ungzip failed: ${err.message}`))
          return
        }
        try {
          const json = strFromU8(decompressed)
          const data = JSON.parse(json) as SerializedMapData
          resolve(data)
        } catch (parseErr) {
          reject(new Error(`JSON parse failed: ${String(parseErr)}`))
        }
      })
    })
  }

  // ─── Save ─────────────────────────────────────────────────────────────────

  /**
   * Save the current store state to a .mapbuilder file.
   *
   * On Chrome/Edge: uses File System Access API.
   *   - If `_currentFileHandle` is set, overwrites silently (Ctrl+S behavior).
   *   - Otherwise, prompts for file location.
   * On Firefox/Safari: triggers a download.
   *
   * Returns true on success, false if the user cancelled.
   */
  export async function saveMap(forceNewFile = false): Promise<boolean> {
    const data = useStore.getState().getSerializableState()
    const compressed = await serializeToBytes(data)
    const mapName = data.mapSettings.name || 'untitled-map'
    const filename = `${mapName.replace(/[^a-z0-9\-_ ]/gi, '_')}.mapbuilder`

    if ('showSaveFilePicker' in window && !forceNewFile) {
      // Use existing handle for silent overwrite if available
      if (_currentFileHandle) {
        try {
          const writable = await _currentFileHandle.createWritable()
          await writable.write(compressed)
          await writable.close()
          return true
        } catch {
          // Handle became invalid (e.g. file deleted) — fall through to prompt
          _currentFileHandle = null
        }
      }

      // Prompt for save location
      try {
        const handle = await (window as Window & typeof globalThis).showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: 'Map Builder File',
              accept: { 'application/octet-stream': ['.mapbuilder'] },
            },
          ],
        })
        const writable = await handle.createWritable()
        await writable.write(compressed)
        await writable.close()
        _currentFileHandle = handle
        return true
      } catch (err) {
        // User cancelled the picker
        if ((err as DOMException).name === 'AbortError') return false
        throw err
      }
    } else {
      // Fallback download for Firefox/Safari
      downloadBytes(compressed, filename)
      return true
    }
  }

  /**
   * Open a .mapbuilder file picker and load the selected file into the store.
   * Returns true on success, false if the user cancelled.
   */
  export async function loadMap(): Promise<boolean> {
    let fileBytes: Uint8Array

    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as Window & typeof globalThis).showOpenFilePicker({
          types: [
            {
              description: 'Map Builder File',
              accept: { 'application/octet-stream': ['.mapbuilder'] },
            },
          ],
          multiple: false,
        })
        const file = await handle.getFile()
        const buffer = await file.arrayBuffer()
        fileBytes = new Uint8Array(buffer)
        // Store handle for subsequent Ctrl+S overwrite
        _currentFileHandle = handle
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return false
        throw err
      }
    } else {
      // Fallback: use standard <input type="file"> via promise
      fileBytes = await pickFileViaInput()
      if (!fileBytes) return false
    }

    const data = await deserializeFromBytes(fileBytes)
    useStore.getState().loadFromFile(data)
    return true
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function downloadBytes(bytes: Uint8Array, filename: string): void {
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function pickFileViaInput(): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.mapbuilder'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          resolve(new Uint8Array(reader.result as ArrayBuffer))
        }
        reader.onerror = () => resolve(null)
        reader.readAsArrayBuffer(file)
      }
      // Resolve null if no file chosen (cancel)
      input.oncancel = () => resolve(null)
      input.click()
    })
  }
  ```

- [x] **Step 4.5 — Wire `file.save` in `src/shortcuts/defaultShortcuts.ts`**

  Replace the `file.save` stub:

  ```typescript
  // At the top of the file, add import:
  import { saveMap } from '@/io/saveLoad'

  // Replace in toolKeyMap:
  'file.save': () => {
    saveMap().catch((err: unknown) => {
      console.error('[save] failed:', err)
      useStore.getState().pushToast({
        id: `save-error-${Date.now()}`,
        message: 'Save failed — see console for details.',
        type: 'error',
        duration: 4000,
        createdAt: Date.now(),
      })
    })
  },
  ```

  Also add `file.load` shortcut entry to `createDefaultShortcuts()` array and handler:

  ```typescript
  // In createDefaultShortcuts() return array, add:
  { id: 'file.load', keys: 'ctrl+o', category: 'File', label: 'Open' },

  // In toolKeyMap, add:
  'file.load': () => {
    import('@/io/saveLoad').then(({ loadMap }) => {
      loadMap().catch((err: unknown) => {
        console.error('[load] failed:', err)
      })
    })
  },
  ```

- [x] **Step 4.6 — Create `src/hooks/useSaveLoad.ts`**

  A React hook for toolbar/menu components to trigger save/load:

  ```typescript
  // src/hooks/useSaveLoad.ts
  import { useCallback } from 'react'
  import { saveMap, loadMap } from '@/io/saveLoad'
  import { useStore } from '@/store/store'

  export function useSaveLoad() {
    const pushToast = useStore((s) => s.pushToast)

    const save = useCallback(
      async (forceNewFile = false) => {
        try {
          const saved = await saveMap(forceNewFile)
          if (saved) {
            pushToast({
              id: `saved-${Date.now()}`,
              message: 'Map saved.',
              type: 'info',
              duration: 2000,
              createdAt: Date.now(),
            })
          }
        } catch (err) {
          console.error('[useSaveLoad] save failed:', err)
          pushToast({
            id: `save-error-${Date.now()}`,
            message: 'Save failed.',
            type: 'error',
            duration: 4000,
            createdAt: Date.now(),
          })
        }
      },
      [pushToast]
    )

    const load = useCallback(async () => {
      try {
        await loadMap()
      } catch (err) {
        console.error('[useSaveLoad] load failed:', err)
        pushToast({
          id: `load-error-${Date.now()}`,
          message: 'Load failed — file may be corrupt.',
          type: 'error',
          duration: 4000,
          createdAt: Date.now(),
        })
      }
    }, [pushToast])

    return { save, load }
  }
  ```

- [x] **Step 4.7 — Add FSA type declarations to TypeScript**

  The File System Access API (`showSaveFilePicker`, `showOpenFilePicker`) is not in the standard lib. Add a minimal declaration file:

  Create `src/types/fsa.d.ts`:

  ```typescript
  // src/types/fsa.d.ts
  // Minimal declarations for File System Access API methods.
  // Only the subset used in src/io/saveLoad.ts.

  interface SaveFilePickerOptions {
    suggestedName?: string
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
  }

  interface OpenFilePickerOptions {
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
    multiple?: boolean
  }

  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
  }
  ```

- [x] **Step 4.8 — Run `pnpm check` and confirm green**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm check
  ```

  All `saveLoad.test.ts` tests should pass. Zero type errors. Zero lint warnings.

  If fflate types cause any issues, verify the import paths match fflate's actual export (`import { gzip, ungzip, strToU8, strFromU8 } from 'fflate'`).

- [x] **Step 4.9 — Commit**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && git add package.json pnpm-lock.yaml src/io/saveLoad.ts src/io/saveLoad.test.ts src/shortcuts/defaultShortcuts.ts src/hooks/useSaveLoad.ts src/types/fsa.d.ts && git commit -m "$(cat <<'EOF'
  feat(io): add .mapbuilder save/load — fflate gzip, FSA API, download fallback, Ctrl+S wiring

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: IndexedDB Autosave

**Files:**
- Create: `src/io/autosave.ts`
- Create: `src/io/autosave.test.ts`
- Modify: `src/App.tsx` (mount autosave subscriber on app init)
- Create: `src/components/shared/RecoveryDialog.tsx`

**Context:** The autosave system uses a dirty flag in `localStorage` and IndexedDB for the actual save data. If the app loads and the dirty flag is set (meaning the last session didn't cleanly save), a recovery dialog offers to restore from the autosaved data. The autosave triggers 30 seconds after the last store mutation (debounced).

---

- [x] **Step 5.1 — Write failing unit tests for autosave module**

  Create `src/io/autosave.test.ts`:

  ```typescript
  // src/io/autosave.test.ts
  // Tests use fake IndexedDB via vitest's jsdom environment.
  // The actual IDB calls are tested via the module's exported helpers.
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
  import {
    AUTOSAVE_DB_NAME,
    AUTOSAVE_STORE_NAME,
    AUTOSAVE_KEY,
    DIRTY_FLAG_KEY,
    setDirtyFlag,
    clearDirtyFlag,
    isDirtyFlagSet,
    saveToIndexedDB,
    loadFromIndexedDB,
  } from './autosave.ts'
  import type { SerializedMapData } from '@/store/types'

  const SAMPLE_DATA: SerializedMapData = {
    version: '1.1',
    mapSettings: {
      name: 'Autosave Test',
      gridType: 'square',
      cellScale: { value: 5, unit: 'ft' },
      ambientLight: '#000000',
    },
    grid: { visible: true, snapDivision: 2, style: 'clean' },
    layers: [],
    lights: [],
    placedObjects: [],
    customImages: {},
  }

  describe('autosave constants', () => {
    it('exports correct key constants', () => {
      expect(AUTOSAVE_DB_NAME).toBe('mapbuilder')
      expect(AUTOSAVE_STORE_NAME).toBe('saves')
      expect(AUTOSAVE_KEY).toBe('mapbuilder-autosave')
      expect(DIRTY_FLAG_KEY).toBe('mapbuilder-dirty')
    })
  })

  describe('dirty flag (localStorage)', () => {
    beforeEach(() => {
      localStorage.clear()
    })
    afterEach(() => {
      localStorage.clear()
    })

    it('isDirtyFlagSet returns false when flag is absent', () => {
      expect(isDirtyFlagSet()).toBe(false)
    })

    it('setDirtyFlag sets the flag', () => {
      setDirtyFlag()
      expect(isDirtyFlagSet()).toBe(true)
    })

    it('clearDirtyFlag clears the flag', () => {
      setDirtyFlag()
      clearDirtyFlag()
      expect(isDirtyFlagSet()).toBe(false)
    })
  })

  describe('IndexedDB autosave', () => {
    beforeEach(async () => {
      // Clean up any existing IDB state between tests
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(AUTOSAVE_DB_NAME)
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
      })
    })

    it('loadFromIndexedDB returns null when no data exists', async () => {
      const result = await loadFromIndexedDB()
      expect(result).toBeNull()
    })

    it('saveToIndexedDB persists data and loadFromIndexedDB retrieves it', async () => {
      await saveToIndexedDB(SAMPLE_DATA)
      const result = await loadFromIndexedDB()
      expect(result).not.toBeNull()
      expect(result?.data.mapSettings.name).toBe('Autosave Test')
      expect(typeof result?.savedAt).toBe('number')
    })

    it('saveToIndexedDB overwrites previous save', async () => {
      await saveToIndexedDB(SAMPLE_DATA)
      const updated: SerializedMapData = {
        ...SAMPLE_DATA,
        mapSettings: { ...SAMPLE_DATA.mapSettings, name: 'Updated Map' },
      }
      await saveToIndexedDB(updated)
      const result = await loadFromIndexedDB()
      expect(result?.data.mapSettings.name).toBe('Updated Map')
    })
  })
  ```

- [x] **Step 5.2 — Run tests to confirm failure**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm test 2>&1 | grep -A5 'autosave'
  ```

  Expected: `Cannot find module './autosave.ts'`.

- [x] **Step 5.3 — Create `src/io/autosave.ts`**

  ```typescript
  // src/io/autosave.ts
  // IndexedDB autosave + dirty flag management.
  //
  // Dirty flag lifecycle:
  //   - Set: immediately on any store mutation (via Zustand subscriber)
  //   - Cleared: on successful explicit save OR successful autosave
  //
  // Autosave trigger: debounced 30s after last store mutation.
  //
  // Recovery check: on app mount, if dirty flag is set, prompt user to restore.

  import type { SerializedMapData } from '@/store/types'

  // ─── Constants ────────────────────────────────────────────────────────────

  export const AUTOSAVE_DB_NAME = 'mapbuilder'
  export const AUTOSAVE_STORE_NAME = 'saves'
  export const AUTOSAVE_KEY = 'mapbuilder-autosave'
  export const DIRTY_FLAG_KEY = 'mapbuilder-dirty'

  // ─── Dirty Flag (localStorage) ───────────────────────────────────────────

  export function setDirtyFlag(): void {
    localStorage.setItem(DIRTY_FLAG_KEY, 'true')
  }

  export function clearDirtyFlag(): void {
    localStorage.removeItem(DIRTY_FLAG_KEY)
  }

  export function isDirtyFlagSet(): boolean {
    return localStorage.getItem(DIRTY_FLAG_KEY) === 'true'
  }

  // ─── IndexedDB ────────────────────────────────────────────────────────────

  export interface AutosaveEntry {
    key: string
    data: SerializedMapData
    savedAt: number   // Date.now() timestamp
  }

  /** Open (or create) the mapbuilder IndexedDB. */
  function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(AUTOSAVE_DB_NAME, 1)
      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
          db.createObjectStore(AUTOSAVE_STORE_NAME, { keyPath: 'key' })
        }
      }
      req.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result)
      req.onerror = (event) => reject((event.target as IDBOpenDBRequest).error)
    })
  }

  /**
   * Save the given SerializedMapData to IndexedDB under AUTOSAVE_KEY.
   * Sets savedAt to current timestamp.
   */
  export async function saveToIndexedDB(data: SerializedMapData): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite')
      const store = tx.objectStore(AUTOSAVE_STORE_NAME)
      const entry: AutosaveEntry = {
        key: AUTOSAVE_KEY,
        data,
        savedAt: Date.now(),
      }
      const req = store.put(entry)
      req.onsuccess = () => resolve()
      req.onerror = (event) => reject((event.target as IDBRequest).error)
      tx.oncomplete = () => db.close()
    })
  }

  /**
   * Load the autosave entry from IndexedDB.
   * Returns null if no autosave exists.
   */
  export async function loadFromIndexedDB(): Promise<AutosaveEntry | null> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readonly')
      const store = tx.objectStore(AUTOSAVE_STORE_NAME)
      const req = store.get(AUTOSAVE_KEY)
      req.onsuccess = (event) => {
        const result = (event.target as IDBRequest<AutosaveEntry | undefined>).result
        resolve(result ?? null)
        db.close()
      }
      req.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  }

  // ─── Autosave Subscriber ─────────────────────────────────────────────────

  let _debounceTimer: ReturnType<typeof setTimeout> | null = null
  const AUTOSAVE_DELAY_MS = 30_000   // 30 seconds

  /**
   * Start the autosave system.
   * Call once on app mount. Returns a cleanup function for unmount.
   *
   * The subscriber sets the dirty flag on every state change and schedules
   * an autosave 30 seconds after the last mutation.
   */
  export function startAutosave(
    getSerializableState: () => SerializedMapData,
    subscribe: (listener: () => void) => () => void,
  ): () => void {
    const handleChange = () => {
      setDirtyFlag()

      if (_debounceTimer !== null) clearTimeout(_debounceTimer)
      _debounceTimer = setTimeout(() => {
        const data = getSerializableState()
        saveToIndexedDB(data)
          .then(() => {
            clearDirtyFlag()
          })
          .catch((err: unknown) => {
            console.warn('[autosave] IndexedDB write failed:', err)
          })
      }, AUTOSAVE_DELAY_MS)
    }

    const unsubscribe = subscribe(handleChange)

    return () => {
      unsubscribe()
      if (_debounceTimer !== null) {
        clearTimeout(_debounceTimer)
        _debounceTimer = null
      }
    }
  }
  ```

- [x] **Step 5.4 — Create `src/components/shared/RecoveryDialog.tsx`**

  ```typescript
  // src/components/shared/RecoveryDialog.tsx
  // Shown on app load when the dirty flag (mapbuilder-dirty) is set in localStorage.
  // Offers to restore from the most recent IndexedDB autosave.
  import { useState, useEffect } from 'react'
  import { loadFromIndexedDB, clearDirtyFlag, isDirtyFlagSet } from '@/io/autosave'
  import { useStore } from '@/store/store'
  import type { AutosaveEntry } from '@/io/autosave'

  interface RecoveryDialogProps {
    onDismiss: () => void
  }

  export function RecoveryDialog({ onDismiss }: RecoveryDialogProps) {
    const loadFromFile = useStore((s) => s.loadFromFile)
    const [entry, setEntry] = useState<AutosaveEntry | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      loadFromIndexedDB()
        .then(setEntry)
        .catch(() => setEntry(null))
        .finally(() => setLoading(false))
    }, [])

    const handleRestore = () => {
      if (!entry) return
      loadFromFile(entry.data)
      clearDirtyFlag()
      onDismiss()
    }

    const handleDiscard = () => {
      clearDirtyFlag()
      onDismiss()
    }

    if (loading) return null

    const savedAtStr = entry
      ? new Date(entry.savedAt).toLocaleString()
      : 'unknown time'

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      >
        <div className="bg-surface-1 border border-border-subtle rounded-lg p-6 max-w-sm w-full shadow-2xl">
          <h2
            id="recovery-title"
            className="text-base font-semibold text-white mb-2"
          >
            Recover Unsaved Changes?
          </h2>
          <p className="text-sm text-text-muted mb-1">
            The previous session ended without saving.
          </p>
          {entry && (
            <p className="text-xs text-text-muted mb-4">
              Autosave from: <span className="text-white">{savedAtStr}</span>
              {' — '}<span className="text-white">{entry.data.mapSettings.name}</span>
            </p>
          )}
          {!entry && (
            <p className="text-xs text-text-muted mb-4">
              No autosave data found.
            </p>
          )}
          <div className="flex gap-3 justify-end">
            <button
              onClick={handleDiscard}
              className="px-3 py-1.5 text-sm rounded bg-surface-2 text-text-muted hover:text-white transition-colors"
            >
              Discard
            </button>
            {entry && (
              <button
                onClick={handleRestore}
                className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:bg-accent/80 transition-colors"
              >
                Restore
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }
  ```

- [x] **Step 5.5 — Mount autosave in `src/App.tsx`**

  Read the current `src/App.tsx` first, then add the recovery dialog check and autosave subscriber. The autosave subscriber must be started after the store is initialized and the engine is ready.

  Add these imports and logic to `App.tsx`:

  ```typescript
  import { useEffect, useState } from 'react'
  import { startAutosave, isDirtyFlagSet } from '@/io/autosave'
  import { useStore } from '@/store/store'
  import { RecoveryDialog } from '@/components/shared/RecoveryDialog'

  // Inside the App component function body:
  const [showRecovery, setShowRecovery] = useState(() => isDirtyFlagSet())

  useEffect(() => {
    const cleanup = startAutosave(
      () => useStore.getState().getSerializableState(),
      (listener) => useStore.subscribe(listener),
    )
    return cleanup
  }, [])
  ```

  In the JSX return, render `RecoveryDialog` before all other content when `showRecovery` is true:

  ```typescript
  {showRecovery && (
    <RecoveryDialog onDismiss={() => setShowRecovery(false)} />
  )}
  ```

- [x] **Step 5.6 — Run `pnpm check` and confirm green**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm check
  ```

  All autosave tests should pass. Zero type errors. Zero lint warnings.

- [x] **Step 5.7 — Commit**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && git add src/io/autosave.ts src/io/autosave.test.ts src/components/shared/RecoveryDialog.tsx src/App.tsx && git commit -m "$(cat <<'EOF'
  feat(io): add IndexedDB autosave with 30s debounce, dirty flag, and crash recovery dialog

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Custom Image Embedding in Save

**Files:**
- Modify: `src/io/saveLoad.ts` (add `embedCustomImages`, `restoreCustomImages`)
- Modify: `src/store/store.ts` (`getSerializableState` to include customImages)
- Modify: `src/store/store.ts` (`loadFromFile` to call `restoreCustomImages`)
- Create: `src/io/imageEmbed.ts` (base64 encode/decode + resize helpers)
- Create: `src/io/imageEmbed.test.ts`

**Context:** Custom uploaded images need to survive the save/load round-trip. They are stored as base64 data URLs in `SerializedMapData.customImages` keyed by their asset ID. On save, we encode any custom blobs registered with PIXI.Assets. On load, we decode the base64 back and re-register with PIXI.Assets before `loadFromFile` sets the layers (so Sprites can find their textures by ID).

---

- [x] **Step 6.1 — Write failing tests for imageEmbed**

  Create `src/io/imageEmbed.test.ts`:

  ```typescript
  // src/io/imageEmbed.test.ts
  import { describe, it, expect } from 'vitest'
  import {
    MAX_EMBED_DIMENSION,
    isDataUrl,
    blobToBase64,
    base64ToUint8Array,
    getImageDimensions,
    needsResize,
  } from './imageEmbed.ts'

  describe('imageEmbed helpers', () => {
    it('exports MAX_EMBED_DIMENSION as 2048', () => {
      expect(MAX_EMBED_DIMENSION).toBe(2048)
    })

    it('isDataUrl identifies data URLs correctly', () => {
      expect(isDataUrl('data:image/png;base64,abc123')).toBe(true)
      expect(isDataUrl('https://example.com/image.png')).toBe(false)
      expect(isDataUrl('/assets/sprite.png')).toBe(false)
      expect(isDataUrl('')).toBe(false)
    })

    it('blobToBase64 encodes a blob to a data URL string', async () => {
      // Create a 1x1 transparent PNG blob
      const pngBytes = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10,  // PNG magic
        0, 0, 0, 13, 73, 72, 68, 82,       // IHDR length + type
        0, 0, 0, 1, 0, 0, 0, 1,            // 1x1
        8, 6, 0, 0, 0,                      // 8-bit RGBA
        31, 21, 196, 137,                   // IHDR CRC
        0, 0, 0, 10, 73, 68, 65, 84,       // IDAT length + type
        120, 156, 98, 0, 0, 0, 2, 0, 1,    // deflate + data
        231, 33, 188, 51,                   // IDAT CRC
        0, 0, 0, 0, 73, 69, 78, 68,        // IEND
        174, 66, 96, 130,                   // IEND CRC
      ])
      const blob = new Blob([pngBytes], { type: 'image/png' })
      const dataUrl = await blobToBase64(blob)
      expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    })

    it('base64ToUint8Array decodes a base64 string to bytes', () => {
      const base64 = btoa('hello world')
      const result = base64ToUint8Array(base64)
      expect(result).toBeInstanceOf(Uint8Array)
      const decoded = new TextDecoder().decode(result)
      expect(decoded).toBe('hello world')
    })

    it('needsResize returns false for small images', () => {
      expect(needsResize(100, 100)).toBe(false)
      expect(needsResize(2048, 2048)).toBe(false)
    })

    it('needsResize returns true for oversized images', () => {
      expect(needsResize(2049, 100)).toBe(true)
      expect(needsResize(100, 2049)).toBe(true)
      expect(needsResize(4096, 4096)).toBe(true)
    })
  })
  ```

- [x] **Step 6.2 — Run tests to confirm failure**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm test 2>&1 | grep -A5 'imageEmbed'
  ```

- [x] **Step 6.3 — Create `src/io/imageEmbed.ts`**

  ```typescript
  // src/io/imageEmbed.ts
  // Utilities for encoding custom uploaded images to base64 for save file embedding
  // and decoding them back on load.
  //
  // Resize limit: 2048×2048 max before base64 encoding.
  // Encoding format: PNG preferred; JPEG at 85% quality if the source was JPEG.
  //
  // Browser-only (uses Canvas 2D API for resize). Not callable in Vitest unit tests
  // that run in jsdom without full Canvas support — test pure helpers only.

  export const MAX_EMBED_DIMENSION = 2048

  /** Returns true if the string is a data URL (data:...) */
  export function isDataUrl(url: string): boolean {
    return url.startsWith('data:')
  }

  /** Encode a Blob to a base64 data URL string. */
  export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('blobToBase64: FileReader failed'))
      reader.readAsDataURL(blob)
    })
  }

  /** Decode a pure base64 string (no data URL prefix) to Uint8Array. */
  export function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  /** Returns true if either dimension exceeds MAX_EMBED_DIMENSION. */
  export function needsResize(width: number, height: number): boolean {
    return width > MAX_EMBED_DIMENSION || height > MAX_EMBED_DIMENSION
  }

  /** Get image dimensions from a data URL or blob URL. Returns null if load fails. */
  export function getImageDimensions(
    src: string
  ): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = src
    })
  }

  /**
   * Resize an image (provided as a data URL) to fit within MAX_EMBED_DIMENSION,
   * preserving aspect ratio. Returns the resized image as a data URL.
   *
   * Uses Canvas 2D — must be called in a browser context.
   */
  export async function resizeImage(
    dataUrl: string,
    mimeType: 'image/png' | 'image/jpeg' = 'image/png',
    quality = 0.85
  ): Promise<string> {
    const dims = await getImageDimensions(dataUrl)
    if (!dims) throw new Error('resizeImage: failed to load image dimensions')

    const { width, height } = dims
    if (!needsResize(width, height)) return dataUrl

    const scale = MAX_EMBED_DIMENSION / Math.max(width, height)
    const targetW = Math.floor(width * scale)
    const targetH = Math.floor(height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('resizeImage: could not get 2D canvas context')

    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, targetW, targetH)
        const resized = canvas.toDataURL(mimeType, quality)
        resolve(resized)
      }
      img.onerror = () => reject(new Error('resizeImage: image load failed'))
      img.src = dataUrl
    })
  }

  /**
   * Prepare a custom image for embedding in a save file.
   *
   * Steps:
   *   1. If the URL is already a data URL, check dimensions and resize if needed.
   *   2. If the URL is a blob: or https: URL, fetch and convert to data URL first.
   *   3. Returns the final data URL ready for storage in customImages.
   */
  export async function prepareImageForEmbed(url: string): Promise<string> {
    let dataUrl: string

    if (isDataUrl(url)) {
      dataUrl = url
    } else {
      // Fetch the resource and convert to data URL
      const response = await fetch(url)
      const blob = await response.blob()
      dataUrl = await blobToBase64(blob)
    }

    // Resize if oversized
    const dims = await getImageDimensions(dataUrl)
    if (dims && needsResize(dims.width, dims.height)) {
      const mimeType = dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png'
      dataUrl = await resizeImage(dataUrl, mimeType)
    }

    return dataUrl
  }

  /**
   * Restore custom images from a save file's customImages map.
   *
   * For each entry in customImages, registers the data URL with PIXI.Assets
   * under the asset ID so that Sprites in image layers can resolve their textures.
   *
   * Must be called BEFORE loadFromFile() restores the layer state.
   */
  export async function restoreCustomImages(
    customImages: Record<string, string>
  ): Promise<void> {
    if (!customImages || Object.keys(customImages).length === 0) return

    const { Assets, Texture } = await import('pixi.js')

    for (const [id, dataUrl] of Object.entries(customImages)) {
      try {
        // Skip if already registered
        if (Assets.cache.has(id)) continue
        // Register data URL as a PIXI asset under the given ID
        const texture = await Assets.load<Texture>({ alias: id, src: dataUrl })
        if (!texture) {
          console.warn(`[restoreCustomImages] Failed to load texture for asset ID: ${id}`)
        }
      } catch (err) {
        console.warn(`[restoreCustomImages] Error loading asset "${id}":`, err)
      }
    }
  }
  ```

- [x] **Step 6.4 — Update `src/store/store.ts` to embed custom images in `getSerializableState`**

  The `getSerializableState` method currently returns `customImages: {}`. To properly embed images, we need to collect them from the PIXI.Assets cache. However, because `getSerializableState` is synchronous and image encoding is async, we separate concerns:

  - `getSerializableState()` remains synchronous and returns `customImages: {}` as a placeholder
  - `saveMap()` in `saveLoad.ts` will call a new `buildCustomImages()` helper before serializing

  Update `src/io/saveLoad.ts` to build the custom images map at save time:

  ```typescript
  // Add to src/io/saveLoad.ts, before the saveMap() function:

  import { prepareImageForEmbed } from './imageEmbed.ts'

  /**
   * Build the customImages record for a save file.
   * Collects all asset IDs from placed objects in image layers,
   * encodes their textures as base64 data URLs.
   */
  async function buildCustomImages(
    data: ReturnType<typeof useStore.getState>['getSerializableState'] extends () => infer R ? R : never
  ): Promise<Record<string, string>> {
    const customImages: Record<string, string> = {}
    const { Assets } = await import('pixi.js')

    for (const obj of data.placedObjects) {
      const assetId = obj.assetId
      if (!assetId || assetId in customImages) continue

      // Only embed custom uploads (they have data: or blob: URLs)
      // Built-in manifest assets are served from the server — no need to embed
      try {
        const texture = Assets.cache.get(assetId)
        if (!texture) continue

        const source = texture.source
        // Only embed if source came from a custom upload (not a manifest URL)
        const customUploads = useStore.getState().assets.customUploads
        const isCustom = customUploads.some((u) => u.id === assetId)
        if (!isCustom) continue

        // Get the original URL from the custom upload record
        const uploadRef = customUploads.find((u) => u.id === assetId)
        if (!uploadRef) continue

        customImages[assetId] = await prepareImageForEmbed(source.label ?? uploadRef.thumbnailUrl)
      } catch (err) {
        console.warn(`[buildCustomImages] Could not embed asset "${assetId}":`, err)
      }
    }

    return customImages
  }
  ```

  Then update `saveMap()` to use `buildCustomImages`:

  ```typescript
  export async function saveMap(forceNewFile = false): Promise<boolean> {
    const baseData = useStore.getState().getSerializableState()
    // Embed custom images into the save file
    const customImages = await buildCustomImages(baseData)
    const data: SerializedMapData = { ...baseData, customImages }
    // ... rest of saveMap unchanged
  ```

- [x] **Step 6.5 — Update `loadFromFile` in `src/store/store.ts` to restore custom images**

  Before calling `set((state) => ...)`, call `restoreCustomImages` asynchronously. Because `loadFromFile` is currently synchronous, we add a new async action `loadMapFile` that wraps the full load pipeline:

  Add to `src/store/store.ts` in the main store object (and to `MapBuilderStore` interface in types.ts):

  ```typescript
  // New async action — use this instead of loadFromFile for file loading
  loadMapFile: async (data: SerializedMapData): Promise<void> => {
    // Step 1: Restore custom images into PIXI.Assets before loading state
    if (data.customImages && Object.keys(data.customImages).length > 0) {
      const { restoreCustomImages } = await import('./imageEmbed.ts').catch(() =>
        import('@/io/imageEmbed')
      )
      await restoreCustomImages(data.customImages)
    }
    // Step 2: Migrate and restore state
    get().loadFromFile(data)
  },
  ```

  Also add `loadMapFile` to `MapBuilderStore` interface in `src/store/types.ts`:

  ```typescript
  loadMapFile: (data: SerializedMapData) => Promise<void>
  ```

  And add it to the `MapBuilderState` exclusion type in `factories.ts`:

  ```typescript
  | 'loadMapFile'
  ```

  Update `src/io/saveLoad.ts` `loadMap()` to call `loadMapFile` instead of `loadFromFile`:

  ```typescript
  // In loadMap(), replace:
  useStore.getState().loadFromFile(data)
  // With:
  await useStore.getState().loadMapFile(data)
  ```

- [x] **Step 6.6 — Run `pnpm check` and confirm green**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && pnpm check
  ```

  All `imageEmbed.test.ts` tests should pass. Zero type errors. Zero lint warnings.

  If the `buildCustomImages` function causes a type error due to the complex return type annotation, simplify it:

  ```typescript
  async function buildCustomImages(data: SerializedMapData): Promise<Record<string, string>> {
  ```

  The `data` should be typed as `SerializedMapData` directly since `getSerializableState()` returns `SerializedMapData`.

- [x] **Step 6.7 — Commit**

  ```bash
  cd /Users/admin/Desktop/Files/map-builder && git add src/io/imageEmbed.ts src/io/imageEmbed.test.ts src/io/saveLoad.ts src/store/store.ts src/store/types.ts src/store/factories.ts && git commit -m "$(cat <<'EOF'
  feat(io): add custom image embedding in save file — base64 encode/decode, resize to 2048px max

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Final Verification

After all six tasks are complete, run the full check one final time:

```bash
cd /Users/admin/Desktop/Files/map-builder && pnpm check
```

Expected output:
- TypeScript: 0 errors
- ESLint: 0 warnings, 0 errors
- Vitest: all tests pass (new tests: `assets.test.ts`, `assetManifest.test.ts`, `migration.test.ts`, `saveLoad.test.ts`, `autosave.test.ts`, `imageEmbed.test.ts`)

Also verify the Month 1 Systems Dev exit criteria from the design spec:

- [x] `.mapbuilder` save/load round-trips all map data (layers, lights, placed objects, settings)
- [x] `Ctrl+S` uses FSA overwrite on Chrome/Edge, download fallback on Firefox/Safari
- [x] Autosave triggers 30s after last mutation, crash recovery dialog shows on unclean shutdown
- [x] Custom uploaded images survive save/load round-trip (base64 embedded, PIXI registered on load)

---

## New Files Created by This Plan

| Path | Purpose |
|------|---------|
| `src/assets/manifest.json` | Static asset category manifest (five categories, empty asset arrays) |
| `src/engine/assetManifest.ts` | Typed manifest accessor + PIXI bundle registration |
| `src/engine/assetManifest.test.ts` | Unit tests for manifest structure |
| `src/store/migration.ts` | v1.0 → v1.1 migration pipeline |
| `src/store/migration.test.ts` | Unit tests for migration logic |
| `src/store/slices/assets.test.ts` | Unit tests for expanded AssetsSlice |
| `src/io/saveLoad.ts` | .mapbuilder save/load with fflate + FSA + fallback |
| `src/io/saveLoad.test.ts` | Unit tests for compression round-trip |
| `src/io/autosave.ts` | IndexedDB autosave + dirty flag + debounce subscriber |
| `src/io/autosave.test.ts` | Unit tests for autosave module |
| `src/io/imageEmbed.ts` | base64 encode/decode + resize helpers for custom images |
| `src/io/imageEmbed.test.ts` | Unit tests for image embed helpers |
| `src/hooks/useSaveLoad.ts` | React hook wrapping save/load for UI components |
| `src/components/shared/RecoveryDialog.tsx` | Crash recovery dialog component |
| `src/types/fsa.d.ts` | Minimal TypeScript declarations for File System Access API |

## Files Modified by This Plan

| Path | Change |
|------|--------|
| `src/store/types.ts` | Expand `Light`, `PlacedObject`, add `AssetEntry/Category/Manifest`, expand `AssetsSlice`, update `SerializedMapData` to v1.1, add `loadMapFile` action |
| `src/store/factories.ts` | Add `manifest: null`, `loadedCategories: []` to default assets state |
| `src/store/store.ts` | `getSerializableState` → v1.1 with `placedObjects`/`customImages`; `loadFromFile` → calls migration; add `loadMapFile` async action |
| `src/store/store.test.ts` | Update version assertion `'1.0'` → `'1.1'`, add round-trip and migration tests |
| `src/store/slices/assets.ts` | Add `setManifest` and `markCategoryLoaded` actions |
| `src/store/slices/layers.ts` | Add `addPlacedObject`, `removePlacedObject`, `updatePlacedObject` actions |
| `src/engine/PixiRenderEngine.ts` | Call `registerManifestBundles()` and `setManifest()` during `init()` |
| `src/shortcuts/defaultShortcuts.ts` | Wire `file.save` stub to `saveMap()`, add `file.load` → `loadMap()` |
| `src/App.tsx` | Mount autosave subscriber, render `RecoveryDialog` on dirty flag |
