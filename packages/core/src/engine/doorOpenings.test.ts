// A door or an Opening the Door tool hangs on a measured kit's cave rock: the rock runs straight
// to each side and tapers there, a door's frame posts sit against the tapered ends, an Opening's
// floor runs out across it as a carved mouth's does, and deleting it closes the rock again.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: () => loaded };
});

import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { jointsOf } from '../assets/caveWallKit';
import type { WalkPlacement } from './caveWalk';
import type { BandMeasure, DoorMeasure, ManifestEntry } from './packManifest';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { caseLayer, type CaseKits } from '../testing/caveCases';
import { mouthEnds, withConnectors } from './caveBandRenderer';
import { kitOverlap } from './caveWalk';
import { drawnFromOutline, layLayer } from '../testing/caveLayout';
import { openingLines } from './doorGaps';
import { resolveDoors, resolveWalls } from '../shared/wallResolve';
import { extractMoveSegments, extractWallSegments } from './lighting/raycaster';
import type { DoorStyle } from '../shared/types';
import type { DungeonLayer } from '../store/types';

const SET = 'Test_Rock';
const KITS: CaseKits = { cave: SET, cliff: SET, stone: 'Test_Stone' };
type Pt = [number, number];

const band = (material: string, gridSize: string, b: BandMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: ['colored'], band: b });
const door = (material: string, gridSize: string, d: DoorMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: 'Test_Doors', tags: ['door'], door: d });

/** The measured test kit (straights, bends, a spur tip and a passage end) and a whole-leaf door kit for it. */
function seed(): void {
  const entries: Record<string, ManifestEntry> = {};
  for (const L of [2, 3, 4, 5, 6]) {
    const end = L / 2 + 0.15;
    entries[`run_${L}x2_A`] = band('run', `${L}x2`, { joints: [[end, 0.36], [-end, 0.36]], turnDeg: 0 });
  }
  for (const N of [2, 3]) {
    const end = N / 2 + 0.15;
    entries[`turn_in_${N}x${N}_A`] = band('turn_in', `${N}x${N}`, { joints: [[N / 2 - 0.64, -end], [-end, N / 2 - 0.64]], turnDeg: 90 });
    entries[`turn_out_${N}x${N}_A`] = band('turn_out', `${N}x${N}`, { joints: [[-end, N / 2 - 1.36], [N / 2 - 1.36, -end]], turnDeg: -90 });
  }
  entries.spur_3x1_A = band('spur', '3x1', { joints: [[0.14, 0.65], [-0.14, 0.65]], turnDeg: -180, end: true, reach: 0.83 });
  entries.cap_4x1_A = band('cap', '4x1', { joints: [[-1.36, 0.65], [1.36, 0.65]], turnDeg: 180, end: true, reach: 0.66 });
  const kit = { kit: 'test_rock_door', label: 'Rock' };
  entries.leaf_1x1_A = door('leaf', '1x1', { ...kit, part: 'leaf', walls: [SET] });
  entries.frame_2x1_A = door('frame', '2x1', { ...kit, part: 'frame', post: [0.49, 0.7] });
  entries.frame_double_3x1_A = door('frame_double', '3x1', { ...kit, part: 'frame-double', post: [0.99, 1.2] });
  seedPack('test-pack', entries);
}

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
}, 30_000);

afterEach(() => resetAssetPackManager());

const floor = (id: string, contour: Pt[], set = SET) => ({ id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [contour], styleOverrides: { wallTextureSetId: set } });
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ROOM = rect(0, 0, 12, 10);

/** A door on the wall nearest `at`, as the Door tool hangs one along a wall; an Opening is a bare archway. */
const doorAt = (at: Pt, width: number, style: DoorStyle | 'opening', patch: object = {}) => ({
  id: `door-${style}`,
  name: 'd',
  childType: 'door',
  visible: true,
  wallId: '',
  position: at,
  angle: 0,
  width,
  style: style === 'opening' ? 'archway' : style,
  state: 'closed',
  isSecret: false,
  ...(style === 'opening' ? { bare: true } : {}),
  ...patch,
});

