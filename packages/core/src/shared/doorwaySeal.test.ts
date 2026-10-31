import { describe, it, expect } from 'vitest';
import { doorwayRoom, findDoorway, isOwnPiece, overDoorway, sealDoorway, turnOwnPiece } from './doorwaySeal';
import { extractWallSegments } from '../engine/lighting/raycaster';
import type { DoorChild, WallSegment } from './types';
import type { DungeonLayer } from '../store/types';

const wall = (id: string, a: [number, number], b: [number, number]): WallSegment => ({
  id,
  points: [a, b],
  wallType: 'normal',
  direction: 'both',
  color: '#000',
  width: 0.5,
  roughness: 0,
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
const layer = (walls: WallSegment[], d: DoorChild = door()): DungeonLayer =>
  ({
    id: `seal-${n++}`,
    type: 'dungeon',
    children: [d],
    standaloneWalls: walls,
    mergedFloor: null,
  }) as unknown as DungeonLayer;

/** fieldstone-keep's doorway: a 2-cell piece between two longer walls on one line. */
const keep = (d?: DoorChild) => layer([wall('left', [0, 0], [8, 0]), wall('gap', [8, 0], [10, 0]), wall('right', [10, 0], [16, 0])], d);

const pts = (seal: ReturnType<typeof sealDoorway>, id: string) => seal?.walls.find((w) => w.id === id)?.after;
const apply = (l: DungeonLayer, seal: NonNullable<ReturnType<typeof sealDoorway>>): DungeonLayer =>
  ({
    ...l,
    id: `${l.id}-after`,
    children: l.children.map((c) => (c.id === 'd1' ? { ...c, ...seal.door } : c)),
    standaloneWalls: l.standaloneWalls.map((w) => {
      const a = seal.walls.find((x) => x.id === w.id);
      return a ? { ...w, points: a.after } : w;
    }),
  }) as DungeonLayer;

describe('sealDoorway', () => {
  it('narrowing the door brings both neighbours up to its edges', () => {
    const seal = sealDoorway(keep(), 'd1', { width: 1 })!;
    expect(seal.door).toEqual({ width: 1, position: [9, 0] });
    expect(pts(seal, 'gap')).toEqual([[8.5, 0], [9.5, 0]]);
    expect(pts(seal, 'left')).toEqual([[0, 0], [8.5, 0]]);
    expect(pts(seal, 'right')).toEqual([[9.5, 0], [16, 0]]);
  });

  it('widening trims them back, the same rule the other way', () => {
    const seal = sealDoorway(keep(), 'd1', { width: 3.5 })!;
    expect(pts(seal, 'gap')).toEqual([[7.25, 0], [10.75, 0]]);
    expect(pts(seal, 'left')).toEqual([[0, 0], [7.25, 0]]);
    expect(pts(seal, 'right')).toEqual([[10.75, 0], [16, 0]]);
  });

  it('keeps a wall drawn the other way round the right way round', () => {
    const l = layer([wall('left', [8, 0], [0, 0]), wall('gap', [8, 0], [10, 0]), wall('right', [16, 0], [10, 0])]);
    const seal = sealDoorway(l, 'd1', { width: 1 })!;
    expect(pts(seal, 'left')).toEqual([[8.5, 0], [0, 0]]);
    expect(pts(seal, 'right')).toEqual([[16, 0], [9.5, 0]]);
  });

  it('slides along the doorway with the walls following, held short of each far end', () => {
    const seal = sealDoorway(keep(), 'd1', { at: [12, 0.3] })!;
    expect(seal.door.position).toEqual([12, 0]);
    expect(pts(seal, 'left')).toEqual([[0, 0], [11, 0]]);
    expect(pts(seal, 'right')).toEqual([[13, 0], [16, 0]]);
    // Past the end: the neighbour keeps half a cell.
    expect(sealDoorway(keep(), 'd1', { at: [40, 0] })!.door.position).toEqual([14.5, 0]);
  });

  it('caps the width at what the neighbours can give', () => {
    expect(doorwayRoom(keep(), 'd1')).toBe(15);
    expect(sealDoorway(keep(), 'd1', { width: 40 })!.door.width).toBe(15);
  });

  it('turns no corner and touches no wall off the line', () => {
    const l = layer([
      wall('up', [8, 0], [8, -6]), // meets the doorway's start at a corner
      wall('gap', [8, 0], [10, 0]),
      wall('beside', [10, 0.5], [16, 0.5]), // parallel, half a cell off
      wall('right', [10, 0], [16, 0]),
    ]);
    const seal = sealDoorway(l, 'd1', { width: 1 })!;
    expect(seal.walls.map((w) => w.id).sort()).toEqual(['gap', 'right']);
    // The start side has no neighbour on the line, so the piece keeps that end.
    expect(pts(seal, 'gap')).toEqual([[8, 0], [9.5, 0]]);
  });

  it('leaves a long wall with a door in it alone: no piece bounds that opening', () => {
    const l = layer([wall('gap', [0, 0], [10, 0]), wall('right', [10, 0], [16, 0])], door({ position: [3, 0], width: 1 }));
    expect(findDoorway(l, 'd1')).toBeNull();
    expect(sealDoorway(l, 'd1', { width: 2 })).toBeNull();
    // A floor-edge door (no drawn wall) has nothing to seal either.
    expect(sealDoorway(layer([], door({ wallId: '' })), 'd1', { width: 1 })).toBeNull();
  });

  it('knows the doorway run a drag may slide along', () => {
    const d = findDoorway(keep(), 'd1')!;
    expect(overDoorway(d, [5, 0.2], 0.5)).toBe(true);
    expect(overDoorway(d, [5, 2], 0.5)).toBe(false);
    expect(overDoorway(d, [30, 0], 0.5)).toBe(false);
  });

  it('closed, the sealed wall blocks light along the whole line; open, exactly the door passes', () => {
    for (const width of [1, 1.5, 3]) {
      const sealed = apply(keep(), sealDoorway(keep(), 'd1', { width })!);
      const covered = (l: DungeonLayer) => {
        const segs = extractWallSegments([l]).filter((s) => Math.abs(s.y1) < 1e-9 && Math.abs(s.y2) < 1e-9);
        const spans = segs.map((s) => [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)]).sort((a, b) => a[0] - b[0]);
        const gaps: [number, number][] = [];
        let at = 0;
        for (const [a, b] of spans) {
          if (a > at + 1e-6) gaps.push([at, a]);
          at = Math.max(at, b);
        }
        if (at < 16 - 1e-6) gaps.push([at, 16]);
        return gaps;
      };
      expect(covered(sealed)).toEqual([]);
      const open = { ...sealed, id: `${sealed.id}-open`, children: [{ ...sealed.children[0], state: 'open' }] } as DungeonLayer;
      const gaps = covered(open);
      expect(gaps).toHaveLength(1);
      expect(gaps[0][0]).toBeCloseTo(9 - width / 2);
      expect(gaps[0][1]).toBeCloseTo(9 + width / 2);
    }
  });
});

describe('isOwnPiece', () => {
  it('a free-standing door: a two-point piece no longer than the door plus the slack', () => {
    const l = layer([wall('gap', [8, 0], [10, 0])]);
    expect(isOwnPiece(l, 'd1')?.id).toBe('gap');
    expect(isOwnPiece(layer([wall('gap', [8, 0], [11, 0])]), 'd1')?.id).toBe('gap');
  });

  it('not a long wall, a chained wall, a floor door, or no door', () => {
    expect(isOwnPiece(layer([wall('gap', [0, 0], [10, 0])]), 'd1')).toBeNull();
    expect(isOwnPiece(layer([{ ...wall('gap', [8, 0], [9, 0]), points: [[8, 0], [9, 0], [9, 1]] }]), 'd1')).toBeNull();
    expect(isOwnPiece(layer([wall('gap', [8, 0], [10, 0])], door({ wallId: '' })), 'd1')).toBeNull();
    expect(isOwnPiece(layer([wall('gap', [8, 0], [10, 0])]), 'nope')).toBeNull();
  });
});

describe('turnOwnPiece', () => {
  it('turns the piece about the door’s centre and gives the door its new angle', () => {
    const turn = turnOwnPiece(layer([wall('gap', [8, 0], [10, 0])]), 'd1', Math.PI / 2)!;
    expect(turn.wallId).toBe('gap');
    expect(turn.before).toEqual([[8, 0], [10, 0]]);
    expect(turn.after[0][0]).toBeCloseTo(9);
    expect(turn.after[0][1]).toBeCloseTo(-1);
    expect(turn.after[1][0]).toBeCloseTo(9);
    expect(turn.after[1][1]).toBeCloseTo(1);
    expect(turn.door).toEqual({ angle: Math.PI / 2, position: [9, 0] });
  });

  it('a door off-centre on a longer piece keeps its place on the piece', () => {
    const turn = turnOwnPiece(layer([wall('gap', [8, 0], [11, 0])], door({ position: [10, 0] })), 'd1', Math.PI / 2)!;
    expect(turn.door.position).toEqual([10, 0]);
    expect(turn.after[0][1]).toBeCloseTo(-2);
    expect(turn.after[1][1]).toBeCloseTo(1);
  });

  it('null for a door on a long wall', () => {
    expect(turnOwnPiece(layer([wall('gap', [0, 0], [10, 0])]), 'd1', 1)).toBeNull();
  });
});
