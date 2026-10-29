import { describe, it, expect } from 'vitest';
import {
  anchorForHandle,
  isIdentity,
  snapshotChild,
  transformChild,
  type WorldTransform,
} from './childTransform';
import type { AnyChild, ShapeChild } from '../../store/types';

const BOX = { x: 0, y: 0, width: 10, height: 4 };

const square = (): ShapeChild => ({
  id: 's1',
  name: 'Square',
  childType: 'shape',
  visible: true,
  locked: false,
  shapeType: 'rectangle',
  contours: [[[0, 0], [10, 0], [10, 4], [0, 4]]],
  roughnessEnabled: false,
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
}) as ShapeChild;

const identity = (over: Partial<WorldTransform> = {}): WorldTransform => ({
  translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0,
  anchorX: 0, anchorY: 0, ...over,
});

const rings = (patch: Partial<AnyChild>) =>
  (patch as { contours: [number, number][][] }).contours;

describe('anchorForHandle', () => {
  // Dragging one edge must leave the opposite one where it was.
  it('pins the opposite corner', () => {
    expect(anchorForHandle('nw', BOX)).toEqual({ x: 10, y: 4 });
    expect(anchorForHandle('se', BOX)).toEqual({ x: 0, y: 0 });
  });

  it('pins the opposite edge and centres the free axis', () => {
    expect(anchorForHandle('e', BOX)).toEqual({ x: 0, y: 2 });
    expect(anchorForHandle('n', BOX)).toEqual({ x: 5, y: 4 });
  });

  it('pivots rotation about the centre', () => {
    expect(anchorForHandle('rotate', BOX)).toEqual({ x: 5, y: 2 });
  });
});

