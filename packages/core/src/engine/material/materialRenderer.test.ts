// Floor pieces as drawn (pieceRenderer.ts): a soft ground piece fades at its edge, a water
// piece gets its shore, a ground piece with a band set its rock rim, a floor its painted
// border; and the rock round a walled cave, which stays in the materials sublayer.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { BufferImageSource, Container, Texture, TilingSprite } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';

const art = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(8 * 8 * 4), width: 8, height: 8 }) });
const host = new Container();
const band = vi.fn();
const manager = {
  catalogVersion: 1,
  getPackManifests: () => [
    {
      packId: 'gg-forge',
      manifest: {
        entries: {
          cave_floor_8x8_floor_A: { type: 'floor', material: 'cave_floor', gridSize: '8x8', set: 'GG_Cave_Floor', tags: ['cave'] },
          wild_dirt_8x8_floor_A: { type: 'floor', material: 'wild_dirt', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'dirt'] },
          wild_grass_8x8_floor_A: { type: 'floor', material: 'wild_grass', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'grass'] },
          wild_water_8x8_floor_A: { type: 'floor', material: 'wild_water', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'water'] },
          wild_water_deep_8x8_floor_A: { type: 'floor', material: 'wild_water_deep', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'water'] },
        },
      },
    },
  ],
  subscribeTextures: () => () => {},
  waitForTexture: () => Promise.resolve(null),
};
vi.mock('../assetPackInstance', () => ({ getAssetPackManager: () => manager }));
vi.mock('../sceneGraph', () => ({ getLayerEntry: () => ({ sublayers: { materials: host } }) }));
vi.mock('../../assets/textureLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../assets/textureLoader')>()),
  resolveTexture: () => art,
  unitTexture: () => ({ texture: art, cellsWide: 1, cellsHigh: 1 }),
  load: () => Promise.resolve(),
}));
vi.mock('../caveBandRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../caveBandRenderer')>()),
  drawOutlineBand: (...args: unknown[]) => band(...args),
}));

import { setClipperModule } from '../../geometry/Clipper2Engine';
import type { DungeonLayer, DungeonStyle, ShapeChild } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import { defaultSoftOf, GROUND_SOFT_EDGE, pieceNameOf } from '../../assets/materialKit';
import { SOFT_EDGE_STEPS } from '../softEdge';
import { BANK_SHADE_ALPHA, BANK_SHADE_MAX, drawLayerMaterials, shoreLayers, SUNK_SHORE_SCALE, waterEdgeOf } from './materialRenderer';
import { drawPiece, isWaterPiece, pieceOutline, type PieceCtx } from '../pieceRenderer';
import { softPieceLayers } from '../softPiece';
import { patchArea } from '../../shared/materialPatch';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

beforeEach(() => band.mockClear());

const GRASS = 'gg-forge:wild_grass_8x8_floor_A';
const DIRT = 'gg-forge:wild_dirt_8x8_floor_A';
const WATER = 'gg-forge:wild_water_8x8_floor_A';
const DEEP = 'gg-forge:wild_water_deep_8x8_floor_A';
const CAVE_FLOOR = 'gg-forge:cave_floor_8x8_floor_A';

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

function piece(extra: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id: 'p1', name: 'p1', childType: 'shape', visible: true, shapeType: 'polygon', contours: [square],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    ...extra,
  };
}

const style = { floorColor: '#808080' } as DungeonStyle;

function layerOf(children: ShapeChild[], mergedFloor: Polygon[] | null = null): DungeonLayer {
  return { id: 'l1', type: 'dungeon', children, standaloneWalls: [], mergedFloor, style } as unknown as DungeonLayer;
}

function draw(shape: ShapeChild, layer = layerOf([shape]), water: Polygon[] = []): Container {
  const into = new Container();
  const ctx: PieceCtx = { layer, style, floorFallback: undefined, water, bleedOf: () => 0, unionFilled: false, soft: new Set() };
  drawPiece(into, shape, ctx);
  return into.children[0] as Container;
}

