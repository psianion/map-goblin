import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { createSelectionRemovalCommand } from './commands';
import { selectLayerForSelected, selectWallById } from './selectors';
import type { DungeonLayer } from './types';
import type { DoorChild, ShapeChild, WallSegment } from '../shared/types';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function addWall(id: string, y: number): WallSegment {
  const w: WallSegment = {
    id,
    points: [[0, y], [10, y]],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    roughness: 0,
  };
  useStore.getState().addWall(layer().id, w);
  return w;
}

function addDoor(id: string, wallId: string, y: number): DoorChild {
  const d: DoorChild = {
    id,
    name: 'Door',
    childType: 'door',
    visible: true,
    wallId,
    position: [5, y],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
  };
  useStore.getState().addChild(layer().id, d);
  return d;
}

function addFloor(id: string): ShapeChild {
  const s: ShapeChild = {
    id,
    name: 'Floor',
    childType: 'shape',
    shapeType: 'polygon',
    visible: true,
    contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
    roughnessEnabled: false,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  };
  useStore.getState().addChild(layer().id, s);
  return s;
}

const wallIds = () => layer().standaloneWalls.map((w) => w.id);
const childIds = () => layer().children.map((c) => c.id);

describe('selectWallById / selectLayerForSelected', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('finds a drawn wall and its layer by id; children still resolve', () => {
    addWall('w', 1);
    addFloor('f');
    const s = useStore.getState();
    expect(selectWallById(s, 'w')?.wall.id).toBe('w');
    expect(selectWallById(s, 'w')?.layer.id).toBe(layer().id);
    expect(selectWallById(s, 'f')).toBeUndefined();
    expect(selectLayerForSelected(s, 'w')?.id).toBe(layer().id);
    expect(selectLayerForSelected(s, 'f')?.id).toBe(layer().id);
    expect(selectLayerForSelected(s, 'nope')).toBeUndefined();
  });
});

describe('createSelectionRemovalCommand', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
  });

  it('deletes a selected wall, and undo puts it back in its place in the draw order', () => {
    addWall('a', 1);
    addWall('b', 2);
    addWall('c', 3);
    const r = createSelectionRemovalCommand(['b']);
    expect(r).toMatchObject({ children: 0, walls: 1, doors: 0 });
    undoManager.execute(r.command!);
    expect(wallIds()).toEqual(['a', 'c']);
    undoManager.undo();
    expect(wallIds()).toEqual(['a', 'b', 'c']);
    undoManager.redo();
    expect(wallIds()).toEqual(['a', 'c']);
  });

  it('takes the doors bound to a deleted wall in the same undo step', () => {
    addWall('w', 1);
    addWall('other', 5);
    addDoor('d1', 'w', 1);
    addDoor('d2', 'w', 1);
    addDoor('keep', 'other', 5);
    const r = createSelectionRemovalCommand(['w']);
    expect(r).toMatchObject({ children: 0, walls: 1, doors: 2 });
    undoManager.execute(r.command!);
    expect(wallIds()).toEqual(['other']);
    expect(childIds()).toEqual(['keep']);
    undoManager.undo();
    expect(wallIds()).toEqual(['w', 'other']);
    expect(childIds()).toEqual(['d1', 'd2', 'keep']);
  });

  it('a selected door that goes with its wall is removed once, by the wall', () => {
    addWall('w', 1);
    addDoor('d', 'w', 1);
    const r = createSelectionRemovalCommand(['d', 'w']);
    expect(r).toMatchObject({ children: 0, walls: 1, doors: 1 });
    undoManager.execute(r.command!);
    expect(childIds()).toEqual([]);
    undoManager.undo();
    expect(childIds()).toEqual(['d']);
    expect(wallIds()).toEqual(['w']);
  });

  it('children and walls together are one undo step', () => {
    addFloor('f');
    addWall('w', 1);
    const r = createSelectionRemovalCommand(['f', 'w']);
    expect(r).toMatchObject({ children: 1, walls: 1, doors: 0 });
    undoManager.execute(r.command!);
    expect(childIds()).toEqual([]);
    expect(wallIds()).toEqual([]);
    undoManager.undo();
    expect(childIds()).toEqual(['f']);
    expect(wallIds()).toEqual(['w']);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('nothing that still exists gives no command', () => {
    expect(createSelectionRemovalCommand(['gone']).command).toBeNull();
  });
});
