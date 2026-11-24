// Plateau rendering: what lands in the plateaus sublayer for a cliff, a slope and a pit, the
// cliff kit the ledge art makes, the lit and shaded faces, and the cliff shadows.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { BufferImageSource, Container, Graphics, Mesh, Sprite, Texture, TilingSprite } from 'pixi.js';
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
          rockledge_1x2_A: object('rockledge', '1x2', 'GG_Cave_Ink'),
          rockledge_1x4_A: object('rockledge', '1x4', 'GG_Cave_Ink'),
          rockledge_bend_90_2x2_A: object('rockledge_bend_90', '2x2', 'GG_Cave_Ink'),
          rockledge_bend_n90_2x2_A: object('rockledge_bend_n90', '2x2', 'GG_Cave_Ink'),
          rockledge_bend_45_2x2_A: object('rockledge_bend_45', '2x2', 'GG_Cave_Ink'),
          rockledge_bend_n45_2x2_A: object('rockledge_bend_n45', '2x2', 'GG_Cave_Ink'),
          rockledge_end_1x1_A: object('rockledge_end', '1x1', 'GG_Cave_Ink'),
          ledge_1x2_A: object('ledge', '1x2', 'GG_Cave_Ink'),
          ledge_1x4_A: object('ledge', '1x4', 'GG_Cave_Ink'),
          ledge_bend_45_1x1_A: object('ledge_bend_45', '1x1', 'GG_Cave_Ink'),
          ledge_bend_90_2x2_A: object('ledge_bend_90', '2x2', 'GG_Cave_Ink'),
          ledge_end_tail_1x1_A: object('ledge_end_tail', '1x1', 'GG_Cave_Ink'),
          contour_1x2_A: object('contour', '1x2', 'GG_Cave_Ink'),
          contour_1x4_A: object('contour', '1x4', 'GG_Cave_Ink'),
          contour_bend_90_2x2_A: object('contour_bend_90', '2x2', 'GG_Cave_Ink'),
          // Face tiles, listed ahead of the ground: a painted border never takes one.
          face_stone_4x4_floor_A: { type: 'floor', material: 'face_stone', gridSize: '4x4', set: 'GG_Wild_Faces', tags: ['face', 'stone'] },
          face_dirt_4x4_floor_A: { type: 'floor', material: 'face_dirt', gridSize: '4x4', set: 'GG_Wild_Faces', tags: ['face', 'dirt'] },
          face_grass_4x4_floor_A: { type: 'floor', material: 'face_grass', gridSize: '4x4', set: 'GG_Wild_Faces', tags: ['face', 'grass'] },
          wild_dirt_8x8_floor_A: { type: 'floor', material: 'wild_dirt', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'dirt'] },
          wild_grass_dark_8x8_floor_A: { type: 'floor', material: 'wild_grass_dark', gridSize: '8x8', set: 'GG_Wild_Ground', tags: ['outdoor', 'grass'] },
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
import { blurPasses, borderWidthOf, FACE_DEPTH_WANDER, faceDepth, faceReach, TOP_SEAM } from '../shared/plateauShade';
import { useStore } from '../store/store';
import { faceTiles, floorTextureEntries } from '../assets/materialKit';
import { rampAlphaAt, sampleRamp } from './rampMask';
import { ledgePieces } from '../assets/caveWallKit';
import { bandHoles } from './caveWalk';
import { bandRide, CURVE_STEP, layBandChain, layBandRing, LIVE_WALK } from './caveBandRenderer';
import { kitOut, resampleClosed, walkClosed } from './caveWalk';
import {
  borderTextureChoices,
  cliffArt,
  cliffArtChoices,
  cliffChoice,
  cliffPieces,
  isPaintedBorder,
  paintedBorderArt,
  paintedBorderTexture,
} from './plateauKit';
import {
  faceShade,
  layerSlopes,
  paintedBorderRamp,
  plateauTopFills,
  plateauTopTiles,
  renderPlateaus,
  shadeCliffs,
  slopeFaceTiles,
  SHADE_FLOOR,
  SHADE_SIDE,
  type TopFill,
} from './plateauRenderer';
import { plateauGridRegions, redrawGrid } from './floorWallRenderer';
import type { LayerEntry } from './sceneGraph';
import {
  BLUR_WEIGHTS_5,
  CLIFF_SHADOW_ALPHA,
  cliffBlurStrength,
  cliffCaster,
  cliffShadowGeometry,
} from './shadowPass';
import { CASTER_HEIGHT, casterLook, shadowLook, type ShadowLook } from '../shared/shadows';
import { skyFrame } from '../shared/sky';
import type { MapEnvironment } from '../shared/world';
import type { DungeonLayer, PlateauChild, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { edgeRuns, layerPlateaus, pointInPoly } from '../shared/plateaus';

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
  it('offers Cave rock (the default, stored as nothing), Cave ink line and Painted border', () => {
    expect(cliffArtChoices().map((c) => [c.value, c.label])).toEqual([
      [undefined, 'Cave rock'],
      ['GG_Cave_Ink:ledge', 'Cave ink line'],
      ['paint', 'Painted border'],
    ]);
    // A bare set id from before the choice is that set's rock row.
    expect(cliffChoice(undefined)).toEqual({ setId: 'GG_Cave_Ink', family: 'rockledge' });
    expect(cliffChoice('GG_Cave_Ink')).toEqual({ setId: 'GG_Cave_Ink', family: 'rockledge' });
    expect(cliffChoice('GG_Cave_Ink:ledge')).toEqual({ setId: 'GG_Cave_Ink', family: 'ledge' });
  });

  it('offers a second band set’s rock row too, each label led by its set', () => {
    const shipped = manager.getPackManifests;
    const second = {
      packId: 'more-caves',
      manifest: {
        entries: Object.fromEntries(
          [
            ['wall_short', '2x2'],
            ['inside_bend', '2x2'],
            ['outside_bend', '2x2'],
            ['rockledge', '1x2'],
            ['rockledge', '1x4'],
            ['rockledge_bend_90', '2x2'],
          ].map(([m, g]) => [`${m}_${g}_A`, object(m, g, 'GG_Deep_Cave')]),
        ),
      },
    };
    manager.getPackManifests = () => [...shipped(), second] as ReturnType<typeof shipped>;
    manager.catalogVersion += 1;
    try {
      expect(cliffArtChoices().map((c) => [c.value, c.label])).toEqual([
        [undefined, 'Cave Ink · Cave rock'],
        ['GG_Cave_Ink:ledge', 'Cave Ink · Cave ink line'],
        ['GG_Deep_Cave:rockledge', 'Deep Cave · Cave rock'],
        ['paint', 'Painted border'],
      ]);
    } finally {
      manager.getPackManifests = shipped;
      manager.catalogVersion += 1;
    }
  });

  it('lays Cave rock with its bends of both hands as drawn, never reversed', () => {
    const kit = cliffArt(undefined);
    expect([...kit.keys()].sort()).toEqual([
      'rockledge_1x2',
      'rockledge_1x4',
      'rockledge_bend_45_2x2',
      'rockledge_bend_90_2x2',
      'rockledge_bend_n45_2x2',
      'rockledge_bend_n90_2x2',
      'rockledge_end_1x1',
    ]);
    const pieces = cliffPieces(kit);
    expect(pieces.every((p) => p.key.startsWith('rockledge_') && !p.key.startsWith('rockledge_end_'))).toBe(true);
    // Each bend once, at its own measured turn: n90 turns -90, 90 turns +90.
    const bends = pieces.filter((p) => p.turnDeg !== 0).map((p) => `${p.key}:${p.turnDeg}`).sort();
    expect(bends).toEqual(['rockledge_bend_45_2x2:45', 'rockledge_bend_90_2x2:90', 'rockledge_bend_n45_2x2:-45', 'rockledge_bend_n90_2x2:-90']);
  });

  it('lays Cave ink line with its own straights and bends, each bend also reversed', () => {
    const kit = cliffArt('GG_Cave_Ink:ledge');
    expect([...kit.keys()].sort()).toEqual(['ledge_1x2', 'ledge_1x4', 'ledge_bend_45_1x1', 'ledge_bend_90_2x2', 'ledge_end_tail_1x1']);
    const pieces = cliffPieces(kit, 'GG_Cave_Ink:ledge');
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

  const findLabel = (c: Container, label: string): Container | undefined =>
    c.label === label ? c : c.children.map((k) => findLabel(k as Container, label)).find(Boolean);
  const slopeOf = (extra: Partial<PlateauChild>) => {
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 2, edge: 'slope', ...extra })]), new Container(), parent);
    return parent;
  };
  /** That `at` is as far as a face of a drop of `drop` reaches, give or take its wander. */
  const asDeep = (at: number, drop: number) => {
    expect(at).toBeGreaterThan(faceDepth(drop) * (1 - FACE_DEPTH_WANDER) - 1e-3);
    expect(at).toBeLessThan(faceReach(drop) + 1e-3);
  };

  it('draws a slope as a side face on one side: ledge bands, its foot and ledge lines, and the rim', () => {
    const parent = slopeOf({ faceDir: 90 });
    const names = labels(parent);
    for (const label of ['plateau-slope-face', 'plateau-slope-lines', 'plateau-slope-rim']) expect(names).toContain(label);
    // The bands hang off the bottom edge only, as deep as a drop of 2 says, give or take.
    const face = findLabel(parent, 'plateau-slope-face')!.getLocalBounds();
    expect(face.minY).toBeCloseTo(11, 2);
    asDeep(face.maxY - 11, 2);
    expect(face.minX).toBeCloseTo(5, 2);
    expect(face.maxX).toBeCloseTo(11, 2);
    // No contour art and no slope sprites: it is drawn, not laid. (The drop shade's ramp is a sprite of its own.)
    const sprites: Container[] = [];
    const walk = (c: Container) => {
      if ((c instanceof Sprite && c.label !== 'ramp') || (c instanceof Mesh && c.label !== 'ramp')) sprites.push(c);
      for (const k of c.children) walk(k as Container);
    };
    walk(parent);
    expect(sprites).toEqual([]);
  });

  it('turns its face the plateau’s own way, else the map’s, never the sun’s', () => {
    useStore.setState((s) => {
      s.mapSettings.faceDirection = 0;
    });
    try {
      const right = findLabel(slopeOf({}), 'plateau-slope-face')!.getLocalBounds();
      expect(right.minX).toBeCloseTo(11, 2);
      asDeep(right.maxX - 11, 2);
      const own = findLabel(slopeOf({ faceDir: 270 }), 'plateau-slope-face')!.getLocalBounds();
      expect(own.maxY).toBeCloseTo(5, 2);
      asDeep(5 - own.minY, 2);
      // The sun moving re-lights nothing on it.
      const parent = slopeOf({});
      const shade = findLabel(parent, 'plateau-slope-face')!;
      shadeCliffs('l1', { dx: 1, dy: 0, length: 2, alpha: 0.4, color: '#000000' });
      expect(shade.alpha).toBe(1);
      expect(shade.tint).toBe(0xffffff);
    } finally {
      useStore.setState((s) => {
        delete s.mapSettings.faceDirection;
      });
    }
  });

  it('draws the lines between ledge bands unless Ledge lines is off; the foot line stays', () => {
    const strokes = (extra: Partial<PlateauChild>) =>
      (findLabel(slopeOf({ faceDir: 90, ...extra }), 'plateau-slope-lines') as Graphics).context.instructions.length;
    expect(strokes({})).toBeGreaterThan(strokes({ contourLines: false }));
    expect(strokes({ contourLines: false })).toBeGreaterThan(0);
  });

  it('keeps the drop shade off its own face', () => {
    const layer = layerOf([ground, plat('hill', 5, 5, 11, 11, { height: 2, edge: 'slope', faceDir: 90 })]);
    const { faces } = layerSlopes(layer);
    expect(faces).toHaveLength(1);
    const parent = new Container();
    renderPlateaus(layer, new Container(), parent);
    const mask = findLabel(parent, 'plateau-shade-mask') as Graphics;
    // The mask's region is the land less the face: a point on the face is outside it.
    expect(mask.containsPoint({ x: 8, y: 11 + faceDepth(2) / 2 })).toBe(false);
    expect(mask.containsPoint({ x: 4.9, y: 8 })).toBe(true);
  });

  it('offers the face tiles in the Face picker’s order, and keeps them out of every other list of floors', () => {
    expect(faceTiles()).toEqual([
      { id: 'gg-forge:face_grass_4x4_floor_A', label: 'Grass' },
      { id: 'gg-forge:face_dirt_4x4_floor_A', label: 'Dirt' },
      { id: 'gg-forge:face_stone_4x4_floor_A', label: 'Stone' },
    ]);
    expect(floorTextureEntries().some((e) => e.tags.includes('face'))).toBe(false);
    expect(floorTextureEntries().length).toBeGreaterThan(0);
    // A painted border's default dirt is the ground's, not the dirt face tile.
    expect(paintedBorderTexture('paint')).toBe('gg-forge:wild_dirt_8x8_floor_A');
  });

  it('lists a face for its texture only when the plateau has one', () => {
    const plain = plat('hill', 5, 5, 11, 11, { height: 1, edge: 'slope', faceDir: 90 });
    expect(slopeFaceTiles(layerOf([ground, plain])).size).toBe(0);
    const stone = { ...plain, faceArt: 'gg-forge:face_stone_4x4_floor_A' };
    const tiles = slopeFaceTiles(layerOf([ground, stone]));
    expect([...tiles.keys()]).toEqual([stone]);
    const pts = [...tiles.values()][0].flat();
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(11, 2);
    asDeep(Math.max(...pts.map((p) => p[1])) - 11, 1);
    // A cliff has no face.
    expect(slopeFaceTiles(layerOf([ground, { ...stone, edge: 'cliff' }])).size).toBe(0);
  });

  it('shades a face tile by its own light: the upper band lifted by an added wash, the lowest darkened', () => {
    const tiled = slopeOf({ faceDir: 90, faceArt: 'gg-forge:face_stone_4x4_floor_A' });
    const lift = findLabel(tiled, 'plateau-slope-lift') as Graphics;
    expect(lift.blendMode).toBe('add');
    // The lift lies on the upper band only, at the rim.
    const up = lift.getLocalBounds();
    expect(up.minY).toBeCloseTo(11, 2);
    expect(up.maxY).toBeLessThan(11 + faceDepth(2) * 0.6);
    // Over plain ground there is no lift: the bands only darken.
    expect(findLabel(slopeOf({ faceDir: 90 }), 'plateau-slope-lift')).toBeUndefined();
  });

  describe('on a layer with a walled floor', () => {
    // A walled floor in one corner: the layer's merged floor is all it covers.
    const room: Polygon = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const withRoom = (children: DungeonLayer['children']) => ({ ...layerOf(children), mergedFloor: [room] }) as DungeonLayer;
    const hill = plat('hill', 10, 10, 16, 16, { height: 2, edge: 'slope', faceDir: 90, faceArt: 'gg-forge:face_stone_4x4_floor_A' });
    const drawn = (layer: DungeonLayer) => {
      const parent = new Container();
      renderPlateaus(layer, new Container(), parent);
      return parent;
    };
    const faceDrawn = (layer: DungeonLayer) => {
      const tiles = slopeFaceTiles(layer).get(hill) ?? [];
      const parent = drawn(layer);
      const lines = findLabel(parent, 'plateau-slope-lines') as Graphics | undefined;
      const mask = findLabel(parent, 'plateau-slope-mask') as Graphics | undefined;
      return {
        tile: tiles.flat().length > 0,
        bands: !!findLabel(parent, 'plateau-slope-face') && (findLabel(parent, 'plateau-slope-face') as Graphics).context.instructions.length > 0,
        // The lines are kept to the land under their mask: the face's middle must be on it.
        lines: !!lines && lines.context.instructions.length > 0 && !!mask && mask.containsPoint({ x: 13, y: 16 + faceDepth(2) / 2 }),
      };
    };
    /** A sized 30 x 30 map with a base ground, or neither. */
    const setGround = (textureId: string | undefined) =>
      useStore.setState((s) => {
        s.mapSettings.ground = textureId ? { textureId } : undefined;
        s.mapSettings.fixedSize = textureId ? { width: 30, height: 30, locked: true } : null;
      });

    it('draws a slope’s face on the base ground beside it: tile, bands and lines', () => {
      setGround('gg-forge:wild_dirt_8x8_floor_A');
      try {
        expect(faceDrawn(withRoom([rect('room', 0, 0, 4, 4), hill]))).toEqual({ tile: true, bands: true, lines: true });
      } finally {
        setGround(undefined);
      }
    });

    it('draws it on a ground piece beside it too', () => {
      const piece = rect('grass', 8, 8, 20, 20, { ground: true });
      expect(faceDrawn(withRoom([rect('room', 0, 0, 4, 4), piece, hill]))).toEqual({ tile: true, bands: true, lines: true });
    });

    it('keeps a face half over the void off the void', () => {
      // The hill's left half stands on a ground piece; its right half's face would hang over nothing.
      const piece = rect('grass', 8, 8, 13, 20, { ground: true });
      const layer = withRoom([rect('room', 0, 0, 4, 4), piece, hill]);
      const pts = (slopeFaceTiles(layer).get(hill) ?? []).flat();
      expect(pts.length).toBeGreaterThan(0);
      for (const [x] of pts) expect(x).toBeLessThanOrEqual(13 + 1e-6);
      expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(10, 2);
    });

    it('lets a cliff’s contact shade land on the base ground beside it', () => {
      setGround('gg-forge:wild_dirt_8x8_floor_A');
      try {
        const parent = drawn(withRoom([rect('room', 0, 0, 4, 4), plat('rock', 10, 10, 16, 16, { height: 2, edge: 'cliff' })]));
        const mask = findLabel(parent, 'plateau-shade-mask') as Graphics;
        expect(mask.containsPoint({ x: 16.1, y: 13 })).toBe(true);
      } finally {
        setGround(undefined);
      }
    });
  });

  it('shows a higher band’s face whole over a lower one: nothing of the lower face under it', () => {
    const stone = 'gg-forge:face_stone_4x4_floor_A';
    const hill = plat('hill', 10, 10, 20, 20, { height: 1, edge: 'slope', faceDir: 90, faceArt: stone });
    // A summit at 2 near the hill's bottom rim: its face hangs over the hill's.
    const summit = plat('summit', 12, 15, 18, 19.9, { height: 2, edge: 'slope', faceDir: 90, faceArt: stone });
    const layer = layerOf([ground, hill, summit]);
    const { faces } = layerSlopes(layer);
    const low = faces.find((f) => f.run.owner === hill)!;
    const high = faces.find((f) => f.run.owner === summit)!;
    const inside = (rings: Polygon[], p: [number, number]) => rings.filter((r) => pointInPoly(p[0], p[1], r)).length % 2 === 1;
    // Under the summit's face, on the hill's: only the summit's shows, tile and bands.
    expect(inside(low.face.region, [15, 20.15])).toBe(true);
    expect(inside(high.region, [15, 20.15])).toBe(true);
    expect(inside(low.region, [15, 20.15])).toBe(false);
    expect(low.bands.some((b) => inside(b, [15, 20.15]))).toBe(false);
    expect(inside(slopeFaceTiles(layer).get(hill)!, [15, 20.15])).toBe(false);
    expect(low.over.length).toBeGreaterThan(0);
    expect(high.over).toEqual([]);
    // Clear of it, the hill's face is whole.
    expect(inside(low.region, [11, 20.15])).toBe(true);
    // Its lines are masked off the summit's face too.
    const parent = new Container();
    renderPlateaus(layer, new Container(), parent);
    const band1 = parent.children.find((c) => c.label === 'plateau-band-1') as Container;
    const mask = findLabel(band1, 'plateau-slope-mask') as Graphics;
    expect(mask.containsPoint({ x: 15, y: 20.15 })).toBe(false);
    expect(mask.containsPoint({ x: 11, y: 20.15 })).toBe(true);
  });

  describe('a textured top', () => {
    const stone = 'gg-forge:stone_floor_A';
    const inside = (rings: Polygon[] | undefined, p: [number, number]) => (rings ?? []).filter((r) => pointInPoly(p[0], p[1], r)).length % 2 === 1;

    it('covers its own outline, holes kept; a Ground top has none', () => {
      const ring = plat('ring', 4, 4, 14, 14, { height: 1, topArt: stone });
      ring.contours.push([[7, 7], [11, 7], [11, 11], [7, 11]]);
      const tops = plateauTopTiles(layerOf([ground, ring]));
      expect(inside(tops.get(ring), [5, 5])).toBe(true);
      expect(inside(tops.get(ring), [9, 9])).toBe(false);
      expect(plateauTopTiles(layerOf([ground, plat('bare', 4, 4, 14, 14, { height: 1 })])).size).toBe(0);
    });

    it('is cut by a plateau of another level that wins over it with a top of its own, and shows through under a Ground one', () => {
      const mesa = plat('mesa', 4, 4, 20, 20, { height: 1, topArt: stone });
      const tiled = plat('tiled', 6, 6, 10, 10, { height: 2, topArt: 'gg-forge:wild_grass_8x8_floor_A' });
      const bare = plat('bare', 12, 12, 16, 16, { height: 2 });
      const tops = plateauTopTiles(layerOf([ground, mesa, tiled, bare]));
      expect(inside(tops.get(mesa), [8, 8])).toBe(false);
      expect(inside(tops.get(tiled), [8, 8])).toBe(true);
      expect(inside(tops.get(mesa), [14, 14])).toBe(true);
      expect(tops.has(bare)).toBe(false);
      // In draw order: the one it stands in first.
      expect([...tops.keys()]).toEqual([mesa, tiled]);
    });

    it('is cut by the face of a higher band lying on it', () => {
      const mesa = plat('mesa', 4, 4, 20, 20, { height: 1, topArt: stone });
      const summit = plat('summit', 8, 8, 12, 12, { height: 2, edge: 'slope', faceDir: 90 });
      const tops = plateauTopTiles(layerOf([ground, mesa, summit]));
      expect(inside(tops.get(mesa), [10, 12.3])).toBe(false);
      expect(inside(tops.get(mesa), [10, 14])).toBe(true);
    });
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

});

