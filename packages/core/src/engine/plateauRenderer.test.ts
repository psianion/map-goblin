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
          ledge_bend_45_1x1_A: object('ledge_bend_45', '1x1', 'GG_Cave_Ink'),
          ledge_bend_90_2x2_A: object('ledge_bend_90', '2x2', 'GG_Cave_Ink'),
          ledge_end_tail_1x1_A: object('ledge_end_tail', '1x1', 'GG_Cave_Ink'),
          contour_1x2_A: object('contour', '1x2', 'GG_Cave_Ink'),
          contour_1x4_A: object('contour', '1x4', 'GG_Cave_Ink'),
          contour_bend_90_2x2_A: object('contour_bend_90', '2x2', 'GG_Cave_Ink'),
          stairs_stone_short_2x2_A: object('stairs_stone_short', '2x2', 'GG_Cave_Ink', ['cave', 'prop', 'stairs']),
        },
      },
    },
    {
      packId: 'gg-demo',
      manifest: {
        entries: {
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
import { SLOPE_CONTOUR_ALPHA, SLOPE_CONTOUR_WIDTH } from '../shared/plateauShade';
import { ledgePieces } from '../assets/caveWallKit';
import { bandHoles } from './caveWalk';
import { bandRide, CURVE_STEP, layBandChain, layBandRing, LIVE_WALK } from './caveBandRenderer';
import { kitOut, resampleClosed, walkClosed } from './caveWalk';
import { cliffArt, cliffArtSetIds, cliffPieces } from './plateauKit';
import {
  defaultStairsArt,
  drawOpening,
  faceShade,
  renderPlateaus,
  shadeCliffs,
  stairsArtEntries,
  SHADE_FLOOR,
  SHADE_SIDE,
} from './plateauRenderer';
import {
  BLUR_WEIGHTS_5,
  CLIFF_BLUR_PASSES,
  CLIFF_SHADOW_ALPHA,
  cliffBlurStrength,
  cliffCaster,
  cliffShadowGeometry,
} from './shadowPass';
import { CASTER_HEIGHT, casterLook, shadowLook, type ShadowLook } from '../shared/shadows';
import { skyFrame } from '../shared/sky';
import type { MapEnvironment } from '../shared/world';
import type { DungeonLayer, PlateauChild, ShapeChild } from '../store/types';
import type { OpeningChild } from '../shared/types';
import type { Polygon } from '../types/geometry';
import { edgeRuns, layerPlateaus, pointInPoly, ringGaps } from '../shared/plateaus';

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

function plat(id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<PlateauChild> = {}): PlateauChild {
  return {
    id,
    name: id,
    childType: 'plateau',
    visible: true,
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    height: 1,
    edge: 'cliff',
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

describe('the cliff kit', () => {
  it('offers the band sets that carry ledges, and lays their straights with their own bends', () => {
    expect(cliffArtSetIds()).toEqual(['GG_Cave_Ink']);
    const kit = cliffArt(undefined);
    expect([...kit.keys()].sort()).toEqual(['ledge_1x2', 'ledge_1x4', 'ledge_bend_45_1x1', 'ledge_bend_90_2x2', 'ledge_end_tail_1x1']);
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
    renderPlateaus(layerOf([ground]), new Container(), parent);
    expect(parent.children).toHaveLength(0);
  });

  it('draws a cliff band: the lift tint on its own in the tops, the top line and ledge rock in the edges', () => {
    const parent = new Container();
    const tops = new Container();
    renderPlateaus(layerOf([ground, plat('top', 5, 5, 11, 11, { height: 2, edge: 'cliff' })]), tops, parent);
    expect(tops.children.map((c) => c.label)).toEqual(['plateau-top-2']);
    expect(tops.children[0]).toBeInstanceOf(Graphics);
    expect(parent.children.map((c) => c.label)).toEqual(['plateau-band-2']);
    const names = labels(parent);
    expect(names).not.toContain('plateau-top-2');
    expect(names).toContain('plateau-top-line');
    expect(names).toContain('plateau-cliff');
    const rock = (parent.children[0] as Container).children.find((c) => c.label === 'plateau-cliff') as Container;
    expect(rock.children.length).toBeGreaterThan(3);
    expect(rock.children.every((s) => s instanceof Sprite)).toBe(true);
  });

  /** How far outside the 6-cell square top at (5, 5) a point lies: rounded at its corners. */
  const outside = (p: { x: number; y: number }) =>
    Math.hypot(Math.max(5 - p.x, 0, p.x - 11), Math.max(5 - p.y, 0, p.y - 11));
  /** The mean distance out of a contour ring's straights, mid side, where each centre is on its ring. */
  const ringOut = (ring: Container) => {
    const mid = ring.children.filter((c) => Math.abs(c.position.x - 8) <= 1.5 || Math.abs(c.position.y - 8) <= 1.5);
    expect(mid.length).toBeGreaterThan(1);
    return mid.reduce((sum, c) => sum + outside(c.position), 0) / mid.length;
  };

  it('draws a slope as a band outside the outline under one walked ink contour a cell of drop; none when switched off', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 3, edge: 'slope' })]), new Container(), parent);
    const band = parent.children[0] as Container;
    const contours = band.children.find((c) => c.label === 'plateau-contours') as Container;
    expect(contours.children).toHaveLength(3);
    // Each ring is the contour pieces, walked: sprites, not a stroke.
    for (const ring of contours.children as Container[]) {
      expect(ring.label).toBe('plateau-contour');
      expect(ring.children.length).toBeGreaterThan(4);
      expect(ring.children.every((s) => s instanceof Sprite)).toBe(true);
    }
    // Evenly spaced inside the one-cell band, whatever the drop: 0.25, 0.5 and 0.75 cell out round the 6-cell top.
    (contours.children as Container[]).forEach((ring, k) => expect(Math.abs(ringOut(ring) - 0.25 * (k + 1))).toBeLessThan(0.12));
    // The ramp reaches the card's slope width out and no further.
    const rampOf = (extra: Partial<PlateauChild>) => {
      const p = new Container();
      renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 3, edge: 'slope', ...extra })]), new Container(), p);
      const find = (c: Container): Container | undefined => (c.label === 'plateau-slope' ? c : c.children.map((k) => find(k as Container)).find(Boolean));
      return find(p)!.getLocalBounds();
    };
    expect(rampOf({}).maxX).toBeCloseTo(12, 2);
    expect(rampOf({}).minX).toBeCloseTo(4, 2);
    expect(rampOf({ slopeWidth: 2.5 }).maxX).toBeCloseTo(13.5, 2);
    expect(rampOf({ slopeWidth: 6 }).maxX).toBeCloseTo(14, 2);
    // The stroke a contour falls back to without art: 1.5 px wide at 1x (20 px a cell), at 60 %.
    expect(SLOPE_CONTOUR_WIDTH * 20).toBeCloseTo(1.5);
    expect(SLOPE_CONTOUR_ALPHA).toBeCloseTo(0.6);
    // The ramp lies in the band's blurred shade, under the contours.
    const shade = band.children.find((c) => c.label === 'plateau-shade') as Container;
    expect(labels(shade)).toContain('plateau-slope');
    expect(band.children.indexOf(shade)).toBeLessThan(band.children.indexOf(contours));
    const meshes: Container[] = [];
    const walk = (c: Container) => {
      if (c instanceof MeshSimple) meshes.push(c);
      for (const k of c.children) walk(k as Container);
    };
    walk(band);
    expect(meshes).toEqual([]);

    renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 3, edge: 'slope', contourLines: false })]), new Container(), parent);
    expect(labels(parent)).not.toContain('plateau-contours');
  });

  it('rings a one-cell slope once inside its band', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 1, edge: 'slope' })]), new Container(), parent);
    const band = parent.children[0] as Container;
    const contours = band.children.find((c) => c.label === 'plateau-contours') as Container;
    expect(contours.children).toHaveLength(1);
    expect(Math.abs(ringOut(contours.children[0] as Container) - 0.5)).toBeLessThan(0.12);
  });

  it('keeps the slope face turned to the sun 40 % lighter than the one turned away, and all alike indoors', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 2, edge: 'slope' })]), new Container(), parent);
    const find = (c: Container): Container | undefined =>
      c.label === 'plateau-slope' ? c : c.children.map((k) => find(k as Container)).find(Boolean);
    const ramp = find(parent)!;
    // The shadow runs +x: the light is in the west, so the west face is turned to it.
    shadeCliffs('l1', { dx: 1, dy: 0, length: 2, alpha: 0.4, color: '#000000' });
    const faces = ramp.children.map((g) => ({ b: g.getLocalBounds(), alpha: g.alpha }));
    // The straight sides, not the rounded corners between them.
    const east = faces.filter(({ b }) => b.minX >= 11 - 1e-6 && b.height > 3);
    const west = faces.filter(({ b }) => b.maxX <= 5 + 1e-6 && b.height > 3);
    expect(east.length).toBeGreaterThan(0);
    expect(west.length).toBeGreaterThan(0);
    for (const f of east) expect(f.alpha).toBeCloseTo(1);
    for (const f of west) expect(f.alpha).toBeCloseTo(0.6);
    shadeCliffs('l1', null);
    expect(ramp.children.every((g) => g.alpha === 1)).toBe(true);
  });

  it('orders bands low to high, a pit before the plateau', () => {
    const parent = new Container();
    renderPlateaus(
      layerOf([ground, plat('top', 2, 2, 6, 6, { height: 2, edge: 'cliff' }), plat('pit', 15, 15, 20, 20, { height: -2, edge: 'cliff' })]),
      new Container(),
      parent,
    );
    expect(parent.children.map((c) => c.label)).toEqual(['plateau-band--2', 'plateau-band-2']);
  });

  it('cuts the ledge where an opening stands, and draws the opening', () => {
    const top = plat('top', 5, 5, 11, 11, { height: 2, edge: 'cliff' });
    const stairs: OpeningChild = { id: 's1', name: 's1', childType: 'opening', visible: true, kind: 'stairs', hostId: 'top', t: 0.125, width: 2 };
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
    renderPlateaus(layer, new Container(), cut);
    expect(labels(cut)).toContain('opening-s1');
  });
});

