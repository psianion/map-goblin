import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import { createDuplicateSelectionCommand, DOOR_COPY_MESSAGE } from '../store/duplicateSelection';
import type { AnyChild, DungeonLayer } from '../store/types';
import type { AssetChild, DoorChild, LightChild, ShapeChild, WallSegment } from '../shared/types';
import {
  alignTargetsCommand,
  buildTargets,
  createNudgeCommand,
  distributeTargetsCommand,
  flipCommand,
  NudgeCommand,
  rotate90Command,
  transformCommand,
  translation,
} from './transformTargets';

const state = () => useStore.getState();
const layer = (): DungeonLayer => state().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const find = (id: string) => layer().children.find((c) => c.id === id);
const findWall = (id: string) => layer().standaloneWalls.find((w) => w.id === id);
const targets = (ids: string[]) => buildTargets(state(), ids).targets;
const exec = (c: { execute(): void } | null) => {
  expect(c).not.toBeNull();
  undoManager.execute(c as never);
};

function add<T extends AnyChild>(c: T): T {
  state().addChild(layer().id, c);
  return c;
}
const asset = (id: string, x: number, y: number, extra: Partial<AssetChild> = {}) =>
  add({
    id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'a', position: { x, y }, rotation: 0,
    scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
  } as AssetChild);
const light = (id: string, x: number, y: number) =>
  add({ id, name: id, childType: 'light', visible: true, color: '#fff', radius: 1, featherRadius: 1, intensity: 1, falloff: 'linear', position: { x, y } } as LightChild);
const floor = (id: string, x0: number, y0: number, x1: number, y1: number) =>
  add({ id, name: id, childType: 'shape', visible: true, shapeType: 'rectangle', flipX: false, flipY: false, contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] } as unknown as ShapeChild);
function wall(id: string, a: [number, number], b: [number, number], extra: Partial<WallSegment> = {}): WallSegment {
  const w = { id, points: [a, b], wallType: 'normal', direction: 'both', color: '#000', width: 0.5, roughness: 0, ...extra } as WallSegment;
  state().addWall(layer().id, w);
  return w;
}
const door = (id: string, wallId: string, at: [number, number], width = 1) =>
  add({ id, name: id, childType: 'door', visible: true, wallId, position: at, angle: 0, width, style: 'single', state: 'closed', isSecret: false } as DoorChild);
function rooms(list: { id: string; anchor: [number, number] }[]) {
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
    l.rooms = list.map((r) => ({ ...r, name: r.id }));
  });
}
const anchor = (id: string) => layer().rooms!.find((r) => r.id === id)!.anchor;

beforeEach(() => {
  undoManager.clear();
  state().resetToDefault();
});

describe('floors carry their rooms', () => {
  it('a moved floor takes the room anchored on it along', () => {
    floor('f', 0, 0, 4, 4);
    rooms([{ id: 'r', anchor: [1, 1] }]);
    exec(transformCommand('Move', targets(['f']), translation(10, 0)));
    expect(anchor('r')).toEqual([11, 1]);
  });

  it('a turned floor turns the anchor with it', () => {
    floor('f', 0, 0, 4, 4);
    rooms([{ id: 'r', anchor: [3, 2] }]);
    exec(rotate90Command(targets(['f'])));
    const [x, y] = anchor('r');
    expect(x).toBeCloseTo(2);
    expect(y).toBeCloseTo(3);
  });

  it('a mirrored floor mirrors the anchor', () => {
    floor('f', 0, 0, 4, 4);
    rooms([{ id: 'r', anchor: [1, 2] }]);
    exec(flipCommand(targets(['f']), 'h'));
    expect(anchor('r')).toEqual([3, 2]);
  });

  it('a room anchored elsewhere stays, and undo puts the carried one back', () => {
    floor('f', 0, 0, 4, 4);
    rooms([{ id: 'in', anchor: [1, 1] }, { id: 'out', anchor: [9, 9] }]);
    exec(transformCommand('Move', targets(['f']), translation(0, 5)));
    expect(anchor('out')).toEqual([9, 9]);
    undoManager.undo();
    expect(anchor('in')).toEqual([1, 1]);
  });
});

