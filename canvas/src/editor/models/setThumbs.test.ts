// Every set and kit an installed pack offers is pictured: its picture names an entry the
// catalogue holds. A kit measured from a pack ships none of the forge's piece names (no
// `wall_short`), so it is pictured by its first piece.
import { afterEach, describe, expect, it } from 'vitest';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { cliffArt, cliffArtChoices, PAINTED_BORDER } from '@dnd/core/src/engine/plateauKit';
import { resetAssetPackManager, seedCaveBandPack, seedPack, seedTestWallSets } from '@dnd/core/src/testing/seedCatalog';
import type { ManifestEntry } from '@dnd/core/src/engine/packManifest';
import { installedWallSets, wallSetLabel, wallSetThumb, wallSetTileLabel } from './assetStrip';

afterEach(() => resetAssetPackManager());

/** A measured kit as a pack ships it: straights and bends named after the pack's own art. */
function seedMeasuredKit(set: string, prefix: string): void {
  const entry = (material: string, gridSize: string, band: ManifestEntry['band']): ManifestEntry =>
    ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set, tags: ['colored'], band }) as ManifestEntry;
  const entries: Record<string, ManifestEntry> = {};
  for (const L of [2, 3, 4]) entries[`${prefix}_straight_${L}x2_A`] = entry(`${prefix}_straight`, `${L}x2`, { joints: [[L / 2, 0.36], [-L / 2, 0.36]], turnDeg: 0 });
  entries[`${prefix}_corner_in_2x2_A`] = entry(`${prefix}_corner_in`, '2x2', { joints: [[-0.36, -1.15], [-1.15, -0.36]], turnDeg: 90 });
  entries[`${prefix}_corner_out_2x2_A`] = entry(`${prefix}_corner_out`, '2x2', { joints: [[-1.15, -0.64], [-0.64, -1.15]], turnDeg: -90 });
  seedPack(`pack-${set}`, entries);
}

function seedAll(): void {
  seedTestWallSets(['GG_Fieldstone']);
  seedCaveBandPack('gg-ink', { set: 'GG_Cave_Ink', tags: ['cave'] });
  seedMeasuredKit('FA_Cave_Walls', 'cave_wall');
  seedMeasuredKit('FA_Cliff_Stone_Earthy_A1', 'cliff_stone_earthy_a1');
  seedMeasuredKit('Wild_Paths', 'path');
}

describe('set pictures', () => {
  it('pictures every wall set and band kit by an entry the catalogue holds', () => {
    seedAll();
    const sets = installedWallSets();
    expect(sets).toEqual(expect.arrayContaining(['GG_Fieldstone', 'GG_Cave_Ink', 'FA_Cave_Walls', 'FA_Cliff_Stone_Earthy_A1', 'Wild_Paths']));
    for (const id of sets) {
      const thumb = wallSetThumb(id);
      expect(thumb, id).toBeDefined();
      expect(getCatalogEntry(thumb!), id).toBeDefined();
    }
  });

  it('pictures every cliff art choice by an entry the catalogue holds', () => {
    seedAll();
    // A painted border is pictured by its texture, not by kit art.
    const choices = cliffArtChoices().filter((c) => c.value && c.value !== PAINTED_BORDER);
    expect(choices.length).toBeGreaterThan(0);
    for (const c of choices) {
      const art = cliffArt(c.value).values().next().value?.id;
      expect(art, c.value).toBeDefined();
      expect(getCatalogEntry(art!), c.value).toBeDefined();
    }
  });

  it('names a set on its tile by what tells it apart, the full name on its tip', () => {
    expect(wallSetTileLabel('FA_Wall_Stone_Earthy_A')).toBe('Stone Earthy');
    expect(wallSetTileLabel('FA_Wall_Wood_Walnut_A')).toBe('Wood Walnut');
    expect(wallSetTileLabel('FA_Cliff_Stone_Earthy_A1')).toBe('Cliff Stone Earthy A1');
    expect(wallSetTileLabel('GG_Fieldstone')).toBe('Fieldstone');
    expect(wallSetLabel('FA_Wall_Stone_Earthy_A')).toBe('FA Wall Stone Earthy A');
  });
});
