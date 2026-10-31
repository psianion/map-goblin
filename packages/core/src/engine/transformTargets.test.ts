import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import type { AnyChild, DungeonLayer } from '../store/types';
import type { AssetChild, DoorChild, LightChild, ShapeChild, TextChild, WallSegment, WaterChild, ZoneChild } from '../shared/types';
import {
  alignTargetsCommand,
  boxTargets,
  buildTargets,
  createNudgeCommand,
  distributeTargetsCommand,
  flipCommand,
  rotate90Command,
  transformCommand,
  translation,
  unionTargetBounds,
} from './transformTargets';

const layer = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const find = (id: string) => layer().children.find((c) => c.id === id);
const findWall = (id: string) => layer().standaloneWalls.find((w) => w.id === id)!;
const run = (cmd: ReturnType<typeof transformCommand>) => {
  expect(cmd).not.toBeNull();
  undoManager.execute(cmd!);
};
const state = () => useStore.getState();

function add<T extends AnyChild>(c: T): T {
  state().addChild(layer().id, c);
  return c;
}

const asset = (id: string, x: number, y: number, extra: Partial<AssetChild> = {}): AssetChild =>
  add({
    id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'a', position: { x, y },
    rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
  } as AssetChild);

const shape = (id: string, x0: number, y0: number, x1: number, y1: number): ShapeChild =>
  add({
    id, name: id, childType: 'shape', visible: true, shapeType: 'rectangle', flipX: false, flipY: false,
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  } as unknown as ShapeChild);

const water = (id: string): WaterChild =>
  add({
    id, name: id, childType: 'water', visible: true, opacity: 1,
    contours: [[[0, 0], [4, 0], [4, 2], [0, 2]]],
  } as unknown as WaterChild);

const light = (id: string, x: number, y: number): LightChild =>
  add({
    id, name: id, childType: 'light', visible: true, color: '#ffffff', radius: 1, featherRadius: 1, intensity: 1,
    falloff: 'linear', position: { x, y },
  } as LightChild);

const zone = (id: string, shapeDef: ZoneChild['shape']): ZoneChild =>
  add({ id, name: id, childType: 'zone', visible: true, shape: shapeDef } as ZoneChild);

function addWall(id: string, a: [number, number], b: [number, number], extra: Partial<WallSegment> = {}): WallSegment {
  const w = { id, points: [a, b], wallType: 'normal', direction: 'both', color: '#000', width: 0.5, roughness: 0, ...extra } as WallSegment;
  state().addWall(layer().id, w);
  return w;
}

const door = (id: string, wallId: string, at: [number, number]): DoorChild =>
  add({
    id, name: id, childType: 'door', visible: true, wallId, position: at, angle: 0, width: 1, style: 'single',
    state: 'closed', isSecret: false,
  } as DoorChild);

const targetsOf = (ids: string[]) => buildTargets(state(), ids).targets;

