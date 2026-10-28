import { describe, it, expect, beforeEach } from 'vitest';
import {
  footprintSnap,
  obbOverlap,
  obbMeetsCircle,
  floorTest,
  eraseHits,
  ObbHash,
  type Obb,
} from './propPlacement';
import { useStore } from '../../store/store';
import type { AssetChild, DungeonLayer } from '../../store/types';
import type { Room } from '../../shared/types';
import { seedCaveBandPack, caveBandChildren, resetAssetPackManager } from '../../testing/seedCatalog';

const DEG = Math.PI / 180;

function baseLayer(): DungeonLayer {
  useStore.getState().resetToDefault();
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return { ...l, children: [], rooms: [], mergedFloor: null };
}

function prop(id: string, over: Partial<AssetChild> = {}): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'test:crate',
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...over,
  };
}

const box = (cx: number, cy: number, hw: number, hh: number, rot = 0): Obb => ({ cx, cy, hw, hh, rot });

describe('footprintSnap', () => {
  const cursor = { x: 3.3, y: 4.8 };

  it('a 1×1 lands inside one cell', () => {
    expect(footprintSnap(cursor, 1, 1, 0, true, 1)).toEqual({ x: 3.5, y: 4.5 });
  });

  it('a 2×1 lands on two whole cells at 0°', () => {
    expect(footprintSnap(cursor, 2, 1, 0, true, 1)).toEqual({ x: 3, y: 4.5 });
  });

  it('a 2×1 turned 90° lands on 1×2 cells', () => {
    const p = footprintSnap(cursor, 2, 1, 90 * DEG, true, 1);
    expect(p.x).toBeCloseTo(3.5);
    expect(p.y).toBeCloseTo(5);
  });

  it('-90° and 270° count as right angles too, and 180° keeps the footprint', () => {
    expect(footprintSnap(cursor, 2, 1, -90 * DEG, true, 1).y).toBeCloseTo(5);
    expect(footprintSnap(cursor, 2, 1, 270 * DEG, true, 1).y).toBeCloseTo(5);
    const half = footprintSnap(cursor, 2, 1, 180 * DEG, true, 1);
    expect(half.x).toBeCloseTo(3);
    expect(half.y).toBeCloseTo(4.5);
  });

  it('within 0.5° of a right angle still snaps by edges; at 45° the centre snaps', () => {
    expect(footprintSnap(cursor, 2, 1, 0.4 * DEG, true, 1)).toEqual({ x: 3, y: 4.5 });
    expect(footprintSnap(cursor, 2, 1, 1 * DEG, true, 1)).toEqual({ x: 3, y: 5 });
    expect(footprintSnap(cursor, 2, 1, 45 * DEG, true, 1)).toEqual({ x: 3, y: 5 });
  });

  it('honours the snap division', () => {
    expect(footprintSnap(cursor, 1, 1, 0, true, 2)).toEqual({ x: 3.5, y: 5 });
    const third = footprintSnap(cursor, 1, 1, 0, true, 3);
    expect(third.x).toBeCloseTo(8 / 3 + 0.5);
    expect(third.y).toBeCloseTo(13 / 3 + 0.5);
  });

  it('snap off returns the cursor; Ctrl flips whichever way snap is set', () => {
    expect(footprintSnap(cursor, 1, 1, 0, false, 1)).toEqual(cursor);
    // The tool passes `grid.snapEnabled !== ctrl`.
    const withCtrl = (snapEnabled: boolean): boolean => snapEnabled !== true;
    expect(footprintSnap(cursor, 1, 1, 0, withCtrl(true), 1)).toEqual(cursor);
    expect(footprintSnap(cursor, 1, 1, 0, withCtrl(false), 1)).toEqual({ x: 3.5, y: 4.5 });
  });
});

describe('oriented boxes', () => {
  it('separating axes: apart, overlapping, touching', () => {
    expect(obbOverlap(box(0, 0, 0.5, 0.5), box(1.5, 0, 0.5, 0.5))).toBe(false);
    expect(obbOverlap(box(0, 0, 0.5, 0.5), box(0.9, 0, 0.5, 0.5))).toBe(true);
    expect(obbOverlap(box(0, 0, 0.5, 0.5), box(1, 0, 0.5, 0.5))).toBe(false);
  });

  it('a diamond whose bounds meet a box but whose shape does not, is apart', () => {
    expect(obbOverlap(box(0, 0, 0.5, 0.5), box(1.1, 1.1, 0.5, 0.5, 45 * DEG))).toBe(false);
    expect(obbOverlap(box(0, 0, 0.5, 0.5), box(0.8, 0.8, 0.5, 0.5, 45 * DEG))).toBe(true);
  });

  it('a long thin box turned 90° meets a circle along its length, not across', () => {
    const plank = box(5, 5, 2, 0.25, 90 * DEG);
    expect(obbMeetsCircle(plank, 5, 6.8, 0.3)).toBe(true);
    expect(obbMeetsCircle(plank, 6.8, 5, 0.3)).toBe(false);
  });

  it('the hash finds overlaps through its buckets and counts centres in a circle', () => {
    const hash = new ObbHash();
    hash.insert(box(0.5, 0.5, 0.5, 0.5));
    hash.insert(box(3.5, 0.5, 0.5, 0.5));
    hash.insert(box(10, 10, 3, 0.5, 30 * DEG));
    expect(hash.overlaps(box(0.9, 0.5, 0.5, 0.5))).toBe(true);
    // Full size these overlap by 0.15; shrunk to 0.8 they stand apart.
    expect(hash.overlaps(box(1.35, 0.5, 0.5, 0.5))).toBe(true);
    expect(hash.overlaps(box(1.35, 0.5, 0.5, 0.5), 0.8)).toBe(false);
    expect(hash.overlaps(box(12.5, 11.4, 0.2, 0.2))).toBe(true);
    expect(hash.centresIn(2, 0.5, 1.6)).toBe(2);
    expect(hash.centresIn(2, 0.5, 1)).toBe(0);
  });
});