describe('doors nudge along their wall', () => {
  it('a step across the wall is projected onto it', () => {
    wall('w', [0, 0], [8, 0]);
    door('d', 'w', [3, 0]);
    exec(transformCommand('Nudge', targets(['d']), translation(1, 2)));
    expect((find('d') as DoorChild).position).toEqual([4, 0]);
  });

  it('a slanted wall takes the step along its own line', () => {
    wall('w', [0, 0], [6, 6]);
    door('d', 'w', [2, 2]);
    exec(transformCommand('Nudge', targets(['d']), translation(1, 0)));
    const [x, y] = (find('d') as DoorChild).position;
    expect(x).toBeCloseTo(2.5);
    expect(y).toBeCloseTo(2.5);
  });

  it('in a sealed doorway the jambs follow the door', () => {
    wall('l', [0, 0], [8, 0]);
    wall('g', [8, 0], [10, 0]);
    wall('r', [10, 0], [16, 0]);
    door('d', 'g', [9, 0], 2);
    exec(transformCommand('Nudge', targets(['d']), translation(1, 0)));
    expect((find('d') as DoorChild).position[0]).toBeCloseTo(10);
    expect(findWall('l')!.points[1][0]).toBeCloseTo(9);
    expect(findWall('r')!.points[0][0]).toBeCloseTo(11);
  });

  it('a door on no drawn wall does not move', () => {
    door('d', '', [3, 0]);
    expect(transformCommand('Nudge', targets(['d']), translation(1, 0))).toBeNull();
  });
});

describe('duplicating a selection', () => {
  it('never copies a door on its own', () => {
    wall('w', [0, 0], [4, 0]);
    door('d', 'w', [2, 0]);
    const dup = createDuplicateSelectionCommand(state().layers, ['d']);
    expect(dup.command).toBeNull();
    expect(dup.doorsSkipped).toBe(1);
    expect(DOOR_COPY_MESSAGE).toContain('Doors stay on their wall');
  });

  it('copies a wall with its doors re-bound to the copy', () => {
    wall('w', [0, 0], [4, 0]);
    door('d', 'w', [2, 0]);
    const dup = createDuplicateSelectionCommand(state().layers, ['w']);
    exec(dup.command);
    const copy = findWall(dup.newIds[0])!;
    expect(copy.points).toEqual([[1, 1], [5, 1]]);
    const doors = layer().children.filter((c): c is DoorChild => c.childType === 'door');
    expect(doors).toHaveLength(2);
    expect(doors.find((d) => d.id !== 'd')!.wallId).toBe(copy.id);
  });

  it('a wall selected with its door copies the door once', () => {
    wall('w', [0, 0], [4, 0]);
    door('d', 'w', [2, 0]);
    const dup = createDuplicateSelectionCommand(state().layers, ['w', 'd']);
    exec(dup.command);
    expect(dup.doorsSkipped).toBe(0);
    expect(layer().children.filter((c) => c.childType === 'door')).toHaveLength(2);
  });

  it('copies locked members unlocked', () => {
    asset('p', 0, 0, { locked: true });
    wall('w', [0, 0], [4, 0], { locked: true });
    const dup = createDuplicateSelectionCommand(state().layers, ['p', 'w']);
    exec(dup.command);
    const [pc, wc] = dup.newIds;
    expect(find(pc)!.locked).toBeUndefined();
    expect(findWall(wc)!.locked).toBeUndefined();
  });

  it('rooms stay where they are', () => {
    rooms([{ id: 'r', anchor: [1, 1] }]);
    asset('p', 0, 0);
    const dup = createDuplicateSelectionCommand(state().layers, ['p', 'r']);
    expect(dup.roomsSkipped).toBe(1);
    expect(dup.newIds).toHaveLength(1);
  });

  it('one undo takes every copy back', () => {
    asset('p', 0, 0);
    wall('w', [0, 0], [4, 0]);
    exec(createDuplicateSelectionCommand(state().layers, ['p', 'w'], { offset: { x: 0, y: 0 } }).command);
    expect(layer().standaloneWalls).toHaveLength(2);
    undoManager.undo();
    expect(layer().standaloneWalls).toHaveLength(1);
    expect(layer().children).toHaveLength(1);
  });
});

