// A measured band kit as drawn: its art redraws when it lands late, it is laid at its
// drawn size, its coloured cliffs are not shaded, and it has no ground strip: the floor's
// paint is fitted to its rock instead (bandFloorFit).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const late = new Texture({ source: new TextureSource({ width: 1, height: 1 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: (id: string) => (id.includes('late') ? late : loaded) };
});

import { Container, Graphics, Sprite } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { bandPiecesFor } from '../assets/caveWallKit';
import { bandScale, bandSetArt, bandSize } from '../assets/packCatalog';
import { resetAssetPackManager, seedCaveBandPack, seedPack } from '../testing/seedCatalog';
import { bandFloorFit, FIT_DOOR_PAD, layBandRing, orientRings, placeBand, type FloorFit } from './caveBandRenderer';
import { renderNodeWalls, type DoorGap } from './wallNodeRenderer';
import { renderPlateaus, shadeCliffs } from './plateauRenderer';
import type { BandMeasure, ManifestEntry } from './packManifest';
import type { DungeonLayer, DungeonStyle, PlateauChild, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

afterEach(() => resetAssetPackManager());

const SET = 'Test_Kit';
const PACK = 'test-pack';

function entry(material: string, gridSize: string, band: BandMeasure, tags: string[]): ManifestEntry {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags, band };
}

/** Two straights, a bend of each hand and an end piece, measured on their entries. */
function seedMeasuredKit(tags: string[] = []): void {
  seedPack(PACK, {
    run_2x2_A: entry('run', '2x2', { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0 }, tags),
    run_2x4_A: entry('run', '2x4', { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0 }, tags),
    turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }, tags),
    turn_out_2x2_A: entry('turn_out', '2x2', { joints: [[-0.025, 0.983], [-0.988, 0.02]], turnDeg: -90 }, tags),
    tip_1x2_A: entry('tip', '1x2', { joints: [[0, 0.98], [0, 0]], turnDeg: 0, end: true }, tags),
  });
}

/** Even-odd containment over Clipper's rings (outers and holes alike). */
function covers(rings: Polygon[], [x, y]: [number, number]): boolean {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

function area(rings: Polygon[]): number {
  let a = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const j = (i + 1) % r.length;
      a += r[i][0] * r[j][1] - r[j][0] * r[i][1];
    }
  }
  return Math.abs(a / 2);
}

/** The fit of one ring laid with the measured kit. */
function fitOf(poly: Polygon, gaps: DoorGap[] = []): FloorFit {
  const [ring] = orientRings([poly]);
  const placed = layBandRing(ring, gaps, bandPiecesFor(SET));
  expect(placed.length).toBeGreaterThan(0);
  return bandFloorFit(ring, placed, gaps);
}

const bandStyle = (setId: string) => ({ wallTextureSetId: setId, wallTextureTint: '#884422', wallWidth: 0.5, floorColor: '#808080' }) as DungeonStyle;
const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('band art that loads late', () => {
  it('asks for a redraw for each piece whose texture is not loaded yet', () => {
    const [ring] = orientRings([square]);
    seedMeasuredKit();
    const placed = layBandRing(ring, [], bandPiecesFor(SET));
    const art = new Map([...bandSetArt(SET)].map(([key, e]) => [key, key === 'run_2x4' ? { ...e, id: 'late-run' } : e]));
    const waitFor = vi.fn();
    placeBand(new Container(), placed, art, 0xffffff, 0, undefined, waitFor);
    expect(placed.some((pl) => pl.piece.key === 'run_2x4')).toBe(true);
    expect(waitFor).toHaveBeenCalledWith('late-run');
    expect(waitFor.mock.calls.every(([id]) => id === 'late-run')).toBe(true);
  });
});

describe('the size a band is laid at', () => {
  it('lays a measured kit at its drawn size at the default width, and the ink set as before', () => {
    seedMeasuredKit();
    seedCaveBandPack('gg-forge', { set: 'GG_Cave_Ink', tags: ['cave'] });
    expect(bandSize(SET, 0.5)).toBe(1);
    expect(bandSize(SET, 1)).toBe(2);
    for (const w of [0.15, 0.5, 1, 1.5]) expect(bandSize('GG_Cave_Ink', w)).toBe(bandScale(w));
  });
});

