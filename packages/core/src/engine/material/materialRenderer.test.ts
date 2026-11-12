// Material brush patches as drawn: a band set's patch keeps its fill and border band; a plain
// floor texture's patch has no band and fades out at its edge.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { BufferImageSource, Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';

const art = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(8 * 8 * 4), width: 8, height: 8 }) });
const host = new Container();
const ground = new Container();
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
          wild_water_8x8_floor_A: { type: 'floor', material: 'wild_water', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'water'] },
          wild_water_deep_8x8_floor_A: { type: 'floor', material: 'wild_water_deep', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'water'] },
        },
      },
    },
  ],
  subscribeTextures: () => () => {},
};
vi.mock('../assetPackInstance', () => ({ getAssetPackManager: () => manager }));
vi.mock('../sceneGraph', () => ({ getLayerEntry: () => ({ sublayers: { materials: host, ground } }) }));
vi.mock('../../assets/textureLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../assets/textureLoader')>()),
  resolveTexture: () => art,
  load: () => Promise.resolve(),
}));
vi.mock('../caveBandRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../caveBandRenderer')>()),
  drawOutlineBand: (...args: unknown[]) => band(...args),
}));

import { setClipperModule } from '../../geometry/Clipper2Engine';
import { nestedAlphas } from '../../shared/plateauShade';
import type { MaterialPatch } from '../../shared/materialPatch';
import type { DungeonLayer } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import { SOFT_EDGE_STEPS } from '../softEdge';
import { BANK_SHADE_ALPHA, BANK_SHADE_MAX, caveDoorGaps, drawLayerMaterials, fallLayers, shoreLayers, SOFT_EDGE, softPatchLayers, waterEdgeOf } from './materialRenderer';
import { layOutlineBand } from '../caveBandRenderer';
import { jointsOf } from '../../assets/caveWallKit';
import { caveEdges, caveFloorShape } from '../../shared/caveFloor';
import { resolveDoors, resolveWalls } from '../../shared/wallResolve';
import { innerBandLayers, outsideBandLayers } from '../softEdge';
import { pointInPoly } from '../../shared/plateaus';
import { wobbleSeed } from '../../shared/plateauShade';
import type { DoorChild, ShapeChild } from '../../shared/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

beforeEach(() => band.mockClear());

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
const patch = (material: string): MaterialPatch => ({ id: 'p1', material, rings: [square], smooth: false, border: true });
const layerWith = (p: MaterialPatch) =>
  ({ id: 'l1', type: 'dungeon', children: [], materials: [p], style: { floorColor: '#808080' } }) as unknown as DungeonLayer;

function tilings(c: Container, out: TilingSprite[] = []): TilingSprite[] {
  for (const ch of c.children) {
    if (ch instanceof TilingSprite) out.push(ch);
    else if (ch instanceof Container) tilings(ch, out);
  }
  return out;
}

const minX = (rings: Polygon[]) => Math.min(...rings.flat().map((p) => p[0]));

describe('a plain floor texture patch', () => {
  it('draws no border band, even with Border on', () => {
    drawLayerMaterials(layerWith(patch('gg-forge:wild_dirt_8x8_floor_A')));
    expect(band).not.toHaveBeenCalled();
  });

  it('fades its fill out at the edge in nested steps', () => {
    drawLayerMaterials(layerWith(patch('gg-forge:wild_dirt_8x8_floor_A')));
    const fills = tilings(host);
    expect(fills).toHaveLength(SOFT_EDGE_STEPS);
    expect(fills.map((f) => f.alpha)).toEqual(nestedAlphas(1, SOFT_EDGE_STEPS));
  });

  it('lays every step of the fade from one anchor, so the stacked texture lines up instead of smearing', () => {
    drawLayerMaterials(layerWith(patch('gg-forge:wild_dirt_8x8_floor_A')));
    const fills = tilings(host);
    expect(fills).toHaveLength(SOFT_EDGE_STEPS);
    for (const f of fills) {
      expect([f.x, f.y, f.width, f.height]).toEqual([0, 0, 10, 10]);
      expect([f.tilePosition.x, f.tilePosition.y]).toEqual([fills[0].tilePosition.x, fills[0].tilePosition.y]);
    }
  });

  it('builds its steps inside the outline, the outermost on it, each reaching further out', () => {
    const layers = softPatchLayers([square]);
    expect(layers).toHaveLength(SOFT_EDGE_STEPS);
    expect(layers[0].alpha).toBe(1);
    expect(minX(layers[0].rings)).toBeCloseTo(SOFT_EDGE - SOFT_EDGE / SOFT_EDGE_STEPS, 2);
    expect(layers[layers.length - 1].rings).toEqual([square]);
    for (let k = 1; k < layers.length; k++) expect(minX(layers[k].rings)).toBeLessThan(minX(layers[k - 1].rings));
  });
});

