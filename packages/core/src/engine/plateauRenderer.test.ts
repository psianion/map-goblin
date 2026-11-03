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
import { bandRide, CURVE_STEP, layBandRing, LIVE_WALK } from './caveBandRenderer';
import { resampleClosed, walkClosed } from './caveWalk';
import { cliffArt, cliffArtSetIds, cliffPieces } from './plateauKit';
import {
  CONTOUR_LINE,
  LEDGE_ROW_INSET,
  cliffRows,
  drawOpening,
  faceLight,
  faceShade,
  renderPlateaus,
  shadeCliffs,
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
import type { OpeningChild, PathChild } from '../shared/types';
import { cliffCrossingsOf, fallPieces, waterfallSpans } from './path/waterfalls';
import type { Polygon } from '../types/geometry';
import { layerPlateaus, pointInPoly, ringGaps } from '../shared/plateaus';

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

  it('draws a slope as one ink contour ring per cell of drop, 2 px at 1x, shaded in quads; none when switched off', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 3, edge: 'slope' })]), new Container(), parent);
    const band = parent.children[0] as Container;
    const contours = band.children.find((c) => c.label === 'plateau-contours') as Container;
    expect(contours.children).toHaveLength(3);
    // Each ring a cell further down the slope: 8, 10 and 12 cells across round the 6-cell top.
    const widths = contours.children.map((g) => Math.round(g.getLocalBounds().width));
    expect(widths).toEqual([8, 10, 12]);
    // 2 px wide at 1x (20 px a cell).
    expect(CONTOUR_LINE * 20).toBeCloseTo(2);
    expect(band.children.some((c) => c.label === 'plateau-slope')).toBe(true);
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

  it('rings a one-cell slope at its foot, not just along its top', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 1, edge: 'slope' })]), new Container(), parent);
    const band = parent.children[0] as Container;
    const contours = band.children.find((c) => c.label === 'plateau-contours') as Container;
    expect(contours.children).toHaveLength(1);
    expect(contours.getLocalBounds().width).toBeGreaterThan(6 + 1.9);
  });

  it('shades the slope face turned from the sun and leaves the lit one bare', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 2, edge: 'slope' })]), new Container(), parent);
    const band = parent.children[0] as Container;
    const shade = band.children.find((c) => c.label === 'plateau-slope') as Container;
    // The shadow runs +x: the light is in the west, so the east face is turned away.
    shadeCliffs('l1', { dx: 1, dy: 0, length: 2, alpha: 0.4, color: '#000000' });
    // The east and west faces: the north and south ones run side-on to this sun.
    const faces = shade.children.map((g) => ({ b: g.getLocalBounds(), alpha: g.alpha }));
    const east = faces.filter(({ b }) => b.minX >= 11 - 1e-6);
    const west = faces.filter(({ b }) => b.maxX <= 5 + 1e-6);
    expect(east.length).toBeGreaterThan(0);
    expect(west.length).toBeGreaterThan(0);
    expect(Math.min(...east.map((f) => f.alpha))).toBeGreaterThan(0.2);
    expect(Math.max(...west.map((f) => f.alpha))).toBe(0);
    shadeCliffs('l1', null);
    expect(shade.children.every((g) => g.alpha === 0)).toBe(true);
  });

  it('reads as a hill: on the face turned from the sun, light at the top and darker ring by ring to the foot', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 3, edge: 'slope' })]), new Container(), parent);
    const band = parent.children[0] as Container;
    const shade = band.children.find((c) => c.label === 'plateau-slope') as Container;
    shadeCliffs('l1', { dx: 1, dy: 0, length: 2, alpha: 0.4, color: '#000000' });
    // The east face's quads (not its corner wedges), by how far down the slope each lies.
    const east = shade.children
      .map((g) => ({ b: g.getLocalBounds(), alpha: g.alpha }))
      .filter(({ b }) => b.minX >= 11 - 1e-6 && b.height > 2);
    const byStep = new Map<number, number[]>();
    for (const { b, alpha } of east) {
      const step = Math.floor((b.minX + b.maxX) / 2 - 11);
      byStep.set(step, [...(byStep.get(step) ?? []), alpha]);
    }
    expect([...byStep.keys()].sort()).toEqual([0, 1, 2]);
    // Brightness under the shade (1 - alpha), top to foot.
    const bright = [0, 1, 2].map((k) => 1 - Math.max(...byStep.get(k)!));
    expect(bright[0]).toBeGreaterThan(bright[1]);
    expect(bright[1]).toBeGreaterThan(bright[2]);
    expect(bright[0] - bright[2]).toBeGreaterThan(0.2);
    // Every quad of one step is shaded alike: flat between rings, a step at each.
    for (const alphas of byStep.values()) expect(Math.max(...alphas) - Math.min(...alphas)).toBeLessThan(1e-9);
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
    const walked = walkClosed(bandRide(resampleClosed(ring as [number, number][], CURVE_STEP), true), cliffPieces(cliffArt(undefined)), LIVE_WALK);
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

  it('walks a pit reversed, so its rock lies inside the rim', () => {
    const sprites = rockOf(layerOf([ground, plat('pit', 5, 5, 13, 12, { height: -1, edge: 'cliff' })]));
    const inside = sprites.filter((s) => s.position.x > 5 && s.position.x < 13 && s.position.y > 5 && s.position.y < 12);
    expect(inside.length / sprites.length).toBeGreaterThan(0.9);
  });

  it('draws the ledge of a lone cave floor raised on void', () => {
    expect(rockOf(layerOf([plat('cave', 0, 0, 8, 7, { height: 1, edge: 'cliff' })])).length).toBeGreaterThan(3);
  });
});

