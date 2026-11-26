// A band kit carried by its own set: the measurements ride on the manifest entries,
// so a pack needs neither the built-in kit's material names nor the `cave` tag.
import { afterEach, describe, expect, it } from 'vitest';
import { bandEndPiecesFor, bandPiecesFor, caveBandPieces } from './caveWallKit';
import { getBandSet, getBandSetIds, isBandSet, isColoredSet, isMeasuredBandSet, propEntries } from './packCatalog';
import { resetAssetPackManager, seedCaveBandPack, seedPack } from '../testing/seedCatalog';
import { layBandRing, orientRings } from '../engine/caveBandRenderer';
import { bandHoles } from '../engine/caveWalk';
import { cliffArt, cliffArtChoices, cliffPieces, ledgeEndPieces } from '../engine/plateauKit';
import type { BandMeasure, ManifestEntry } from '../engine/packManifest';

const SET = 'Test_Kit';

function entry(material: string, gridSize: string, band?: BandMeasure, tags: string[] = []): ManifestEntry {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags, band };
}

/** Two straights of different length, a bend of each hand, an end piece and a prop. */
function seedMeasuredKit(tags: string[] = []): void {
  seedPack('test-pack', {
    run_2x2_A: entry('run', '2x2', { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0 }, tags),
    run_2x4_A: entry('run', '2x4', { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0 }, tags),
    turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }, tags),
    turn_out_2x2_A: entry('turn_out', '2x2', { joints: [[-0.025, 0.983], [-0.988, 0.02]], turnDeg: -90 }, tags),
    tip_1x2_A: entry('tip', '1x2', { joints: [[0, 0.98], [0, 0]], turnDeg: 0, end: true }, tags),
    boulder_1x1_A: entry('boulder', '1x1'),
  });
}

afterEach(() => resetAssetPackManager());

describe('a measured band kit', () => {
  it('is a band set with no cave tag and none of the built-in names', () => {
    seedMeasuredKit();
    expect(getBandSetIds()).toEqual([SET]);
    expect(isBandSet(SET)).toBe(true);
    expect(isMeasuredBandSet(SET)).toBe(true);
    // Its prop carries no measurement, so it is not part of the band.
    expect(getBandSet(SET).map((e) => e.material).sort()).toEqual(['run', 'run', 'tip', 'turn_in', 'turn_out']);
  });

  it('needs a straight that is no end piece', () => {
    seedPack('test-pack', {
      tip_1x2_A: entry('tip', '1x2', { joints: [[0, 0.98], [0, 0]], turnDeg: 0, end: true }),
      turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }),
    });
    expect(isBandSet(SET)).toBe(false);
  });

  it('lays its straights, their mirrors and both bends, and keeps the end piece for run ends', () => {
    seedMeasuredKit();
    const pool = bandPiecesFor(SET);
    expect(pool.map((p) => `${p.key}${p.flipY ? '~' : ''}`).sort()).toEqual([
      'run_2x2',
      'run_2x2~',
      'run_2x4',
      'run_2x4~',
      'turn_in_2x2',
      'turn_out_2x2',
    ]);
    const mirror = pool.find((p) => p.key === 'run_2x4' && p.flipY)!;
    expect(mirror.jointsCells).toEqual([[-0.065, 1.988], [-0.065, -1.983]]);
    expect(pool.find((p) => p.key === 'run_2x4' && !p.flipY)!.chordCells).toBeCloseTo(3.971, 3);
    expect(bandEndPiecesFor(SET).map((p) => p.key)).toEqual(['tip_1x2']);
  });

  it('keeps the first of two entries measuring one piece', () => {
    seedPack('test-pack', {
      run_2x2_A: entry('run', '2x2', { joints: [[0, 1], [0, -1]], turnDeg: 0 }),
      run_2x2_B: entry('run', '2x2', { joints: [[0, 0.5], [0, -0.5]], turnDeg: 0 }),
    });
    const straights = bandPiecesFor(SET).filter((p) => !p.flipY);
    expect(straights).toHaveLength(1);
    expect(straights[0].chordCells).toBe(2);
  });

  it('lays a 10 by 10 square with only its own pieces and no holes', () => {
    seedMeasuredKit();
    const [square] = orientRings([[[0, 0], [10, 0], [10, 10], [0, 10]]]);
    const placed = layBandRing(square, [], bandPiecesFor(SET));
    const keys = new Set(['run_2x2', 'run_2x4', 'turn_in_2x2', 'turn_out_2x2']);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.every((p) => keys.has(p.piece.key))).toBe(true);
    expect(bandHoles(placed, true)).toEqual([]);
  });

  it('leaves a set without measurements on the built-in kit', () => {
    seedCaveBandPack('gg-forge', { set: 'GG_Cave_Ink', tags: ['cave'] });
    expect(isMeasuredBandSet('GG_Cave_Ink')).toBe(false);
    expect(bandPiecesFor('GG_Cave_Ink')).toBe(caveBandPieces());
    expect(bandEndPiecesFor('GG_Cave_Ink')).toEqual([]);
  });

  it('is one cliff look of its own, laid with its own pool and end pieces', () => {
    seedMeasuredKit();
    const art = cliffArt(SET);
    expect([...art.keys()].sort()).toEqual(['run_2x2', 'run_2x4', 'tip_1x2', 'turn_in_2x2', 'turn_out_2x2']);
    expect(cliffPieces(art, SET)).toEqual(bandPiecesFor(SET));
    expect(ledgeEndPieces(art, SET).map((p) => p.key)).toEqual(['tip_1x2']);
    expect(cliffArtChoices().map((c) => [c.value, c.label])).toEqual([
      [SET, 'Test Kit'],
      ['paint', 'Painted border'],
    ]);
  });

  it('is coloured when its pieces are tagged so', () => {
    seedMeasuredKit(['colored']);
    expect(isColoredSet(SET)).toBe(true);
    resetAssetPackManager();
    seedMeasuredKit();
    expect(isColoredSet(SET)).toBe(false);
  });

  it('still offers the props it ships beside the kit', () => {
    seedMeasuredKit();
    expect(propEntries().map((e) => e.material)).toContain('boulder');
  });
});