describe('a patch on a layer with floors', () => {
  const floor: Polygon = [[0, 0], [5, 0], [5, 5], [0, 5]];
  const onFloor = (p: MaterialPatch, mergedFloor: Polygon[] | null) => ({ ...layerWith(p), mergedFloor }) as unknown as DungeonLayer;
  const piece = () => host.children[host.children.length - 1] as Container;

  it('trims a plain texture patch to the floor union', () => {
    drawLayerMaterials(onFloor(patch('gg-forge:wild_dirt_8x8_floor_A'), [floor]));
    const mask = piece().mask as Graphics;
    expect(mask).toBeInstanceOf(Graphics);
    const b = mask.getLocalBounds();
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 5, 5]);
  });

  it('draws a plain texture patch untrimmed on a layer with no floor', () => {
    drawLayerMaterials(onFloor(patch('gg-forge:wild_dirt_8x8_floor_A'), null));
    expect(piece().mask).toBeFalsy();
    drawLayerMaterials(onFloor(patch('gg-forge:wild_dirt_8x8_floor_A'), []));
    expect(piece().mask).toBeFalsy();
  });

  it('leaves a band set patch untrimmed', () => {
    drawLayerMaterials(onFloor(patch('GG_Cave_Ink'), [floor]));
    expect(piece().mask).toBeFalsy();
  });

  it('draws a ground patch whole, in the sublayer under the floors, and clears it again', () => {
    drawLayerMaterials(onFloor({ ...patch('gg-forge:wild_dirt_8x8_floor_A'), ground: true }, [floor]));
    expect(host.children).toHaveLength(0);
    expect(ground.children).toHaveLength(1);
    expect((ground.children[0] as Container).mask).toBeFalsy();
    drawLayerMaterials(onFloor(patch('gg-forge:wild_dirt_8x8_floor_A'), [floor]));
    expect(ground.children).toHaveLength(0);
    expect(host.children).toHaveLength(1);
  });
});