describe('a painted border', () => {
  const DIRT = 'gg-forge:wild_dirt_8x8_floor_A';
  const DARK = 'gg-forge:wild_grass_dark_8x8_floor_A';
  const runOf = (p: PlateauChild) => edgeRuns(layerPlateaus(layerOf([ground, p])).bands[0])[0];

  it('is stored in edgeArt: paint takes the dirt floor, paint:<id> names one; it lays no ledge', () => {
    expect(isPaintedBorder('paint')).toBe(true);
    expect(isPaintedBorder(paintedBorderArt(DARK))).toBe(true);
    expect(isPaintedBorder(undefined)).toBe(false);
    expect(isPaintedBorder('GG_Cave_Ink:ledge')).toBe(false);
    expect(paintedBorderTexture('paint')).toBe(DIRT);
    expect(paintedBorderTexture(paintedBorderArt(DARK))).toBe(DARK);
    expect(paintedBorderTexture('GG_Cave_Ink:ledge')).toBeUndefined();
    // It names no ledge: should the edge turn back to plain cliff art, that is Cave rock.
    expect(cliffChoice(paintedBorderArt(DARK))).toEqual({ setId: 'GG_Cave_Ink', family: 'rockledge' });
    expect(borderTextureChoices()).toEqual([
      { value: DIRT, label: 'Dirt' },
      { value: DARK, label: 'Darker grass' },
    ]);
  });

  it('is 0.75 cells wide unless set, kept to 0.25 to 3', () => {
    expect(borderWidthOf(undefined)).toBe(0.75);
    expect(borderWidthOf(1.5)).toBe(1.5);
    expect(borderWidthOf(0.1)).toBe(0.25);
    expect(borderWidthOf(9)).toBe(3);
  });

  it('draws its texture into the tops under the lift, no ledge sprites or ink, and keeps the drop shade', () => {
    const parent = new Container();
    const tops = new Container();
    renderPlateaus(layerOf([ground, plat('top', 5, 5, 11, 11, { height: 2, edge: 'cliff', edgeArt: paintedBorderArt(DARK) })]), tops, parent);
    expect(tops.children.map((c) => c.label)).toEqual(['plateau-border', 'plateau-top-2']);
    const fills = (c: Container): number => c.children.reduce((n, ch) => n + (ch instanceof TilingSprite ? 1 : ch instanceof Container ? fills(ch) : 0), 0);
    // One fill, faded by its ramp.
    expect(fills(tops.children[0] as Container)).toBe(1);
    const names = labels(parent);
    expect(names).toContain('plateau-drop-shade');
    for (const gone of ['plateau-cliff', 'plateau-top-line', 'plateau-cliff-ink', 'plateau-border']) expect(names).not.toContain(gone);
  });

  it('leaves the default cliff as it was: no border, its ledge rock laid', () => {
    const parent = new Container();
    const tops = new Container();
    renderPlateaus(layerOf([ground, plat('top', 5, 5, 11, 11, { height: 2, edge: 'cliff' })]), tops, parent);
    expect(tops.children.map((c) => c.label)).toEqual(['plateau-top-2']);
    expect(labels(parent)).toContain('plateau-cliff');
  });

  it('lays a raised band inside the outline: solid on the edge, its inner edge wandering within a third of its width', () => {
    const ramp = paintedBorderRamp(runOf(plat('top', 5, 5, 11, 11, { height: 2, edge: 'cliff', edgeArt: 'paint' })), 0.75)!;
    const alpha = (x: number, y: number) => rampAlphaAt(ramp, [x, y]);
    // How far in the whole band reaches along the west side, sampled down it.
    const depth = (y: number) => {
      let x = 5;
      while (x < 8 && alpha(x + 0.01, y) > 1e-3) x += 0.01;
      return x - 5;
    };
    const depths = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map(depth);
    // 0.75 ± a third of it, and not even: the inner edge wanders.
    for (const d of depths) {
      expect(d).toBeGreaterThanOrEqual(0.5 - 0.02);
      expect(d).toBeLessThanOrEqual(1 + 0.02);
    }
    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(0.05);
    // Solid on the edge all the way along.
    for (let y = 5.5; y < 10.6; y += 0.5) expect(alpha(5.1, y)).toBeCloseTo(1, 2);
    // Never outside the outline, never across the middle.
    expect(alpha(4.9, 8)).toBe(0);
    expect(alpha(8, 8)).toBe(0);
  });

  it('wanders the same way every redraw of one plateau, another way for another', () => {
    const at = (id: string) => [...paintedBorderRamp(runOf(plat(id, 5, 5, 11, 11, { height: 2, edge: 'cliff', edgeArt: 'paint' })), 0.75)!.field.alpha];
    expect(at('top')).toEqual(at('top'));
    expect(at('other')).not.toEqual(at('top'));
  });

  it('draws a thin ink edge line along the outline unless switched off; other cliff art draws none', () => {
    const edgeLines = (extra: Partial<PlateauChild>) => {
      const parent = new Container();
      renderPlateaus(layerOf([ground, plat('top', 5, 5, 11, 11, { height: 2, edge: 'cliff', ...extra })]), new Container(), parent);
      return labels(parent).filter((l) => l === 'plateau-edge-line').length;
    };
    expect(edgeLines({ edgeArt: 'paint' })).toBe(1);
    expect(edgeLines({ edgeArt: 'paint', contourLines: false })).toBe(0);
    expect(edgeLines({})).toBe(0);
  });

  it('lays a pit’s band on its high side, outside the ring', () => {
    const ramp = paintedBorderRamp(runOf(plat('pit', 5, 5, 11, 11, { height: -2, edge: 'cliff', edgeArt: 'paint' })), 0.75)!;
    // 0.75 out, give or take its wobble of a third of that.
    expect(rampAlphaAt(ramp, [4.6, 8])).toBeGreaterThan(0);
    expect(rampAlphaAt(ramp, [3.95, 8])).toBe(0);
    expect(rampAlphaAt(ramp, [5.5, 8])).toBe(0);
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
  /** The sprites laid, the drop shade's ramp aside. */
  const spritesIn = (c: Container): number =>
    c.children.reduce((n, ch) => n + (ch instanceof Sprite ? (ch.label === 'ramp' ? 0 : 1) : ch instanceof Container ? spritesIn(ch) : 0), 0);

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
      const passes = blurPasses(strength);
      const sum = [...Array(passes).keys()].reduce((acc, i) => acc + 0.25 ** i, 0);
      const n = 4000;
      let row: number[] = Array.from({ length: n }, (_, i) => (i < n / 2 ? CLIFF_SHADOW_ALPHA : 0));
      const at = (r: number[], x: number) => {
        const c = Math.max(0, Math.min(n - 1, x));
        const i = Math.floor(c);
        const t = c - i;
        return r[i] * (1 - t) + r[Math.min(n - 1, i + 1)] * t;
      };
      const w = [BLUR_WEIGHTS_5[2], BLUR_WEIGHTS_5[1], BLUR_WEIGHTS_5[0], BLUR_WEIGHTS_5[1], BLUR_WEIGHTS_5[2]];
      for (let pass = 0, u = strength / Math.sqrt(sum); pass < passes; pass++, u /= 2) {
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
    const at = (map: MapEnvironment) => cliffCaster(skyFrame({ ...map, time: 'day' }), map);
    for (const map of [{ environment: 'indoor' }, { environment: 'outdoor', naturalLight: false }] as MapEnvironment[]) {
      const { sun, strength } = at(map);
      expect(sun.kind).toBe('sun');
      expect(sun.altitude).toBe(35);
      expect(strength).toBeCloseTo(0.7);
    }
    expect(at({ environment: 'outdoor' }).strength).toBe(1);
    // A sky whose light is out (below the horizon) casts from the fixed sun too.
    const dark = cliffCaster(
      { ...skyFrame({ environment: 'outdoor', time: 'day' }), sun: { azimuth: 90, altitude: -5, intensity: 0, kind: 'sun' } },
      { environment: 'outdoor' },
    );
    expect(dark.sun.azimuth).toBe(225);
    expect(dark.strength).toBeCloseTo(0.7);
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

  it('a slope casts as a cliff does, from the foot of its face where the face lies on the lee side', () => {
    // The face points along the shadow (+x): the shadow starts where the face ends.
    const layer = layerOf([ground, plat('hill', 10, 10, 14, 14, { height: 2, edge: 'slope', faceDir: 0 })]);
    const pts = points(cliffShadowGeometry(layer, look, groundRing));
    expect(pts.length).toBeGreaterThan(0);
    // Away from the corners, where the face eases into the rim and the shadow meets the edge.
    const middle = pts.filter(([, y]) => y > 11 && y < 13);
    expect(middle.length).toBeGreaterThan(0);
    for (const [x] of middle) expect(x).toBeGreaterThanOrEqual(14 + faceDepth(2) * (1 - FACE_DEPTH_WANDER) - 0.01);
    expect(Math.min(...pts.map((p) => p[0]))).toBeGreaterThanOrEqual(14 - 1e-6);
    // Pointing away from it, the shadow starts on the edge itself.
    const away = points(cliffShadowGeometry(layerOf([ground, plat('hill', 10, 10, 14, 14, { height: 2, edge: 'slope', faceDir: 180 })]), look, groundRing));
    expect(Math.min(...away.map((p) => p[0]))).toBeCloseTo(14, 2);
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

  it('reaches 0.15 + 0.06 a cell of drop out (a contact shade), wider at +3 than at +1, and inward for a pit', () => {
    const reach = (height: number) => {
      const parent = new Container();
      renderPlateaus(layerOf([ground, plat('top', 10, 10, 16, 16, { height, edge: 'none' })]), new Container(), parent);
      const soft = shadeOf(parent.children[0] as Container)[0].children[0] as Container;
      const g = soft.children.find((c) => c.label === 'plateau-drop-shade') as Container;
      const ramp = g.children.find((c) => c.label === 'ramp') as Sprite;
      // The furthest texel east of the plateau the shade still darkens, across its middle.
      const source = ramp.texture.source as BufferImageSource;
      const bytes = source.resource as Uint8Array;
      const res = 1 / ramp.scale.x;
      const row = Math.floor((13 - ramp.y) * res);
      let last = 0;
      for (let i = 0; i < source.width; i++) if (bytes[(row * source.width + i) * 4 + 3] > 0) last = i;
      return { maxX: ramp.x + (last + 1) / res };
    };
    expect(reach(1).maxX - 16).toBeCloseTo(0.21, 1);
    expect(reach(3).maxX - 16).toBeCloseTo(0.33, 1);
    expect(reach(3).maxX - 16).toBeLessThanOrEqual(1 / 3 + 0.1);
    expect(reach(3).maxX).toBeGreaterThan(reach(1).maxX + 0.1);
    // A pit shades inside its rim: its mask is the pit's own floor.
    const parent = new Container();
    renderPlateaus(layerOf([ground, plat('pit', 10, 10, 16, 16, { height: -2, edge: 'none' })]), new Container(), parent);
    const mask = shadeOf(parent.children[0] as Container)[0].mask as Graphics;
    const b = mask.getLocalBounds();
    expect([b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 100) / 100)).toEqual([10, 10, 16, 16]);
  });
});

describe('grid lines over plateau textures', () => {
  const DIRT = 'gg-forge:wild_dirt_8x8_floor_A';
  const STONE = 'gg-forge:face_stone_4x4_floor_A';
  const gridOf = (layer: DungeonLayer) => {
    const entry = { sublayers: { grid: new Container() } } as unknown as LayerEntry;
    redrawGrid(layer, entry);
    return entry.sublayers!.grid;
  };

  beforeEach(() => {
    useStore.getState().setMapGround({ textureId: 'gg-forge:wild_grass_dark_8x8_floor_A' });
    useStore.getState().setFixedSize({ width: 30, height: 30, locked: true });
  });
  afterEach(() => {
    useStore.getState().setMapGround(null);
    useStore.getState().setFixedSize(null);
  });

  it('a layer with only a textured plateau on the base ground is lined over its top and its face', () => {
    const hill = plat('hill', 5, 5, 11, 11, { height: 1, edge: 'slope', faceDir: 90, topArt: DIRT, faceArt: STONE });
    const layer = layerOf([hill]);
    expect(plateauGridRegions(layer)).toHaveLength(2);
    const grid = gridOf(layer);
    expect(grid.children).toHaveLength(1);
    const mask = (grid.children[0] as Container).mask as Graphics;
    expect(mask.containsPoint({ x: 8, y: 8 })).toBe(true);
    expect(mask.containsPoint({ x: 8, y: 11.15 })).toBe(true);
    expect(mask.containsPoint({ x: 3, y: 3 })).toBe(false);
    // Kept while the layer is the same.
    expect(plateauGridRegions(layer)[0]).toBe(plateauGridRegions(layer)[0]);
  });

  it('a Ground top adds none, nor a face with no texture', () => {
    const layer = layerOf([plat('hill', 5, 5, 11, 11, { height: 1, edge: 'slope', faceDir: 90 })]);
    expect(plateauGridRegions(layer)).toEqual([]);
    expect(gridOf(layer).children).toHaveLength(0);
  });
});

describe('a soft seam between tops of one height', () => {
  const DIRT = 'gg-forge:wild_dirt_8x8_floor_A';
  const GRASS = 'gg-forge:wild_grass_dark_8x8_floor_A';
  const inR = (rings: readonly Polygon[], p: [number, number]) => rings.filter((r) => pointInPoly(p[0], p[1], r)).length % 2 === 1;
  /** How opaque the texture is at `p`: inside its rings, its ramp where it fades, else 1; 0 out. */
  const opacity = (fill: TopFill, p: [number, number]) =>
    !inR(fill.rings, p) ? 0 : fill.soft ? sampleRamp(fill.soft, p[0], p[1]) : 1;

  it('side by side: the later fades in along the seam and not on the rim, the earlier runs on under it', () => {
    const a = plat('a', 2, 2, 10, 10, { topArt: DIRT });
    const b = plat('b', 10, 3, 18, 9, { topArt: GRASS });
    const layer = layerOf([ground, a, b]);
    const fills = plateauTopFills(layer);
    const fa = fills.get(a)!;
    const fb = fills.get(b)!;
    expect([fb.fades.length, fb.grows.length, fa.fades.length, fa.grows.length]).toEqual([1, 0, 0, 1]);
    // b: nothing on the seam, part way across it, full past it and all along its rim.
    // As good as nothing a hair in from the seam: the ramp starts at nothing on it.
    expect(opacity(fb, [10.03, 6])).toBeLessThan(0.02);
    const mid = opacity(fb, [10 + TOP_SEAM / 2, 6]);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(opacity(fb, [10 + TOP_SEAM + 0.3, 6])).toBeCloseTo(1, 6);
    expect(opacity(fb, [17.97, 6])).toBeCloseTo(1, 6);
    expect(opacity(fb, [14, 3.03])).toBeCloseTo(1, 6);
    expect(opacity(fb, [14, 8.97])).toBeCloseTo(1, 6);
    // a: crisp, grown TOP_SEAM under b and no further, never out of the band.
    expect(fa.soft).toBeNull();
    expect(inR(fa.rings, [10.5, 6])).toBe(true);
    expect(inR(fa.rings, [10 + TOP_SEAM + 0.1, 6])).toBe(false);
    expect(inR(fa.rings, [10.3, 2.7])).toBe(false);
    // The grid and the Material brush keep a's own top.
    expect(inR(plateauTopTiles(layer).get(a)!, [10.5, 6])).toBe(false);
  });

  it('overlapping: the later fades in along its outline inside the earlier, the earlier has no fade', () => {
    const a = plat('a', 2, 2, 10, 10, { topArt: DIRT });
    const b = plat('b', 8, 4, 16, 8, { topArt: GRASS });
    const fills = plateauTopFills(layerOf([ground, a, b]));
    const fa = fills.get(a)!;
    const fb = fills.get(b)!;
    expect([fb.fades.length, fb.grows.length, fa.fades.length, fa.grows.length]).toEqual([1, 0, 0, 1]);
    expect(opacity(fb, [8.03, 6])).toBeLessThan(0.02);
    expect(opacity(fb, [9.5, 6])).toBeCloseTo(1, 6);
    expect(opacity(fb, [12, 4.03])).toBeCloseTo(1, 6);
    expect(opacity(fb, [15.97, 6])).toBeCloseTo(1, 6);
    expect(fa.soft).toBeNull();
  });

  it('a textured top against a Ground top fades, whichever comes first', () => {
    const a = plat('a', 2, 2, 10, 10, { topArt: DIRT });
    const b = plat('b', 10, 3, 18, 9);
    const fa = plateauTopFills(layerOf([ground, a, b])).get(a)!;
    expect([fa.fades.length, fa.grows.length]).toEqual([1, 0]);
    expect(opacity(fa, [9.97, 6])).toBeLessThan(0.02);
    expect(opacity(fa, [6, 9.97])).toBeCloseTo(1, 6);
    const later = { ...a, id: 'a2' };
    const fl = plateauTopFills(layerOf([ground, b, later])).get(later)!;
    expect([fl.fades.length, fl.grows.length]).toEqual([1, 0]);
  });

  it('a lone plateau has no seam and draws exactly as before', () => {
    const a = plat('a', 2, 2, 10, 10, { topArt: DIRT });
    const layer = layerOf([ground, a]);
    const fill = plateauTopFills(layer).get(a)!;
    expect(fill).toEqual({ rings: plateauTopTiles(layer).get(a), soft: null, fades: [], grows: [] });
    expect(fill.rings).toBe(plateauTopTiles(layer).get(a));
    // Worked out once.
    expect(plateauTopFills(layer)).toBe(plateauTopFills(layer));
  });

  it('keeps the cut by a higher band hard, on the faded top and on the grown one', () => {
    const a = plat('a', 2, 2, 10, 10, { topArt: DIRT });
    const b = plat('b', 10, 3, 18, 9, { topArt: GRASS });
    const c = plat('c', 10.2, 4, 14, 8, { height: 2, topArt: DIRT });
    const fills = plateauTopFills(layerOf([ground, a, b, c]));
    const fa = fills.get(a)!;
    const fb = fills.get(b)!;
    // c stands at 2 on b, a band higher: nothing of either lower top is drawn under it.
    expect(opacity(fb, [12, 6])).toBe(0);
    expect(opacity(fb, [14.1, 6])).toBeCloseTo(1, 6);
    expect(inR(fa.rings, [10.5, 6])).toBe(false);
    expect(inR(fa.rings, [10.1, 6])).toBe(true);
    expect(inR(fa.rings, [10.5, 3.5])).toBe(true);
  });
});

describe('a height is its own level, drawn', () => {
  const DIRT = 'gg-forge:wild_dirt_8x8_floor_A';
  const GRASS = 'gg-forge:wild_grass_dark_8x8_floor_A';
  const look: ShadowLook = { dx: 1, dy: 0, length: 1.2, alpha: 0.4, color: '#000000' };
  const groundRing: Polygon[] = [ground.contours[0] as Polygon];
  const inR = (rings: readonly Polygon[], p: [number, number]) => rings.filter((r) => pointInPoly(p[0], p[1], r)).length % 2 === 1;
  const opacity = (fill: TopFill, p: [number, number]) =>
    !inR(fill.rings, p) ? 0 : fill.soft ? sampleRamp(fill.soft, p[0], p[1]) : 1;
  const findLabel = (c: Container, label: string): Container | undefined =>
    c.label === label ? c : c.children.map((k) => findLabel(k as Container, label)).find(Boolean);
  const draw = (layer: DungeonLayer) => {
    const tops = new Container();
    const edges = new Container();
    renderPlateaus(layer, tops, edges);
    return { tops, edges };
  };
  const within = (rings: Polygon[], x0: number, y0: number, x1: number, y1: number) =>
    rings.flat().every(([x, y]) => x >= x0 - 1e-6 && x <= x1 + 1e-6 && y >= y0 - 1e-6 && y <= y1 + 1e-6);

  it('a +1 inside a +1 is one band: one lift tint, no edge, face or shadow between them, and a different top fades in all round', () => {
    const grass = plat('grass', 2, 2, 28, 28, { edge: 'slope', faceDir: 90, topArt: GRASS });
    const sand = plat('sand', 10, 10, 20, 20, { edge: 'slope', faceDir: 90, topArt: DIRT });
    const layer = layerOf([ground, grass, sand]);
    const { tops, edges } = draw(layer);
    expect(labels(tops).filter((l) => l.startsWith('plateau-top-'))).toEqual(['plateau-top-1']);
    expect((findLabel(tops, 'plateau-top-1') as Graphics).containsPoint({ x: 15, y: 15 })).toBe(true);
    expect(edges.children.map((c) => c.label)).toEqual(['plateau-band-1']);
    // Only the outer outline has an edge, so only it has a face, a rim and a shade.
    expect(layerSlopes(layer).faces.map((f) => f.run.owner)).toEqual([grass]);
    expect(edgeRuns(layerPlateaus(layer).bands[0]).map((r) => r.owner)).toEqual([grass]);
    const shadow = cliffShadowGeometry(layer, look, groundRing);
    expect(shadow.length).toBeGreaterThan(0);
    expect(inR(shadow, [20.3, 15])).toBe(false);
    // The sand fades in from its whole outline onto the grass, which runs on crisp under it.
    const fills = plateauTopFills(layer);
    const fs = fills.get(sand)!;
    const fg = fills.get(grass)!;
    expect(fs.grows).toEqual([]);
    expect(fs.fades.length).toBeGreaterThan(0);
    for (const p of [[10.03, 15], [19.97, 15], [15, 10.03], [15, 19.97]] as [number, number][]) expect(opacity(fs, p)).toBeLessThan(0.02);
    expect(opacity(fs, [15, 15])).toBeCloseTo(1, 6);
    expect(fg.soft).toBeNull();
    expect(inR(fg.rings, [15, 15])).toBe(true);
  });

  it('nested terraces 1, 2 and 3: each step’s face is the face of a drop of 1', () => {
    const slope = { edge: 'slope' as const, faceDir: 90 };
    const lone = layerSlopes(layerOf([ground, plat('lone', 2, 2, 28, 28, { height: 1, ...slope })])).faces[0];
    const layer = layerOf([ground, plat('t1', 2, 2, 28, 28, { height: 1, ...slope }), plat('t2', 6, 6, 24, 24, { height: 2, ...slope }), plat('t3', 10, 10, 20, 20, { height: 3, ...slope })]);
    const { faces } = layerSlopes(layer);
    expect(faces.map((f) => f.run.owner?.id)).toEqual(['t1', 't2', 't3']);
    for (const f of faces) {
      expect(f.run.drops.every((d) => d === 1)).toBe(true);
      expect(f.face.bands.length).toBe(lone.face.bands.length);
      expect(f.face.steps.length).toBe(lone.face.steps.length);
      expect(f.region.length).toBeGreaterThan(0);
    }
    // Each level its own tint, never two stacked.
    const { tops } = draw(layer);
    const tint = (h: number) => findLabel(tops, `plateau-top-${h}`) as Graphics;
    expect([tint(1), tint(2), tint(3)].map((g) => g.containsPoint({ x: 15, y: 15 }))).toEqual([false, false, true]);
    expect([tint(1), tint(2), tint(3)].map((g) => g.containsPoint({ x: 4, y: 15 }))).toEqual([true, false, false]);
  });

  it('a +1 inside a +3 mesa is a dip: its own tint only, its rim and face inward, its shade and shadow on its floor', () => {
    const mesa = plat('mesa', 2, 2, 28, 28, { height: 3, edge: 'cliff' });
    const dip = plat('dip', 10, 10, 20, 20, { height: 1, edge: 'slope', faceDir: 90 });
    const layer = layerOf([ground, mesa, dip]);
    const { tops, edges } = draw(layer);
    const t3 = findLabel(tops, 'plateau-top-3') as Graphics;
    const t1 = findLabel(tops, 'plateau-top-1') as Graphics;
    expect(t3.containsPoint({ x: 5, y: 5 })).toBe(true);
    expect(t3.containsPoint({ x: 15, y: 15 })).toBe(false);
    expect(t1.containsPoint({ x: 15, y: 15 })).toBe(true);
    // Its face hangs inside its rim, as deep as a drop of 2.
    const face = layerSlopes(layer).faces.find((f) => f.run.owner === dip)!;
    expect(face.run.drops.every((d) => d === -2)).toBe(true);
    expect(face.region.length).toBeGreaterThan(0);
    expect(within(face.region, 10, 10, 20, 20)).toBe(true);
    // Its rim line, and its shade inside it, never up on the mesa.
    const band = edges.children.find((c) => c.label === 'plateau-band-1') as Container;
    expect(findLabel(band, 'plateau-slope-rim')).toBeDefined();
    const mask = findLabel(band, 'plateau-shade-mask') as Graphics;
    expect(mask.containsPoint({ x: 19.9, y: 15 })).toBe(true);
    expect(mask.containsPoint({ x: 25, y: 15 })).toBe(false);
    // As a cliff it throws its shadow onto its own floor.
    const walled = layerOf([ground, mesa, { ...dip, edge: 'cliff' }]);
    const shadow = cliffShadowGeometry(walled, look, groundRing);
    expect(inR(shadow, [10.3, 15])).toBe(true);
    expect(inR(shadow, [19.7, 15])).toBe(false);
  });

  it('a -1 pit inside a +2 mesa gets its inner wall: a face, a shade and a shadow inside it', () => {
    const mesa = plat('mesa', 2, 2, 28, 28, { height: 2, edge: 'cliff' });
    const pit = plat('pit', 10, 10, 20, 20, { height: -1, edge: 'slope', faceDir: 90 });
    const layer = layerOf([ground, mesa, pit]);
    const face = layerSlopes(layer).faces.find((f) => f.run.owner === pit)!;
    expect(face.run.drops.every((d) => d === -3)).toBe(true);
    expect(face.region.length).toBeGreaterThan(0);
    expect(within(face.region, 10, 10, 20, 20)).toBe(true);
    const { edges } = draw(layer);
    const band = edges.children.find((c) => c.label === 'plateau-band--1') as Container;
    const mask = findLabel(band, 'plateau-shade-mask') as Graphics;
    expect(mask.containsPoint({ x: 19.9, y: 15 })).toBe(true);
    const shadow = cliffShadowGeometry(layerOf([ground, mesa, { ...pit, edge: 'cliff' }]), look, groundRing);
    expect(inR(shadow, [10.3, 15])).toBe(true);
  });

  it('a textured top under a textured dip is cut there; under a Ground one it shows through', () => {
    const mesa = plat('mesa', 2, 2, 28, 28, { height: 3, topArt: GRASS });
    const tops = plateauTopTiles(layerOf([ground, mesa, plat('dip', 10, 10, 20, 20, { height: 1, topArt: DIRT })]));
    expect(inR(tops.get(mesa)!, [15, 15])).toBe(false);
    expect(inR(tops.get(mesa)!, [5, 5])).toBe(true);
    const bare = plateauTopTiles(layerOf([ground, mesa, plat('dip', 10, 10, 20, 20, { height: 1 })]));
    expect(inR(bare.get(mesa)!, [15, 15])).toBe(true);
  });
});
