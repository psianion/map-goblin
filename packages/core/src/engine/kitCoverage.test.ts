// A measured kit's pieces that are laid only where their own place is: step pieces at a jog,
// dead ends at a narrow passage's end and a rock spur's tip, painted endings at a cliff's free
// ends. And a set a pack has renamed, still drawn under its old id.
import { afterEach, describe, expect, it } from 'vitest';
import { bandEndPiecesFor, bandPiecesFor, kitDeadEnds, kitSteps } from '../assets/caveWallKit';
import { canonicalSetId, getBandSetIds, isMeasuredBandSet } from '../assets/packCatalog';
import { getAssetPackManager } from './assetPackInstance';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { layBandChain, layBandRing, orientRings } from './caveBandRenderer';
import { endTangents } from './bandBend';
import { cliffChoice } from './plateauKit';
import type { BandMeasure, ManifestEntry } from './packManifest';
import type { Polygon } from '../types/geometry';

const SET = 'Test_Rock';

function entry(material: string, gridSize: string, band: BandMeasure): ManifestEntry {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: ['colored'], band };
}

/** Straights of 2 to 6 cells, a bend of each hand in 2 and 3, a step, two dead ends and a painted ending. */
function seedKit(): void {
  const entries: Record<string, ManifestEntry> = {};
  for (const L of [2, 3, 4, 5, 6]) {
    const end = L / 2 + 0.15;
    entries[`run_${L}x2_A`] = entry('run', `${L}x2`, { joints: [[end, 0.36], [-end, 0.36]], turnDeg: 0 });
  }
  for (const N of [2, 3]) {
    const end = N / 2 + 0.15;
    entries[`turn_in_${N}x${N}_A`] = entry('turn_in', `${N}x${N}`, { joints: [[N / 2 - 0.64, -end], [-end, N / 2 - 0.64]], turnDeg: 90 });
    entries[`turn_out_${N}x${N}_A`] = entry('turn_out', `${N}x${N}`, { joints: [[-end, N / 2 - 1.36], [N / 2 - 1.36, -end]], turnDeg: -90 });
  }
  // Steps one cell sideways over three.
  entries.step_3x3_A = entry('step', '3x3', { joints: [[1.65, -0.64], [-1.65, 0.36]], turnDeg: 0, step: true });
  // A spur's tip one cell wide, and a passage's end two cells wide.
  entries.spur_3x1_A = entry('spur', '3x1', { joints: [[0.14, 0.65], [-0.14, 0.65]], turnDeg: -180, end: true, reach: 0.83 });
  entries.cap_4x1_A = entry('cap', '4x1', { joints: [[-1.36, 0.65], [1.36, 0.65]], turnDeg: 180, end: true, reach: 0.66 });
  // A painted ending 2.6 cells long.
  entries.taper_3x2_A = entry('taper', '3x2', { joints: [[1.5, 0.36], [-1.12, 0.36]], turnDeg: 0, end: true });
  seedPack('test-pack', entries);
}

const ring = (pts: [number, number][]): Polygon => orientRings([pts as Polygon])[0];
const branches = (placed: { branch: string }[]) => placed.map((p) => p.branch);

afterEach(() => resetAssetPackManager());

describe('pieces laid only in their own place', () => {
  it('keeps steps, dead ends and endings out of the run', () => {
    seedKit();
    const keys = bandPiecesFor(SET).map((p) => p.key);
    expect(keys.some((k) => k.startsWith('step') || k.startsWith('spur') || k.startsWith('cap') || k.startsWith('taper'))).toBe(false);
    const pool = bandPiecesFor(SET);
    expect(kitSteps(pool).map((p) => p.key)).toEqual(['step_3x3', 'step_3x3']);
    expect(kitDeadEnds(pool).map((p) => p.key).sort()).toEqual(['cap_4x1', 'spur_3x1']);
    expect(bandEndPiecesFor(SET).map((p) => p.key)).toEqual(['taper_3x2']);
  });

  it('lays a step piece where a side jogs one cell, its ends running along the sides', () => {
    seedKit();
    const placed = layBandRing(ring([[0, 0], [8, 0], [8, 1], [16, 1], [16, 9], [0, 9]]), [], bandPiecesFor(SET), 1, true);
    const steps = placed.filter((p) => p.branch === 'step');
    expect(steps).toHaveLength(1);
    // Square to the sides it joins: its ends run along x, as the straights either side do.
    for (const t of endTangents(steps[0])) expect(Math.abs(t[1])).toBeLessThan(0.05);
  });

  it('lays no step piece where the jog is further than the piece steps', () => {
    seedKit();
    const placed = layBandRing(ring([[0, 0], [8, 0], [8, 1.5], [16, 1.5], [16, 9], [0, 9]]), [], bandPiecesFor(SET), 1, true);
    expect(branches(placed)).not.toContain('step');
  });

  it('caps a rock spur one cell wide with its dead end', () => {
    seedKit();
    const placed = layBandRing(ring([[0, 0], [5, 0], [5, 5], [6, 5], [6, 0], [12, 0], [12, 10], [0, 10]]), [], bandPiecesFor(SET), 1);
    const caps = placed.filter((p) => p.branch === 'dead-end');
    expect(caps.map((p) => p.piece.key)).toEqual(['spur_3x1']);
  });

  it('closes a passage two cells wide with its dead end', () => {
    seedKit();
    const placed = layBandRing(ring([[0, 0], [12, 0], [12, 8], [7, 8], [7, 14], [5, 14], [5, 8], [0, 8]]), [], bandPiecesFor(SET), 1);
    expect(placed.filter((p) => p.branch === 'dead-end').map((p) => p.piece.key)).toEqual(['cap_4x1']);
  });

  it("ends a cliff's free run in its painted ending at each tip, where one fits", () => {
    seedKit();
    const long = layBandChain([[0, 0], [10, 0]], [], bandPiecesFor(SET), 1, true);
    expect(long[0].branch).toBe('ending');
    expect(long[long.length - 1].branch).toBe('ending');
    // The tips stay on the run's own ends.
    expect(Math.min(...long.map((p) => Math.min(p.P[0], p.Q[0])))).toBeGreaterThan(-0.01);
    expect(Math.max(...long.map((p) => Math.max(p.P[0], p.Q[0])))).toBeLessThan(10.01);
    // Too short for one: the run keeps its tapered ends.
    expect(branches(layBandChain([[0, 0], [2, 0]], [], bandPiecesFor(SET), 1, true))).not.toContain('ending');
    // A run going on into a wall's rock lays none at that end.
    const merged = layBandChain([[0, 0], [10, 0]], [], bandPiecesFor(SET), 1, true, [false, true]);
    expect(merged[0].branch).toBe('ending');
    expect(merged[merged.length - 1].branch).not.toBe('ending');
  });
});

describe('a renamed set', () => {
  it('draws under its old id as the set it became, and is offered once', () => {
    seedKit();
    const mgr = getAssetPackManager() as unknown as { manifestCache: Map<string, { setAliases?: Record<string, string> }>; catalogVersion: number };
    mgr.manifestCache.get('test-pack')!.setAliases = { Old_Rock: SET };
    mgr.catalogVersion++;
    expect(isMeasuredBandSet('Old_Rock')).toBe(true);
    expect(canonicalSetId('Old_Rock')).toBe(SET);
    expect(cliffChoice('Old_Rock').setId).toBe(SET);
    expect(bandPiecesFor('Old_Rock')).toBe(bandPiecesFor(SET));
    expect(getBandSetIds()).toEqual([SET]);
  });
});