const roomWith = (children: unknown[] = [], set = SET): DungeonLayer => caseLayer([floor('room', ROOM, set), ...children], KITS);
const floorBands = (layer: DungeonLayer) => layLayer(layer).bands.filter((b) => b.kind === 'floor');
/** Pieces that turn back at an opening: a dead end or a cap laid there. */
const turned = (layer: DungeonLayer): WalkPlacement[] => floorBands(layer).flatMap((b) => b.placed.filter((p) => p.branch === 'mouth' || p.branch === 'dead-end'));
const placements = (layer: DungeonLayer): string[] =>
  floorBands(layer).flatMap((b) => b.placed.map((p) => `${p.piece.key} ${p.at.position.x.toFixed(4)} ${p.at.position.y.toFixed(4)} ${p.at.rotation.toFixed(4)}`));

/** Where each tapered end of the rock's art ends, as drawn (`withConnectors`): its tip, along the wall. */
const taperTips = (layer: DungeonLayer): Pt[] =>
  floorBands(layer).flatMap((b) =>
    withConnectors(b.placed, b.placed.map((p) => p.piece), b.size, mouthEnds(b.gaps, b.size)).flatMap((pl) => {
      const [J0, J1] = jointsOf(pl.piece, pl.at);
      const L = Math.hypot(J1[0] - J0[0], J1[1] - J0[1]);
      const u: Pt = [(J1[0] - J0[0]) / L, (J1[1] - J0[1]) / L];
      const half = pl.bend?.half ?? 0;
      return ([0, 1] as const).filter((k) => pl.bend?.taper?.[k]).map((k): Pt => (k === 0 ? [J0[0] + u[0] * half, J0[1] + u[1] * half] : [J1[0] - u[0] * half, J1[1] - u[1] * half]));
    }),
  );

/** Whether the straight from `a` to `b` crosses any of `segs`. */
const crosses = (segs: readonly { x1: number; y1: number; x2: number; y2: number }[], a: Pt, b: Pt): boolean =>
  segs.some((g) => {
    const d = (b[0] - a[0]) * (g.y2 - g.y1) - (b[1] - a[1]) * (g.x2 - g.x1);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((g.x1 - a[0]) * (g.y2 - g.y1) - (g.y1 - a[1]) * (g.x2 - g.x1)) / d;
    const u = ((g.x1 - a[0]) * (b[1] - a[1]) - (g.y1 - a[1]) * (b[0] - a[0])) / d;
    return t > 0 && t < 1 && u >= 0 && u <= 1;
  });

