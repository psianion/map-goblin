// A measured kit's pieces that are laid only where their own place is: step pieces at a jog,
// dead ends at a narrow passage's end and a rock spur's tip, painted endings at a cliff's free
// ends. And a set a pack has renamed, still drawn under its old id.
import { afterEach, describe, expect, it } from 'vitest';
import { bandEndPiecesFor, bandPiecesFor, jointsOf, kitDeadEnds, kitSteps } from '../assets/caveWallKit';
import type { WalkPlacement } from './caveWalk';
import type { DoorGap } from './wallNodeRenderer';
import { canonicalSetId, getBandSetIds, isMeasuredBandSet } from '../assets/packCatalog';
import { getAssetPackManager } from './assetPackInstance';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { layBandChain, layBandRing, orientRings } from './caveBandRenderer';
import { endTangents } from './bandBend';
import { cliffChoice } from './plateauKit';
import { walkCliff } from './plateauRenderer';
import type { EdgeRun } from '../shared/plateaus';
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

describe('caps at an erased mouth', () => {
  /** Mouth gaps along the edge a → b, no wider than half a cell each, as the eraser hands them. */
  const mouth = (a: [number, number], b: [number, number], door = false): DoorGap[] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / 0.5);
    return Array.from({ length: n }, (_, k) => ({ wallId: 'w', position: [a[0] + ((b[0] - a[0]) * (k + 0.5)) / n, a[1] + ((b[1] - a[1]) * (k + 0.5)) / n] as [number, number], width: len / n, ...(door ? {} : { mouth: true }) }));
  };
  /** Where a laid cap's floor line turns round its tip: the middle of its joints carried its reach on, square to them, toward `to`. */
  const tipOf = (pl: WalkPlacement, to: [number, number]): [number, number] => {
    const [J0, J1] = jointsOf(pl.piece, pl.at);
    const M: [number, number] = [(J0[0] + J1[0]) / 2, (J0[1] + J1[1]) / 2];
    const L = Math.hypot(J1[0] - J0[0], J1[1] - J0[1]);
    let n: [number, number] = [-(J1[1] - J0[1]) / L, (J1[0] - J0[0]) / L];
    if ((to[0] - M[0]) * n[0] + (to[1] - M[1]) * n[1] < 0) n = [-n[0], -n[1]];
    return [M[0] + n[0] * pl.piece.reach!, M[1] + n[1] * pl.piece.reach!];
  };
  const room = ring([[0, 0], [12, 0], [12, 10], [0, 10]]);

  it('caps both ends of the rock at a mouth in a straight wall, keeping its width', () => {
    seedKit();
    const placed = layBandRing(room, mouth([5, 0], [7, 0]), bandPiecesFor(SET), 1);
    const caps = placed.filter((p) => p.branch === 'mouth');
    expect(caps.map((p) => p.piece.key)).toEqual(['spur_3x1', 'spur_3x1']);
    // Each tip on its own edge of the opening, along the wall.
    const tips = caps.map((p) => tipOf(p, [6, 0])[0]).sort((a, b) => a - b);
    expect(tips[0]).toBeCloseTo(5, 2);
    expect(tips[1]).toBeCloseTo(7, 2);
    // No rock laid across the opening.
    for (const pl of placed) for (const J of jointsOf(pl.piece, pl.at)) expect(J[0] > 5.01 && J[0] < 6.99 && Math.abs(J[1]) < 1.5).toBe(false);
  });

  it('caps the rock where a mouth takes a corner, and a narrow and a wide mouth', () => {
    seedKit();
    const corner = [...mouth([0, 2], [0, 0]), ...mouth([0, 0], [2, 0])];
    expect(layBandRing(room, corner, bandPiecesFor(SET), 1).filter((p) => p.branch === 'mouth')).toHaveLength(2);
    expect(layBandRing(room, mouth([5, 0], [6, 0]), bandPiecesFor(SET), 1).filter((p) => p.branch === 'mouth')).toHaveLength(2);
    expect(layBandRing(room, mouth([4, 0], [8, 0]), bandPiecesFor(SET), 1).filter((p) => p.branch === 'mouth')).toHaveLength(2);
  });

  it('caps the rock at a mouth in a curved wall', () => {
    seedKit();
    const circle = ring(Array.from({ length: 48 }, (_, k): [number, number] => [8 + 6 * Math.cos((2 * Math.PI * k) / 48), 8 + 6 * Math.sin((2 * Math.PI * k) / 48)]));
    const a = circle[0];
    const b = circle[2];
    expect(layBandRing(circle, [...mouth(a as [number, number], b as [number, number])], bandPiecesFor(SET), 1).filter((p) => p.branch === 'mouth')).toHaveLength(2);
  });

  it('caps the rock at a door too, and at a mouth a door stands in', () => {
    seedKit();
    const tips = (gaps: DoorGap[]) =>
      layBandRing(room, gaps, bandPiecesFor(SET), 1)
        .filter((p) => p.branch === 'mouth')
        .map((p) => tipOf(p, [6, 0])[0])
        .sort((a, b) => a - b);
    for (const door of [mouth([5, 0], [7, 0], true), [{ wallId: 'w', position: [6, 0] as [number, number], width: 2 }]]) {
      const [a, b] = tips(door);
      expect(a).toBeCloseTo(5, 2);
      expect(b).toBeCloseTo(7, 2);
    }
    // A door dropped into a carved mouth: one opening, still capped at its edges.
    const [a, b] = tips([...mouth([5, 0], [7, 0]), { wallId: 'w', position: [6, 0], width: 2 }]);
    expect(a).toBeCloseTo(5, 2);
    expect(b).toBeCloseTo(7, 2);
  });

  it('keeps a stretch too short for a cap its taper', () => {
    seedKit();
    // Two mouths a cell apart: the rock between them is too short for a cap.
    const placed = layBandRing(room, [...mouth([3, 0], [5, 0]), ...mouth([5.6, 0], [8, 0])], bandPiecesFor(SET), 1);
    expect(placed.filter((p) => p.branch === 'mouth').every((p) => Math.min(p.P[0], p.Q[0]) < 3 || Math.max(p.P[0], p.Q[0]) > 8)).toBe(true);
  });
});

