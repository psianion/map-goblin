import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Same stand-ins as floorTerrain.test.ts: wall stones resolve textures through the pack
// manager, which reaches for a 2d canvas jsdom will not give it.
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
  GRID_CELL_PX: 200,
}));

import { Container } from 'pixi.js';
import { rebuildDungeonLayer } from './floorWallRenderer';
import { setEditorDesk, type EditorDesk } from './editorDesk';
import type { LayerEntry } from './sceneGraph';
import { useStore } from '../store/store';
import type { DungeonLayer, WallSegment } from '../store/types';

const DESK: EditorDesk = { desk: '#f2f2f2', dot: '#c6c6c6', sheet: '#fbfbfb', ink: '#1b1b1b' };

function makeEntry(): LayerEntry {
  const sub = () => new Container();
  return {
    id: 'layer-1',
    type: 'dungeon',
    container: new Container(),
    sublayers: {
      floor: sub(),
      materials: sub(),
      water: sub(),
      paths: sub(),
      plateauTops: sub(),
      plateauEdges: sub(),
      shadows: sub(),
      grid: sub(),
      walls: sub(),
      wallMarks: sub(),
      doors: sub(),
      objects: sub(),
      imageGrid: sub(),
      labels: sub(),
    },
    renderTexture: null,
    textureSprite: null,
    dirtyFlag: false,
  };
}

/** A layer holding one see-through wall, the kind the editor marks. */
function layerWithWall(): DungeonLayer {
  const base = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
  const wall = { id: 'w1', points: [[0, 0], [10, 0]], wallType: 'ethereal' } as WallSegment;
  return { ...base, children: [], standaloneWalls: [wall] };
}

describe('the editor wall marks under a desk', () => {
  beforeEach(() => useStore.getState().resetToDefault());
  afterEach(() => setEditorDesk(null));

  it('are drawn under the editor desk, which leaves wallMarks unset', () => {
    setEditorDesk(DESK);
    const entry = makeEntry();
    rebuildDungeonLayer(layerWithWall(), entry);
    expect(entry.sublayers!.wallMarks.children.length).toBeGreaterThan(0);
  });

  it('are not drawn under a desk that turns them off, as the table does', () => {
    setEditorDesk({ ...DESK, lit: true, wallMarks: false });
    const entry = makeEntry();
    entry.sublayers!.wallMarks.addChild(new Container());
    rebuildDungeonLayer(layerWithWall(), entry);
    expect(entry.sublayers!.wallMarks.children).toHaveLength(0);
  });

  it('are not drawn with no desk at all', () => {
    const entry = makeEntry();
    rebuildDungeonLayer(layerWithWall(), entry);
    expect(entry.sublayers!.wallMarks.children).toHaveLength(0);
  });
});
