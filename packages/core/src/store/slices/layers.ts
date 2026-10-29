import type { StateCreator } from 'zustand';
import type { AnyChild, Layer, MapBuilderStore, Room, SublayerVisibility, WallSegment } from '../types';
import type { RoomArea, ThresholdSegment, WallEdits } from '../../shared/types';

export interface LayerActions {
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  /** Appends the child, or inserts it at `index` (placing under, an undone delete). */
  addChild: (layerId: string, child: AnyChild, index?: number) => void;
  removeChild: (layerId: string, childId: string) => void;
  reorderChild: (layerId: string, fromIndex: number, toIndex: number) => void;
  /** Reorders children to `ids`; unknown ids are ignored, a child missing from `ids` keeps its index. */
  setChildOrder: (layerId: string, ids: string[]) => void;
  updateChild: (layerId: string, childId: string, patch: Partial<AnyChild>) => void;
  recomputeMergedFloor: (layerId: string) => void;
  /** A pack texture a floor bake needed has landed — re-key the bake. */
  bumpFloorTextureEpoch: (layerId: string) => void;
  /** Appends the wall, or inserts it at `index` (an undone delete going back where it was). */
  addWall: (layerId: string, wall: WallSegment, index?: number) => void;
  removeWall: (layerId: string, wallId: string) => void;
  updateWall: (layerId: string, wallId: string, updates: Partial<WallSegment>) => void;
  /** Replace the hand edits for one floor ring; undefined clears them. */
  setFloorWallEdits: (layerId: string, ringKey: string, edits: WallEdits | undefined) => void;
  closeAllDoors: (layerId: string) => void;
  setRooms: (layerId: string, rooms: Room[]) => void;
  updateRoom: (layerId: string, roomId: string, patch: Partial<Room>) => void;
  setThresholds: (layerId: string, thresholds: ThresholdSegment[]) => void;
  setAreas: (layerId: string, areas: RoomArea[]) => void;
  setSublayerVisibility: (layerId: string, sublayer: keyof SublayerVisibility, visible: boolean) => void;
  setBackgroundTexture: (layerId: string, url: string | null) => void;
  setBackgroundLocked: (layerId: string, locked: boolean) => void;
}

export const createLayersSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  LayerActions
> = (set, _get) => ({
  addLayer: (layer) =>
    set((state) => {
      // Every layer belongs to a level. One added without a level the map knows
      // (a fresh layer, a paste from another map) lands in the level on show.
      if (!state.levels.some((l) => l.id === layer.levelId)) {
        layer = { ...layer, levelId: state.ui.activeLevelId || state.levels[0]?.id || '' };
      }
      state.layers.push(layer);
    }),
  removeLayer: (id) =>
    set((state) => {
      const idx = state.layers.findIndex((l) => l.id === id);
      if (idx <= 0) return;
      // Solo bookkeeping for a layer about to disappear would dangle —
      // nothing to restore now that solo never writes `visible`, but the
      // pointer itself still has to go, right here rather than in the ui
      // slice, since this is the one place that knows the layer is about to go.
      if (state.ui.solo?.layerId === id) {
        state.ui.solo = null;
      }
      const [gone] = state.layers.splice(idx, 1);
      if (state.ui.activeLayerId === id) {
        // Stay on the level being shown: the next layer of the same level, else
        // the nearest one, else whatever is left.
        const sameLevel = state.layers.filter((l) => l.levelId === gone.levelId);
        const next =
          sameLevel.find((l) => state.layers.indexOf(l) >= idx) ??
          sameLevel.at(-1) ??
          state.layers[Math.min(idx, state.layers.length - 1)];
        state.ui.activeLayerId = next?.id ?? '';
        if (next) state.ui.activeLevelId = next.levelId;
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
  addChild: (layerId, child, index) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        // L2: Guard against duplicate IDs — silently ignore if already present
        if (layer.children.some((c) => c.id === child.id)) return;
        if (index !== undefined && index >= 0 && index < layer.children.length) {
          layer.children.splice(index, 0, child);
        } else {
          layer.children.push(child);
        }
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
      if (!layer || layer.type !== 'dungeon') return;
      const len = layer.children.length;
      if (
        !Number.isInteger(fromIndex) || !Number.isInteger(toIndex) ||
        fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len
      ) {
        return;
      }
      const [child] = layer.children.splice(fromIndex, 1);
      if (child) layer.children.splice(toIndex, 0, child);
    }),
  setChildOrder: (layerId, ids) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return;
      const byId = new Map(layer.children.map((c) => [c.id, c]));
      const order = [...new Set(ids)].filter((id) => byId.has(id));
      const listed = new Set(order);
      // The listed children trade places among the slots they already hold, so
      // everything left out of `ids` stays exactly where it was.
      let next = 0;
      layer.children = layer.children.map((c) => (listed.has(c.id) ? byId.get(order[next++])! : c));
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
            const doorChild = child as import('../../shared/types').DoorChild;
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
  bumpFloorTextureEpoch: (layerId) =>
    set((state) => {
      state.floorTextureEpochs[layerId] = (state.floorTextureEpochs[layerId] ?? 0) + 1;
    }),

  // ─── Wall actions (sublayer detail) ─────────────────────
  addWall: (layerId, wall, index) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        if (index !== undefined && index >= 0 && index < layer.standaloneWalls.length) {
          layer.standaloneWalls.splice(index, 0, wall);
        } else {
          layer.standaloneWalls.push(wall);
        }
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
  setFloorWallEdits: (layerId, ringKey, edits) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return;
      if (!edits) {
        if (layer.floorWallEdits) delete layer.floorWallEdits[ringKey];
        return;
      }
      layer.floorWallEdits ??= {};
      layer.floorWallEdits[ringKey] = edits;
    }),
  closeAllDoors: (layerId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        for (const child of layer.children) {
          if (child.childType === 'door') {
            const door = child as import('../../shared/types').DoorChild;
            if (door.style !== 'archway') {
              door.state = 'closed';
            }
          }
        }
      }
    }),

  // ─── Rooms ──────────────────────────────────────────────
  setRooms: (layerId, rooms) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.rooms = rooms;
      }
    }),
  // The room is the durable record now — its id, name and anchor are authored, so
  // a rename is a plain field write that no refresh ever puts back.
  updateRoom: (layerId, roomId, patch) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return;
      const room = layer.rooms?.find((r) => r.id === roomId);
      if (!room) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (room as unknown as Record<string, unknown>)[k];
        else (room as unknown as Record<string, unknown>)[k] = v;
      }
    }),
  setThresholds: (layerId, thresholds) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return;
      if (thresholds.length > 0) layer.thresholds = thresholds;
      else delete layer.thresholds;
    }),
  setAreas: (layerId, areas) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return;
      if (areas.length > 0) layer.areas = areas;
      else delete layer.areas;
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

});