describe('a water patch’s shore', () => {
  const WATER = 'gg-forge:wild_water_8x8_floor_A';
  const DEEP = 'gg-forge:wild_water_deep_8x8_floor_A';
  const DIRT = 'gg-forge:wild_dirt_8x8_floor_A';
  const inRings = (x: number, y: number, rings: Polygon[]) => rings.filter((r) => pointInPoly(x, y, r)).length % 2 === 1;
  const drawn = (p: MaterialPatch) => {
    drawLayerMaterials(layerWith(p));
    const names: string[] = [];
    const walk = (c: Container) => {
      for (const ch of c.children) {
        if (ch.label) names.push(ch.label);
        if (ch instanceof Container) walk(ch);
      }
    };
    walk(host);
    return names;
  };

  it('defaults to a half-cell band of the dirt floor, no shallow line, no bank shade', () => {
    expect(waterEdgeOf(patch(WATER))).toEqual({ shore: { textureId: DIRT, width: 0.5 }, bankShade: 0, bankWidth: 0.5, shallow: false });
    expect(waterEdgeOf({ ...patch(WATER), shore: 'none' })?.shore).toBeUndefined();
    expect(waterEdgeOf({ ...patch(WATER), shoreWidth: 1.5, shallowLine: true })).toMatchObject({ shore: { width: 1.5 }, shallow: true });
  });

  it('lays the band on the land side only: outside the outline, crisp on it, soft further out', () => {
    const layers = outsideBandLayers([square], 0.5, 0.2);
    expect(layers).toHaveLength(SOFT_EDGE_STEPS);
    const whole = layers[layers.length - 1].rings;
    for (const l of layers) for (const [x, y] of [[5, 5], [0.05, 5], [9.95, 5]]) expect(inRings(x, y, l.rings)).toBe(false);
    expect(inRings(-0.05, 5, layers[0].rings)).toBe(true);
    expect(inRings(-0.45, 5, whole)).toBe(true);
    expect(inRings(-0.55, 5, whole)).toBe(false);
  });

  it('lays no shore between two waters that touch, whatever each is', () => {
    const east: Polygon = [[10, 0], [20, 0], [20, 10], [10, 10]];
    const alone = shoreLayers([square], 0.5, [square]);
    expect(inRings(10.2, 5, alone[alone.length - 1].rings)).toBe(true);
    const beside = shoreLayers([square], 0.5, [square, east]);
    expect(beside.length).toBeGreaterThan(0);
    for (const l of beside) expect(inRings(10.2, 5, l.rings)).toBe(false);
    // The bank on its open sides is as it was.
    expect(inRings(-0.2, 5, beside[beside.length - 1].rings)).toBe(true);
  });

  it('draws the shore under a crisp fill with a waterline; None draws no shore and keeps the soft edge', () => {
    const names = drawn(patch(WATER));
    expect(names).toContain('material-shore');
    expect(names).toContain('material-waterline');
    expect(names.indexOf('material-shore')).toBeLessThan(names.indexOf('material-waterline'));
    const none = drawn({ ...patch(WATER), shore: 'none' });
    expect(none).not.toContain('material-shore');
    expect(none).not.toContain('material-waterline');
    expect(tilings(host)).toHaveLength(SOFT_EDGE_STEPS);
  });

  it('shades the bank on deep water only, and draws the shallow line when asked', () => {
    expect(drawn(patch(DEEP))).toContain('material-bank-shade');
    expect(waterEdgeOf(patch(DEEP))!.bankShade).toBeGreaterThan(0);
    expect(drawn(patch(WATER))).not.toContain('material-bank-shade');
    expect(drawn(patch(WATER))).not.toContain('material-shallow-line');
    expect(drawn({ ...patch(WATER), shallowLine: true })).toContain('material-shallow-line');
  });

  it('follows the patch’s height: a sunk shore half as wide again, a bank shade on any water, darker deeper, up to a cap', () => {
    const at = (material: string, height: number | undefined) => waterEdgeOf({ ...patch(material), ...(height === undefined ? {} : { height }) })!;
    // At 0, or raised: as set.
    for (const h of [undefined, 0, 1]) {
      expect(at(WATER, h).shore!.width).toBe(0.5);
      expect(at(WATER, h).bankShade).toBe(0);
      expect(at(DEEP, h).bankShade).toBe(BANK_SHADE_ALPHA);
    }
    // Sunk: the shore 1.5 times as wide, and every water shaded.
    expect(at(WATER, -1).shore!.width).toBeCloseTo(0.75);
    expect(waterEdgeOf({ ...patch(WATER), shoreWidth: 1, height: -2 })!.shore!.width).toBeCloseTo(1.5);
    const shades = [-0.5, -1, -2, -3, -6, -10].map((h) => at(WATER, h).bankShade);
    expect(shades[0]).toBeGreaterThan(0);
    for (let i = 1; i < shades.length; i++) expect(shades[i]).toBeGreaterThanOrEqual(shades[i - 1]);
    expect(shades[2]).toBeGreaterThan(shades[1]);
    expect(Math.max(...shades)).toBe(BANK_SHADE_MAX);
    // Deep water sunk is never lighter than at 0.
    expect(at(DEEP, -0.5).bankShade).toBe(BANK_SHADE_ALPHA);
    // And the shade is drawn.
    expect(drawn({ ...patch(WATER), height: -1 })).toContain('material-bank-shade');
  });

  it('falls across the water where a plateau’s cliff crosses it, as wide as the water there; none without a cliff', () => {
    // A stream running east, 2 wide, crossing the west cliff of a +1 plateau at x = 6.
    const stream: MaterialPatch = { id: 'w', material: WATER, rings: [[[0, 4], [12, 4], [12, 6], [0, 6]]], smooth: false, border: true };
    const plateau = { id: 't', name: 't', childType: 'plateau', visible: true, contours: [[[6, 0], [20, 0], [20, 20], [6, 20]]], height: 1, edge: 'cliff' };
    const layer = { children: [plateau] } as unknown as DungeonLayer;
    const steps = fallLayers(layer, [stream.rings[0]]);
    expect(steps.length).toBeGreaterThan(0);
    const whole = steps[steps.length - 1].rings;
    expect(inRings(6, 5, whole)).toBe(true);
    expect(inRings(6, 4.1, whole)).toBe(true);
    expect(inRings(6, 5.9, whole)).toBe(true);
    // Only on the water, only by the cliff line.
    expect(inRings(6, 3.9, whole)).toBe(false);
    expect(inRings(7, 5, whole)).toBe(false);
    expect(fallLayers({ children: [] } as unknown as DungeonLayer, [stream.rings[0]])).toEqual([]);
    expect(fallLayers({ children: [{ ...plateau, edge: 'slope' }] } as unknown as DungeonLayer, [stream.rings[0]])).toEqual([]);
    drawLayerMaterials({ ...layerWith(stream), children: [plateau] } as unknown as DungeonLayer);
    const names: string[] = [];
    const walk = (c: Container) => c.children.forEach((ch) => (names.push(ch.label), ch instanceof Container && walk(ch)));
    walk(host);
    expect(names).toContain('material-fall');
  });

  it('leaves ground and cave ink patches as they were', () => {
    expect(waterEdgeOf(patch(DIRT))).toBeNull();
    expect(waterEdgeOf(patch('GG_Cave_Ink'))).toBeNull();
    for (const m of [DIRT, 'GG_Cave_Ink']) {
      const names = drawn(patch(m));
      for (const gone of ['material-shore', 'material-waterline', 'material-bank-shade', 'material-shallow-line']) expect(names).not.toContain(gone);
    }
  });
});