describe('transformChild', () => {
  it('moves every ring point by the same world delta', () => {
    const out = rings(transformChild(snapshotChild(square()), identity({ translateX: 3, translateY: -2 })));
    expect(out[0]).toEqual([[3, -2], [13, -2], [13, 2], [3, 2]]);
  });

  // Handle points are absolute, so any ring transform that leaves them behind
  // bends the room's curves toward where it used to stand.
  it('maps curve tangents with the same transform as the ring', () => {
    const s = square();
    s.tangents = [[{ tout: [2, -3] }, { tin: [8, -3] }, null, null]];
    const t = identity({ rotation: Math.PI / 2, translateX: 1, translateY: 0 });
    const patch = transformChild(snapshotChild(s), t) as Partial<ShapeChild>;
    const vt = patch.tangents![0];
    // (2,-3) rotated 90° about origin → (3,2), then +1 in x.
    expect(vt[0]?.tout?.[0]).toBeCloseTo(4, 9);
    expect(vt[0]?.tout?.[1]).toBeCloseTo(2, 9);
    expect(vt[1]?.tin?.[0]).toBeCloseTo(4, 9);
    expect(vt[1]?.tin?.[1]).toBeCloseTo(8, 9);
    expect(vt[2]).toBeNull();
  });

  it('leaves the tangents field written-but-undefined for straight shapes', () => {
    const patch = transformChild(snapshotChild(square()), identity({ translateX: 1 })) as Partial<ShapeChild>;
    expect('tangents' in patch).toBe(true);
    expect(patch.tangents).toBeUndefined();
  });

  it('scales about the anchor, leaving it fixed', () => {
    const t = identity({ scaleX: 2, scaleY: 1, anchorX: 0, anchorY: 0 });
    const out = rings(transformChild(snapshotChild(square()), t));
    expect(out[0][0]).toEqual([0, 0]);   // the anchor does not move
    expect(out[0][1]).toEqual([20, 0]);  // the dragged edge does
  });

  // A stored translate/rotate/scale triple cannot express a non-uniform scale of
  // an already-rotated shape; rewriting points can, so this must stay exact.
  it('handles non-uniform scale on a rotated shape without skew', () => {
    const rotated = square();
    rotated.contours = [[[0, 0], [0, 10], [-4, 10], [-4, 0]]]; // same box, turned 90°
    const t = identity({ scaleX: 2, scaleY: 1 });
    const out = rings(transformChild(snapshotChild(rotated), t));
    expect(out[0]).toEqual([[0, 0], [0, 10], [-8, 10], [-8, 0]]);
  });

  it('bakes an existing transform in rather than applying it twice', () => {
    const s = square();
    s.transform = { translate: [5, 0], rotate: 0, scale: [1, 1] };
    const out = rings(transformChild(snapshotChild(s), identity()));
    expect(out[0][0]).toEqual([5, 0]);
    // ...and clears it, or computeMergedFloor would shift the rings again.
    const patch = transformChild(snapshotChild(s), identity()) as { transform?: unknown };
    expect(patch.transform).toBeUndefined();
  });

  it('leaves a door alone — it belongs to its wall', () => {
    const door = { childType: 'door' } as AnyChild;
    expect(snapshotChild(door).kind).toBe('none');
    expect(transformChild(snapshotChild(door), identity({ translateX: 5 }))).toEqual({});
  });

  const asset = (): AnyChild =>
    ({
      id: 'a1',
      name: 'Asset',
      childType: 'asset',
      visible: true,
      position: { x: 4, y: 6 },
      rotation: 0,
      scale: 1.5,
      width: 2,
      height: 2,
      flipX: false,
      flipY: false,
    }) as AnyChild;

  it('resizes an asset through width/height, non-uniformly', () => {
    // Width/height are what the renderer draws — scale is a legacy multiplier
    // and must pass through untouched.
    const t = identity({ scaleX: 2, scaleY: 0.5, anchorX: 4, anchorY: 6 });
    const patch = transformChild(snapshotChild(asset()), t) as {
      width: number; height: number; scale?: number; position: { x: number; y: number };
    };
    expect(patch.width).toBe(4);
    expect(patch.height).toBe(1);
    expect(patch.scale).toBeUndefined();
    expect(patch.position).toEqual({ x: 4, y: 6 }); // anchored at its own centre
  });

  it('clamps asset size instead of collapsing through zero', () => {
    const t = identity({ scaleX: 0, scaleY: 0 });
    const patch = transformChild(snapshotChild(asset()), t) as { width: number; height: number };
    expect(patch.width).toBeGreaterThan(0);
    expect(patch.height).toBeGreaterThan(0);
  });

  it('scales text uniformly through scale, leaving width/height estimates alone', () => {
    const text = {
      childType: 'text',
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: 1,
      width: 2.2,
      height: 0.96,
    } as AnyChild;
    const t = identity({ scaleX: 2, scaleY: 1.2 });
    const patch = transformChild(snapshotChild(text), t) as {
      scale: number; width?: number; height?: number;
    };
    expect(patch.scale).toBe(2); // dominant factor wins
    expect(patch.width).toBeUndefined();
    expect(patch.height).toBeUndefined();
  });

  it('scales a light radius and ignores rotation', () => {
    const light = {
      childType: 'light',
      position: { x: 1, y: 1 },
      radius: 6,
    } as AnyChild;
    const snap = snapshotChild(light);
    expect(snap.kind).toBe('radius');
    const t = identity({ scaleX: 1.5, scaleY: 1, rotation: Math.PI / 2, anchorX: 1, anchorY: 1 });
    const patch = transformChild(snap, t) as { radius: number; rotation?: number };
    expect(patch.radius).toBe(9);
    expect(patch.rotation).toBeUndefined();
  });
});

describe('isIdentity', () => {
  it('is true for a click that never moved', () => {
    expect(isIdentity(identity())).toBe(true);
  });

  it('is false once anything actually changed', () => {
    expect(isIdentity(identity({ translateX: 0.5 }))).toBe(false);
    expect(isIdentity(identity({ scaleX: 1.2 }))).toBe(false);
    expect(isIdentity(identity({ rotation: 0.01 }))).toBe(false);
  });
});
