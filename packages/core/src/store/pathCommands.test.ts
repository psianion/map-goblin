import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import {
  addPath,
  insertPathPoint,
  movePathPoint,
  removePath,
  removePathPoint,
  setPathFields,
  setPathPointHandles,
  setPathPointHeight,
  setPathPointWidth,
} from './pathCommands';
import type { PathChild } from '../shared/types';
import type { Command, DungeonLayer } from './types';

const road = (over: Partial<PathChild> = {}): PathChild => ({
  id: 'road',
  name: 'Road',
  childType: 'path',
  visible: true,
  points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 2 }],
  closed: false,
  width: 1.5,
  heightMode: 'ground',
  materialId: 'gg-forge:road-dirt',
  tint: '#ffffff',
  opacity: 1,
  offset: 0.37,
  flip: false,
  edge: 'soft',
  edgeStrip: true,
  ends: { start: 'cut', end: 'cut', length: 1 },
  sort: 'under',
  ...over,
});

let layerId = '';
const layer = () => useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer;
const now = (): PathChild | undefined => layer().children.find((c) => c.id === 'road') as PathChild | undefined;
const exec = (cmd: Command | null) => {
  expect(cmd).not.toBeNull();
  undoManager.execute(cmd!);
};

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
});

describe('adding and removing a path', () => {
  it('draws a path as one entry, and undo takes it away again', () => {
    exec(addPath(layerId, road()));
    expect(now()).toEqual(road());
    undoManager.undo();
    expect(now()).toBeUndefined();
    undoManager.redo();
    expect(now()).toEqual(road());
  });

  it('deletes a path and puts it back where it was', () => {
    useStore.getState().addChild(layerId, road());
    exec(removePath('road'));
    expect(now()).toBeUndefined();
    undoManager.undo();
    expect(now()).toEqual(road());
    expect(removePath('nothing')).toBeNull();
  });
});

describe('setPathFields', () => {
  beforeEach(() => useStore.getState().addChild(layerId, road()));

  it('writes the fields and undoes to the old ones', () => {
    exec(setPathFields('road', { materialId: 'gg-forge:water', closed: true, fill: true, sort: 'overhead', under: 'blocked' }));
    expect(now()).toMatchObject({ materialId: 'gg-forge:water', closed: true, fill: true, sort: 'overhead', under: 'blocked' });
    undoManager.undo();
    expect(now()).toMatchObject({ materialId: 'gg-forge:road-dirt', closed: false, sort: 'under' });
    expect(now()!.fill).toBeUndefined();
    undoManager.redo();
    expect(now()!.fill).toBe(true);
  });

  it('refuses a width that is not a positive number, an empty patch, and a missing path', () => {
    expect(setPathFields('road', { width: 0 })).toBeNull();
    expect(setPathFields('road', { width: Number.NaN })).toBeNull();
    expect(setPathFields('road', { width: undefined })).toBeNull();
    expect(setPathFields('road', {})).toBeNull();
    expect(setPathFields('nothing', { width: 2 })).toBeNull();
  });
});

describe('point edits', () => {
  beforeEach(() => useStore.getState().addChild(layerId, road()));
  const points = () => now()!.points;

  it('inserts a point and undoes it', () => {
    exec(insertPathPoint('road', 1, { x: 2, y: 1, width: 3 }));
    expect(points()).toEqual([{ x: 0, y: 0 }, { x: 2, y: 1, width: 3 }, { x: 4, y: 0 }, { x: 8, y: 2 }]);
    undoManager.undo();
    expect(points()).toHaveLength(3);
    // Appending at the end is an insert at the length.
    exec(insertPathPoint('road', 3, { x: 10, y: 2 }));
    expect(points()[3]).toEqual({ x: 10, y: 2 });
    expect(insertPathPoint('road', 9, { x: 0, y: 0 })).toBeNull();
    expect(insertPathPoint('road', 0, { x: 0, y: 0, width: -1 })).toBeNull();
  });

  it('removes a point, but never below two', () => {
    exec(removePathPoint('road', 1));
    expect(points()).toEqual([{ x: 0, y: 0 }, { x: 8, y: 2 }]);
    expect(removePathPoint('road', 0)).toBeNull();
    undoManager.undo();
    expect(points()).toHaveLength(3);
  });

  it('moves a point, and a run of moves on the same point is one entry', () => {
    exec(movePathPoint('road', 1, 4, 1));
    exec(movePathPoint('road', 1, 4, 2));
    exec(movePathPoint('road', 1, 5, 3));
    expect(points()[1]).toEqual({ x: 5, y: 3 });
    undoManager.undo();
    expect(points()[1]).toEqual({ x: 4, y: 0 });
    expect(undoManager.canUndo()).toBe(false);
    undoManager.redo();
    expect(points()[1]).toEqual({ x: 5, y: 3 });
  });

  it('keeps edits of different points, or different kinds, as their own entries', () => {
    exec(movePathPoint('road', 1, 4, 1));
    exec(movePathPoint('road', 2, 9, 2));
    exec(setPathPointWidth('road', 2, 2));
    undoManager.undo();
    expect(points()[2]).toEqual({ x: 9, y: 2 });
    undoManager.undo();
    expect(points()[2]).toEqual({ x: 8, y: 2 });
    expect(points()[1]).toEqual({ x: 4, y: 1 });
  });

  it('sets and clears a point width, a burst folding into one entry', () => {
    exec(setPathPointWidth('road', 0, 2));
    exec(setPathPointWidth('road', 0, 2.25));
    exec(setPathPointWidth('road', 0, 2.5));
    expect(points()[0]).toEqual({ x: 0, y: 0, width: 2.5 });
    undoManager.undo();
    expect(points()[0]).toEqual({ x: 0, y: 0 });
    undoManager.redo();
    exec(setPathPointWidth('road', 0, undefined));
    expect(points()[0]).not.toHaveProperty('width');
    expect(setPathPointWidth('road', 0, 0)).toBeNull();
  });

  it('sets and clears a point height', () => {
    exec(setPathPointHeight('road', 2, 3));
    expect(points()[2]).toEqual({ x: 8, y: 2, height: 3 });
    undoManager.undo();
    expect(points()[2]).not.toHaveProperty('height');
    undoManager.redo();
    // Cleared on a fresh entry (another edit in between), the height goes.
    exec(movePathPoint('road', 0, 1, 0));
    exec(setPathPointHeight('road', 2, undefined));
    expect(points()[2]).not.toHaveProperty('height');
    undoManager.undo();
    expect(points()[2].height).toBe(3);
    expect(setPathPointHeight('road', 2, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('sets handles, makes a point sharp, and takes it back to auto; one handle drag is one entry', () => {
    const handles = { in: [-1, 0] as [number, number], out: [1, 0] as [number, number] };
    exec(setPathPointHandles('road', 1, handles));
    expect(points()[1].handles).toEqual(handles);
    exec(setPathPointHandles('road', 1, null));
    expect(points()[1].handles).toBeNull();
    exec(setPathPointHandles('road', 1, undefined));
    expect(points()[1]).not.toHaveProperty('handles');
    undoManager.undo();
    expect(points()[1]).toEqual({ x: 4, y: 0 });
    undoManager.redo();
    expect(points()[1]).not.toHaveProperty('handles');
  });

  it('refuses an index off the path and a path that is not there', () => {
    expect(movePathPoint('road', 3, 0, 0)).toBeNull();
    expect(movePathPoint('road', -1, 0, 0)).toBeNull();
    expect(movePathPoint('road', 0, Number.NaN, 0)).toBeNull();
    expect(movePathPoint('nothing', 0, 0, 0)).toBeNull();
  });
});