function tilings(c: Container, out: TilingSprite[] = []): TilingSprite[] {
  for (const ch of c.children) {
    if (ch instanceof TilingSprite) out.push(ch);
    else if (ch instanceof Container) tilings(ch, out);
  }
  return out;
}

const labelled = (c: Container, label: string) => c.children.filter((ch) => ch.label === label);

describe('a piece’s defaults by texture', () => {
  it('gives outdoor ground a soft edge, water and cave floor a crisp one', () => {
    expect(defaultSoftOf(GRASS)).toBe(GROUND_SOFT_EDGE);
    expect(defaultSoftOf(DIRT)).toBe(GROUND_SOFT_EDGE);
    expect(defaultSoftOf(WATER)).toBeUndefined();
    expect(defaultSoftOf(CAVE_FLOOR)).toBeUndefined();
    expect(defaultSoftOf(undefined)).toBeUndefined();
  });

  it('names pieces by texture', () => {
    expect(pieceNameOf(GRASS)).toBe('Grass');
    expect(pieceNameOf(DIRT)).toBe('Dirt');
    expect(pieceNameOf(DEEP)).toBe('Water');
    expect(pieceNameOf('GG_Cave_Ink')).toBe('Cave');
  });
});

describe('a piece’s fill', () => {
  it('is one crisp tiled fill for a piece with no softness', () => {
    expect(tilings(draw(piece({ textureId: CAVE_FLOOR })))).toHaveLength(1);
  });

  it('fades in nested steps where there is no GL to draw the natural edge', () => {
    const drawn = draw(piece({ ground: true, textureId: GRASS, soft: 0.5 }));
    expect(tilings(drawn)).toHaveLength(SOFT_EDGE_STEPS);
  });

  it('builds the steps inside the outline, the outermost on it', () => {
    const layers = softPieceLayers(pieceOutline(piece()), 0.5);
    expect(layers).toHaveLength(SOFT_EDGE_STEPS);
    expect(patchArea(layers[layers.length - 1].rings)).toBeCloseTo(100, 6);
    expect(patchArea(layers[0].rings)).toBeLessThan(100);
    for (let i = 1; i < layers.length; i++) expect(patchArea(layers[i].rings)).toBeGreaterThan(patchArea(layers[i - 1].rings));
  });

  it('is painted to the piece’s own region: its holes are cut, whichever way its rings wind', () => {
    const hole: Polygon = [[4, 4], [6, 4], [6, 6], [4, 6]];
    const outline = pieceOutline(piece({ contours: [[...square].reverse(), hole] }));
    expect(outline).toHaveLength(2);
    expect(patchArea(outline)).toBeCloseTo(96, 6);
  });

  it('shows a patch kept to the floors only where the floors are', () => {
    const shape = piece({ ground: true, textureId: GRASS, keptToFloors: true });
    expect(draw(shape, layerOf([shape], [square])).mask).toBeTruthy();
    expect(draw(shape, layerOf([shape], null)).mask).toBeFalsy();
  });
});

