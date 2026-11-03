// The look of the units the shipped pack lays, measured on the pack itself: the road verge
// is laid at half a cell, spaced to cover a third or so of its band.
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
  it('lays every road verge unit at 0.4 to 0.6 of a cell', () => {
    for (const set of ROADS) {
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
