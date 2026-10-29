import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { doorwayEditCommand, revertDoorwayLive, writeDoorwayLive } from './doorwayCommands';
import type { DoorChild, WallSegment } from '../shared/types';
import type { DungeonLayer } from './types';

const wall = (id: string, a: [number, number], b: [number, number]): WallSegment => ({
  id, points: [a, b], wallType: 'normal', direction: 'both', color: '#000', width: 0.5, roughness: 0,
});

const door: DoorChild = {
  id: 'd1', name: 'Door', childType: 'door', visible: true, wallId: 'gap', position: [9, 0], angle: 0,
  width: 2, style: 'single', state: 'closed', isSecret: false,
};

const live = () => useStore.getState().layers.find((l) => l.type === 'dungeon') as DungeonLayer;
const pointsOf = (id: string) => live().standaloneWalls.find((w) => w.id === id)!.points;
const doorNow = () => live().children.find((c) => c.id === 'd1') as DoorChild;

describe('doorway edits', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
      l.standaloneWalls = [wall('left', [0, 0], [8, 0]), wall('gap', [8, 0], [10, 0]), wall('right', [10, 0], [16, 0])];
      l.children = [structuredClone(door)];
    });
  });

  it('a width change moves the door and both neighbours in one undo step', () => {
    undoManager.execute(doorwayEditCommand('Door width', live(), 'd1', {}, {}, { width: 1 })!);
    expect(doorNow().width).toBe(1);
    expect(pointsOf('left')).toEqual([[0, 0], [8.5, 0]]);
    expect(pointsOf('right')).toEqual([[9.5, 0], [16, 0]]);
    undoManager.undo();
    expect(undoManager.canUndo()).toBe(false);
    expect(doorNow().width).toBe(2);
    expect(pointsOf('left')).toEqual([[0, 0], [8, 0]]);
    expect(pointsOf('gap')).toEqual([[8, 0], [10, 0]]);
  });

  it('carries the caller’s own fields (a style change) in the same step', () => {
    undoManager.execute(doorwayEditCommand('Door style', live(), 'd1', { style: 'single' }, { style: 'double' }, { width: 3 })!);
    expect([doorNow().style, doorNow().width]).toEqual(['double', 3]);
    expect(pointsOf('right')).toEqual([[10.5, 0], [16, 0]]);
    undoManager.undo();
    expect([doorNow().style, doorNow().width]).toEqual(['single', 2]);
    expect(pointsOf('right')).toEqual([[10, 0], [16, 0]]);
  });

  it('writes nothing when nothing changes, and the door alone off a doorway', () => {
    expect(doorwayEditCommand('Door width', live(), 'd1', {}, {}, { width: 2 })).toBeNull();
    useStore.setState((s) => {
      (s.layers.find((x) => x.type === 'dungeon') as DungeonLayer).standaloneWalls = [wall('gap', [0, 0], [20, 0])];
    });
    undoManager.execute(doorwayEditCommand('Door width', live(), 'd1', {}, {}, { width: 3 })!);
    expect(doorNow().width).toBe(3);
    expect(pointsOf('gap')).toEqual([[0, 0], [20, 0]]);
  });

  it('a live gesture is computed from where it started, and reverts with nothing to undo', () => {
    const from = live();
    for (const w of [1.5, 3, 1]) writeDoorwayLive(from, 'd1', {}, { width: w });
    expect(doorNow().width).toBe(1);
    expect(pointsOf('left')).toEqual([[0, 0], [8.5, 0]]);
    revertDoorwayLive(from, 'd1');
    expect(doorNow().width).toBe(2);
    expect(pointsOf('left')).toEqual([[0, 0], [8, 0]]);
    expect(undoManager.canUndo()).toBe(false);
  });
});
