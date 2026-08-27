// A loaded map ships `mergedFloor: null` (files and session payloads both
// strip the derived union). The subscriber that recomputes it can fire before
// the scene entry exists and never again — so the rebuild itself must heal the
// union, or every floor on the map renders as void (the black-cave bug).
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../assets/textureLoader', () => ({
  resolveTexture: (id: string) => ({ id, width: 200, height: 200 }),
  unitTexture: (id: string) => ({ texture: { width: 200, height: 200 }, id }),
  getSync: () => null,
  load: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../assets/packCatalog', () => ({
  getWallPieces: () => [],
  getCatalogEntry: () => undefined,
  GRID_CELL_PX: 200,
}));

import { Container } from 'pixi.js';
import { rebuildDungeonLayer } from './floorWallRenderer';
import type { LayerEntry } from './sceneGraph';
import { useStore } from '../store/store';
import type { DungeonLayer, ShapeChild } from '../store/types';

function makeEntry(id: string): LayerEntry {
  return {
    id,
    type: 'dungeon',
    container: new Container(),
    sublayers: {
      water: new Container(),
      floor: new Container(),
      shadows: new Container(),
      grid: new Container(),
      walls: new Container(),
      doors: new Container(),
      objects: new Container(),
      labels: new Container(),
    },
    renderTexture: null,
    textureSprite: null,
    dirtyFlag: false,
  };
}

const shape = {
  id: 'floor-1',
  name: 'Floor',
  childType: 'shape',
  visible: true,
  shapeType: 'polygon',
  contours: [[[0, 0], [6, 0], [6, 5], [0, 5]]],
  roughnessEnabled: false,
} as unknown as ShapeChild;

describe('rebuildDungeonLayer heals a null mergedFloor', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('computes the union from the shapes, writes it back, and renders the floor', () => {
    const base = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    useStore.setState((s) => {
      const l = s.layers.find((la) => la.id === base.id) as DungeonLayer;
      l.mergedFloor = null;
      l.children = [shape];
    });
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    expect(layer.mergedFloor).toBeNull();

    const entry = makeEntry(layer.id);
    rebuildDungeonLayer(layer, entry);

    const healed = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    expect(healed.mergedFloor).toEqual([[[0, 0], [6, 0], [6, 5], [0, 5]]]);
    // and the floor actually painted instead of bailing on the null union
    expect(entry.sublayers!.floor.children.length).toBeGreaterThan(0);
  });

  it('leaves a shapeless layer alone', () => {
    const base = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    useStore.setState((s) => {
      const l = s.layers.find((la) => la.id === base.id) as DungeonLayer;
      l.mergedFloor = null;
      l.children = [];
    });
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

    rebuildDungeonLayer(layer, makeEntry(layer.id));

    expect(useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!.mergedFloor).toBeNull();
  });
});
