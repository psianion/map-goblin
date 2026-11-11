import { describe, expect, it } from 'vitest';
import { caveFloorContours, caveFloorShape, caveFloors, hasCaveLook, smoothCaveRing, wallPatchesToFloors } from './caveFloor';
import { signedArea } from './floorPieces';
import type { DungeonLayer, Layer } from '../store/types';

type Ring = [number, number][];

/** A wobbly circle of `n` points round (cx, cy), the kind of ring a brush stroke leaves. */
const blob = (cx: number, cy: number, r: number, n: number, sign = 1): Ring =>
  Array.from({ length: n }, (_, i) => {
    const a = (sign * i * 2 * Math.PI) / n;
    const rr = r + 0.05 * Math.sin(i * 1.7);
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  });

const look = { material: 'GG_Cave_Ink', fill: 'p:cave_floor', border: true };

describe('smoothCaveRing', () => {
  it('thins a dense ring to a few hundred points at most, keeping its winding and size', () => {
    const ring = blob(0, 0, 10, 3000);
    const out = smoothCaveRing(ring);
    expect(out.length).toBeGreaterThan(8);
    expect(out.length).toBeLessThan(400);
    expect(Math.sign(signedArea(out))).toBe(Math.sign(signedArea(ring)));
    expect(Math.abs(signedArea(out))).toBeCloseTo(Math.abs(signedArea(ring)), -1);
  });
});

describe('caveFloorContours', () => {
  it('makes one floor per outer ring with its hole inside it, the hole wound the other way', () => {
    const pieces = caveFloorContours([blob(0, 0, 10, 400), blob(0, 0, 3, 200, -1), blob(40, 0, 4, 200)], true);
    expect(pieces).toHaveLength(2);
    const [big, small] = pieces;
    expect(big).toHaveLength(2);
    expect(small).toHaveLength(1);
    expect(Math.sign(signedArea(big[1]))).toBe(-Math.sign(signedArea(big[0])));
  });

  it('leaves the rings as they are with Smooth off', () => {
    const ring = blob(0, 0, 5, 50);
    expect(caveFloorContours([ring], false)).toEqual([[ring]]);
  });
});

describe('a cave floor shape', () => {
  it('pins the fill and the band, or no stone with Border off', () => {
    const shape = caveFloorShape([blob(0, 0, 5, 20)], look, 'f', 'Cave 1');
    expect(shape).toMatchObject({ id: 'f', name: 'Cave 1', childType: 'shape', shapeType: 'polygon', visible: true, textureId: 'p:cave_floor' });
    expect(shape.styleOverrides).toEqual({ wallTextureSetId: 'GG_Cave_Ink' });
    expect(hasCaveLook(shape, look)).toBe(true);
    expect(hasCaveLook(shape, { ...look, border: false })).toBe(false);
    expect(caveFloorShape([blob(0, 0, 5, 20)], { ...look, border: false }, 'g', 'Cave 2').styleOverrides).toEqual({ wallTextureSetId: '' });
  });

  it('names new floors on from the layer’s, Cave N', () => {
    let n = 0;
    const floors = caveFloors([blob(0, 0, 5, 40), blob(30, 0, 5, 40)], false, look, [{ name: 'Cave 3' }], () => `id${n++}`);
    expect(floors.map((f) => [f.id, f.name])).toEqual([
      ['id0', 'Cave 4'],
      ['id1', 'Cave 5'],
    ]);
  });
});

describe('wallPatchesToFloors', () => {
  const layer = (materials: unknown[]): Layer => ({ id: 'l', type: 'dungeon', children: [], materials }) as unknown as Layer;
  const square: Ring = [[0, 0], [4, 0], [4, 4], [0, 4]];

  it('turns a wall patch into floors and keeps every other patch; untouched layers come back as they were', () => {
    const plain = { id: 'a', material: 'GG_Cave_Ink', rings: [square], smooth: false, border: true };
    const layers = [layer([plain, { ...plain, id: 'b', wall: true }])];
    const out = wallPatchesToFloors(layers, () => 'p:cave_floor', () => 'new');
    const l = out[0] as DungeonLayer;
    expect(l.materials).toEqual([plain]);
    expect(l.children).toEqual([caveFloorShape([square], look, 'new', 'Cave 1')]);
    const none = [layer([plain])];
    expect(wallPatchesToFloors(none, () => 'p:cave_floor')).toBe(none);
  });

  it('drops the materials list once its last patch is a floor', () => {
    const out = wallPatchesToFloors([layer([{ id: 'a', material: 'GG_Cave_Ink', rings: [square], smooth: false, border: true, wall: true }])], () => 'p:cave_floor');
    expect((out[0] as DungeonLayer).materials).toBeUndefined();
  });
});