describe('coloured cliff art', () => {
  const ground: ShapeChild = {
    id: 'ground',
    name: 'ground',
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 0], [30, 0], [30, 30], [0, 30]]],
  } as ShapeChild;
  const plat = (edgeArt?: string): PlateauChild =>
    ({ id: 'top', name: 'top', childType: 'plateau', visible: true, contours: [[[5, 5], [11, 5], [11, 11], [5, 11]]], height: 2, edge: 'cliff', edgeArt }) as PlateauChild;
  const layerOf = (p: PlateauChild) => ({ id: 'l1', type: 'dungeon', children: [ground, p], style: { floorColor: '#808080' } }) as unknown as DungeonLayer;
  const rockOf = (parent: Container) =>
    ((parent.children[0] as Container).children.find((c) => c.label === 'plateau-cliff') as Container).children as Sprite[];
  const sun = { dx: 1, dy: 0, length: 2, alpha: 0.4, color: '#000000' };

  it('keeps a coloured measured kit untinted under the sun, and shades the default ledge as before', () => {
    const object = (material: string, gridSize: string) => ({ type: 'object', material, gridSize, set: 'GG_Cave_Ink', tags: ['cave'] }) as ManifestEntry;
    seedPack('gg-forge', {
      wall_short_2x2_A: object('wall_short', '2x2'),
      inside_bend_2x2_A: object('inside_bend', '2x2'),
      outside_bend_2x2_A: object('outside_bend', '2x2'),
      rockledge_1x2_A: object('rockledge', '1x2'),
      rockledge_1x4_A: object('rockledge', '1x4'),
      rockledge_bend_90_2x2_A: object('rockledge_bend_90', '2x2'),
      rockledge_bend_n90_2x2_A: object('rockledge_bend_n90', '2x2'),
    });
    seedMeasuredKit(['colored']);

    const coloured = new Container();
    renderPlateaus(layerOf(plat(SET)), new Container(), coloured);
    shadeCliffs('l1', sun);
    expect(rockOf(coloured).length).toBeGreaterThan(0);
    expect(rockOf(coloured).every((s) => s.tint === 0xffffff)).toBe(true);

    const ledge = new Container();
    renderPlateaus(layerOf(plat()), new Container(), ledge);
    shadeCliffs('l1', sun);
    expect(rockOf(ledge).some((s) => s.tint < 0xffffff)).toBe(true);
  });
});

describe('a measured kit has no ground strip', () => {
  it('draws no strip for a measured kit and hands its ring over to be fitted', () => {
    seedMeasuredKit();
    const walls = new Container();
    const laid = vi.fn();
    renderNodeWalls(walls, [square], [], bandStyle(SET), [], {}, { onBandLaid: laid });
    expect(walls.children.length).toBeGreaterThan(0);
    expect(walls.children.some((c) => c instanceof Graphics)).toBe(false);
    expect(laid).toHaveBeenCalledTimes(1);
  });

  it('keeps the ink set’s strip, and fits nothing for it', () => {
    seedCaveBandPack('gg-forge', { set: 'GG_Cave_Ink', tags: ['cave'] });
    const walls = new Container();
    const laid = vi.fn();
    renderNodeWalls(walls, [square], [], bandStyle('GG_Cave_Ink'), [], {}, { onBandLaid: laid });
    expect(walls.children[0]).toBeInstanceOf(Graphics);
    expect(laid).not.toHaveBeenCalled();
  });
});

describe('fitting the floor to a measured kit’s rock', () => {
  it('leaves a rectangle nearly as authored', () => {
    seedMeasuredKit();
    const fit = fitOf(square);
    // Next to no floor past the rock, and the ground under it filled only in a thin band
    // along the edge: out to the seat, which lies under the rock just past its floor line.
    expect(area(fit.tips)).toBeLessThan(0.5);
    const fromEdge = ([x, y]: [number, number]) => Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(y), Math.abs(y - 10));
    expect(Math.max(...[...fit.tips, ...fit.gaps].flat().map(fromEdge))).toBeLessThan(0.45);
  });

  it('fills the ground inside the rock at an L room’s reflex corner', () => {
    seedMeasuredKit();
    const fit = fitOf([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]]);
    expect(covers(fit.gaps, [5.1, 5.1])).toBe(true);
    expect(covers(fit.tips, [5.1, 5.1])).toBe(false);
  });

  it('takes the floor off past the rock at a corner sharper than a right angle', () => {
    seedMeasuredKit();
    const fit = fitOf([[0, 0], [8, 1], [11, 6], [6, 9], [1, 7]]);
    // Just inside the tip at [0, 0], along its bisector.
    expect(covers(fit.tips, [0.06, 0.05])).toBe(true);
  });

  it('cuts and adds nothing inside a door opening', () => {
    seedMeasuredKit();
    const door: DoorGap = { wallId: 'floor:0:0', position: [5, 0], width: 1, ring: 0 };
    const fit = fitOf(square, [door]);
    const clear = door.width / 2 + FIT_DOOR_PAD - 0.02;
    for (const p of [...fit.tips, ...fit.gaps].flat()) {
      expect(Math.hypot(p[0] - door.position[0], p[1] - door.position[1])).toBeGreaterThanOrEqual(clear);
    }
  });

  it('fits nothing for a ring the walk laid nothing for', () => {
    expect(bandFloorFit(square, [])).toEqual({ tips: [], gaps: [] });
  });
});