describe('every cliff ring is walked', () => {
  const rockOf = (layer: DungeonLayer): Sprite[] => {
    const parent = new Container();
    renderPlateaus(layer, new Container(), parent);
    const band = parent.children[parent.children.length - 1] as Container;
    const rock = band.children.find((c) => c.label === 'plateau-cliff') as Container;
    return rock.children as Sprite[];
  };
  it('lays a round plateau with the walk, piece for piece', () => {
    const round: [number, number][] = Array.from({ length: 64 }, (_, i) => [
      15 + 5 * Math.cos((i / 64) * 2 * Math.PI),
      15 + 5 * Math.sin((i / 64) * 2 * Math.PI),
    ]);
    const layer = layerOf([ground, { ...plat('top', 0, 0, 1, 1, { height: 1, edge: 'cliff' }), contours: [round] }]);
    const ring = layerPlateaus(layer).bands[0].rings[0];
    const kit = cliffPieces(cliffArt(undefined));
    const walked = walkClosed(bandRide(resampleClosed(ring as [number, number][], CURVE_STEP), true, kitOut(kit)), kit, LIVE_WALK);
    expect(rockOf(layer).length).toBe(walked.placed.length);
  });

  it('lays an 8x7 plateau piece for piece as the band walk does', () => {
    // An 8x7 side leaves the walk room for one straight at most once its corners are
    // turned, so the band lays it corner first (caveWalk `layCorners`): still every piece
    // at its own size, one sprite each.
    const layer = layerOf([ground, plat('top', 5, 5, 13, 12, { height: 1, edge: 'cliff' })]);
    const ring = layerPlateaus(layer).bands[0].rings[0];
    expect(rockOf(layer).length).toBe(layBandRing(ring, [], cliffPieces(cliffArt(undefined))).length);
  });

  it('never stretches a ledge: every sprite keeps its own proportions', () => {
    for (const layer of [
      layerOf([ground, plat('top', 5, 5, 13, 12, { height: 2, edge: 'cliff' })]),
      layerOf([ground, plat('pit', 5, 5, 13, 12, { height: -2, edge: 'cliff' })]),
      layerOf([plat('cave', 0, 0, 8, 7, { height: 1, edge: 'cliff' })]),
    ]) {
      const sprites = rockOf(layer);
      expect(sprites.length).toBeGreaterThan(3);
      for (const s of sprites) expect(Math.abs(s.scale.x)).toBeCloseTo(Math.abs(s.scale.y), 9);
    }
  });

  it('lays the ledge line of a pit on its rim', () => {
    const sprites = rockOf(layerOf([ground, plat('pit', 5, 5, 13, 12, { height: -1, edge: 'cliff' })]));
    // A thin line kit rides the edge itself: every piece's centre within a bend's bow of it.
    const off = (x: number, y: number) =>
      Math.max(5 - x, x - 13, 5 - y, y - 12) > 0 ? Math.max(5 - x, x - 13, 5 - y, y - 12) : Math.min(x - 5, 13 - x, y - 5, 12 - y);
    expect(sprites.length).toBeGreaterThan(3);
    for (const s of sprites) expect(off(s.position.x, s.position.y)).toBeLessThan(0.7);
  });

  it('draws the ledge of a lone cave floor raised on void', () => {
    expect(rockOf(layerOf([plat('cave', 0, 0, 8, 7, { height: 1, edge: 'cliff' })])).length).toBeGreaterThan(3);
  });
});

