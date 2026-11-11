import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Wall stones resolve textures through the pack manager, which reaches for a
// 2d canvas jsdom will not give it. Same stand-ins as wallNodeRenderer.test.ts.
vi.mock('../assets/textureLoader', () => ({
  resolveTexture: (id: string) => ({ id, width: 200, height: 200 }),
  getSync: () => null,
  load: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../assets/packCatalog', () => ({
  isBandSet: () => false,
  getBandSet: () => [],
  bandSetArt: () => new Map(),
  getWallPieces: () => [],
  getCatalogEntry: () => undefined,
  hasLiveTexture: () => false,
  GRID_CELL_PX: 200,
}));

import { Container, Graphics, Mesh } from 'pixi.js';
import { rebuildDungeonLayer } from './floorWallRenderer';
import { setTerrainRenderer, type TerrainRenderer } from './terrain/TerrainRenderer';
import type { LayerEntry } from './sceneGraph';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';

function makeEntry(): LayerEntry {
  return {
    id: 'layer-1',
    type: 'dungeon',
    container: new Container(),
    sublayers: {
      floor: new Container(),
      materials: new Container(),
      water: new Container(),
      paths: new Container(),
      plateauTops: new Container(),
      plateauEdges: new Container(),
      shadows: new Container(),
      grid: new Container(),
      walls: new Container(),
      wallMarks: new Container(),
      doors: new Container(),
      objects: new Container(),
      imageGrid: new Container(),
      labels: new Container(),
    },
    renderTexture: null,
    textureSprite: null,
    dirtyFlag: false,
  };
}

/** A stand-in for the real quad — building one needs a GL context. */
function fakeTerrain() {
  const meshes: Container[] = [];
  const fake = {
    createFloorMesh: () => {
      const mesh = new Container();
      mesh.label = 'terrainFloorMesh';
      meshes.push(mesh);
      return mesh as unknown as Mesh;
    },
  } as unknown as TerrainRenderer;
  return { fake, meshes };
}

function layerWithFloor(): DungeonLayer {
  const base = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
  return { ...base, mergedFloor: [[[0, 0], [4, 0], [4, 4], [0, 4]]], children: [] };
}

describe('painted terrain over the floor', () => {
  beforeEach(() => useStore.getState().resetToDefault());
  afterEach(() => setTerrainRenderer(null));

  it('draws the terrain quad above the floor fill and clips it to the floor', () => {
    const { fake, meshes } = fakeTerrain();
    setTerrainRenderer(fake);
    const entry = makeEntry();

    rebuildDungeonLayer(layerWithFloor(), entry);

    const floor = entry.sublayers!.floor;
    expect(meshes.length).toBe(1);
    // Last child = on top of the fill, the mask and the edge transitions.
    expect(floor.children[floor.children.length - 1]).toBe(meshes[0]);
    // Without the mask the quad would repaint ground the base quad already covers.
    expect(floor.mask).not.toBeNull();
  });

  it('is skipped, without touching the floor, when no terrain renderer exists', () => {
    const entry = makeEntry();
    rebuildDungeonLayer(layerWithFloor(), entry);
    const floor = entry.sublayers!.floor;
    expect(floor.children.some((c) => c.label === 'terrainFloorMesh')).toBe(false);
    expect(floor.children.length).toBeGreaterThan(0);
  });

  it('a rebuild replaces the quad instead of stacking one per rebuild', () => {
    const { fake } = fakeTerrain();
    setTerrainRenderer(fake);
    const entry = makeEntry();
    const layer = layerWithFloor();

    rebuildDungeonLayer(layer, entry);
    rebuildDungeonLayer(layer, entry);

    const floor = entry.sublayers!.floor;
    expect(floor.children.filter((c) => c.label === 'terrainFloorMesh').length).toBe(1);
  });
});

/** Every fill painted in `floor` (its mask aside), bottom to top, as the alpha it reaches the screen with. */
function paintedAlphas(floor: Container): number[] {
  const out: number[] = [];
  const walk = (node: Container, alpha: number): void => {
    if (node === floor.mask) return;
    const a = alpha * node.alpha;
    if (node instanceof Graphics) {
      for (const i of node.context.instructions) if (i.action === 'fill') out.push(a * (i.data.style.alpha ?? 1));
    }
    for (const child of node.children) walk(child as Container, a);
  };
  for (const child of floor.children) walk(child as Container, 1);
  return out;
}

describe('floor opacity', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  function layerWithShape(opacity?: number): DungeonLayer {
    const ring: [number, number][] = [[0, 0], [40, 0], [40, 40], [0, 40]];
    return {
      ...layerWithFloor(),
      mergedFloor: [ring],
      children: [{
        id: 's1', name: 's1', childType: 'shape', visible: true, shapeType: 'rectangle',
        contours: [ring], roughnessEnabled: false, textureScale: 1, textureOffsetX: 0,
        textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff', opacity,
      }],
    };
  }

  it('reaches the visible fill, with nothing of the same floor painted opaque above it', () => {
    const entry = makeEntry();
    const draw = (opacity?: number) => {
      rebuildDungeonLayer(layerWithShape(opacity), entry);
      return paintedAlphas(entry.sublayers!.floor);
    };
    expect(draw()).toEqual([1]);
    expect(draw(0.5)).toEqual([0.5]);
    expect(draw(0)).toEqual([0]);
  });
});