describe('a cliff draws its ledge alone', () => {
  const spritesIn = (c: Container): number =>
    c.children.reduce((n, ch) => n + (ch instanceof Sprite ? 1 : ch instanceof Container ? spritesIn(ch) : 0), 0);

  it('lays one sprite per ledge placement and nothing else past it', () => {
    const layer = layerOf([ground, plat('top', 5, 5, 13, 12, { height: 1, edge: 'cliff' })]);
    const parent = new Container();
    renderPlateaus(layer, new Container(), parent);
    const ring = layerPlateaus(layer).bands[0].rings[0];
    const placements = layBandRing(ring, [], cliffPieces(cliffArt(undefined))).length;
    expect(placements).toBeGreaterThan(3);
    expect(spritesIn(parent)).toBe(placements);
  });

  it('draws a pit with its ledge rock only, inside the rim', () => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('pit', 5, 5, 11, 11, { height: -2, edge: 'cliff' })]), new Container(), parent);
    const band = parent.children[0] as Container;
    const rock = band.children.find((c) => c.label === 'plateau-cliff') as Container;
    expect(rock.children.length).toBeGreaterThan(3);
    expect(spritesIn(parent)).toBe(rock.children.length);
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

  it('stacks a cliff’s ledge a row a cell, up to three: 1x, 2x and 3x the ring walk', () => {
    const rock = (height: number): number => {
      const parent = new Container();
      renderPlateaus(layerOf([ground, plat('top', 4, 4, 22, 18, { height })]), new Container(), parent);
      return ((parent.children[0] as Container).children.find((c) => c.label === 'plateau-cliff') as Container).children.length;
    };
    const ring = layerPlateaus(layerOf([ground, plat('top', 4, 4, 22, 18)])).bands[0].rings[0];
    const walk = layBandRing(ring, [], cliffPieces(cliffArt(undefined))).length;
    expect(rock(1)).toBe(walk);
    expect(rock(2) / walk).toBeGreaterThan(1.8);
    expect(rock(2) / walk).toBeLessThanOrEqual(2);
    expect(rock(3) / walk).toBeGreaterThan(2.6);
    expect(rock(3) / walk).toBeLessThanOrEqual(3);
    expect(rock(5)).toBe(rock(3));
    expect(rock(-3) / rock(-1)).toBeGreaterThan(2.6);
  });

  it('walks each inner row 0.35 cell up the cliff from the last, and draws it first, under the outer', () => {
    const ring = layerPlateaus(layerOf([ground, plat('top', 4, 4, 22, 18)])).bands[0].rings[0];
    const rows = cliffRows(ring, true, 3, [], cliffPieces(cliffArt(undefined)));
    expect(LEDGE_ROW_INSET).toBeCloseTo(0.35);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(layBandRing(ring, [], cliffPieces(cliffArt(undefined))));
    // On the north edge (y = 4), each row's chords lie 0.35 cell further south than the last.
    const northY = (row: (typeof rows)[number]) => {
      const ys = row.filter((p) => p.P[0] > 8 && p.P[0] < 18 && p.P[1] < 11 && Math.abs(p.P[1] - p.Q[1]) < 0.05).map((p) => p.P[1]);
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    expect(northY(rows[1]) - northY(rows[0])).toBeCloseTo(LEDGE_ROW_INSET, 1);
    expect(northY(rows[2]) - northY(rows[1])).toBeCloseTo(LEDGE_ROW_INSET, 1);
    // Drawn inner first: the outer row's pieces are the last sprites laid.
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('top', 4, 4, 22, 18, { height: 3 })]), new Container(), parent);
    const sprites = ((parent.children[0] as Container).children.find((c) => c.label === 'plateau-cliff') as Container).children;
    const flat = new Container();
    renderPlateaus(layerOf([ground, plat('top', 4, 4, 22, 18, { height: 1 })]), new Container(), flat);
    const outer = ((flat.children[0] as Container).children.find((c) => c.label === 'plateau-cliff') as Container).children;
    expect(sprites.slice(-outer.length).map((s) => [s.position.x, s.position.y])).toEqual(outer.map((s) => [s.position.x, s.position.y]));
  });

  it('cuts every row at an opening', () => {
    const top = plat('top', 4, 4, 22, 18, { height: 3 });
    // The ring runs (4,4)→(22,4)→…, 64 cells round: t = 9/64 stands at (13, 4).
    const stairs: OpeningChild = { id: 's1', name: 's1', childType: 'opening', visible: true, kind: 'stairs', hostId: 'top', t: 9 / 64, width: 2 };
    const layer = layerOf([ground, top, stairs]);
    const [gap] = ringGaps(layer);
    expect(gap.position[0]).toBeCloseTo(13);
    const ring = layerPlateaus(layer).bands[0].rings[0];
    const pieces = cliffPieces(cliffArt(undefined));
    const over = (row: { P: [number, number]; Q: [number, number] }[], y: number) =>
      row.some(({ P, Q }) => {
        const [dx, dy] = [Q[0] - P[0], Q[1] - P[1]];
        const u = Math.max(0, Math.min(1, ((13 - P[0]) * dx + (y - P[1]) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(13 - (P[0] + dx * u), y - (P[1] + dy * u)) < 0.5;
      });
    const plain = cliffRows(ring, true, 3, [], pieces);
    const cut = cliffRows(ring, true, 3, [{ wallId: gap.id, position: gap.position, width: gap.width }], pieces);
    plain.forEach((row, k) => expect(over(row, 4 + k * LEDGE_ROW_INSET), `row ${k} uncut`).toBe(true));
    cut.forEach((row, k) => expect(over(row, 4 + k * LEDGE_ROW_INSET), `row ${k} cut`).toBe(false));
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
    const east = rock.children.filter((s) => s.position.x > 11 && mid(s)) as Sprite[];
    const west = rock.children.filter((s) => s.position.x < 5 && mid(s)) as Sprite[];
    expect(east.length).toBeGreaterThan(0);
    expect(west.length).toBeGreaterThan(0);
    expect(east.every((s) => s.tint < 0xffffff)).toBe(true);
    expect(west.every((s) => s.tint > 0xf0f0f0)).toBe(true);
    shadeCliffs('l1', { ...look, dx: -1 });
    expect(east.every((s) => s.tint > 0xf0f0f0)).toBe(true);
  });

  it('adds light over the face turned to the sun, and none indoors', () => {
    expect(faceLight([1, 0], { ...look, dx: -1 })).toBeGreaterThan(0.2);
    expect(faceLight([-1, 0], { ...look, dx: -1 })).toBe(0);
    expect(faceLight([1, 0], null)).toBe(0);
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('top', 5, 5, 11, 11, { height: 2, edge: 'cliff' })]), new Container(), parent);
    const lights = (parent.children[0] as Container).children.find((x) => x.label === 'plateau-cliff-light') as Container;
    shadeCliffs('l1', { ...look, dx: -1 });
    const lit = lights.children.filter((g) => g.alpha > 0).map((g) => g.getLocalBounds());
    // The light is from the east: only the east face takes it.
    expect(lit).toHaveLength(1);
    expect(lit[0].minX).toBeGreaterThanOrEqual(11 - 1e-6);
    shadeCliffs('l1', null);
    expect(lights.children.every((g) => g.alpha === 0)).toBe(true);
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

  it('casts under every sky: indoors from a fixed top-left sun at 70 %, as long as the drop', () => {
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
    expect(reach(2) / reach(1)).toBeCloseTo(2, 1);
  });

  it('slopes cast none: they shade instead', () => {
    const layer = layerOf([ground, plat('hill', 10, 10, 14, 14, { height: 2, edge: 'slope' })]);
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

});

describe('waterfalls at cliff crossings', () => {
  // The plateau-test outcrop: +2, cliff all round, its west edge at x = 4.
  const outcrop = plat('outcrop', 4, 4, 12, 11, { height: 2, edge: 'cliff' });
  const water = (id: string, points: PathChild['points'], over: Partial<PathChild> = {}): PathChild => ({
    id,
    name: id,
    childType: 'path',
    visible: true,
    points,
    closed: false,
    width: 1.5,
    heightMode: 'ground',
    materialId: 'gg-forge:water',
    tint: '#ffffff',
    opacity: 1,
    offset: 0,
    flip: false,
    edge: 'soft',
    ends: { start: 'cut', end: 'cut', length: 1 },
    sort: 'under',
    ...over,
  });

  it('finds where a river runs off a cliff, and hangs the fall on the low side', () => {
    const river = water('river', [{ x: 10, y: 6.5 }, { x: 1, y: 6.5 }]);
    const layer = layerOf([ground, outcrop, river]);
    const crossings = cliffCrossingsOf(layer, river);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toMatchObject({ down: 1, drop: 2 });
    expect(crossings[0].start).toBeCloseTo(6, 6);
    const [fall] = waterfallSpans(river, crossings);
    // From the lip at x = 4, half the 2-cell drop on, falling west.
    expect(fall.x).toBeCloseTo(3, 6);
    expect(Math.abs(fall.angle)).toBeCloseTo(Math.PI, 6);
  });

  it('honours the drop when the river is drawn uphill: the fall still hangs off the low side', () => {
    const river = water('river', [{ x: 1, y: 6.5 }, { x: 10, y: 6.5 }]);
    const crossings = cliffCrossingsOf(layerOf([ground, outcrop, river]), river);
    expect(crossings).toHaveLength(1);
    expect(crossings[0].down).toBe(-1);
    const [fall] = waterfallSpans(river, crossings);
    expect(fall.x).toBeCloseTo(3, 6);
    expect(Math.abs(fall.angle)).toBeCloseTo(Math.PI, 6);
  });

  it('spills a raised pool over the stretch of its shore that runs along the cliff', () => {
    const corner = (x: number, y: number) => ({ x, y, handles: null });
    const pool = water('pool', [corner(4, 5), corner(8, 5), corner(8, 9), corner(4, 9)], { closed: true, fill: true, width: 1 });
    const crossings = cliffCrossingsOf(layerOf([ground, outcrop, pool]), pool);
    expect(crossings).toHaveLength(1);
    const falls = waterfallSpans(pool, crossings);
    expect(falls).toHaveLength(2);
    for (const f of falls) {
      expect(f.x).toBeLessThan(4);
      expect(Math.abs(f.angle)).toBeCloseTo(Math.PI, 6);
      expect(f.y).toBeGreaterThan(5 - 1e-6);
      expect(f.y).toBeLessThan(9 + 1e-6);
    }
  });

  it('finds none on flat ground', () => {
    const river = water('river', [{ x: 10, y: 20 }, { x: 1, y: 20 }]);
    expect(cliffCrossingsOf(layerOf([ground, outcrop, river]), river)).toEqual([]);
  });

  it('tiles a fall with square pieces of one size, none stretched', () => {
    const pieces = fallPieces([{ x: 0, y: 0, angle: Math.PI / 2, width: 3, length: 2 }], 2);
    expect(pieces).toHaveLength(4);
    for (const p of pieces) expect(p.scale).toBeCloseTo(0.75, 6);
    // Two across, two down, the first row at the lip (y = -1).
    expect([...new Set(pieces.map((p) => p.x.toFixed(3)))]).toEqual(['0.750', '-0.750']);
    expect(Math.min(...pieces.map((p) => p.y))).toBeCloseTo(-0.25, 6);
  });
});