describe('a cliff draws its ledge alone', () => {
  const spritesIn = (c: Container): number =>
    c.children.reduce((n, ch) => n + (ch instanceof Sprite ? 1 : ch instanceof Container ? spritesIn(ch) : 0), 0);

  const partOf = (parent: Container, label: string): Sprite[] =>
    ((parent.children[0] as Container).children.find((c) => c.label === label) as Container | undefined)?.children as Sprite[] ?? [];

  it('lays one sprite per ledge placement and nothing else past it', () => {
    const layer = layerOf([ground, plat('top', 5, 5, 13, 12, { height: 1, edge: 'cliff' })]);
    const parent = new Container();
    renderPlateaus(layer, new Container(), parent);
    const ring = layerPlateaus(layer).bands[0].rings[0];
    const placements = layBandRing(ring, [], cliffPieces(cliffArt(undefined))).length;
    expect(placements).toBeGreaterThan(3);
    // A closed ring has no tips, so no end pieces.
    expect(partOf(parent, 'plateau-cliff')).toHaveLength(placements);
    expect(spritesIn(parent)).toBe(placements);
  });

  it('ends a ledge run cut by a gap with an end piece at each tip', () => {
    const layer = layerOf([ground, plat('top', 5, 5, 13, 12, { height: 1, edge: 'cliff' })]);
    const gaps = [{ id: 'opening:o', position: [9, 5] as [number, number], width: 1.5 }];
    const parent = new Container();
    renderPlateaus(layer, new Container(), parent, { gaps });
    const ring = layerPlateaus(layer).bands[0].rings[0];
    const walked = layBandRing(ring, gaps.map((g) => ({ wallId: g.id, position: g.position, width: g.width })), cliffPieces(cliffArt(undefined)));
    expect(partOf(parent, 'plateau-cliff')).toHaveLength(walked.length + 2);
  });

  it('draws a pit with its ledge line only', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('pit', 5, 5, 11, 11, { height: -2, edge: 'cliff' })]), new Container(), parent);
    const rock = partOf(parent, 'plateau-cliff');
    expect(rock.length).toBeGreaterThan(3);
    expect(spritesIn(parent)).toBe(rock.length);
  });
});

