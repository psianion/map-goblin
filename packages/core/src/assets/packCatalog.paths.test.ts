import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { kitPiece, pathKit, pathKits } from './packCatalog';
import { resetAssetPackManager, seedPack, seedPathKits } from '../testing/seedCatalog';
import type { PackManifest } from '../engine/packManifest';

beforeEach(() => {
  resetAssetPackManager();
  seedPathKits();
});
afterEach(() => resetAssetPackManager());

describe('path kits', () => {
  it('lists each kit entry as one material, by label', () => {
    expect(pathKits().map((k) => [k.id, k.label, k.kind])).toEqual([
      ['gg-forge:road-dirt', 'Road dirt', 'surface'],
      ['gg-forge:water', 'Water', 'surface'],
    ]);
  });

  it('resolves the fill and the units a kit names', () => {
    const water = pathKit('gg-forge:water')!;
    expect(water.fill?.id).toBe('gg-forge:water-fill');
    expect(water.fill?.gridSize).toBe('4x4');
    expect(water.manifest.band?.straight).toEqual(['water-bank']);
    expect(kitPiece(water, 'water-bank')?.id).toBe('gg-forge:water-bank');
    expect(pathKit('gg-forge:road-dirt')!.manifest.edge?.map((u) => u.key)).toEqual(['dirt-pebbles_1x1_object_A']);
  });

  it('ignores path entries that are not kits', () => {
    expect(pathKit('gg-forge:old-strip')).toBeUndefined();
  });

  it('follows the packs installed', () => {
    resetAssetPackManager();
    expect(pathKits()).toEqual([]);
  });
});

/** The gg-forge pack the app installs, as the index names it. */
async function shippedPack(): Promise<PackManifest> {
  const { readFileSync, readdirSync } = await import('node:fs' as string);
  const { resolve } = await import('node:path' as string);
  const dir = resolve(process.cwd(), '../..', 'canvas/public/packs/gg-forge');
  const index = JSON.parse(readFileSync(resolve(dir, '..', 'index.json'), 'utf8'));
  const file = (readdirSync(dir) as string[]).find((f) => `gg-forge/${f}` === index.packs['gg-forge'].manifest)!;
  return JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as PackManifest;
}

describe('the shipped gg-forge pack', () => {
  it('carries five kits and no strip, edge or end piece', async () => {
    const manifest = await shippedPack();
    resetAssetPackManager();
    seedPack('gg-forge', manifest.entries);
    expect(pathKits().map((k) => [k.set, k.kind])).toEqual([
      ['planks', 'planks'],
      ['road-cobble', 'surface'],
      ['road-dirt', 'surface'],
      ['trail-grass', 'surface'],
      ['water', 'surface'],
    ]);
    for (const kit of pathKits()) {
      const m = kit.manifest;
      const keys = [m.fill, m.railPost, m.end, m.fall, ...(m.edge ?? []).map((u) => u.key), ...(m.cross ?? []).map((u) => u.key), ...(m.band?.straight ?? [])];
      for (const key of keys.filter(Boolean)) expect(kitPiece(kit, key!), `${kit.set}: ${key}`).toBeDefined();
      // Every piece a kit names ships an image.
      for (const key of keys.filter(Boolean)) {
        const e = manifest.entries[key!];
        expect(Object.keys(manifest.files).some((f) => f.startsWith(`${e.material}_${e.gridSize}_${e.variant}-`)), key).toBe(true);
      }
    }
    expect(Object.values(manifest.entries).filter((e) => ['strip', 'edge', 'end'].includes(e.pieceType))).toEqual([]);
  });

  it('names the waterfall in the water kit, a minor version on from 1.10', async () => {
    const manifest = await shippedPack();
    expect(manifest.version).toBe('1.11.0');
    resetAssetPackManager();
    seedPack('gg-forge', manifest.entries);
    const water = pathKit('gg-forge:water')!;
    expect(water.manifest.fall).toBe('water-fall');
    expect(kitPiece(water, 'water-fall')?.gridSize).toBe('2x2');
  });

  it('still draws every path of the saved 3.2 maps: each names a kit the pack ships', async () => {
    const { readFileSync, readdirSync } = await import('node:fs' as string);
    const { resolve } = await import('node:path' as string);
    const manifest = await shippedPack();
    resetAssetPackManager();
    seedPack('gg-forge', manifest.entries);
    const dir = resolve(process.cwd(), '../..', 'session/testdata');
    let paths = 0;
    // The JSON saves; the .ggvtt files are the same maps in the binary format.
    for (const name of (readdirSync(dir) as string[]).filter((n) => n.endsWith('.mapbuilder'))) {
      const map = JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
      for (const layer of map.layers ?? []) {
        for (const c of layer.children ?? []) {
          if (c.childType !== 'path') continue;
          paths++;
          expect(pathKit(c.materialId), `${name}: ${c.id} (${c.materialId})`).toBeDefined();
        }
      }
    }
    expect(paths).toBeGreaterThanOrEqual(4);
  });
});
