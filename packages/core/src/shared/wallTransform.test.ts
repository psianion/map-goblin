import { describe, it, expect } from 'vitest';
import type { DoorChild, WallSegment } from './types';
import type { DungeonLayer } from '../store/types';
import { copyWall, doorsOnWall, mapDoorPose, mapWallPoints, mirrorMap, planWallEdits, wallCentre, type PointMap } from './wallTransform';
import { layoutWall, type WallPieceSpec } from '../engine/wallLayout';
import { extractWallSegments } from '../engine/lighting/raycaster';

const wall = (id: string, a: [number, number], b: [number, number], extra: Partial<WallSegment> = {}): WallSegment => ({
  id,
  points: [a, b],
  wallType: 'normal',
  direction: 'both',
  color: '#000',
  width: 0.5,
  roughness: 0,
  ...extra,
});

const door = (over: Partial<DoorChild> = {}): DoorChild => ({
  id: 'd1',
  name: 'Door',
  childType: 'door',
  visible: true,
  wallId: 'gap',
  position: [9, 0],
  angle: 0,
  width: 2,
  style: 'single',
  state: 'closed',
  isSecret: false,
  ...over,
});

let n = 0;
const layer = (walls: WallSegment[], children: DoorChild[] = []): DungeonLayer =>
  ({ id: `wt-${n++}`, type: 'dungeon', children, standaloneWalls: walls, mergedFloor: null }) as unknown as DungeonLayer;

const shift = (dx: number, dy: number): PointMap => ([x, y]) => [x + dx, y + dy];
const turn90 = (cx: number, cy: number): PointMap => ([x, y]) => [cx - (y - cy), cy + (x - cx)];

const STONE: WallPieceSpec[] = [
  { id: 'straight-a', role: 'straight', lengthPx: 400, thicknessPx: 61 },
  { id: 'straight-b', role: 'straight', lengthPx: 200, thicknessPx: 57 },
  { id: 'rock-a', role: 'rock', lengthPx: 70, thicknessPx: 60 },
];

describe('wall transforms', () => {
  it('maps every point of the line', () => {
    expect(mapWallPoints([[0, 0], [2, 1]], shift(3, -1))).toEqual([[3, -1], [5, 0]]);
  });

  it('turns a door with its wall: a quarter turn adds a quarter to its angle', () => {
    const pose = mapDoorPose({ position: [2, 0], angle: 0 }, turn90(0, 0));
    expect(pose.position[0]).toBeCloseTo(0);
    expect(pose.position[1]).toBeCloseTo(2);
    expect(pose.angle).toBeCloseTo(Math.PI / 2);
  });

  it('mirrors a door the way the wall under it mirrors', () => {
    const pose = mapDoorPose({ position: [1, 1], angle: Math.PI / 4 }, mirrorMap('h', 0, 0));
    expect(pose.position).toEqual([-1, 1]);
    expect(pose.angle).toBeCloseTo((3 * Math.PI) / 4);
  });

  it('moves a lone wall and the door on it, nothing else', () => {
    const l = layer([wall('gap', [8, 0], [10, 0]), wall('far', [0, 5], [4, 5])], [door()]);
    const plan = planWallEdits(l, new Map([['gap', shift(0, 3)]]));
    expect(plan.walls).toEqual([{ id: 'gap', before: [[8, 0], [10, 0]], after: [[8, 3], [10, 3]] }]);
    expect(plan.doors).toEqual([{ id: 'd1', before: { position: [9, 0] }, after: { position: [9, 3] } }]);
  });

  it('keeps a doorway sealed when the whole run moves together', () => {
    const walls = [wall('left', [0, 0], [8, 0]), wall('gap', [8, 0], [10, 0]), wall('right', [10, 0], [16, 0])];
    const l = layer(walls, [door()]);
    const m = shift(1, 2);
    const plan = planWallEdits(l, new Map(walls.map((w) => [w.id, m])));
    const after = new Map(plan.walls.map((w) => [w.id, w.after]));
    // The jambs still meet: left ends where gap starts, gap ends where right starts.
    expect(after.get('left')![1]).toEqual(after.get('gap')![0]);
    expect(after.get('gap')![1]).toEqual(after.get('right')![0]);
    expect(plan.doors[0].after.position).toEqual([10, 2]);
  });

  it('re-seals a door that was narrower than its doorway after the move', () => {
    const walls = [wall('left', [0, 0], [8, 0]), wall('gap', [8, 0], [10, 0]), wall('right', [10, 0], [16, 0])];
    const l = layer(walls, [door({ width: 1 })]);
    const plan = planWallEdits(l, new Map(walls.map((w) => [w.id, shift(0, 1)])));
    const gap = plan.walls.find((w) => w.id === 'gap')!.after;
    // Sealed again on the moved layer: the doorway piece spans the door exactly, 1 cell.
    expect(Math.hypot(gap[1][0] - gap[0][0], gap[1][1] - gap[0][1])).toBeCloseTo(1);
  });

  it('leaves hand edits keyed by t untouched', () => {
    const w = wall('w', [0, 0], [4, 0], { nodeEdits: [{ t: 0.25, rotate: 0.1 }] });
    const copy = copyWall(w, 'w2', shift(1, 1));
    expect(copy.nodeEdits).toEqual(w.nodeEdits);
    expect(copy.points).toEqual([[1, 1], [5, 1]]);
    expect(copy.id).toBe('w2');
  });

  it('copies a wall unlocked', () => {
    const copy = copyWall(wall('w', [0, 0], [1, 0], { locked: true }), 'c');
    expect(copy.locked).toBeUndefined();
  });

  it('re-lays the kit stones from the moved line: every stone moves with it', () => {
    const before = layoutWall([[0, 0], [6, 0]], false, STONE, { wallWidth: 0.5, seed: 3 });
    const after = layoutWall(mapWallPoints([[0, 0], [6, 0]], shift(2, 5)), false, STONE, { wallWidth: 0.5, seed: 3 });
    expect(after.length).toBe(before.length);
    after.forEach((node, i) => {
      expect(node.x).toBeCloseTo(before[i].x + 2);
      expect(node.y).toBeCloseTo(before[i].y + 5);
    });
  });

  it('moves the band the light sweep reads, so the cave rock and its shadow re-lay', () => {
    const l = layer([wall('gap', [8, 0], [10, 0])], []);
    const plan = planWallEdits(l, new Map([['gap', shift(0, 4)]]));
    const moved = layer([{ ...l.standaloneWalls[0], points: plan.walls[0].after }]);
    const segs = extractWallSegments([moved]);
    expect(segs.some((s) => Math.abs(s.y1 - 4) < 1e-9 && Math.abs(s.y2 - 4) < 1e-9)).toBe(true);
  });

  it('finds the doors on a wall and the centre of its line', () => {
    const l = layer([wall('gap', [8, 0], [10, 2])], [door(), door({ id: 'd2', wallId: 'other' })]);
    expect(doorsOnWall(l, 'gap').map((d) => d.id)).toEqual(['d1']);
    expect(wallCentre([[8, 0], [10, 2]])).toEqual([9, 1]);
  });
});
