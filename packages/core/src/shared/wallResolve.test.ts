import { describe, it, expect } from 'vitest';
import { resolveWalls, resolveDoors, toOcclusionDoors, FLOOR_ANCHORED } from './wallResolve';
import { buildOcclusionSegments } from './occlusion';
import type { DoorChild, WallSegment } from './types';
import type { DungeonLayer } from '../store/types';

const wall = (overrides: Partial<WallSegment> = {}): WallSegment => ({
  id: 'w1',
  points: [[0, 0], [10, 0]],
  wallType: 'normal',
  direction: 'both',
  color: '#000',
  width: 2,
  roughness: 0,
  ...overrides,
});

const door = (overrides: Partial<DoorChild> = {}): DoorChild => ({
  id: 'd1',
  name: 'Door 1',
  childType: 'door',
  visible: true,
  wallId: 'w1',
  position: [5, 0],
  angle: 0,
  width: 1,
  style: 'single',
  state: 'closed',
  isSecret: false,
  ...overrides,
});

/** A square ring, counter-clockwise from the origin corner. */
const ring = (x: number, y: number, size = 10): [number, number][] => [
  [x, y], [x + size, y], [x + size, y + size], [x, y + size],
];

let nextLayerId = 0;
const layer = (parts: Partial<DungeonLayer>): DungeonLayer =>
  ({
    // A fresh id per layer keeps the resolve memo from answering for another test.
    id: `layer-${nextLayerId++}`,
    type: 'dungeon',
    children: [],
    standaloneWalls: [],
    mergedFloor: null,
    ...parts,
  }) as unknown as DungeonLayer;

const resolve = (l: DungeonLayer) => resolveDoors(l, resolveWalls(l));

describe('resolveWalls', () => {
  it('promotes every floor-ring edge to a normal wall', () => {
    const walls = resolveWalls(layer({ mergedFloor: [ring(0, 0)] }));
    expect(walls).toHaveLength(4);
    expect(walls.every((w) => w.kind === 'floor')).toBe(true);
    expect(walls.every((w) => w.wallType === 'normal')).toBe(true);
  });

  it('returns standalone walls alongside floor edges', () => {
    const walls = resolveWalls(
      layer({ standaloneWalls: [wall()], mergedFloor: [ring(0, 0)] }),
    );
    expect(walls).toHaveLength(5);
    expect(walls[0].kind).toBe('standalone');
  });

  it('recomputes only when the geometry reference changes', () => {
    const l = layer({ standaloneWalls: [wall()] });
    expect(resolveWalls(l)).toBe(resolveWalls(l));
    l.mergedFloor = [ring(0, 0)];
    expect(resolveWalls(l)).toHaveLength(5);
  });
});

