// Older maps' brush paint loads as floor pieces: patches at load (no Clipper), the water
// mask once Clipper is in.
import { beforeAll, describe, expect, it } from 'vitest';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { DungeonLayer, SerializedMapData, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { createDungeonLayer } from '../store/factories';
import { CURRENT_VERSION, SUPPORTED_VERSIONS, migrateToLatest } from '../store/migration';
import { computeMergedFloor } from '../engine/mergedFloor';
import { PATCH_SOFT_EDGE, patchesToPieces, waterMaskRings, waterToPieces } from './legacyPaint';
import { encodeWater, paintWaterDisc, emptyWaterGrid, type WaterBody } from './waterMask';
import { patchArea, type MaterialPatch } from './materialPatch';
import { pieceCovers } from './pieces';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function floor(id: string, ring: Polygon): ShapeChild {
  return {
    id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [ring],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
  };
}

const patch = (extra: Partial<MaterialPatch> & { wall?: boolean }): MaterialPatch => ({
  id: 'p', material: 'pack:wild_grass_8x8_floor_A', rings: [rect(0, 0, 6, 4)], smooth: false, border: false, ...extra,
});

function layerWith(children: DungeonLayer['children'], materials: MaterialPatch[]): DungeonLayer {
  return { ...createDungeonLayer('L'), children, materials };
}

const shapes = (layer: DungeonLayer) => layer.children.filter((c): c is ShapeChild => c.childType === 'shape');
const lookup = { fillOf: (m: string) => (m === 'GG_Cave_Ink' ? 'pack:cave_floor' : undefined), nameOf: (m: string) => (m.includes('grass') ? 'Grass' : 'Cave') };

describe('patches as pieces', () => {
  it('puts ground patches under the first floor and the rest over the last, each in its order', () => {
    const light = { id: 'light', name: 'Light', childType: 'light', visible: true } as unknown as DungeonLayer['children'][number];
    const layer = layerWith(
      [light, floor('a', rect(0, 0, 4, 4)), floor('b', rect(4, 0, 8, 4))],
      [
        patch({ id: 'on1' }),
        patch({ id: 'g1', ground: true }),
        patch({ id: 'on2', material: 'pack:wild_dirt_8x8_floor_A' }),
        patch({ id: 'g2', ground: true }),
      ],
    );
    const [out] = patchesToPieces([layer], lookup);
    expect(out.children.map((c) => c.id)).toEqual(['light', 'g1', 'g2', 'a', 'b', 'on1', 'on2']);
    expect(out.materials).toBeUndefined();
  });

  it('makes a plain texture patch a soft ground piece with its texture, shore and height', () => {
    const [out] = patchesToPieces(
      [layerWith([], [patch({ ground: true, shore: 'none', shoreWidth: 1, shallowLine: true, height: -1 })])],
      lookup,
    );
    expect(shapes(out)[0]).toMatchObject({
      id: 'p', name: 'Grass 1', ground: true, textureId: 'pack:wild_grass_8x8_floor_A', soft: PATCH_SOFT_EDGE,
      shore: 'none', shoreWidth: 1, shallowLine: true, height: -1, contours: [rect(0, 0, 6, 4)],
    });
    expect(shapes(out)[0]).not.toHaveProperty('keptToFloors');
  });

  it('keeps a patch painted on a floor to the floors', () => {
    const [out] = patchesToPieces([layerWith([floor('a', rect(0, 0, 4, 4))], [patch({})])], lookup);
    expect(shapes(out)[1]).toMatchObject({ ground: true, keptToFloors: true });
  });

  it('makes a band set patch a ground piece with its rock rim, and none with Border off', () => {
    const [out] = patchesToPieces(
      [layerWith([], [patch({ id: 'rim', material: 'GG_Cave_Ink', border: true }), patch({ id: 'bare', material: 'GG_Cave_Ink' })])],
      lookup,
    );
    const [rim, bare] = shapes(out);
    expect(rim).toMatchObject({ name: 'Cave 1', ground: true, textureId: 'pack:cave_floor', edgeMaterial: 'GG_Cave_Ink' });
    expect(rim).not.toHaveProperty('soft');
    expect(bare).not.toHaveProperty('edgeMaterial');
    // Paint only: the union never sees it.
    expect(computeMergedFloor(out)).toBeNull();
  });

  it('leaves a band set patch waiting while its fill cannot be named, and a wall patch for the cave conversion', () => {
    const layer = layerWith([], [patch({ id: 'unknown', material: 'GG_Other' }), patch({ id: 'wall', material: 'GG_Cave_Ink', wall: true }), patch({ id: 'grass' })]);
    const [out] = patchesToPieces([layer]);
    expect(out.materials?.map((p) => p.id)).toEqual(['unknown', 'wall']);
    expect(shapes(out).map((c) => c.id)).toEqual(['grass']);
    expect(shapes(out)[0].name).toBe('Ground 1');
  });

  it('bakes a Smooth outline in and splits a patch of two islands into two pieces', () => {
    const [out] = patchesToPieces([layerWith([], [patch({ smooth: true, rings: [rect(0, 0, 6, 4), rect(10, 0, 14, 4)] })])], lookup);
    const pieces = shapes(out);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].contours[0].length).toBeGreaterThan(4);
    expect(pieceCovers(pieces[0], 3, 2) || pieceCovers(pieces[1], 3, 2)).toBe(true);
    expect(pieceCovers(pieces[0], 0.01, 0.01) || pieceCovers(pieces[1], 0.01, 0.01)).toBe(false);
  });

  it('changes nothing the second time, and hands back the same layers with no patches', () => {
    const once = patchesToPieces([layerWith([], [patch({})])], lookup);
    expect(patchesToPieces(once, lookup)).toBe(once);
  });
});

