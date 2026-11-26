// Stair kits a pack declares, and a flight laid with one: whole cells of painted steps, Wide pieces
// first across, the longest run first down, the tile's top on the edge, foot first.
import { afterEach, describe, expect, it } from 'vitest';
import { layFlight, packStairKits, STAIR_SIDE_LINE, stairKitById, stairKitFor, stairPasses, STONE_STAIRS } from './stairKits';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import type { ManifestEntry, StairsMeasure } from '../engine/packManifest';

const entry = (material: string, gridSize: string, stairs: StairsMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: 'Test_Stairs', tags: ['stairs'], stairs });

function seedStairs(): void {
  const kit = (id: string, label: string, extra: Partial<StairsMeasure> = {}) => ({
    [`${id}_a_1x3_A`]: entry(`${id}_a`, '1x3', { kit: id, label, wide: 1, run: 2, painted: [0, 0, 1, 2], ...extra }),
    [`${id}_b_1x2_A`]: entry(`${id}_b`, '1x2', { kit: id, label, wide: 1, run: 1, painted: [0, 0, 1, 1], ...extra }),
    [`${id}_wide_a_2x3_A`]: entry(`${id}_wide_a`, '2x3', { kit: id, label, wide: 2, run: 2, painted: [0, 0, 2, 2], ...extra }),
    [`${id}_wide_b_2x2_A`]: entry(`${id}_wide_b`, '2x2', { kit: id, label, wide: 2, run: 1, painted: [0, 0, 2, 1], ...extra }),
  });
  seedPack('test-pack', {
    ...kit('stone_earthy', 'Earthy stone', { colour: 'Earthy' }),
    ...kit('overlay', 'Overlay', { default: true }),
    ...kit('stone_slate', 'Slate stone', { colour: 'Slate' }),
  });
}

afterEach(() => resetAssetPackManager());

const near = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;

describe('stair kits a pack declares', () => {
  it('are built from their pieces, the default first', () => {
    seedStairs();
    expect(packStairKits().map((k) => k.id)).toEqual(['overlay', 'stone_earthy', 'stone_slate']);
    expect(stairKitById('stone_slate')).toMatchObject({ label: 'Slate stone', colour: 'Slate' });
    expect(stairKitById('stone_slate')!.pieces).toHaveLength(4);
  });

  it('lays the default with no kit picked, and Stone in the cliff kit’s colour', () => {
    seedStairs();
    expect(stairKitFor(undefined, 'FA_Cliff_Stone_Slate_A2')?.id).toBe('overlay');
    expect(stairKitFor(STONE_STAIRS, 'FA_Cliff_Stone_Slate_A2')?.id).toBe('stone_slate');
    expect(stairKitFor(STONE_STAIRS, 'GG_Cave_Ink')?.id).toBe('stone_earthy');
    expect(stairKitFor('stone_earthy', 'FA_Cliff_Stone_Slate_A2')?.id).toBe('stone_earthy');
    expect(stairKitFor('gone', undefined)?.id).toBe('overlay');
  });

  it('has no kit with no pack', () => {
    expect(packStairKits()).toEqual([]);
    expect(stairKitFor(undefined, undefined)).toBeNull();
  });
});

describe('a flight laid with a kit', () => {
  it('lays one B piece for a one-cell drop one cell wide, its top on the edge and its foot a cell down', () => {
    seedStairs();
    // Down a plateau's west edge: the top from (19, 8) to (19, 7), the low ground to the west.
    const [only, ...rest] = layFlight({ top: [[19, 8], [19, 7]], down: [-1, 0], length: 1 }, stairKitById('overlay')!);
    expect(rest).toEqual([]);
    expect(only.entryId).toBe('test-pack:overlay_b_1x2_A');
    // The tile's y axis runs down the flight (west), its x axis a quarter turn back from it (south).
    expect(near([Math.cos(only.rotation + Math.PI / 2), Math.sin(only.rotation + Math.PI / 2)], [-1, 0])).toBe(true);
    expect(near([Math.cos(only.rotation), Math.sin(only.rotation)], [0, 1])).toBe(true);
    // Its painted top-left on the end of the span its x axis starts from.
    expect(near(only.origin, [19, 7])).toBe(true);
    expect(only.scale).toEqual([1, 1]);
  });

  it('lays Wide pieces first across, one-cell pieces after, A pieces first down, foot first', () => {
    seedStairs();
    const laid = layFlight({ top: [[0, 0], [3, 0]], down: [0, -1], length: 3 }, stairKitById('stone_earthy')!);
    expect(laid.map((p) => p.entryId.replace('test-pack:stone_earthy_', ''))).toEqual(['wide_b_2x2_A', 'b_1x2_A', 'wide_a_2x3_A', 'a_1x3_A']);
    // Down north: the tile's x axis runs west, so the pieces start from the east end of the span.
    expect(laid.map((p) => p.origin.map((v) => Math.round(v * 1e9) / 1e9))).toEqual([
      [3, -2],
      [1, -2],
      [3, 0],
      [1, 0],
    ]);
  });

  it('stretches the pieces to a span or a drop that is not whole cells', () => {
    seedStairs();
    const [p] = layFlight({ top: [[0, 0], [1.25, 0]], down: [0, 1], length: 0.9 }, stairKitById('overlay')!);
    expect(p.entryId).toBe('test-pack:overlay_b_1x2_A');
    expect(p.scale[0]).toBeCloseTo(1.25);
    expect(p.scale[1]).toBeCloseTo(0.9);
  });
});

describe('a flight wider than one piece', () => {
  it('trims the side lines where pieces meet, so it reads as one flight; its outer sides stay', () => {
    seedStairs();
    const laid = layFlight({ top: [[0, 0], [4, 0]], down: [0, 1], length: 1 }, stairKitById('overlay')!);
    expect(laid.map((p) => p.crop)).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(laid[0].painted).toEqual([0, 0, 2 - STAIR_SIDE_LINE, 1]);
    expect(laid[1].painted).toEqual([STAIR_SIDE_LINE, 0, 2, 1]);
    const three = layFlight({ top: [[0, 0], [3, 0]], down: [0, 1], length: 1 }, stairKitById('overlay')!);
    expect(three.map((p) => p.crop)).toEqual([
      [false, true],
      [true, false],
    ]);
    // Each still fills its own share of the span.
    expect(three[0].scale[0] * (three[0].painted[2] - three[0].painted[0])).toBeCloseTo(2);
    expect(three[1].scale[0] * (three[1].painted[2] - three[1].painted[0])).toBeCloseTo(1);
    const [one] = layFlight({ top: [[0, 0], [1, 0]], down: [0, 1], length: 1 }, stairKitById('overlay')!);
    expect(one.crop).toEqual([false, false]);
    expect(one.painted).toEqual([0, 0, 1, 1]);
  });

  it('draws a translucent overlay kit twice, so its steps read on a light floor, and a stone kit once', () => {
    seedStairs();
    expect(stairPasses(stairKitById('overlay')!)).toBe(2);
    expect(stairPasses(stairKitById('stone_slate')!)).toBe(1);
  });
});
