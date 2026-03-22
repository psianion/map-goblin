import type { StateCreator } from 'zustand';
import type { AnyChild, DungeonStyle, Layer, MapBuilderStore, SublayerVisibility, WallSegment } from '../types.ts';
import { BUILT_IN_PRESETS, loadCustomPresets, saveCustomPresetsToStorage, deleteCustomPresetFromStorage } from '../presets.ts';
import type { StylePreset } from '../presets.ts';
import { ApplyPresetCommand } from '../commands.ts';
import { undoManager } from '../undoManager.ts';

export interface LayerActions {
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  addChild: (layerId: string, child: AnyChild) => void;
  removeChild: (layerId: string, childId: string) => void;
  reorderChild: (layerId: string, fromIndex: number, toIndex: number) => void;
  updateChild: (layerId: string, childId: string, patch: Partial<AnyChild>) => void;
  recomputeMergedFloor: (layerId: string) => void;
  addWall: (layerId: string, wall: WallSegment) => void;
  removeWall: (layerId: string, wallId: string) => void;
  updateWall: (layerId: string, wallId: string, updates: Partial<WallSegment>) => void;
  closeAllDoors: (layerId: string) => void;
  setSublayerVisibility: (layerId: string, sublayer: keyof SublayerVisibility, visible: boolean) => void;
  setBackgroundTexture: (layerId: string, url: string | null) => void;
  setBackgroundLocked: (layerId: string, locked: boolean) => void;
  applyPreset: (layerId: string, presetName: string) => void;
  saveCustomPreset: (name: string, style: Partial<DungeonStyle>) => void;
  deleteCustomPreset: (name: string) => void;
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
      if (idx <= 0) return;
      state.layers.splice(idx, 1);
      if (state.ui.activeLayerId === id) {
        const nextIdx = Math.min(idx, state.layers.length - 1);
        state.ui.activeLayerId = state.layers[nextIdx]?.id ?? '';
      }
    }),
  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
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

  // ─── Child CRUD ─────────────────────────────────────────
  addChild: (layerId, child) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        // L2: Guard against duplicate IDs — silently ignore if already present
        if (layer.children.some((c) => c.id === child.id)) return;
        layer.children.push(child);
      }
    }),
  removeChild: (layerId, childId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const idx = layer.children.findIndex((c) => c.id === childId);
        if (idx >= 0) layer.children.splice(idx, 1);
      }
    }),
  reorderChild: (layerId, fromIndex, toIndex) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const [child] = layer.children.splice(fromIndex, 1);
        if (child) layer.children.splice(toIndex, 0, child);
      }
    }),
  updateChild: (layerId, childId, patch) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const child = layer.children.find((c) => c.id === childId);
        if (child) {
          // L8: Archway cannot be locked — the UI already filters this option,
          // but coerce here as a safety net in case the store is updated directly.
          if (
            child.childType === 'door' &&
            'style' in child &&
            (patch as Record<string, unknown>).state === 'locked'
          ) {
            const doorChild = child as import('@/shared/types').DoorChild;
            const newStyle = (patch as Record<string, unknown>).style ?? doorChild.style;
            if (newStyle === 'archway') {
              (patch as Record<string, unknown>).state = 'closed';
            }
          }
          Object.assign(child, patch);
        }
      }
    }),
  recomputeMergedFloor: (layerId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.mergedFloor = null;
      }
    }),

  // ─── Wall actions (sublayer detail) ─────────────────────
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
  updateWall: (layerId, wallId, updates) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const wall = layer.standaloneWalls.find((w) => w.id === wallId);
        if (wall) Object.assign(wall, updates);
      }
    }),
  closeAllDoors: (layerId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        for (const child of layer.children) {
          if (child.childType === 'door') {
            const door = child as import('@/shared/types').DoorChild;
            if (door.style !== 'archway') {
              door.state = 'closed';
            }
          }
        }
      }
    }),

  // ─── Sublayer / background ─────────────────────────────
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

  // ─── Presets ───────────────────────────────────────────
  applyPreset: (layerId, presetName) => {
    const state = get();
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') return;

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
});