describe('each cell of height shows', () => {
  const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const mean = (c: number[]) => (c[0] + c[1] + c[2]) / 3;
  /** What the tops make of `floor` at (x, y): every top over the point composited in draw order. */
  const shown = (layer: DungeonLayer, tops: Container, floor: number, x: number, y: number): number => {
    const bands = layerPlateaus(layer).bands;
    let c = rgb(floor);
    for (const top of tops.children as Graphics[]) {
      const height = Number(top.label.replace('plateau-top-', ''));
      const band = bands.find((b) => b.height === height)!;
      const over = band.rings.filter((r) => pointInPoly(x, y, r)).length % 2 === 1;
      if (!over) continue;
      const fill = top.context.instructions.find((i) => i.action === 'fill')!.data as { style: { color: number; alpha: number } };
      const to = rgb(fill.style.color);
      c = c.map((v, k) => v + (to[k] - v) * fill.style.alpha);
    }
    return mean(c);
  };

  it('lifts a +1, +2 and +3 top at least 8/255 apart on cave, grass and stone floors, and sinks pits the same steps', () => {
    const raised = layerOf([ground, plat('a', 2, 2, 8, 8, { height: 1 }), plat('b', 10, 2, 16, 8, { height: 2 }), plat('c', 18, 2, 24, 8, { height: 3 })]);
    const sunk = layerOf([ground, plat('a', 2, 2, 8, 8, { height: -1 }), plat('b', 10, 2, 16, 8, { height: -2 }), plat('c', 18, 2, 24, 8, { height: -3 })]);
    const up = new Container();
    const down = new Container();
    renderPlateaus(raised, up, new Container());
    renderPlateaus(sunk, down, new Container());
    for (const floor of [0x3d3a36, 0x5f7040, 0x8a857c]) {
      const lift = [1, 5, 13, 21].map((x) => shown(raised, up, floor, x, 5));
      const sink = [1, 5, 13, 21].map((x) => shown(sunk, down, floor, x, 5));
      for (let k = 1; k < 4; k++) {
        expect(lift[k] - lift[k - 1], `floor ${floor.toString(16)}, +${k}`).toBeGreaterThanOrEqual(8);
        expect(sink[k]).toBeLessThan(sink[k - 1]);
      }
    }
  });

  it('lays one ledge ring at any drop: +1, +2 and +3 lay the ring walk once', () => {
    const ring = plat('top', 4, 4, 12, 10).contours[0] as Polygon;
    const once = layBandRing(ring, [], cliffPieces(cliffArt(undefined))).length;
    for (const height of [1, 2, 3]) {
      const parent = new Container();
      renderPlateaus(layerOf([ground, plat('top', 4, 4, 12, 10, { height })]), new Container(), parent);
      const rock = (parent.children[0] as Container).children.find((c) => c.label === 'plateau-cliff') as Container;
      expect(rock.children, `+${height}`).toHaveLength(once);
    }
  });
});