describe('resolveDoors', () => {
  it('follows a node edit — the door moves with the wall it is hinted to', () => {
    const l = layer({ standaloneWalls: [wall()], children: [door()] });
    expect(resolve(l)[0].position).toEqual([5, 0]);

    // Drag both nodes down a unit: the stored position is untouched, the
    // resolved one lands back on the wall.
    l.standaloneWalls = [wall({ points: [[0, 1], [10, 1]] })];
    const moved = resolve(l)[0];
    expect(moved.position).toEqual([5, 1]);
    expect(moved.detached).toBe(false);
    expect((l.children[0] as DoorChild).position).toEqual([5, 0]);
  });

  it('derives angle from the wall rather than the stored copy', () => {
    const l = layer({
      standaloneWalls: [wall({ points: [[0, 0], [0, 10]] })],
      children: [door({ position: [0, 5], angle: 0 })],
    });
    expect(resolve(l)[0].angle).toBeCloseTo(Math.PI / 2);
  });

  it('clamps the door so it stays fully on its wall', () => {
    const l = layer({
      standaloneWalls: [wall()],
      children: [door({ position: [10, 0], width: 4 })],
    });
    expect(resolve(l)[0].position).toEqual([8, 0]);
  });

  it('re-anchors a floor door after the union reorders the rings', () => {
    const rings = [ring(0, 0), ring(40, 0)];
    const l = layer({
      mergedFloor: rings,
      // On the bottom edge of the second ring.
      children: [door({ wallId: FLOOR_ANCHORED, position: [45, 0] })],
    });
    const before = resolve(l)[0];
    expect(before.detached).toBe(false);
    expect(before.wall!.id).toBe('floor:1:0');

    l.mergedFloor = [rings[1], rings[0]];
    const after = resolve(l)[0];
    expect(after.detached).toBe(false);
    expect(after.wall!.id).toBe('floor:0:0');
    expect(after.position).toEqual(before.position);
  });

  it('re-anchors a legacy floor-* wallId by projection', () => {
    const l = layer({
      mergedFloor: [ring(0, 0)],
      children: [door({ wallId: 'floor-0-2', position: [5, 0] })],
    });
    const resolved = resolve(l)[0];
    expect(resolved.detached).toBe(false);
    // The stored id named ring 0 edge 2; projection puts it on edge 0 where it
    // actually sits.
    expect(resolved.wall!.id).toBe('floor:0:0');
    expect(resolved.position).toEqual([5, 0]);
  });

  it('prefers the hinted wall at a corner, and the nearest one once the hint is gone', () => {
    const along = wall({ id: 'w1', points: [[0, 0], [10, 0]] });
    const up = wall({ id: 'w2', points: [[10, 0], [10, 10]] });
    const corner = door({ wallId: 'w1', position: [10, 0] });

    const hinted = layer({ standaloneWalls: [along, up], children: [corner] });
    expect(resolve(hinted)[0].wall!.id).toBe('w1');

    const orphaned = layer({ standaloneWalls: [up], children: [corner] });
    expect(resolve(orphaned)[0].wall!.id).toBe('w2');
  });

  it('detaches a floor door when the wall under it is gone', () => {
    const l = layer({
      mergedFloor: [ring(0, 0)],
      children: [door({ wallId: FLOOR_ANCHORED, position: [5, 0] })],
    });
    expect(resolve(l)[0].detached).toBe(false);

    l.mergedFloor = null;
    const detached = resolve(l);
    // Still listed — a detached door is never silently dropped.
    expect(detached).toHaveLength(1);
    expect(detached[0].detached).toBe(true);
    expect(detached[0].wall).toBeNull();
  });

  it('detaches a door further from any wall than its re-anchor range', () => {
    const l = layer({
      standaloneWalls: [wall()],
      children: [door({ wallId: FLOOR_ANCHORED, position: [5, 6] })],
    });
    expect(resolve(l)[0].detached).toBe(true);
  });
});

describe('toOcclusionDoors', () => {
  it('excludes detached doors from the occlusion input', () => {
    const l = layer({
      standaloneWalls: [wall()],
      children: [door({ wallId: FLOOR_ANCHORED, position: [5, 6] })],
    });
    const walls = resolveWalls(l);
    const segments = buildOcclusionSegments(walls, toOcclusionDoors(resolveDoors(l, walls)));
    expect(segments.some((s) => s.sourceType === 'door')).toBe(false);
    expect(segments).toHaveLength(1);
  });

  it('splits a floor-ring edge at an open door so light gets through', () => {
    const l = layer({
      mergedFloor: [ring(0, 0)],
      children: [door({ wallId: FLOOR_ANCHORED, position: [5, 0], width: 2, state: 'open' })],
    });
    const walls = resolveWalls(l);
    const segments = buildOcclusionSegments(walls, toOcclusionDoors(resolveDoors(l, walls)));
    const gap = segments.find((s) => s.sourceType === 'door');
    expect(gap!.blocksLight).toBe(false);
    // The doored edge is now two stubs plus the gap, the other three intact.
    expect(segments).toHaveLength(6);
  });
});