describe('a floor’s painted border', () => {
  const DIRT = 'gg-forge:wild_dirt_8x8_floor_A';
  const inRings = (x: number, y: number, rings: Polygon[]) => rings.filter((r) => pointInPoly(x, y, r)).length % 2 === 1;
  const hole: Polygon = [[4, 4], [6, 4], [6, 6], [4, 6]];
  const floor = (over: Partial<ShapeChild> = {}): ShapeChild => ({
    id: 'f1',
    name: 'Floor',
    childType: 'shape',
    visible: true,
    shapeType: 'polygon',
    contours: [square, hole],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...over,
  });

  it('lays a band just inside the outline and round its holes, 0.75 wide give or take its wobble', () => {
    const layers = innerBandLayers([square, hole], 0.75, wobbleSeed('f1'));
    expect(layers).toHaveLength(SOFT_EDGE_STEPS);
    const whole = layers[layers.length - 1].rings;
    expect(inRings(0.1, 2, whole)).toBe(true);
    expect(inRings(1.2, 2, whole)).toBe(false);
    expect(inRings(-0.1, 2, whole)).toBe(false);
    // Round the hole, on the floor's side of it, never in it.
    expect(inRings(3.9, 5, whole)).toBe(true);
    expect(inRings(5, 5, whole)).toBe(false);
    for (let y = 1; y < 9.5; y += 0.5) {
      let x = 0;
      while (x < 3 && inRings(x + 0.01, y, whole)) x += 0.01;
      expect(x).toBeGreaterThanOrEqual(0.48);
      expect(x).toBeLessThanOrEqual(1.02);
    }
  });

  it('is drawn with the patches for a floor that has one, and not for one that has none', () => {
    const layer = (f: ShapeChild) => ({ id: 'l1', type: 'dungeon', children: [f], materials: undefined, style: { floorColor: '#808080' } }) as unknown as DungeonLayer;
    drawLayerMaterials(layer(floor({ edgePaint: DIRT })));
    expect(host.children.map((c) => c.label)).toEqual(['floor-border-f1']);
    expect(tilings(host)).toHaveLength(SOFT_EDGE_STEPS);
    drawLayerMaterials(layer(floor()));
    expect(host.children).toHaveLength(0);
  });
});

describe('a band set patch', () => {
  it('is drawn as before: one solid fill and its border band', () => {
    drawLayerMaterials(layerWith(patch('GG_Cave_Ink')));
    const fills = tilings(host);
    expect(fills).toHaveLength(1);
    expect(fills[0].alpha).toBe(1);
    expect(band).toHaveBeenCalledTimes(1);
    expect(band.mock.calls[0][2]).toBe('GG_Cave_Ink');
  });
});

describe('a plain opening in a cave’s rock', () => {
  it('stops the rock either side of it, as any door on the cave does', () => {
    const ring: Polygon = Array.from({ length: 64 }, (_, i): [number, number] => {
      const a = (i / 64) * Math.PI * 2;
      return [7 * Math.cos(a), 7 * Math.sin(a)];
    });
    const cave = caveFloorShape([ring], { material: 'GG_Cave_Ink', fill: 'p:cave_floor', border: true }, 'c', 'c');
    const mouth = {
      id: 'd', name: 'd', childType: 'door', visible: true, wallId: '', position: [7, 0], angle: 0,
      width: 1.5, style: 'archway', state: 'open', isSecret: false, bare: true,
    } as DoorChild;
    const layer = { id: 'cave-mouth', type: 'dungeon', children: [cave, mouth], standaloneWalls: [], style: { floorColor: '#808080' } } as unknown as DungeonLayer;
    const [edge] = caveEdges(layer);
    const gaps = caveDoorGaps(edge, resolveDoors(layer, resolveWalls(layer)));
    expect(gaps).toHaveLength(1);
    const placed = layOutlineBand(edge.rings, undefined, gaps).flat();
    expect(placed.length).toBeGreaterThan(4);
    for (const pl of placed) {
      for (const j of jointsOf(pl.piece, pl.at)) {
        expect(Math.hypot(j[0] - gaps[0].position[0], j[1] - gaps[0].position[1])).toBeGreaterThan(0.75);
      }
    }
  });
});