describe('light on the rock', () => {
  const look: ShadowLook = { dx: 1, dy: 0, length: 2, alpha: 0.4, color: '#000000' };

  it('lights a face turned to the sun and shades the one turned away', () => {
    // The shadow runs +x, so the light is to the west.
    expect(faceShade([-1, 0], look)).toBe(1);
    expect(faceShade([1, 0], look)).toBe(SHADE_FLOOR);
    expect(faceShade([0, 1], look)).toBe(SHADE_SIDE);
    // Far enough apart to read on dark ink rock: the lit face at least twice the shaded one.
    expect(faceShade([-1, 0], look) / faceShade([1, 0], look)).toBeGreaterThanOrEqual(2);
    expect(faceShade([1, 0], null)).toBe(1);
  });

  it('re-tints laid rock when the sun moves', () => {
    const parent = new Container();
    const layer = layerOf([ground, plat('top', 5, 5, 11, 11, { height: 2, edge: 'cliff' })]);
    renderPlateaus(layer, new Container(), parent);
    const rock = (parent.children[0] as Container).children.find((x) => x.label === 'plateau-cliff') as Container;
    shadeCliffs('l1', look);
    // The faces away from the corners: the walk turns each corner with a bend whose chord runs
    // across it, so the corner stone is side-on to either sun and takes the side shade.
    const mid = (s: { position: { y: number } }) => s.position.y > 6 && s.position.y < 10;
    const east = rock.children.filter((s) => s.position.x > 10.5 && mid(s)) as Sprite[];
    const west = rock.children.filter((s) => s.position.x < 5.5 && mid(s)) as Sprite[];
    expect(east.length).toBeGreaterThan(0);
    expect(west.length).toBeGreaterThan(0);
    expect(east.every((s) => s.tint < 0xffffff)).toBe(true);
    expect(west.every((s) => s.tint > 0xf0f0f0)).toBe(true);
    shadeCliffs('l1', { ...look, dx: -1 });
    expect(east.every((s) => s.tint > 0xf0f0f0)).toBe(true);
  });

  it('adds no wash of light over the ledge line, which has no rock face to light', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('top', 5, 5, 11, 11, { height: 2, edge: 'cliff' })]), new Container(), parent);
    expect(labels(parent)).not.toContain('plateau-cliff-light');
  });
});