describe('the nudge command', () => {
  it('folds a later nudge of the same selection into itself', () => {
    asset('p', 0, 0);
    const a = createNudgeCommand(state(), ['p'], 1, 0).command!;
    a.execute();
    const b = createNudgeCommand(state(), ['p'], 1, 0).command!;
    b.execute();
    expect(a.merge(b)).toBe(true);
    expect(a.steps).toBe(2);
    a.undo();
    expect((find('p') as AssetChild).position.x).toBe(0);
  });

  it('never folds a nudge of another selection', () => {
    asset('p', 0, 0);
    asset('q', 0, 0);
    const a = createNudgeCommand(state(), ['p'], 1, 0).command!;
    const b = createNudgeCommand(state(), ['q'], 1, 0).command!;
    expect(a.merge(b)).toBe(false);
  });

  it('redoes every folded step in order', () => {
    asset('p', 0, 0);
    const a = createNudgeCommand(state(), ['p'], 1, 0).command!;
    a.execute();
    const b = createNudgeCommand(state(), ['p'], 0, 1).command!;
    b.execute();
    a.merge(b);
    a.undo();
    a.execute();
    expect((find('p') as AssetChild).position).toEqual({ x: 1, y: 1 });
  });

  it('a nudge of a wall changes the rooms', () => {
    wall('w', [0, 0], [4, 0]);
    expect(createNudgeCommand(state(), ['w'], 1, 0).command!.affectsRooms).toBe(true);
  });

  it('a nudge of only locked members is nothing, and says how many', () => {
    asset('p', 0, 0, { locked: true });
    const r = createNudgeCommand(state(), ['p'], 1, 0);
    expect(r.command).toBeNull();
    expect(r.locked).toBe(1);
  });

  it('is a NudgeCommand, labelled Nudge', () => {
    asset('p', 0, 0);
    const c = createNudgeCommand(state(), ['p'], 1, 0).command!;
    expect(c).toBeInstanceOf(NudgeCommand);
    expect(c.label).toBe('Nudge');
  });
});

describe('align and distribute any kinds', () => {
  it('aligns a prop and a light to the right edge', () => {
    asset('p', 0, 0);
    light('l', 5, 0);
    exec(alignTargetsCommand(targets(['p', 'l']), 'right'));
    // To the light's marker (5 + 0.5), not out to its radius.
    expect((find('p') as AssetChild).position.x).toBeCloseTo(5);
  });

  it('aligns middles across a wall and a prop', () => {
    wall('w', [0, 10], [4, 10]);
    asset('p', 8, 0);
    exec(alignTargetsCommand(targets(['w', 'p']), 'vcenter'));
    const w = findWall('w')!;
    expect(w.points[0][1]).toBeCloseTo((find('p') as AssetChild).position.y);
  });

  it('aligns bottoms', () => {
    asset('a', 0, 0);
    asset('b', 3, 4);
    exec(alignTargetsCommand(targets(['a', 'b']), 'bottom'));
    expect((find('a') as AssetChild).position.y).toBeCloseTo(4);
  });

  it('needs two members to align', () => {
    asset('a', 0, 0);
    expect(alignTargetsCommand(targets(['a']), 'left')).toBeNull();
  });

  it('distributes vertically, the ends staying put', () => {
    asset('a', 0, 0);
    asset('b', 0, 1);
    asset('c', 0, 6);
    exec(distributeTargetsCommand(targets(['a', 'b', 'c']), 'v'));
    expect((find('b') as AssetChild).position.y).toBeCloseTo(3);
    expect((find('c') as AssetChild).position.y).toBe(6);
  });

  it('distributes walls with props', () => {
    asset('a', 0, 0);
    wall('w', [1, 5], [1.5, 5]);
    asset('c', 10, 0);
    exec(distributeTargetsCommand(targets(['a', 'w', 'c']), 'h'));
    const w = findWall('w')!;
    expect((w.points[0][0] + w.points[1][0]) / 2).toBeCloseTo(5);
  });

  it('leaves locked members out of distribute (two left: nothing)', () => {
    asset('a', 0, 0);
    asset('b', 1, 0, { locked: true });
    asset('c', 9, 0);
    expect(distributeTargetsCommand(targets(['a', 'b', 'c']), 'h')).toBeNull();
  });

  it('leaves doors and rooms out', () => {
    wall('w', [0, 0], [4, 0]);
    door('d', 'w', [2, 0]);
    rooms([{ id: 'r', anchor: [1, 1] }]);
    asset('p', 9, 9);
    expect(alignTargetsCommand(targets(['d', 'r', 'p']), 'left')).toBeNull();
  });
});