describe('floorTest', () => {
  const room = (id: string, x0: number, x1: number): Room => ({
    id,
    name: id,
    anchor: [(x0 + x1) / 2, 3],
    face: [[x0, 0], [x1, 0], [x1, 6], [x0, 6]],
  });

  it('with rooms, a box must stand in one room: never across the wall between two', () => {
    const test = floorTest({ ...baseLayer(), rooms: [room('a', 0, 6), room('b', 6, 12)] });
    expect(test).not.toBeNull();
    expect(test!(box(3, 3, 0.5, 0.5))).toBe(true);
    expect(test!(box(9, 3, 0.5, 0.5, 30 * DEG))).toBe(true);
    expect(test!(box(6, 3, 0.5, 0.5))).toBe(false);
    expect(test!(box(5.8, 3, 0.5, 0.5))).toBe(false);
    expect(test!(box(3, 7, 0.5, 0.5))).toBe(false);
  });

  it('without rooms, the merged floor answers, holes excluded', () => {
    const test = floorTest({
      ...baseLayer(),
      mergedFloor: [
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [[4, 4], [6, 4], [6, 6], [4, 6]],
      ],
    });
    expect(test).not.toBeNull();
    expect(test!(box(2, 2, 0.5, 0.5))).toBe(true);
    expect(test!(box(5, 5, 0.5, 0.5))).toBe(false);
    expect(test!(box(3.8, 5, 0.5, 0.5))).toBe(false);
    expect(test!(box(9.8, 2, 0.5, 0.5))).toBe(false);
  });

  it('a layer with neither rooms nor floor has no test', () => {
    expect(floorTest(baseLayer())).toBeNull();
    // Rooms without faces (not derived yet) are not a floor either.
    expect(floorTest({ ...baseLayer(), rooms: [{ id: 'r', name: 'r', anchor: [0, 0] }] })).toBeNull();
  });
});

describe('eraseHits', () => {
  beforeEach(() => {
    resetAssetPackManager();
    seedCaveBandPack();
  });

  it('uses the turned box, and spares images, cave rock, locked and hidden props', () => {
    const rock = { ...caveBandChildren(1, 5).children[0], id: 'rock', position: { x: 5, y: 5 } };
    const layer = {
      ...baseLayer(),
      children: [
        prop('plank', { position: { x: 5, y: 5 }, width: 4, height: 0.5, rotation: 90 * DEG }),
        prop('image', { objectType: 'image', position: { x: 5, y: 5 } }),
        prop('locked', { locked: true, position: { x: 5, y: 5 } }),
        prop('hidden', { visible: false, position: { x: 5, y: 5 } }),
        rock,
      ],
    };
    expect(eraseHits(layer, { x: 5, y: 5 }, 0.5)).toEqual(['plank']);
    // Along the plank's length after its turn: hit. Across it: an unturned box would reach, the real one does not.
    expect(eraseHits(layer, { x: 5, y: 6.8 }, 0.3)).toEqual(['plank']);
    expect(eraseHits(layer, { x: 6.8, y: 5 }, 0.3)).toEqual([]);
  });

  it('a brush in the corner of a 45° prop’s bounds but clear of its turned box misses it', () => {
    // A 2×2 rock turned 45°: its axis-aligned bounds reach ±1.41, its own box only a diamond.
    const layer = { ...baseLayer(), children: [prop('rock', { width: 2, height: 2, rotation: 45 * DEG })] };
    expect(eraseHits(layer, { x: 1.2, y: 1.2 }, 0.3)).toEqual([]);
    // Off the centre, but touching the turned box's edge: a hit.
    expect(eraseHits(layer, { x: 1.2, y: 0 }, 0.3)).toEqual(['rock']);
  });

  it('measures a legacy scaled prop at its rendered size', () => {
    const layer = { ...baseLayer(), children: [prop('old', { position: { x: 0, y: 0 }, scale: 3 })] };
    expect(eraseHits(layer, { x: 1.4, y: 0 }, 0.1)).toEqual(['old']);
  });
});