describe('the water mask as pieces', () => {
  function pond(): WaterBody {
    let g = emptyWaterGrid();
    g = paintWaterDisc(g, 5, 5, 2, false);
    g = paintWaterDisc(g, 20, 5, 1.5, false);
    return encodeWater(g, { shallow: '#88aacc', deep: '#224466', blend: 1, border: false })!;
  }

  it('traces the wet texels', () => {
    const rings = waterMaskRings(pond());
    expect(rings).toHaveLength(2);
    expect(patchArea(rings)).toBeGreaterThan(Math.PI * 4 * 0.9 + Math.PI * 2.25 * 0.9);
    expect(patchArea(rings)).toBeLessThan(Math.PI * 4 * 1.15 + Math.PI * 2.25 * 1.15);
  });

  it('makes one water piece per pool, smoothed, filled with the water texture, with no shore', () => {
    const pieces = waterToPieces(pond(), 'pack:wild_water_8x8_floor_A', [{ name: 'Water 1' }]);
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => p.name).sort()).toEqual(['Water 2', 'Water 3']);
    for (const p of pieces) expect(p).toMatchObject({ ground: true, textureId: 'pack:wild_water_8x8_floor_A', shore: 'none' });
    expect(pieces.some((p) => pieceCovers(p, 5, 5))).toBe(true);
    expect(pieces.some((p) => pieceCovers(p, 20, 5))).toBe(true);
    expect(pieces.some((p) => pieceCovers(p, 12, 5))).toBe(false);
  });
});

describe('map format 3.11', () => {
  it('is the version saved, and 3.10 is still read', () => {
    expect(CURRENT_VERSION).toBe('3.11');
    expect(SUPPORTED_VERSIONS).toContain('3.10');
  });

  it('loads a 3.10 map with its plain patches as pieces, with no catalog at hand', () => {
    const layer = layerWith([floor('a', rect(0, 0, 4, 4))], [patch({ ground: true })]);
    const old = {
      version: '3.10',
      mapSettings: { name: 'Old', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#ffffff' },
      grid: { visible: true, snapDivision: 2 },
      layers: [layer],
      customImages: {},
    } as unknown as SerializedMapData;
    const data = migrateToLatest(old);
    const out = data.layers[0] as DungeonLayer;
    expect(out.materials).toBeUndefined();
    expect(out.children.map((c) => c.id)).toEqual(['p', 'a']);
    // The old floor carries no flag: it is the walled floor it was.
    expect(out.children[1]).not.toHaveProperty('ground');
    expect(migrateToLatest(data).layers).toBe(data.layers);
  });
});