describe('a water piece', () => {
  it('is told by its texture', () => {
    expect(isWaterPiece(piece({ textureId: WATER }))).toBe(true);
    expect(isWaterPiece(piece({ textureId: GRASS }))).toBe(false);
    expect(isWaterPiece(piece())).toBe(false);
  });

  it('defaults to a half-cell shore of the dirt floor, no shallow line, no bank shade', () => {
    expect(waterEdgeOf({ material: WATER })).toEqual({ shore: { textureId: DIRT, width: 0.5 }, bankShade: 0, bankWidth: 0.5, shallow: false });
    expect(waterEdgeOf({ material: GRASS })).toBeNull();
    expect(waterEdgeOf({ material: WATER, shore: 'none' })?.shore).toBeUndefined();
  });

  it('shades the bank on deep water, and on any water sunk below the ground, darker the deeper up to a cap', () => {
    expect(waterEdgeOf({ material: DEEP })?.bankShade).toBe(BANK_SHADE_ALPHA);
    const sunk = waterEdgeOf({ material: WATER, height: -1 })!;
    expect(sunk.shore?.width).toBe(0.5 * SUNK_SHORE_SCALE);
    expect(sunk.bankShade).toBeGreaterThan(0);
    expect(waterEdgeOf({ material: WATER, height: -10 })?.bankShade).toBe(BANK_SHADE_MAX);
  });

  it('lays the shore on the land side only, and none where water meets water', () => {
    const outline = pieceOutline(piece());
    const alone = shoreLayers(outline, 0.5, outline);
    expect(alone.length).toBeGreaterThan(0);
    for (const l of alone) expect(l.rings.flat().some(([x]) => x < 0 || x > 10)).toBe(true);
    const beside: Polygon = [[10, 0], [20, 0], [20, 10], [10, 10]];
    const widest = shoreLayers(outline, 0.5, [...outline, beside]).at(-1)!;
    // Nothing of the band lies on the neighbouring water (its corners still round past it, above and below).
    expect(widest.rings.flat().every(([x, y]) => x <= 10 + 1e-6 || y <= 1e-6 || y >= 10 - 1e-6)).toBe(true);
  });

  it('draws the shore under a crisp fill with a waterline, whatever its softness', () => {
    const drawn = draw(piece({ ground: true, textureId: WATER, soft: 0.5 }), undefined, pieceOutline(piece()));
    expect(labelled(drawn, 'material-shore')).toHaveLength(1);
    expect(labelled(drawn, 'material-waterline')).toHaveLength(1);
    // The shore's steps, and one fill.
    expect(tilings(drawn)).toHaveLength(tilings(labelled(drawn, 'material-shore')[0] as Container).length + 1);
  });

  it('with no shore keeps a soft edge, and draws the shallow line when asked', () => {
    const drawn = draw(piece({ ground: true, textureId: WATER, soft: 0.5, shore: 'none', shallowLine: true }));
    expect(labelled(drawn, 'material-shore')).toHaveLength(0);
    expect(labelled(drawn, 'material-waterline')).toHaveLength(0);
    expect(labelled(drawn, 'material-shallow-line')).toHaveLength(1);
    expect(tilings(drawn)).toHaveLength(SOFT_EDGE_STEPS);
  });
});

describe('a piece’s dressing', () => {
  it('lays a ground piece’s rock rim with the piece, paint only', () => {
    draw(piece({ ground: true, textureId: CAVE_FLOOR, edgeMaterial: 'GG_Cave_Ink' }));
    expect(band).toHaveBeenCalledTimes(1);
    expect(band.mock.calls[0][2]).toBe('GG_Cave_Ink');
  });

  it('leaves a walled cave’s rock to the materials sublayer, above every piece', () => {
    const cave = piece({ textureId: CAVE_FLOOR, edgeMaterial: 'GG_Cave_Ink', styleOverrides: { wallTextureSetId: '' } });
    draw(cave);
    expect(band).not.toHaveBeenCalled();
    drawLayerMaterials(layerOf([cave], [square]));
    expect(band).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(1);
    // A ground piece's rim is not drawn there, and clears what was.
    drawLayerMaterials(layerOf([piece({ ground: true, textureId: CAVE_FLOOR, edgeMaterial: 'GG_Cave_Ink' })]));
    expect(host.children).toHaveLength(0);
  });

  it('draws a floor’s painted border with the floor, so a later piece covers it', () => {
    const drawn = draw(piece({ textureId: CAVE_FLOOR, edgePaint: DIRT }));
    expect(labelled(drawn, 'floor-border-p1')).toHaveLength(1);
    expect(labelled(draw(piece({ textureId: CAVE_FLOOR })), 'floor-border-p1')).toHaveLength(0);
  });
});
