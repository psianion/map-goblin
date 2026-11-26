import { describe, expect, it } from 'vitest';
import { findWallJoints, type JointSpine } from './wallJoints';

const wall = (points: [number, number][], over: Partial<JointSpine> = {}): JointSpine => ({
  points,
  setId: 'Test_Outline',
  width: 0.5,
  closed: false,
  ...over,
});

/** Rotate `v` by `angle`, as the renderer turns the authored piece. */
const turn = ([x, y]: [number, number], angle: number): [number, number] => [
  x * Math.cos(angle) - y * Math.sin(angle),
  x * Math.sin(angle) + y * Math.cos(angle),
];

describe('findWallJoints', () => {
  it('finds one tee where a wall ends square on the middle of another, its stem along the ending wall', () => {
    const joints = findWallJoints([wall([[0, 0], [10, 0]]), wall([[5, 6], [5, 0.1]])]);
    expect(joints).toHaveLength(1);
    const [tee] = joints;
    expect(tee).toMatchObject({ kind: 'tee', spine: 1, other: 0, end: 1 });
    expect(tee.x).toBeCloseTo(5);
    expect(tee.y).toBeCloseTo(0);
    // The authored stem (+y) turned by the joint's angle points up the ending wall.
    const [sx, sy] = turn([0, 1], tee.angle);
    expect(sx).toBeCloseTo(0);
    expect(sy).toBeCloseTo(1);
  });

  it('finds no tee where the walls meet at 60°', () => {
    const end: [number, number] = [5, 0];
    const from: [number, number] = [5 + 6 * Math.cos(Math.PI / 3), 6 * Math.sin(Math.PI / 3)];
    expect(findWallJoints([wall([[0, 0], [10, 0]]), wall([from, end])])).toEqual([]);
  });

  it('finds one cross where two walls cross square away from their ends', () => {
    const joints = findWallJoints([wall([[0, 0], [10, 0]]), wall([[5, -5], [5, 5]])]);
    expect(joints).toHaveLength(1);
    expect(joints[0]).toMatchObject({ kind: 'cross', spine: 0, other: 1 });
    expect(joints[0].x).toBeCloseTo(5);
    expect(joints[0].y).toBeCloseTo(0);
  });

  it('finds nothing at an L where two walls share an end', () => {
    expect(findWallJoints([wall([[0, 0], [10, 0]]), wall([[10, 0], [10, 8]])])).toEqual([]);
  });

  it('finds nothing where the walls differ in set or in width', () => {
    expect(findWallJoints([wall([[0, 0], [10, 0]]), wall([[5, 6], [5, 0]], { setId: 'Other' })])).toEqual([]);
    expect(findWallJoints([wall([[0, 0], [10, 0]]), wall([[5, 6], [5, 0]], { width: 0.8 })])).toEqual([]);
  });

  it('finds a tee on a floor ring, never a cross with one, and none inside a door', () => {
    const ring = wall([[0, 0], [10, 0], [10, 10], [0, 10]], { closed: true, ring: true });
    expect(findWallJoints([wall([[5, 6], [5, 0]]), ring]).map((j) => j.kind)).toEqual(['tee']);
    expect(findWallJoints([wall([[5, -5], [5, 5]]), ring])).toEqual([]);
    expect(findWallJoints([wall([[5, 6], [5, 0]]), ring], [{ position: [5, 0], width: 1 }])).toEqual([]);
  });
});
