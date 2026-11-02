// Borders between floors: where two differently textured floors meet, the top floor's kit
// walks its edge units along the boundary they share; only a kit with no edge units (or no
// kit at all) falls back to the colour blend.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';

const art = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(8 * 8 * 4), width: 8, height: 8 }) });
const tile = (material: string, gridSize: string, set: string, type = 'floor') => ({ type, material, gridSize, set, tags: [] as string[] });
const manager = {
  catalogVersion: 1,
  getPackManifests: () => [
    {
      packId: 'gg-forge',
      manifest: {
        entries: {
          'road-dirt-fill': tile('road-dirt-fill', '4x4', 'road-dirt', 'path'),
          'dirt-pebbles_1x1_object_A': tile('dirt-pebbles', '1x1', 'GG_Paths_Props', 'object'),
          'road-dirt-kit': {
            type: 'kit',
            material: 'road-dirt',
            gridSize: '1x1',
            set: 'road-dirt',
            tags: ['path', 'kit'],
            kit: { kind: 'surface', fill: 'road-dirt-fill', edge: [{ key: 'dirt-pebbles_1x1_object_A', weight: 1, spacing: 0.6, jitter: 0.3 }] },
          },
          'water-fill': tile('water-fill', '4x4', 'water', 'path'),
          'water-kit': { type: 'kit', material: 'water', gridSize: '1x1', set: 'water', tags: ['path', 'kit'], kit: { kind: 'surface', fill: 'water-fill' } },
          'cave-floor': tile('cave-floor', '4x4', 'GG_Cave_Floor'),
        },
      },
    },
  ],
  getTexture: () => art,
  getFrame: () => null,
  waitForTexture: vi.fn(() => new Promise(() => {})),
};
vi.mock('./assetPackInstance', () => ({ getAssetPackManager: () => manager }));

import { setClipperModule } from '../geometry/Clipper2Engine';
import { floorBorders, floorKit, renderEdgeTransitions } from './edgeTransitions';
import { MAX_OVERLAP, unitOverlap } from './path/pathKitLayout';
import type { DungeonLayer, ShapeChild } from '../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

function floor(id: string, x0: number, y0: number, x1: number, y1: number, textureId?: string): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    textureId,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#808080',
  } as ShapeChild;
}

const layerOf = (children: ShapeChild[]) =>
  ({ id: 'l1', type: 'dungeon', children, style: { showEdgeTransitions: true, edgeTransitionWidth: 0.5 } }) as unknown as DungeonLayer;

const cave = floor('cave', 0, 0, 10, 10, 'gg-forge:cave-floor');
const road = floor('road', 10, 0, 20, 10, 'gg-forge:road-dirt-fill');

describe('floorKit', () => {
  it('finds the kit whose fill a floor is painted with; none for a texture no kit claims', () => {
    expect(floorKit('gg-forge:road-dirt-fill')?.id).toBe('gg-forge:road-dirt');
    expect(floorKit('gg-forge:cave-floor')).toBeUndefined();
    expect(floorKit(undefined)).toBeUndefined();
  });
});

describe('floorBorders', () => {
  it('walks the top floor’s edge units along the shared edge, and only there', () => {
    const { borders, blends } = floorBorders([cave, road], 0.5);
    expect(blends).toEqual([]);
    expect(borders).toHaveLength(1);
    const { top, units } = borders[0];
    expect(top.id).toBe('road');
    // Ten cells of shared edge at 0.6 apart: about sixteen units, every one on the line x = 10.
    expect(units.length).toBeGreaterThanOrEqual(13);
    for (const u of units) {
      expect(u.x).toBeCloseTo(10, 6);
      expect(u.y).toBeGreaterThanOrEqual(0);
      expect(u.y).toBeLessThanOrEqual(10);
      expect(u.scale).toBe(0.5);
    }
    // No two overlap by more than the walk allows.
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) expect(unitOverlap(units[i], units[j])).toBeLessThanOrEqual(MAX_OVERLAP + 1e-9);
    }
    // Seeded by the two floors: the same pair lays the same units.
    expect(floorBorders([cave, road], 0.5).borders[0].units).toEqual(units);
  });

  it('falls back to the blend only when the top floor’s kit has no edge units, or it has no kit', () => {
    const water = floor('water', 10, 0, 20, 10, 'gg-forge:water-fill');
    expect(floorBorders([cave, water], 0.5)).toEqual({ borders: [], blends: [[cave, water]] });
    // The cave floor on top: no kit claims it.
    expect(floorBorders([road, { ...cave }], 0.5).blends).toHaveLength(1);
  });

  it('leaves floors of one texture, and floors apart, alone', () => {
    expect(floorBorders([cave, { ...cave, id: 'cave2', contours: [[[10, 0], [20, 0], [20, 10], [10, 10]]] }], 0.5)).toEqual({ borders: [], blends: [] });
    expect(floorBorders([cave, floor('far', 30, 0, 40, 10, 'gg-forge:road-dirt-fill')], 0.5)).toEqual({ borders: [], blends: [] });
  });
});

describe('renderEdgeTransitions', () => {
  const drawn = (children: ShapeChild[]) => {
    const parent = new Container();
    renderEdgeTransitions(parent, layerOf(children));
    return parent;
  };

  it('draws units, not a strip or a blend, where a kit floor meets another', () => {
    const parent = drawn([cave, road]);
    expect(parent.children.map((c) => c.label)).toEqual(['floor-edge-units']);
    const units = (parent.children[0] as Container).children;
    expect(units.length).toBeGreaterThan(10);
    expect(units.every((s) => s instanceof Sprite && Math.abs(s.position.x - 10) < 1e-6)).toBe(true);
  });

  it('draws the blend where the top floor’s kit has no edge units', () => {
    const parent = drawn([cave, floor('water', 10, 0, 20, 10, 'gg-forge:water-fill')]);
    expect(parent.children.map((c) => c.label)).toEqual(['floor-edge-blend']);
  });

  it('draws nothing with the layer’s edge transitions switched off', () => {
    const parent = new Container();
    const layer = layerOf([cave, road]);
    layer.style.showEdgeTransitions = false;
    renderEdgeTransitions(parent, layer);
    expect(parent.children).toHaveLength(0);
  });
});
