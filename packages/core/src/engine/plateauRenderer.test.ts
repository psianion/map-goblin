// Plateau rendering: what lands in the plateaus sublayer for a cliff, a slope and a pit, the
// cliff kit the ledge art makes, the lit and shaded faces, and the cliff shadows.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { BufferImageSource, Container, Graphics, MeshSimple, Sprite, Texture } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';

const art = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(8 * 8 * 4), width: 8, height: 8 }) });
const object = (material: string, gridSize: string, set: string, tags: string[] = ['structure', 'cave']) => ({
  type: 'object',
  material,
  gridSize,
  set,
  tags,
});
const manager = {
  catalogVersion: 1,
  getPackManifests: () => [
    {
      packId: 'gg-forge',
      manifest: {
        entries: {
          wall_short_2x2_A: object('wall_short', '2x2', 'GG_Cave_Ink'),
          inside_bend_2x2_A: object('inside_bend', '2x2', 'GG_Cave_Ink'),
          outside_bend_2x2_A: object('outside_bend', '2x2', 'GG_Cave_Ink'),
          ledge_1x2_A: object('ledge', '1x2', 'GG_Cave_Ink'),
          ledge_1x4_A: object('ledge', '1x4', 'GG_Cave_Ink'),
        },
      },
    },
    {
      packId: 'gg-demo',
      manifest: {
        entries: {
          ledge_bend_1x1_A: object('ledge_bend', '1x1', 'demo-structures', ['structure']),
          ledge_bend_2x2_A: object('ledge_bend', '2x2', 'demo-structures', ['structure']),
          stairs_stone_short_2x2_A: object('stairs_stone_short', '2x2', 'demo-structures', ['structure']),
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
import { ledgePieces } from '../assets/caveWallKit';
import { bandHoles } from './caveWalk';
import { layBandRing } from './caveBandRenderer';
import { cliffArt, cliffArtSetIds, cliffPieces } from './plateauKit';
import { drawOpening, drawWaterfall, faceShade, renderPlateaus, shadeCliffs, SHADE_FLOOR } from './plateauRenderer';
import { cliffShadowGeometry } from './shadowPass';
import { CASTER_HEIGHT, casterLook, type ShadowLook } from '../shared/shadows';
import type { DungeonLayer, ShapeChild } from '../store/types';
import type { OpeningChild } from '../shared/types';
import type { Polygon } from '../types/geometry';
import { layerPlateaus, ringGaps } from '../shared/plateaus';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

function rect(id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...extra,
  };
}

const layerOf = (children: DungeonLayer['children']) =>
  ({ id: 'l1', type: 'dungeon', children, style: { floorColor: '#808080' } }) as unknown as DungeonLayer;

const ground = rect('ground', 0, 0, 30, 30);

function labels(c: Container, out: string[] = []): string[] {
  for (const ch of c.children) {
    if (ch.label) out.push(ch.label);
    if (ch instanceof Container) labels(ch, out);
  }
  return out;
}

const paint = (parent: Container) => parent.addChild(new Graphics());

describe('the cliff kit', () => {
  it('offers the band sets that carry ledges, and lays forge straights with gg-demo bends', () => {
    expect(cliffArtSetIds()).toEqual(['GG_Cave_Ink']);
    const kit = cliffArt(undefined);
    expect([...kit.keys()].sort()).toEqual(['ledge_1x2', 'ledge_1x4', 'ledge_bend_1x1', 'ledge_bend_2x2']);
    const pieces = cliffPieces(kit);
    expect(pieces.some((p) => p.turnDeg > 0)).toBe(true);
    expect(pieces.some((p) => p.turnDeg < 0)).toBe(true);
  });

  it('closes rectangles, an L and circles with no holes', () => {
    const L: Polygon = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
    const circle = (r: number): Polygon =>
      Array.from({ length: 64 }, (_, i) => [r * Math.cos((i / 64) * 2 * Math.PI), r * Math.sin((i / 64) * 2 * Math.PI)] as [number, number]);
    for (const ring of [rect('a', 0, 0, 4, 4).contours[0], rect('b', 0, 0, 10, 4).contours[0], L, circle(3), circle(6)]) {
      const placed = layBandRing(ring, [], ledgePieces());
      expect(placed.length).toBeGreaterThan(3);
      expect(bandHoles(placed, true)).toEqual([]);
    }
  });
});

describe('renderPlateaus', () => {
  it('draws nothing on a flat layer', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground]), parent, paint);
    expect(parent.children).toHaveLength(0);
  });

  it('draws a cliff band: floor, top line and ledge rock', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, rect('top', 5, 5, 11, 11, { height: 2, edge: 'cliff' })]), parent, paint);
    expect(parent.children.map((c) => c.label)).toEqual(['plateau-band-2']);
    const names = labels(parent);
    expect(names).toContain('plateau-floor');
    expect(names).toContain('plateau-top-line');
    expect(names).toContain('plateau-cliff');
    const rock = (parent.children[0] as Container).children.find((c) => c.label === 'plateau-cliff') as Container;
    expect(rock.children.length).toBeGreaterThan(3);
    expect(rock.children.every((s) => s instanceof Sprite)).toBe(true);
  });

  it('draws a slope as a ribbon with a contour line per cell, and none when switched off', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, rect('hill', 5, 5, 11, 11, { height: 3, edge: 'slope' })]), parent, paint);
    const band = parent.children[0] as Container;
    expect(band.children.some((c) => c instanceof MeshSimple && c.label === 'plateau-slope')).toBe(true);
    expect(labels(parent)).toContain('plateau-contours');

    renderPlateaus(layerOf([ground, rect('hill', 5, 5, 11, 11, { height: 3, edge: 'slope', contourLines: false })]), parent, paint);
    expect(labels(parent)).not.toContain('plateau-contours');
  });

  it('orders bands low to high, a pit before the plateau', () => {
    const parent = new Container();
    renderPlateaus(
      layerOf([ground, rect('top', 2, 2, 6, 6, { height: 2, edge: 'cliff' }), rect('pit', 15, 15, 20, 20, { height: -2, edge: 'cliff' })]),
      parent,
      paint,
    );
    expect(parent.children.map((c) => c.label)).toEqual(['plateau-band--2', 'plateau-band-2']);
  });

  it('cuts the ledge where an opening stands, and draws the opening', () => {
    const top = rect('top', 5, 5, 11, 11, { height: 2, edge: 'cliff' });
    const stairs: OpeningChild = { id: 's1', name: 's1', childType: 'opening', visible: true, kind: 'stairs', shapeId: 'top', t: 0.125, width: 2 };
    const layer = layerOf([ground, top, stairs]);
    const [gap] = ringGaps(layer);
    expect(gap.position[0]).toBeCloseTo(8);
    expect(gap.position[1]).toBeCloseTo(5);
    // No rock chord passes over the opening once its gap is cut.
    const ring = layerPlateaus(layer).bands[0].rings[0];
    const over = (placed: { P: [number, number]; Q: [number, number] }[]) =>
      placed.some(({ P, Q }) => {
        const [dx, dy] = [Q[0] - P[0], Q[1] - P[1]];
        const u = Math.max(0, Math.min(1, ((8 - P[0]) * dx + (5 - P[1]) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(8 - (P[0] + dx * u), 5 - (P[1] + dy * u)) < 0.5;
      });
    expect(over(layBandRing(ring, [], ledgePieces()))).toBe(true);
    expect(over(layBandRing(ring, [{ wallId: gap.id, position: gap.position, width: gap.width }], ledgePieces()))).toBe(false);
    const cut = new Container();
    renderPlateaus(layer, cut, paint);
    expect(labels(cut)).toContain('opening-s1');
  });
});

describe('light on the rock', () => {
  const look: ShadowLook = { dx: 1, dy: 0, length: 2, alpha: 0.4, color: '#000000' };

  it('lights a face turned to the sun and shades the one turned away', () => {
    // The shadow runs +x, so the light is to the west.
    expect(faceShade([-1, 0], look)).toBe(1);
    expect(faceShade([1, 0], look)).toBe(SHADE_FLOOR);
    expect(faceShade([0, 1], look)).toBe(SHADE_FLOOR);
    expect(faceShade([1, 0], null)).toBe(1);
  });

  it('re-tints laid rock when the sun moves', () => {
    const parent = new Container();
    const layer = layerOf([ground, rect('top', 5, 5, 11, 11, { height: 2, edge: 'cliff' })]);
    renderPlateaus(layer, parent, paint);
    const rock = (parent.children[0] as Container).children.find((x) => x.label === 'plateau-cliff') as Container;
    shadeCliffs('l1', look);
    const east = rock.children.filter((s) => s.position.x > 11) as Sprite[];
    const west = rock.children.filter((s) => s.position.x < 5) as Sprite[];
    expect(east.length).toBeGreaterThan(0);
    expect(west.length).toBeGreaterThan(0);
    expect(east.every((s) => s.tint < 0xffffff)).toBe(true);
    expect(west.every((s) => s.tint > 0xf0f0f0)).toBe(true);
    shadeCliffs('l1', { ...look, dx: -1 });
    expect(east.every((s) => s.tint > 0xf0f0f0)).toBe(true);
  });
});

describe('cliff shadows', () => {
  const look: ShadowLook = { dx: 1, dy: 0, length: 1.2, alpha: 0.4, color: '#000000' };
  const groundRing: Polygon[] = [ground.contours[0] as Polygon];
  const points = (polys: Polygon[][]) => polys.flat().flat();

  it('casts as tall as the drop', () => {
    expect(casterLook(look, 2).length).toBeCloseTo((2 / CASTER_HEIGHT) * look.length);
    expect(casterLook({ ...look, length: 5 }, 3).length).toBeCloseTo(12.5);
  });

  it('a plateau casts outward on the lee side, never onto itself', () => {
    const layer = layerOf([ground, rect('top', 10, 10, 14, 14, { height: 2, edge: 'cliff' })]);
    const pts = points(cliffShadowGeometry(layer, look, groundRing));
    expect(pts.length).toBeGreaterThan(0);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(14 - 1e-6);
      expect(x).toBeLessThanOrEqual(14 + 2 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(y).toBeLessThanOrEqual(14 + 1e-6);
    }
  });

  it('a pit is shadowed inside, from the rim the light comes over', () => {
    const layer = layerOf([ground, rect('pit', 10, 10, 16, 16, { height: -2, edge: 'cliff' })]);
    const pts = points(cliffShadowGeometry(layer, look, groundRing));
    expect(pts.length).toBeGreaterThan(0);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(x).toBeLessThanOrEqual(12 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(y).toBeLessThanOrEqual(16 + 1e-6);
    }
  });

  it('slopes cast none: they shade instead', () => {
    const layer = layerOf([ground, rect('hill', 10, 10, 14, 14, { height: 2, edge: 'slope' })]);
    expect(points(cliffShadowGeometry(layer, look, groundRing))).toHaveLength(0);
  });
});

describe('openings and waterfalls', () => {
  const frame = { position: [0, 0] as [number, number], along: [1, 0] as [number, number], downhill: [0, 1] as [number, number], drop: 2 };

  it('draws stairs from the art, and placeholder ramps and ladders', () => {
    const stairs = drawOpening({ id: 'a', kind: 'stairs', width: 2 }, frame)!;
    expect(stairs.children[0]).toBeInstanceOf(Sprite);
    // The art's top sits at the ring and its foot runs downhill (+y).
    expect((stairs.children[0] as Sprite).rotation).toBeCloseTo(0);
    expect(drawOpening({ id: 'b', kind: 'ramp', width: 2 }, frame)).toBeInstanceOf(Graphics);
    expect(drawOpening({ id: 'c', kind: 'ladder', width: 1 }, frame)).toBeInstanceOf(Graphics);
  });

  it('hangs a waterfall from its lip down the drop', () => {
    const parent = new Container();
    const mesh = drawWaterfall(parent, { a: [0, 0], b: [2, 0], downhill: [0, 1], drop: 3 })!;
    expect(parent.children).toContain(mesh);
    const v = mesh.geometry.getBuffer('aPosition').data as Float32Array;
    expect(Math.max(...Array.from(v).filter((_, i) => i % 2 === 1))).toBe(3);
  });
});
