// The look of the units the shipped pack lays, measured on the pack itself: the road verge
// and the cliff foot are laid at half a cell, spaced to cover a third or so of their band,
// and the foot stays a narrow band just out past the ledge, tinted the ledge's own grey.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Texture } from 'pixi.js';

const PACKS = join(__dirname, '../../../../../canvas/public/packs');
const index = JSON.parse(readFileSync(join(PACKS, 'index.json'), 'utf8'));
const forge = JSON.parse(readFileSync(join(PACKS, index.packs['gg-forge'].manifest), 'utf8'));
const manager = {
  catalogVersion: 1,
  getPackManifests: () => [{ packId: 'gg-forge', manifest: forge }],
  getTexture: () => Texture.EMPTY,
  getFrame: () => null,
  waitForTexture: vi.fn(() => new Promise(() => {})),
};
vi.mock('../assetPackInstance', () => ({ getAssetPackManager: () => manager }));

import { pathKits } from '../../assets/packCatalog';
import { kitEdgeUnits } from './kitUnits';
import { edgeWalk, type UnitPlacement } from './pathKitLayout';
import { footUnits } from '../plateauKit';
import { FOOT_OUT, LEDGE_DEPTH, greyMatch, layCliffFoot } from '../plateauRenderer';
import type { Polygon } from '../../types/geometry';

/** How much of a band the units' footprints (discs `size` across) cover, sampled on a fine grid. */
function coverage(units: readonly UnitPlacement[], inBand: (x: number, y: number) => boolean, box: [number, number, number, number]): number {
  const step = 0.02;
  let inside = 0;
  let covered = 0;
  const [x0, y0, x1, y1] = box;
  for (let x = x0; x <= x1; x += step) {
    for (let y = y0; y <= y1; y += step) {
      if (!inBand(x, y)) continue;
      inside++;
      if (units.some((u) => Math.hypot(u.x - x, u.y - y) <= u.size / 2)) covered++;
    }
  }
  return covered / inside;
}

const ROADS = ['road-dirt', 'road-cobble', 'trail-grass'];
const kitOf = (set: string) => {
  const kit = pathKits().find((k) => k.set === set);
  if (!kit) throw new Error(`no ${set} kit in the pack`);
  return kit;
};

describe('unit scale', () => {
  it('lays every road verge unit and every foot rubble unit at 0.4 to 0.6 of a cell', () => {
    for (const set of [...ROADS, 'cliff-foot']) {
      const { units } = kitEdgeUnits(kitOf(set));
      expect(units.length, set).toBeGreaterThan(0);
      for (const u of units) {
        expect(u.size, `${set} ${u.key}`).toBeGreaterThanOrEqual(0.4);
        expect(u.size, `${set} ${u.key}`).toBeLessThanOrEqual(0.6);
      }
    }
  });

  it('keeps the water bank at its painted size', () => {
    expect(kitOf('water').manifest.band?.scale).toBe(1);
  });
});

describe('the road verge', () => {
  // A straight road 40 cells long and 3 wide: its two long edges, away from the ends.
  const ring: Polygon = [[0, 0], [40, 0], [40, 3], [0, 3]];
  const band = (x: number, y: number) => x >= 3 && x <= 37 && (Math.abs(y) <= 0.3 || Math.abs(y - 3) <= 0.3);

  it.each(ROADS)('%s covers 30 to 45 % of its verge', (set) => {
    const laid = edgeWalk([ring], kitEdgeUnits(kitOf(set)).units, `${set}-road`);
    const c = coverage(laid, band, [3, -0.3, 37, 3.3]);
    expect(c).toBeGreaterThanOrEqual(0.3);
    expect(c).toBeLessThanOrEqual(0.45);
  });
});

describe('the cliff foot', () => {
  // A 20-cell square plateau; the walk runs with the void (outside) on its left.
  const square: Polygon = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const outside = (x: number, y: number) => {
    const dx = Math.max(0 - x, 0, x - 20);
    const dy = Math.max(0 - y, 0, y - 20);
    return Math.hypot(dx, dy);
  };

  it('covers 30 to 45 % of a band just out past the ledge, and reaches under 0.7 cell past it', () => {
    const laid = layCliffFoot(square, true, [], footUnits().units, 'foot');
    expect(laid.length).toBeGreaterThan(40);
    // The band: from the ledge rock's edge out 0.6 cell, along the four sides away from the corners.
    const inBand = (x: number, y: number) => {
      const d = outside(x, y);
      const corner = (x < 1 || x > 19) && (y < 1 || y > 19);
      return !corner && d >= LEDGE_DEPTH && d <= LEDGE_DEPTH + 0.6;
    };
    const c = coverage(laid, inBand, [-1.2, -1.2, 21.2, 21.2]);
    expect(c).toBeGreaterThanOrEqual(0.3);
    expect(c).toBeLessThanOrEqual(0.45);
    const reach = Math.max(...laid.map((u) => outside(u.x, u.y) + u.size / 2));
    expect(reach - LEDGE_DEPTH).toBeLessThan(0.7);
    // Every unit lies out on the void side, centred near FOOT_OUT.
    for (const u of laid) expect(outside(u.x, u.y)).toBeGreaterThan(FOOT_OUT - 0.2);
  });
});

describe('the foot tint', () => {
  const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const tinted = (art: number, tint: number) => rgb(art).map((v, i) => (v * rgb(tint)[i]) / 255);

  it('brings bluish rubble to the ledge grey: no blue or purple cast left', () => {
    // The shipped art's mean colours: ledge (65, 65, 65), rubble B (94, 95, 102).
    const ledge = 0x414141;
    for (const rubble of [0x5e5f66, 0x5b5c5e, 0x6a5a78]) {
      const [r, g, b] = tinted(rubble, greyMatch(ledge, rubble));
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
      expect(b - r).toBeLessThanOrEqual(1);
      expect((r + g + b) / 3).toBeGreaterThan(55);
      expect((r + g + b) / 3).toBeLessThanOrEqual(66);
    }
  });

  it('leaves the art alone when a colour is unknown', () => {
    expect(greyMatch(null, 0x5e5f66)).toBe(0xffffff);
    expect(greyMatch(0x414141, null)).toBe(0xffffff);
  });
});
