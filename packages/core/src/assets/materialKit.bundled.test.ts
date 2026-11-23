// The brush lists against the packs the apps ship (canvas/public/packs): the cave floor is
// plain ground in the Terrain brush, and Cave ink stays the Material brush's.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { pieceLook } from '../engine/tools/MaterialTool';
import { brushMaterialIds, defaultSoftOf, GROUND_SOFT_EDGE, groundTextureIds, materialIds, outdoorFloorIds } from './materialKit';
import type { MaterialToolSettings } from '../store/types';

const CAVE_FLOOR = 'gg-forge:cave_floor_8x8_floor_A';

beforeAll(() => {
  resetAssetPackManager();
  // From process.cwd() (packages/core under vitest), as caveWallKit.test reads the shipped pack.
  for (const pack of ['gg-forge', 'gg-demo']) {
    const dir = resolve(process.cwd(), '../../canvas/public/packs', pack);
    const file = readdirSync(dir).find((f) => /^pack-[0-9a-f]+\.json$/.test(f))!;
    seedPack(pack, JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')).entries);
  }
});

afterAll(() => resetAssetPackManager());

const settings = (over: Partial<MaterialToolSettings> = {}): MaterialToolSettings => ({ material: 'GG_Cave_Ink', radius: 2, smooth: true, border: true, floor: false, feather: 0.5, ...over }) as MaterialToolSettings;

describe('the cave floor as plain ground', () => {
  it('is listed in the Terrain brush after the outdoor ground, and in the shore and border choices', () => {
    const terrain = brushMaterialIds('terrain');
    expect(terrain).toContain(CAVE_FLOOR);
    const outdoor = groundTextureIds().filter((id) => id !== CAVE_FLOOR);
    expect(outdoor.length).toBeGreaterThan(0);
    expect(terrain.slice(0, outdoor.length + 1)).toEqual([...outdoor, CAVE_FLOOR]);
    expect(outdoorFloorIds()).toContain(CAVE_FLOOR);
    // No slope face tile becomes ground.
    expect(terrain.some((id) => id.includes('face_'))).toBe(false);
  });

  it('paints a patch with a soft edge and no border units', () => {
    const look = pieceLook(CAVE_FLOOR, settings());
    expect(look.textureId).toBe(CAVE_FLOOR);
    expect(look.edgeMaterial).toBeUndefined();
    expect(look.soft).toBeGreaterThan(0);
    expect(defaultSoftOf(CAVE_FLOOR)).toBe(GROUND_SOFT_EDGE);
  });

  it('leaves the Material brush’s list as it was: Cave ink paints the floor with rock, and the floor is not offered twice', () => {
    const material = brushMaterialIds('material');
    expect(material).toEqual(materialIds());
    expect(material).toContain('GG_Cave_Ink');
    expect(material).not.toContain(CAVE_FLOOR);
  });
});
