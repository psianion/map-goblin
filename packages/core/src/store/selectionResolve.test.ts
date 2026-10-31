import { describe, it, expect } from 'vitest';
import type { AnyChild, DungeonLayer, Layer, WallSegment } from './types';
import type { Room } from '../shared/types';
import { isLockedObject, isWallShown, kindCounts, liveSelectionIds, resolveSelection, selectionNoun, selectionTitle } from './selectionResolve';

const child = (id: string, childType: AnyChild['childType'], extra: Record<string, unknown> = {}): AnyChild =>
  ({ id, name: id, childType, visible: true, ...extra }) as unknown as AnyChild;

const wall = (id: string, extra: Partial<WallSegment> = {}): WallSegment =>
  ({ id, points: [[0, 0], [1, 0]], wallType: 'normal', direction: 'both', color: '#000000', roughness: 0, ...extra }) as WallSegment;

const room = (id: string): Room => ({ id, name: id, anchor: [0, 0] });

function dungeon(id: string, children: AnyChild[], walls: WallSegment[] = [], rooms: Room[] = []): DungeonLayer {
  return { id, name: id, type: 'dungeon', visible: true, locked: false, opacity: 1, children, standaloneWalls: walls, rooms } as unknown as DungeonLayer;
}

const layers: Layer[] = [
  { id: 'bg', name: 'Background', type: 'background', visible: true, locked: false, opacity: 1 } as unknown as Layer,
  dungeon('a', [child('p1', 'asset'), child('p2', 'asset', { locked: true }), child('l1', 'light')], [wall('w1')], [room('r1')]),
  dungeon('b', [child('t1', 'text'), child('z1', 'zone')], [wall('w2', { locked: true })]),
];

describe('resolveSelection', () => {
  it('sorts ids into children, walls and rooms with their layers', () => {
    const r = resolveSelection({ layers }, ['p1', 'w1', 'r1', 't1']);
    expect(r.children.map((c) => [c.child.id, c.layer.id])).toEqual([['p1', 'a'], ['t1', 'b']]);
    expect(r.walls.map((w) => [w.wall.id, w.layer.id])).toEqual([['w1', 'a']]);
    expect(r.rooms.map((x) => [x.room.id, x.layer.id])).toEqual([['r1', 'a']]);
  });

  it('keeps selection order and drops duplicates', () => {
    const r = resolveSelection({ layers }, ['t1', 'p1', 't1']);
    expect(r.children.map((c) => c.child.id)).toEqual(['t1', 'p1']);
  });

  it('drops ids that name nothing', () => {
    const r = resolveSelection({ layers }, ['gone', 'p1']);
    expect(r.children).toHaveLength(1);
    expect(r.walls).toHaveLength(0);
  });

  it('counts each kind', () => {
    const r = resolveSelection({ layers }, ['p1', 'p2', 'l1', 'w1', 'w2', 'r1', 'z1']);
    expect(r.kinds).toEqual({ asset: 2, light: 1, wall: 2, room: 1, zone: 1 });
  });

  it('lists the members locked per object, children and walls alike', () => {
    const r = resolveSelection({ layers }, ['p1', 'p2', 'w2', 'r1']);
    expect(r.locked).toEqual(['p2', 'w2']);
  });

  it('answers an empty selection without walking the layers', () => {
    const r = resolveSelection({ layers }, []);
    expect(r).toEqual({ children: [], walls: [], rooms: [], locked: [], kinds: {} });
  });
});

describe('selection helpers', () => {
  it('titles a mixed selection kind by kind, props first', () => {
    expect(selectionTitle({ text: 1, asset: 3, light: 2 })).toBe('3 props · 2 lights · 1 label');
    expect(selectionTitle({ wall: 1 })).toBe('1 wall');
  });

  it('reads locks and wall visibility off the object', () => {
    expect(isLockedObject({})).toBe(false);
    expect(isLockedObject({ locked: true })).toBe(true);
    expect(isWallShown({})).toBe(true);
    expect(isWallShown({ visible: false })).toBe(false);
  });

  it('keeps only ids that still exist, levels and areas included', () => {
    const state = { layers, levels: [{ id: 'lvl' }] };
    expect(liveSelectionIds(state, ['p1', 'gone', 'w2', 'r1', 'lvl'])).toEqual(['p1', 'w2', 'r1', 'lvl']);
  });

  it('keeps nothing from an empty list', () => {
    expect(liveSelectionIds({ layers }, [])).toEqual([]);
  });
});

describe('selectionNoun', () => {
  it('names one kind by its own noun, singular and plural', () => {
    expect(selectionNoun({ wall: 1 })).toBe('1 wall');
    expect(selectionNoun({ asset: 4 })).toBe('4 props');
    expect(selectionNoun({ water: 2 })).toBe('2 water bodies');
    expect(selectionNoun({ shape: 1 })).toBe('1 floor');
  });

  it('calls two or more kinds objects', () => {
    expect(selectionNoun({ asset: 2, light: 1, wall: 1 })).toBe('4 objects');
  });

  it('counts children and walls by kind, and says nothing for none', () => {
    expect(kindCounts([child('a', 'asset'), child('b', 'asset'), child('l', 'light')], 2)).toEqual({ asset: 2, light: 1, wall: 2 });
    expect(selectionNoun({})).toBe('');
  });
});