describe('an Opening the Door tool makes in cave rock', () => {
  it.each([1, 2, 3])('opens the rock %i cells wide, the rock running straight to each edge and tapered there, the opening keeping its width', (w) => {
    seed();
    const layer = roomWith([doorAt([6, 0], w, 'opening')]);
    expect(turned(layer)).toEqual([]);
    const tips = taperTips(layer).sort((a, b) => a[0] - b[0]);
    expect(tips).toHaveLength(2);
    expect(tips[0][0]).toBeCloseTo(6 - w / 2, 2);
    expect(tips[1][0]).toBeCloseTo(6 + w / 2, 2);
    // Its gaps are a mouth's, never a door's jambs.
    const gaps = floorBands(layer).flatMap((b) => b.gaps);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.mouth === true)).toBe(true);
  });

  it('opens the rock at a corner, with no rock left across it', () => {
    seed();
    const layer = roomWith([doorAt([1, 0], 2, 'opening')]);
    expect(turned(layer)).toEqual([]);
    expect(taperTips(layer).length).toBeGreaterThan(0);
    // Where each piece's art ends (its joints carried half the kit's overlap back in): none across the opening.
    for (const b of floorBands(layer)) {
      for (const pl of b.placed) {
        const [J0, J1] = jointsOf(pl.piece, pl.at);
        const L = Math.hypot(J1[0] - J0[0], J1[1] - J0[1]);
        const h = (kitOverlap(b.placed.map((p) => p.piece)) / 2) * pl.at.scale;
        const ends: Pt[] = [
          [J0[0] + ((J1[0] - J0[0]) / L) * h, J0[1] + ((J1[1] - J0[1]) / L) * h],
          [J1[0] - ((J1[0] - J0[0]) / L) * h, J1[1] - ((J1[1] - J0[1]) / L) * h],
        ];
        for (const E of ends) expect(E[0] > 0.2 && E[0] < 1.99 && E[1] < 0 && E[1] > -1.5, `art end at ${E}`).toBe(false);
      }
    }
  });

  it('changes no rock across a passage, where there is none to open', () => {
    seed();
    const rooms = [floor('a', rect(0, 0, 6, 6)), floor('b', rect(10, 0, 16, 6)), floor('p', rect(6, 2, 10, 4))];
    const plain = caseLayer(rooms, KITS);
    const opened = caseLayer([...rooms, { ...doorAt([8, 3], 2, 'opening'), angle: Math.PI / 2, freestanding: true, wallId: 'piece' }], KITS);
    opened.standaloneWalls = [{ id: 'piece', points: [[8, 2], [8, 4]], wallType: 'normal', direction: 'both', color: '#000000', roughness: 0, width: 1 } as never];
    expect(placements(opened)).toEqual(placements(plain));
  });

  it('closes the rock exactly as it was when deleted', () => {
    seed();
    const before = placements(roomWith());
    const opened = roomWith([doorAt([6, 0], 2, 'opening')]);
    expect(placements(opened)).not.toEqual(before);
    const deleted = { ...opened, children: opened.children.filter((c) => c.childType !== 'door'), mergedFloor: null } as DungeonLayer;
    expect(placements(deleted)).toEqual(before);
  });

  it("lays its line for the floor's fade, as a carved mouth's; a door and a stone wall lay none", () => {
    seed();
    const lines = (layer: DungeonLayer) => openingLines(layer, resolveDoors(layer, resolveWalls(layer)));
    const [line, ...rest] = lines(roomWith([doorAt([6, 0], 2, 'opening')]));
    expect(rest).toEqual([]);
    const xs = line.map((p) => p[0]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(5, 6);
    expect(xs[1]).toBeCloseTo(7, 6);
    expect(line.every((p) => Math.abs(p[1]) < 1e-6)).toBe(true);
    expect(lines(roomWith([doorAt([6, 0], 2, 'single')]))).toEqual([]);
    expect(lines(roomWith([doorAt([6, 0], 2, 'opening')], 'Test_Stone'))).toEqual([]);
  });

  it('passes light, sight and movement through its full width; a closed door blocks them and an open one passes them', () => {
    seed();
    const through = (layer: DungeonLayer): boolean[] => {
      const shown = drawnFromOutline(layLayer(layer)).layer;
      const kinds = [extractWallSegments([shown], 'light'), extractWallSegments([shown], 'sight'), extractMoveSegments([shown])];
      // Straight through the middle, and near each edge.
      return kinds.map((segs) => [5.2, 6, 6.8].every((x) => !crosses(segs, [x, 1.5], [x, -2])));
    };
    expect(through(roomWith([doorAt([6, 0], 2, 'opening')]))).toEqual([true, true, true]);
    expect(through(roomWith([doorAt([6, 0], 2, 'single')]))).toEqual([false, false, false]);
    expect(through(roomWith([doorAt([6, 0], 2, 'single', { state: 'open' })]))).toEqual([true, true, true]);
  });
});

describe('a door on cave rock', () => {
  it.each(['single', 'double', 'portcullis', 'archway'] as const)('tapers the rock either side of a %s, with no piece turning back', (style) => {
    seed();
    const layer = roomWith([doorAt([6, 0], 2, style)]);
    expect(turned(layer)).toEqual([]);
    expect(taperTips(layer)).toHaveLength(2);
  });

  it("widens its gap by its frame's posts, so they sit against the tapered ends' tips; an Opening has no posts", () => {
    seed();
    const widest = (style: DoorStyle | 'opening', width: number) => Math.max(...floorBands(roomWith([doorAt([6, 0], width, style)])).flatMap((b) => b.gaps.map((g) => g.width)));
    // A single's frame posts are 0.21 deep, a double's too: each edge moves out by one.
    expect(widest('single', 1)).toBeCloseTo(1.42, 6);
    expect(widest('double', 2)).toBeCloseTo(2.42, 6);
    expect(widest('opening', 2)).toBeLessThanOrEqual(2 + 1e-6);
    const tips = taperTips(roomWith([doorAt([6, 0], 1, 'single')])).map((p) => p[0]).sort((a, b) => a - b);
    expect(tips[0]).toBeCloseTo(5.5 - 0.21, 2);
    expect(tips[1]).toBeCloseTo(6.5 + 0.21, 2);
  });
});
