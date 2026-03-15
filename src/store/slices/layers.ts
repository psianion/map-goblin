import type { StateCreator } from 'zustand';
import type { Polygon } from '../../types/geometry.ts';
import type { DungeonStyle, Layer, MapBuilderStore, PlacedObject, ShapeRecord, SplinePathRecord, SublayerVisibility, WallSegment } from '../types.ts';
import { BUILT_IN_PRESETS, loadCustomPresets, saveCustomPresetsToStorage, deleteCustomPresetFromStorage } from '../presets.ts';
import type { StylePreset } from '../presets.ts';
import { ApplyPresetCommand } from '../commands.ts';
import { undoManager } from '../undoManager.ts';

export interface LayerActions {
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  addShape: (layerId: string, shape: ShapeRecord) => void;
  removeShape: (layerId: string, shapeId: string) => void;
  updateMergedFloor: (layerId: string, merged: Polygon[] | null) => void;
  addWall: (layerId: string, wall: WallSegment) => void;
  removeWall: (layerId: string, wallId: string) => void;
  setSublayerVisibility: (layerId: string, sublayer: keyof SublayerVisibility, visible: boolean) => void;
  setBackgroundTexture: (layerId: string, url: string | null) => void;
  setBackgroundLocked: (layerId: string, locked: boolean) => void;
  applyPreset: (layerId: string, presetName: string) => void;
  saveCustomPreset: (name: string, style: Partial<DungeonStyle>) => void;
  deleteCustomPreset: (name: string) => void;
  addPlacedObject: (layerId: string, obj: PlacedObject) => void;
  removePlacedObject: (layerId: string, objId: string) => void;
  updatePlacedObject: (layerId: string, objId: string, patch: Partial<PlacedObject>) => void;
  addPath: (layerId: string, path: SplinePathRecord) => void;
  removePath: (layerId: string, pathId: string) => void;
  updatePath: (layerId: string, pathId: string, patch: Partial<SplinePathRecord>) => void;
}

export const createLayersSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  LayerActions
> = (set, get) => ({
  addLayer: (layer) =>
    set((state) => {
      state.layers.push(layer);
    }),
  removeLayer: (id) =>
    set((state) => {
      const idx = state.layers.findIndex((l) => l.id === id);
      // Cannot remove background layer (index 0) or nonexistent layer
      if (idx <= 0) return;
      state.layers.splice(idx, 1);
      // If the removed layer was active, select the nearest remaining layer
      if (state.ui.activeLayerId === id) {
        const nextIdx = Math.min(idx, state.layers.length - 1);
        state.ui.activeLayerId = state.layers[nextIdx]?.id ?? '';
      }
    }),
  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
      // Background layer (index 0) is pinned
      if (fromIndex <= 0 || toIndex <= 0) return;
      if (fromIndex >= state.layers.length) return;
      const [layer] = state.layers.splice(fromIndex, 1);
      if (layer) state.layers.splice(toIndex, 0, layer);
    }),
  updateLayer: (id, patch) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === id);
      if (layer) Object.assign(layer, patch);
    }),
  addShape: (layerId, shape) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.shapes.push(shape);
      }
    }),
  removeShape: (layerId, shapeId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const idx = layer.shapes.findIndex((s) => s.id === shapeId);
        if (idx >= 0) layer.shapes.splice(idx, 1);
      }
    }),
  updateMergedFloor: (layerId, merged) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.mergedFloor = merged;
      }
    }),
  addWall: (layerId, wall) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.standaloneWalls.push(wall);
      }
    }),
  removeWall: (layerId, wallId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const idx = layer.standaloneWalls.findIndex((w) => w.id === wallId);
        if (idx >= 0) layer.standaloneWalls.splice(idx, 1);
      }
    }),
  setSublayerVisibility: (layerId, sublayer, visible) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.sublayerVisibility[sublayer] = visible;
      }
    }),
  setBackgroundTexture: (layerId, url) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'background') {
        layer.backgroundTexture = url;
      }
    }),
  setBackgroundLocked: (layerId, locked) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'background') {
        layer.presetLock = locked;
      }
    }),
  applyPreset: (layerId, presetName) => {
    const state = get();
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') return;

    // Look up preset from built-ins first, then custom presets
    let presetStyle: StylePreset | undefined;
    const builtIn = BUILT_IN_PRESETS[presetName];
    if (builtIn) {
      presetStyle = builtIn.style;
    } else {
      const custom = loadCustomPresets();
      presetStyle = custom[presetName];
    }
    if (!presetStyle) return;

    const previousStyle = structuredClone(layer.style);
    const cmd = new ApplyPresetCommand(
      `Apply preset "${presetName}"`,
      layerId,
      presetStyle,
      previousStyle,
    );
    undoManager.execute(cmd);
  },
  saveCustomPreset: (name, style) => {
    const presetStyle: StylePreset = {
      floorColor: style.floorColor ?? '#FFFFFF',
      wallColor: style.wallColor ?? '#000000',
      wallWidth: style.wallWidth ?? 0.12,
      shadowEnabled: style.shadowEnabled ?? false,
      shadowColor: style.shadowColor ?? '#000000',
      shadowOffset: style.shadowOffset ?? { x: 0, y: 0 },
      shadowIntensity: style.shadowIntensity ?? 0,
      hatchingStyle: style.hatchingStyle ?? 'none',
      hatchingBandWidth: style.hatchingBandWidth ?? 1.0,
      hatchingLineSpacing: style.hatchingLineSpacing ?? 0.3,
      hatchingLineThickness: style.hatchingLineThickness ?? 0.02,
      hatchingAngle: style.hatchingAngle ?? 45,
      hatchingInverted: style.hatchingInverted ?? false,
      edgeTransitionWidth: style.edgeTransitionWidth ?? 0.5,
      showEdgeTransitions: style.showEdgeTransitions ?? true,
      wallTextureTint: style.wallTextureTint ?? '#ffffff',
    };
    set((state) => {
      state.ui.customPresets[name] = presetStyle;
    });
    const allCustom = loadCustomPresets();
    allCustom[name] = presetStyle;
    saveCustomPresetsToStorage(allCustom);
  },
  deleteCustomPreset: (name) => {
    set((state) => {
      delete state.ui.customPresets[name];
    });
    deleteCustomPresetFromStorage(name);
  },
  addPlacedObject: (layerId, obj) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'images') {
        layer.objects.push(obj);
      }
    }),
  removePlacedObject: (layerId, objId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'images') {
        const idx = layer.objects.findIndex((o) => o.id === objId);
        if (idx >= 0) layer.objects.splice(idx, 1);
      }
    }),
  updatePlacedObject: (layerId, objId, patch) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'images') {
        const obj = layer.objects.find((o) => o.id === objId);
        if (obj) Object.assign(obj, patch);
      }
    }),
  addPath: (layerId, path) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.paths.push(path);
      }
    }),
  removePath: (layerId, pathId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const idx = layer.paths.findIndex((p) => p.id === pathId);
        if (idx >= 0) layer.paths.splice(idx, 1);
      }
    }),
  updatePath: (layerId, pathId, patch) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const path = layer.paths.find((p) => p.id === pathId);
        if (path) Object.assign(path, patch);
      }
    }),
});
