// A cave mouth in a plateau's or pit's measured cliff: the cliff stops at the span's ends with no
// taper and no end piece, the kit's entrance piece lies across it, plain with a walled floor behind
// the mouth and dark with none. With a floor behind, the mouth alone is crossed freely and seen
// through and its rock line breaks there; with none it stands as the cliff. The room is untouched,
// and taking the entrance away lays the cliff exactly as it was.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: () => loaded, load: () => Promise.resolve(loaded) };
});

import { Container } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { cliffRockLines } from './rockLines';
import { cliffFreeTips, cliffLedge, entrancePlacements, laidRuns, renderPlateaus, walkStretch } from './plateauRenderer';
import { jointsOf } from '../assets/caveWallKit';
import { cliffOccluders, crossingsAlong, layerPlateaus, surfaceHeightAt } from '../shared/plateaus';
import { defaultCrossingKinds } from '../shared/crossingKinds';
import type { BandMeasure, ManifestEntry } from './packManifest';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import { setPlateauFields } from '../store/plateauCommands';
import { computeMergedFloor } from './mergedFloor';
import { resolveWalls } from '../shared/wallResolve';
import { stairOpenings } from '../shared/stairOpenings';
import type { CliffEntrance, DungeonLayer, PlateauChild, ShapeChild } from '../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
}, 30_000);

type Pt = [number, number];
const SET = 'Test_Cliff_Kit';

function entry(material: string, gridSize: string, band: BandMeasure): ManifestEntry {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: [], band };
}

/** The measured cliff kit plateauStairs.test.ts seeds, with entrance pieces 2 and 3 cells wide, plain and Shadow, unless `mouths` is off. */
function seedCliffKit(mouths = true): void {
  const mouth = (L: number, shadow: boolean): BandMeasure => ({
    joints: [[-0.065, L / 2], [-0.065, -L / 2]],
    turnDeg: 0,
    spine: [[-0.065, L / 2], [0.135, 0], [-0.065, -L / 2]],
    entrance: true,
    mouth: [0.35, 0.65],
    ...(shadow && { shadow: true }),
  });
  seedPack('test-cliff-pack', {
    run_2x2_A: entry('run', '2x2', { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0, spine: [[-0.065, 0.983], [0.135, 0.3], [-0.265, -0.3], [-0.065, -0.988]] }),
    run_2x4_A: entry('run', '2x4', { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0, spine: [[-0.065, 1.983], [0.135, 0.6], [-0.265, -0.6], [-0.065, -1.988]] }),
    turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }),
    turn_out_2x2_A: entry('turn_out', '2x2', { joints: [[-0.025, 0.983], [-0.988, 0.02]], turnDeg: -90 }),
    tip_1x2_A: entry('tip', '1x2', { joints: [[0, 0.98], [0, 0]], turnDeg: 0, end: true }),
    ...(mouths && {
      mouth_a_2x2_A: entry('mouth_a', '2x2', mouth(2, false)),
      mouth_shadow_a_2x2_A: entry('mouth_shadow_a', '2x2', mouth(2, true)),
      mouth_b_2x3_A: entry('mouth_b', '2x3', mouth(3, false)),
      mouth_shadow_b_2x3_A: entry('mouth_shadow_b', '2x3', mouth(3, true)),
    }),
  });
}

const room: Pt[] = [[0, 0], [10, 0], [10, 8], [0, 8]];
/** A mouth on the north edge, x 4 to 6, its hollow x 4.7 to 5.3: the outline starts at (0, 0) and runs east along y 0. */
const ENT: CliffEntrance = { id: 'e1', ring: 0, from: 4, to: 6, mouth: [4.7, 5.3] };

function plat(height: number, entrances?: CliffEntrance[]): PlateauChild {
  return { id: 'plat', name: 'plat', childType: 'plateau', visible: true, contours: [room], height, edge: 'cliff', edgeArt: SET, ...(entrances && { entrances }) };
}