describe('a cave wall kit as cliff art', () => {
  /** Which way each laid piece's void side (the left of its chord) looks, from the plateau's middle at (4, 4): out is +1, in -1. */
  const voidSides = (faces?: 'floor'): number[] => {
    const entries: Record<string, ManifestEntry> = {};
    for (const L of [2, 4]) {
      const end = L / 2 + 0.15;
      entries[`run_${L}x2_A`] = entry('run', `${L}x2`, { joints: [[end, 0.36], [-end, 0.36]], turnDeg: 0, ...(faces && { faces }) });
    }
    entries.turn_in_2x2_A = entry('turn_in', '2x2', { joints: [[-0.36, -1.15], [-1.15, -0.36]], turnDeg: 90, ...(faces && { faces }) });
    entries.turn_out_2x2_A = entry('turn_out', '2x2', { joints: [[-1.15, -0.64], [-0.64, -1.15]], turnDeg: -90, ...(faces && { faces }) });
    seedPack('test-pack', entries);
    const sides = (drop: number): number[] =>
      walkCliff({ points: [[0, 0], [8, 0], [8, 8], [0, 8]], closed: true, drop, owner: { edgeArt: SET } } as unknown as EdgeRun).map((pl) => {
        const d = [pl.Q[0] - pl.P[0], pl.Q[1] - pl.P[1]];
        const mid = [(pl.P[0] + pl.Q[0]) / 2 - 4, (pl.P[1] + pl.Q[1]) / 2 - 4];
        return Math.sign(d[1] * mid[0] - d[0] * mid[1]);
      });
    return [...new Set([...sides(1), ...sides(-1).map((s) => -s)])];
  };

  it('lays a cliff kit with its void side on the low ground', () => {
    // Out from a plateau; in toward a pit's floor (read flipped, so both read +1).
    expect(voidSides()).toEqual([1]);
  });

  it('lays a kit measured as cave walls with its floor side on the low ground', () => {
    expect(voidSides('floor')).toEqual([-1]);
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