describe('cliff shadows', () => {
  const look: ShadowLook = { dx: 1, dy: 0, length: 1.2, alpha: 0.4, color: '#000000' };
  const groundRing: Polygon[] = [ground.contours[0] as Polygon];
  const points = (polys: Polygon[]) => polys.flat();

  it('casts as tall as the drop', () => {
    expect(casterLook(look, 2).length).toBeCloseTo((2 / CASTER_HEIGHT) * look.length);
    expect(casterLook({ ...look, length: 5 }, 3).length).toBeCloseTo(12.5);
  });

  it('a plateau casts outward on the lee side, never onto itself', () => {
    const layer = layerOf([ground, plat('top', 10, 10, 14, 14, { height: 2, edge: 'cliff' })]);
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
    const layer = layerOf([ground, plat('pit', 10, 10, 16, 16, { height: -2, edge: 'cliff' })]);
    const pts = points(cliffShadowGeometry(layer, look, groundRing));
    expect(pts.length).toBeGreaterThan(0);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(x).toBeLessThanOrEqual(12 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(y).toBeLessThanOrEqual(16 + 1e-6);
    }
  });

  it('is soft: a flat 40 % black whose far edge the blur fades over at least 0.3 cell at any zoom', () => {
    expect(CLIFF_SHADOW_ALPHA).toBeGreaterThanOrEqual(0.35);
    expect(CLIFF_SHADOW_ALPHA).toBeLessThanOrEqual(0.45);
    // Pixi's blur, pass for pass: 5 taps `u` px apart, the first pass at the strength that
    // makes the passes add up to the filter's, each next one half the last; across the far edge.
    const fade = (pxPerCell: number): number => {
      const strength = cliffBlurStrength(pxPerCell);
      const sum = [...Array(CLIFF_BLUR_PASSES).keys()].reduce((acc, i) => acc + 0.25 ** i, 0);
      const n = 4000;
      let row: number[] = Array.from({ length: n }, (_, i) => (i < n / 2 ? CLIFF_SHADOW_ALPHA : 0));
      const at = (r: number[], x: number) => {
        const c = Math.max(0, Math.min(n - 1, x));
        const i = Math.floor(c);
        const t = c - i;
        return r[i] * (1 - t) + r[Math.min(n - 1, i + 1)] * t;
      };
      const w = [BLUR_WEIGHTS_5[2], BLUR_WEIGHTS_5[1], BLUR_WEIGHTS_5[0], BLUR_WEIGHTS_5[1], BLUR_WEIGHTS_5[2]];
      for (let pass = 0, u = strength / Math.sqrt(sum); pass < CLIFF_BLUR_PASSES; pass++, u /= 2) {
        const prev = row;
        row = prev.map((_, x) => w.reduce((acc, wk, k) => acc + wk * at(prev, x + (k - 2) * u), 0));
      }
      const hi = row.findIndex((a) => a < 0.9 * CLIFF_SHADOW_ALPHA);
      const lo = row.findIndex((a) => a < 0.1 * CLIFF_SHADOW_ALPHA);
      return (lo - hi) / pxPerCell;
    };
    for (const zoom of [20, 60, 120]) {
      expect(fade(zoom), `at ${zoom} px a cell`).toBeGreaterThanOrEqual(0.3);
      expect(fade(zoom)).toBeLessThan(0.6);
    }
  });

  it('casts under every sky: indoors from a fixed top-left sun at 70 %, 0.8 + 0.6 a cell of drop long', () => {
    const at = (map: MapEnvironment) => cliffCaster(skyFrame({ ...map, minutes: 12 * 60 }), map);
    for (const map of [{ environment: 'indoor' }, { environment: 'outdoor', naturalLight: false }] as MapEnvironment[]) {
      const { sun, strength } = at(map);
      expect(sun.kind).toBe('sun');
      expect(sun.altitude).toBe(35);
      expect(strength).toBeCloseTo(0.7);
    }
    expect(at({ environment: 'outdoor' }).strength).toBe(1);
    const look = shadowLook(at({ environment: 'indoor' }).sun)!;
    // From the top left: the shadow falls to the bottom right.
    expect(look.dx).toBeCloseTo(Math.SQRT1_2);
    expect(look.dy).toBeCloseTo(Math.SQRT1_2);
    const reach = (height: number) => {
      const layer = layerOf([ground, plat('top', 10, 10, 14, 14, { height, edge: 'cliff' })]);
      const pts = points(cliffShadowGeometry(layer, look, groundRing));
      expect(pts.length).toBeGreaterThan(0);
      return Math.max(...pts.map(([x, y]) => (x - 14) * look.dx + (y - 14) * look.dy));
    };
    expect(reach(1)).toBeGreaterThan(1);
    expect(reach(1)).toBeCloseTo(1.4, 1);
    expect(reach(2)).toBeCloseTo(2.0, 1);
  });

  it('slopes cast none: they shade instead', () => {
    const layer = layerOf([ground, plat('hill', 10, 10, 14, 14, { height: 2, edge: 'slope' })]);
    expect(points(cliffShadowGeometry(layer, look, groundRing))).toHaveLength(0);
  });
});