function floor(id: string, contour: Pt[], extra: Partial<ShapeChild> = {}): ShapeChild {
  return { id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [contour], textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff', ...extra };
}

/** A walled floor on the plateau, its north wall 0.3 cells in from the cliff: behind the mouth. */
const DEN = floor('den', [[2, 0.3], [8, 0.3], [8, 6], [2, 6]]);

const layerOf = (children: unknown[]): DungeonLayer => ({ id: 'l1', name: 'l1', type: 'dungeon', visible: true, opacity: 1, children, mergedFloor: [] }) as unknown as DungeonLayer;

const kinds = defaultCrossingKinds();
/** The crossings a straight move makes, each as its kind and whether it chips. */
const crossed = (layer: DungeonLayer, a: Pt, b: Pt) => crossingsAlong(layer, a, b, kinds).map((c) => `${c.kindId}${c.chip ? '' : ' no chip'}`);
/** Whether a cliff that hides blocks the straight move from `a` to `b`. */
const hidden = (layer: DungeonLayer, a: Pt, b: Pt): boolean =>
  cliffOccluders(layer, 1).some((g) => {
    const d = (b[0] - a[0]) * (g.y2 - g.y1) - (b[1] - a[1]) * (g.x2 - g.x1);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((g.x1 - a[0]) * (g.y2 - g.y1) - (g.y1 - a[1]) * (g.x2 - g.x1)) / d;
    const u = ((g.x1 - a[0]) * (b[1] - a[1]) - (g.y1 - a[1]) * (b[0] - a[0])) / d;
    return t > 0 && t < 1 && u >= 0 && u <= 1;
  });

/** Every piece the layer's cliffs lay, as drawn: key, place, turn and scale. */
const placements = (layer: DungeonLayer): string[] =>
  layerPlateaus(layer).bands.flatMap((band) =>
    laidRuns(layer, band).flatMap(({ cliffs }) =>
      (cliffs ?? []).flatMap((c) => cliffLedge(c, walkStretch(c)).map((pl) => `${pl.piece.key} ${pl.at.position.x.toFixed(4)} ${pl.at.position.y.toFixed(4)} ${pl.at.rotation.toFixed(4)} ${pl.at.scale.toFixed(4)}`)),
    ),
  );

/** The pieces laid across the layer's entrances. */
const mouths = (layer: DungeonLayer) => layerPlateaus(layer).bands.flatMap((band) => entrancePlacements(layer, band));

describe('a cave mouth in a measured cliff', () => {
  beforeEach(() => {
    resetAssetPackManager();
    seedCliffKit();
  });

  for (const height of [2, -2]) {
    it(`stops the cliff at the span's ends with no taper and no end piece, and lays the piece across it (height ${height})`, () => {
      const layer = layerOf([plat(height, [ENT])]);
      const band = layerPlateaus(layer).bands[0];
      const [laid] = laidRuns(layer, band);
      const [c] = laid.cliffs!;
      expect(laid.cliffs).toHaveLength(1);
      expect(c.joins).toEqual([true, true]);
      expect(c.opens).toEqual([false, false]);
      expect(c.merged).toEqual([false, false]);
      const ends = [c.run.points[0], c.run.points[c.run.points.length - 1]].map(([x, y]) => [x, y]).sort((p, q) => p[0] - q[0]);
      expect(ends).toEqual([[4, 0], [6, 0]]);
      const ledge = cliffLedge(c, walkStretch(c));
      expect(ledge.some((pl) => pl.branch === 'end' || pl.branch === 'ending')).toBe(false);
      const taper = cliffFreeTips(c, ledge);
      const joints = ledge.flatMap((pl) => jointsOf(pl.piece, pl.at));
      for (const end of [[4, 0], [6, 0]]) {
        const tip = joints.reduce((b, j) => (Math.hypot(j[0] - end[0], j[1] - end[1]) < Math.hypot(b[0] - end[0], b[1] - end[1]) ? j : b));
        expect(Math.hypot(tip[0] - end[0], tip[1] - end[1])).toBeLessThan(0.5);
        expect(taper?.(tip) ?? false).toBe(false);
      }
      // No rock of the run across the span: the piece lies there, its joints on the span's ends.
      expect(joints.some(([x, y]) => x > 4.2 && x < 5.8 && Math.abs(y) < 0.3)).toBe(false);
      const [m] = mouths(layer);
      expect(m.pl.piece.key).toBe('mouth_shadow_a_2x2');
      const [j0, j1] = jointsOf(m.pl.piece, m.pl.at);
      expect([j0[0], j1[0]].map((x) => Math.round(x * 100) / 100).sort((p, q) => p - q)).toEqual([4, 6]);
      expect(m.pl.at.scale).toBeCloseTo(1);
    });
  }

  it('with nothing behind is art only: the mouth climbs, hides and keeps its rock line as the cliff', () => {
    const layer = layerOf([plat(2, [ENT])]);
    expect(layerPlateaus(layer).entrances.map((e) => e.behind)).toEqual([false]);
    expect(crossed(layer, [5, -1], [5, 1])).toEqual(['climb']);
    expect(hidden(layer, [5, -1], [5, 1])).toBe(true);
    const line = cliffRockLines(layer).lines.find((l) => l.edge.length === 2)!;
    expect(line.runs).toHaveLength(1);
  });

  it('with a walled floor behind lays the plain piece, walks either cell its hollow covers, sees through the hollow alone, and breaks the rock line there', () => {
    const layer = layerOf([plat(2, [ENT]), DEN]);
    expect(layerPlateaus(layer).entrances.map((e) => e.behind)).toEqual([true]);
    expect(mouths(layer).map((m) => m.pl.piece.key)).toEqual(['mouth_a_2x2']);
    // The hollow (4.7 to 5.3) covers 0.3 of each of the span's two cells: a straight step on either is free, with no chip.
    for (const x of [4.5, 5.5]) expect(crossed(layer, [x, -1], [x, 1])).toEqual(['free no chip']);
    // Sight passes the hollow alone: beside it, in the same cells, the cliff hides.
    expect(hidden(layer, [5, -1], [5, 1])).toBe(false);
    expect(hidden(layer, [4.3, -1], [4.3, 1])).toBe(true);
    expect(hidden(layer, [5.7, -1], [5.7, 1])).toBe(true);
    // Past the span, the cliff.
    expect(crossed(layer, [3.5, -1], [3.5, 1])).toEqual(['climb']);
    // The entrance's saved line: two runs, one either side of the hollow.
    const line = cliffRockLines(layer).lines.find((l) => l.edge.length === 2)!;
    expect(line.runs).toHaveLength(2);
    expect(line.runs.flat().some(([x]) => x > 4.75 && x < 5.25)).toBe(false);
  });

  it('opens and closes with the floor behind it, nothing stored', () => {
    expect(layerPlateaus(layerOf([plat(2, [ENT])])).entrances[0].behind).toBe(false);
    expect(layerPlateaus(layerOf([plat(2, [ENT]), DEN])).entrances[0].behind).toBe(true);
    // A floor under both sides of the edge (the plateau drawn inside one big room) stands behind nothing.
    expect(layerPlateaus(layerOf([floor('hall', [[-5, -5], [15, -5], [15, 15], [-5, 15]]), plat(2, [ENT])])).entrances[0].behind).toBe(false);
    // Ground is no room; nor is a floor more than half a cell in.
    expect(layerPlateaus(layerOf([plat(2, [ENT]), { ...DEN, ground: true }])).entrances[0].behind).toBe(false);
    expect(layerPlateaus(layerOf([plat(2, [ENT]), floor('far', [[2, 0.7], [8, 0.7], [8, 6], [2, 6]])])).entrances[0].behind).toBe(false);
  });

  it('into a pit: a room outside it, reached through its wall', () => {
    const outside = floor('cellar', [[2, -6], [8, -6], [8, -0.3], [2, -0.3]]);
    const layer = layerOf([plat(-2, [ENT]), outside]);
    expect(layerPlateaus(layer).entrances.map((e) => e.behind)).toEqual([true]);
    expect(crossed(layer, [4.5, -1], [4.5, 1])).toEqual(['free no chip']);
    expect(crossed(layer, [3.5, -1], [3.5, 1])).toEqual(['climb']);
    expect(hidden(layer, [4.3, -1], [4.3, 1])).toBe(true);
    expect(mouths(layer).map((m) => m.pl.piece.key)).toEqual(['mouth_a_2x2']);
  });

  it('leaves the room and the top over it as they were', () => {
    const plain = layerOf([plat(2), DEN]);
    const open = layerOf([plat(2, [ENT]), DEN]);
    const look = (layer: DungeonLayer) => {
      const lp = layerPlateaus(layer);
      return { level: surfaceHeightAt(lp.infos, 5, 3), mouth: surfaceHeightAt(lp.infos, 5, 0.1), surface: lp.bands.map((b) => b.surface) };
    };
    expect(look(open)).toEqual(look(plain));
    expect(look(open).level).toBe(2);
  });

  it('lays the cliff exactly as it was once the entrance is taken away', () => {
    const before = placements(layerOf([plat(2)]));
    expect(before.length).toBeGreaterThan(0);
    expect(placements(layerOf([plat(2, [ENT])]))).not.toEqual(before);
    expect(placements(layerOf([plat(2, [])]))).toEqual(before);
    expect(cliffRockLines(layerOf([plat(2, [])])).lines).toEqual(cliffRockLines(layerOf([plat(2)])).lines);
  });

  it('walks a 3-cell mouth through the middle cell its hollow covers, and climbs its outer cells', () => {
    // The hollow 4.05 to 4.91 of a span 3 to 6: the middle cell alone.
    const layer = layerOf([plat(2, [{ id: 'w', ring: 0, from: 3, to: 6, mouth: [4.05, 4.91] }]), DEN]);
    expect(crossed(layer, [4.5, -1], [4.5, 1])).toEqual(['free no chip']);
    for (const x of [3.5, 5.5]) expect(crossed(layer, [x, -1], [x, 1])).toEqual(['climb']);
    expect(hidden(layer, [4.5, -1], [4.5, 1])).toBe(false);
    expect(hidden(layer, [4.02, -1], [4.02, 1])).toBe(true);
  });

  it('works the hollow out again when the cliff art changes, one undo step with it', () => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    useStore.setState((s) => {
      (s.layers.find((l) => l.type === 'dungeon') as DungeonLayer).children = [plat(2, [ENT])];
    });
    const mouth = () => ((useStore.getState().layers.find((l) => l.type === 'dungeon') as DungeonLayer).children[0] as PlateauChild).entrances![0].mouth;
    // Art with no entrance pieces: the mouth is a plain gap, the whole span.
    undoManager.execute(setPlateauFields('plat', { edgeArt: 'Some_Other_Rock' })!);
    expect(mouth()).toEqual([4, 6]);
    undoManager.undo();
    expect(mouth()).toEqual([4.7, 5.3]);
    // Back to the kit's own art: its piece's hollow, turned the way the cliff is walked.
    undoManager.execute(setPlateauFields('plat', { edgeArt: 'Some_Other_Rock' })!);
    undoManager.execute(setPlateauFields('plat', { edgeArt: SET })!);
    const [m0, m1] = mouth()!;
    expect(Math.round((m1 - m0) * 1000) / 1000).toBe(0.6);
  });

  for (const pit of [false, true]) {
    it(`opens the wall of the room behind across every cell the mouth frees to walk (${pit ? 'a pit, the room outside it' : 'a plateau'})`, () => {
      const den = pit ? floor('cellar', [[2, -6], [8, -6], [8, -0.3], [2, -0.3]]) : DEN;
      const opened = (span: CliffEntrance): number[] => {
        const layer = { ...layerOf([plat(pit ? -2 : 2, [span]), den]), standaloneWalls: [] } as unknown as DungeonLayer;
        layer.mergedFloor = computeMergedFloor(layer);
        return stairOpenings(layer, resolveWalls(layer)).flatMap((o) => [o.position[0] - o.door.width / 2, o.position[0] + o.door.width / 2].map((x) => Math.round(x * 100) / 100));
      };
      // A1: the hollow covers 0.32 and 0.36 of the two cells: both. A2: 0.29 and 0.23, neither 0.3: the one it covers most.
      expect(opened({ id: 'a1', ring: 0, from: 4, to: 6, mouth: [4.676, 5.36] })).toEqual([4, 6]);
      expect(opened({ id: 'a2', ring: 0, from: 4, to: 6, mouth: [4.71, 5.23] })).toEqual([4, 5]);
      // 3 wide: the middle cell alone.
      expect(opened({ id: 'a3', ring: 0, from: 3, to: 6, mouth: [4.05, 4.914] })).toEqual([4, 5]);
    });
  }

  it('takes the 3-cell piece for a 3-cell span, and the piece the span names', () => {
    const wide = layerOf([plat(2, [{ id: 'w', ring: 0, from: 3, to: 6 }])]);
    expect(mouths(wide).map((m) => m.pl.piece.key)).toEqual(['mouth_shadow_b_2x3']);
    // With no hollow saved, the middle third opens.
    expect(layerPlateaus(layerOf([plat(2, [{ id: 'w', ring: 0, from: 3, to: 6 }]), DEN])).entrances[0].mouth.map(([x]) => x)).toEqual([4, 5]);
  });

  it('draws the pieces over the cliff', () => {
    const edges = new Container();
    renderPlateaus(layerOf([plat(2, [ENT])]), new Container(), edges);
    const labels = (edges.children[0] as Container).children.map((c) => c.label);
    expect(labels.indexOf('plateau-entrances')).toBeGreaterThan(labels.indexOf('plateau-cliff'));
    expect(((edges.children[0] as Container).children[labels.indexOf('plateau-entrances')] as Container).children).toHaveLength(1);
  });
});

describe('a cave mouth in a cliff kit with no entrance pieces', () => {
  beforeEach(() => {
    resetAssetPackManager();
    seedCliffKit(false);
  });

  it('leaves a plain gap with tapered tips, any whole width, and lays no piece', () => {
    const layer = layerOf([plat(2, [{ id: 'g', ring: 0, from: 3, to: 7 }])]);
    const [c] = laidRuns(layer, layerPlateaus(layer).bands[0])[0].cliffs!;
    expect(c.opens).toEqual([true, true]);
    expect(c.joins).toBeUndefined();
    expect(mouths(layer)).toEqual([]);
    const ends = [c.run.points[0], c.run.points[c.run.points.length - 1]].map(([x]) => x).sort((p, q) => p - q);
    expect(ends).toEqual([3, 7]);
  });
});