describe('transform targets', () => {
  beforeEach(() => {
    undoManager.clear();
    state().resetToDefault();
  });

  it('moves a prop and undoes', () => {
    asset('p', 2, 2);
    run(transformCommand('Move', targetsOf(['p']), translation(1, 0)));
    expect((find('p') as AssetChild).position).toEqual({ x: 3, y: 2 });
    undoManager.undo();
    expect((find('p') as AssetChild).position).toEqual({ x: 2, y: 2 });
  });

  it('moves a wall, and the door on it with it, in one undo entry', () => {
    addWall('w', [0, 0], [4, 0]);
    door('d', 'w', [2, 0]);
    run(transformCommand('Move', targetsOf(['w']), translation(0, 3)));
    expect(findWall('w').points).toEqual([[0, 3], [4, 3]]);
    expect((find('d') as DoorChild).position).toEqual([2, 3]);
    undoManager.undo();
    expect(findWall('w').points).toEqual([[0, 0], [4, 0]]);
    expect((find('d') as DoorChild).position).toEqual([2, 0]);
  });

  it('turns a wall a quarter about its centre and its door angle with it', () => {
    addWall('w', [0, 0], [4, 0]);
    door('d', 'w', [3, 0]);
    run(rotate90Command(targetsOf(['w'])));
    const [a, b] = findWall('w').points;
    expect(a[0]).toBeCloseTo(2);
    expect(a[1]).toBeCloseTo(-2);
    expect(b[0]).toBeCloseTo(2);
    expect(b[1]).toBeCloseTo(2);
    expect((find('d') as DoorChild).angle).toBeCloseTo(Math.PI / 2);
  });

  it('flips a wall about its own centre', () => {
    addWall('w', [0, 0], [4, 2]);
    run(flipCommand(targetsOf(['w']), 'h'));
    expect(findWall('w').points).toEqual([[4, 0], [0, 2]]);
  });

  it('keeps a doorway sealed when the run moves together', () => {
    addWall('l', [0, 0], [8, 0]);
    addWall('g', [8, 0], [10, 0]);
    addWall('r', [10, 0], [16, 0]);
    door('d', 'g', [9, 0]);
    run(transformCommand('Move', targetsOf(['l', 'g', 'r']), translation(0, 2)));
    expect(findWall('l').points[1]).toEqual(findWall('g').points[0]);
    expect(findWall('g').points[1]).toEqual(findWall('r').points[0]);
  });

  it('a door on its own slides along its wall only', () => {
    addWall('w', [0, 0], [6, 0]);
    door('d', 'w', [2, 0]);
    run(transformCommand('Nudge', targetsOf(['d']), translation(1, 1)));
    expect((find('d') as DoorChild).position).toEqual([3, 0]);
  });

  it('a door rides with its wall, never twice', () => {
    addWall('w', [0, 0], [6, 0]);
    door('d', 'w', [2, 0]);
    run(transformCommand('Move', targetsOf(['w', 'd']), translation(1, 0)));
    expect((find('d') as DoorChild).position).toEqual([3, 0]);
  });

  it('scales a circle zone uniformly and keeps its centre on the mapped point', () => {
    zone('z', { kind: 'circle', position: { x: 2, y: 2 }, radius: 1 });
    run(transformCommand('Resize', targetsOf(['z']), { ...translation(0, 0), scaleX: 2, scaleY: 2, anchorX: 1, anchorY: 1 }));
    expect((find('z') as ZoneChild).shape).toEqual({ kind: 'circle', position: { x: 3, y: 3 }, radius: 2 });
  });

  it('resizes a rect zone and turns it on its own centre', () => {
    zone('z', { kind: 'rect', x: 0, y: 0, width: 4, height: 2 });
    run(rotate90Command(targetsOf(['z'])));
    const s = (find('z') as ZoneChild).shape as Extract<ZoneChild['shape'], { kind: 'rect' }>;
    expect(s.width).toBeCloseTo(2);
    expect(s.height).toBeCloseTo(4);
    expect(s.x + s.width / 2).toBeCloseTo(2);
  });

  it('moves a point zone', () => {
    zone('z', { kind: 'point', position: { x: 1, y: 1 } });
    run(transformCommand('Move', targetsOf(['z']), translation(2, 0)));
    expect((find('z') as ZoneChild).shape).toEqual({ kind: 'point', position: { x: 3, y: 1 } });
  });

  it('flips water by mirroring its rings', () => {
    water('wa');
    const before = (find('wa') as WaterChild).contours[0].map((p) => [...p]);
    run(flipCommand(targetsOf(['wa']), 'v'));
    const after = (find('wa') as WaterChild).contours[0];
    expect(after).toHaveLength(before.length);
    expect(after.map(([, y]) => y).sort()).toEqual(before.map(([, y]) => 2 - y).sort());
  });

  it('leaves locked members out and counts them', () => {
    asset('p', 0, 0, { locked: true });
    addWall('w', [0, 0], [1, 0], { locked: true });
    shape('s', 0, 0, 1, 1);
    const set = buildTargets(state(), ['p', 'w', 's']);
    expect(set.targets.map((t) => t.id)).toEqual(['s']);
    expect(set.locked).toEqual(['p', 'w']);
  });

  it('a locked light is skipped like a locked prop', () => {
    light('l', 0, 0);
    useStore.getState().updateChild(layer().id, 'l', { locked: true } as Partial<AnyChild>);
    expect(buildTargets(state(), ['l']).targets).toHaveLength(0);
  });

  it('a floor carries the rooms anchored inside it', () => {
    shape('s', 0, 0, 4, 4);
    useStore.setState((st) => {
      const l = st.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
      l.rooms = [{ id: 'r', name: 'Hall', anchor: [1, 1] }, { id: 'out', name: 'Out', anchor: [9, 9] }];
    });
    run(transformCommand('Move', targetsOf(['s']), translation(5, 0)));
    const rooms = layer().rooms!;
    expect(rooms.find((r) => r.id === 'r')!.anchor).toEqual([6, 1]);
    expect(rooms.find((r) => r.id === 'out')!.anchor).toEqual([9, 9]);
  });

  it('the gizmo box leaves doors out and unions walls and children', () => {
    addWall('w', [0, 0], [4, 0]);
    door('d', 'w', [2, 0]);
    asset('p', 10, 10);
    const box = unionTargetBounds(boxTargets(targetsOf(['w', 'd', 'p'])))!;
    expect(box.x).toBeLessThan(0);
    expect(box.x + box.width).toBeCloseTo(10.5);
  });

  it('a live preview writes the store and revert puts it back', () => {
    addWall('w', [0, 0], [4, 0]);
    const [t] = targetsOf(['w']);
    t.apply(translation(1, 1));
    expect(findWall('w').points).toEqual([[1, 1], [5, 1]]);
    t.revert();
    expect(findWall('w').points).toEqual([[0, 0], [4, 0]]);
  });

  it('aligns a light and a wall to the left edge of their union', () => {
    light('l', 10, 0);
    addWall('w', [2, 5], [4, 5]);
    run(alignTargetsCommand(targetsOf(['l', 'w']), 'left'));
    const l = find('l') as LightChild;
    const wall = findWall('w');
    // Both boxes now start at the same x: the light's by its marker square, not its radius.
    expect(l.position.x - 0.5).toBeCloseTo(wall.points[0][0] - 0.3);
  });

  it('distributes needs three members', () => {
    asset('a', 0, 0);
    asset('b', 5, 0);
    expect(distributeTargetsCommand(targetsOf(['a', 'b']), 'h')).toBeNull();
    asset('c', 6, 0);
    run(distributeTargetsCommand(targetsOf(['a', 'b', 'c']), 'h'));
    expect((find('b') as AssetChild).position.x).toBeCloseTo(3);
  });

  it('align skips locked members', () => {
    asset('a', 0, 0);
    asset('b', 5, 3, { locked: true });
    light('c', 9, 9);
    run(alignTargetsCommand(targetsOf(['a', 'b', 'c']), 'top'));
    expect((find('b') as AssetChild).position).toEqual({ x: 5, y: 3 });
  });

  it('turns a label but never a light', () => {
    add({
      id: 't', name: 't', childType: 'text', visible: true, text: 'x', position: { x: 0, y: 0 }, rotation: 0, scale: 1,
      width: 2, height: 1, fontSize: 1, color: '#000000',
    } as unknown as TextChild);
    light('l', 3, 3);
    run(rotate90Command(targetsOf(['t', 'l'])));
    expect((find('t') as TextChild).rotation).toBeCloseTo(Math.PI / 2);
    expect((find('l') as LightChild).position).toEqual({ x: 3, y: 3 });
  });

  it('a nudge command carries a key built from the sorted ids', () => {
    asset('b', 0, 0);
    asset('a', 0, 0);
    const { command } = createNudgeCommand(state(), ['b', 'a'], 1, 0);
    expect(command!.coalesceKey).toBe('nudge:a,b');
  });
});