describe('openings', () => {
  const frame = { position: [0, 0] as [number, number], along: [1, 0] as [number, number], downhill: [0, 1] as [number, number], drop: 2 };

  it('draws stairs from the art, and placeholder ramps and ladders', () => {
    const stairs = drawOpening({ id: 'a', kind: 'stairs', width: 2 }, frame)!;
    expect(stairs.children[0]).toBeInstanceOf(Sprite);
    // The art's top sits at the ring and its foot runs downhill (+y).
    expect((stairs.children[0] as Sprite).rotation).toBeCloseTo(0);
    expect(drawOpening({ id: 'b', kind: 'ramp', width: 2 }, frame)).toBeInstanceOf(Graphics);
    expect(drawOpening({ id: 'c', kind: 'ladder', width: 1 }, frame)).toBeInstanceOf(Graphics);
  });

  it('defaults to the ink stone stairs and offers the ink flights first', () => {
    expect(defaultStairsArt()?.id).toBe('gg-forge:stairs_stone_short_2x2_A');
    const ids = stairsArtEntries().map((e) => e.id);
    expect(ids[0]).toBe('gg-forge:stairs_stone_short_2x2_A');
    expect(ids).toContain('gg-demo:stairs_stone_short_2x2_A');
  });

});

describe('the ledge on the goblin warren', () => {
  const warrenFloor = async (): Promise<ShapeChild> => {
    const { readFileSync } = await import('node:fs' as string);
    // The suite runs from packages/core.
    const doc = JSON.parse(readFileSync(`${process.cwd()}/../../session/testdata/goblin-warren.mapbuilder`, 'utf8'));
    return doc.layers.find((l: DungeonLayer) => l.type === 'dungeon').children.find((c: ShapeChild) => c.id === 'floor-cave-0');
  };
  /** Every cliff ring of a +1 plateau of `contour` on the warren floor, walked as it draws: its holes. */
  const holesOf = (floor: ShapeChild, contour: Polygon) => {
    const layer = layerOf([floor, { ...plat('p', 0, 0, 1, 1), contours: [contour] }]);
    const pieces = cliffPieces(cliffArt(undefined));
    return layerPlateaus(layer).bands.flatMap((band) =>
      edgeRuns(band).map((run) => {
        const placed = run.closed ? layBandRing(run.points, [], pieces) : layBandChain(run.points, [], pieces);
        expect(placed.length).toBeGreaterThan(3);
        return bandHoles(placed, run.closed).length;
      }),
    );
  };
  const rounded = (x0: number, y0: number, w: number, h: number, r: number): Polygon => {
    const out: Polygon = [];
    const corners = [[x0 + w - r, y0 + r, -90], [x0 + w - r, y0 + h - r, 0], [x0 + r, y0 + h - r, 90], [x0 + r, y0 + r, 180]];
    for (const [cx, cy, a0] of corners) {
      for (let k = 0; k <= 8; k++) {
        const a = ((a0 + (90 * k) / 8) * Math.PI) / 180;
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    }
    return out;
  };

  it('closes a 6 x 5.5 plateau against the den’s cave wall with no hole', async () => {
    const floor = await warrenFloor();
    const ring = floor.contours[0] as Polygon;
    // The den's north-east corner: its north and east sides run along and past the cave wall.
    const against: Polygon = [[51, 6], [57, 6], [57, 11.5], [51, 11.5]];
    expect(against.filter(([x, y]) => pointInPoly(x, y, ring)).length).toBeLessThan(4);
    expect(holesOf(floor, against)).toEqual([0]);
  });

  it('closes 20 rectangles and 20 rounded rectangles at +1 anywhere on the warren floor with no hole', async () => {
    const floor = await warrenFloor();
    const ring = floor.contours[0] as Polygon;
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let n = 0;
    while (n < 20) {
      const [w, h] = [2 + rand() * 8, 2 + rand() * 7];
      const [x, y] = [2 + rand() * 54, 2 + rand() * 42];
      const rect: Polygon = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      if (!rect.every(([px, py]) => pointInPoly(px, py, ring))) continue;
      n++;
      expect(holesOf(floor, rect), `rect at ${x.toFixed(1)},${y.toFixed(1)}`).toEqual([0]);
      expect(holesOf(floor, rounded(x, y, w, h, Math.min(w, h) * rand() * 0.5)), `rounded at ${x.toFixed(1)},${y.toFixed(1)}`).toEqual([0]);
    }
  });
});

describe('the drop shade', () => {
  const shadeOf = (band: Container) => band.children.filter((c) => c.label === 'plateau-shade') as Container[];

  it('lays a masked, blurred shade on the low side of every edge kind, under its rock', () => {
    for (const edge of ['none', 'slope', 'cliff'] as const) {
      const parent = new Container();
      renderPlateaus(layerOf([ground, plat('top', 5, 5, 11, 11, { height: 1, edge })]), new Container(), parent);
      const band = parent.children[0] as Container;
      const [shade] = shadeOf(band);
      expect(shade, edge).toBeTruthy();
      // First in the band: under the slope's contours and the cliff's rock.
      expect(band.children[0]).toBe(shade);
      const mask = shade.mask as Graphics;
      expect(mask).toBeInstanceOf(Graphics);
      expect(shade.children).toContain(mask);
      const soft = shade.children.find((c) => c.label === 'plateau-shade-soft') as Container;
      expect(soft.filters).toHaveLength(1);
      expect(labels(soft)).toContain('plateau-drop-shade');
      // The mask is the ground outside the plateau: a ring round it, holed where the plateau is.
      const b = mask.getLocalBounds();
      expect(b.minX).toBeLessThan(5 - 2);
      expect(b.maxX).toBeGreaterThan(11 + 2);
    }
  });

  it('reaches 0.35 + 0.3 a cell of drop out, wider at +3 than at +1, and inward for a pit', () => {
    const reach = (height: number) => {
      const parent = new Container();
      renderPlateaus(layerOf([ground, plat('top', 10, 10, 16, 16, { height, edge: 'none' })]), new Container(), parent);
      const soft = shadeOf(parent.children[0] as Container)[0].children[0] as Container;
      const g = soft.children.find((c) => c.label === 'plateau-drop-shade') as Graphics;
      return g.getLocalBounds();
    };
    expect(reach(1).maxX - 16).toBeCloseTo(0.65, 1);
    expect(reach(3).maxX - 16).toBeCloseTo(1.25, 1);
    expect(reach(3).maxX).toBeGreaterThan(reach(1).maxX + 0.5);
    // A pit shades inside its rim: its mask is the pit's own floor.
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('pit', 10, 10, 16, 16, { height: -2, edge: 'none' })]), new Container(), parent);
    const mask = shadeOf(parent.children[0] as Container)[0].mask as Graphics;
    const b = mask.getLocalBounds();
    expect([b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 100) / 100)).toEqual([10, 10, 16, 16]);
  });
});
