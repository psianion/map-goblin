// An Opening in a cave wall whose rock is a kit with cave-mouth pieces (a cliff kit used as the
// cave's rock): the piece of the Opening's width lies across it, the rock ends at its ends with no
// taper, and the Opening stays a plain door for everything else. A kit with none keeps the plain
// Opening. The Door tool makes the Opening as wide as one of the kit's pieces, and tells the dock
// the rock of the edge under the pointer.
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
import { bandPiecesFor, jointsOf, wallMouthWidths } from '../assets/caveWallKit';
import type { BandMeasure, ManifestEntry } from './packManifest';
import { laidCaves } from './material/materialRenderer';
import { layOutlineBand, mouthEnds, mouthPieces, orientRings } from './caveBandRenderer';
import { kitOut, kitOverlap, type WalkPlacement } from './caveWalk';
import { doorGaps } from './doorGaps';
import { computeMergedFloor } from './mergedFloor';
import { resolveDoors, resolveWalls } from '../shared/wallResolve';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import { DoorTool } from './tools/DoorTool';
import type { DoorChild, DungeonLayer } from '../store/types';
import type { DoorGap } from './wallNodeRenderer';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
}, 30_000);

type Pt = [number, number];
/** A cliff kit with mouth pieces 2 cells wide (two of them) and 3 wide, plain and Shadow; and the same kit with none. */
const MOUTHS = 'Test_Cliff_Kit';
const PLAIN = 'Test_Plain_Kit';

function seed(): void {
  const entry = (set: string, material: string, gridSize: string, band: BandMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set, tags: [], band });
  const mouth = (L: number, shadow: boolean): BandMeasure => ({
    joints: [[-0.065, L / 2], [-0.065, -L / 2]],
    turnDeg: 0,
    spine: [[-0.065, L / 2], [0.135, 0], [-0.065, -L / 2]],
    entrance: true,
    mouth: [0.35, 0.65],
    ...(shadow && { shadow: true }),
  });
  for (const set of [MOUTHS, PLAIN]) {
    seedPack(`${set}-pack`, {
      run_2x2_A: entry(set, 'run', '2x2', { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0, spine: [[-0.065, 0.983], [0.135, 0.3], [-0.265, -0.3], [-0.065, -0.988]] }),
      run_2x4_A: entry(set, 'run', '2x4', { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0, spine: [[-0.065, 1.983], [0.135, 0.6], [-0.265, -0.6], [-0.065, -1.988]] }),
      turn_in_2x2_A: entry(set, 'turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }),
      turn_out_2x2_A: entry(set, 'turn_out', '2x2', { joints: [[-0.025, 0.983], [-0.988, 0.02]], turnDeg: -90 }),
      ...(set === MOUTHS && {
        mouth_a_2x2_A: entry(set, 'mouth_a', '2x2', mouth(2, false)),
        mouth_shadow_a_2x2_A: entry(set, 'mouth_shadow_a', '2x2', mouth(2, true)),
        mouth_c_2x2_A: entry(set, 'mouth_c', '2x2', mouth(2, false)),
        mouth_b_2x3_A: entry(set, 'mouth_b', '2x3', mouth(3, false)),
        mouth_shadow_b_2x3_A: entry(set, 'mouth_shadow_b', '2x3', mouth(3, true)),
      }),
    });
  }
}

const ROOM: Pt[] = [[0, 0], [10, 0], [10, 8], [0, 8]];
const CIRCLE: Pt[] = Array.from({ length: 40 }, (_, k) => [5 + 4 * Math.cos((2 * Math.PI * k) / 40), 5 + 4 * Math.sin((2 * Math.PI * k) / 40)] as Pt);

const shape = (contour: Pt[], extra: object) => ({ id: 'cave', name: 'cave', childType: 'shape', visible: true, shapeType: 'polygon', contours: [contour], textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff', ...extra });
/** A cave painted with the Material brush, its rock `kit`. */
const brushed = (contour: Pt[], kit: string) => shape(contour, { edgeMaterial: kit, styleOverrides: { wallTextureSetId: '' } });
/** A room drawn with the floor tools, walled with `kit`. */
const drawn = (contour: Pt[], kit: string) => shape(contour, { styleOverrides: { wallTextureSetId: kit } });
const opening = (position: Pt, width: number, extra: Partial<DoorChild> = {}): DoorChild => ({ id: 'o1', name: 'Opening 1', childType: 'door', visible: true, wallId: '', position, angle: 0, width, style: 'archway', state: 'closed', isSecret: false, bare: true, ...extra });

let seq = 0;
function layerOf(children: unknown[]): DungeonLayer {
  const l = { id: `wm-${seq++}`, name: 'wm', type: 'dungeon', visible: true, children, standaloneWalls: [], style: { wallWidth: 0.5, floorColor: '#F1ECDF', wallColor: '#000000' }, mergedFloor: null } as unknown as DungeonLayer;
  return { ...l, mergedFloor: computeMergedFloor(l) };
}

/** Where each piece's art ends: half the kit's overlap in from each joint, along its chord. */
const artEnds = (placed: WalkPlacement[], overlap: number): Pt[] =>
  placed.flatMap((pl) => {
    const [J0, J1] = jointsOf(pl.piece, pl.at);
    const L = Math.hypot(J1[0] - J0[0], J1[1] - J0[1]) || 1;
    const h = (overlap / 2) * pl.at.scale;
    const u = [(J1[0] - J0[0]) / L, (J1[1] - J0[1]) / L];
    return [
      [J0[0] + u[0] * h, J0[1] + u[1] * h],
      [J1[0] - u[0] * h, J1[1] - u[1] * h],
    ] as Pt[];
  });

/** The gaps a brush cave's rock stops at. */
const caveGaps = (layer: DungeonLayer): DoorGap[] => laidCaves(layer)[0].gaps;
const set = () => bandPiecesFor(MOUTHS);

describe('an Opening in a cave wall whose rock has mouth pieces', () => {
  beforeEach(() => {
    resetAssetPackManager();
    seed();
  });

  it('carries the piece of its width, the picked one where the kit has it; a narrower Opening, a door, or a kit with none carries none', () => {
    expect(wallMouthWidths(MOUTHS)).toEqual([2, 3]);
    expect(wallMouthWidths(PLAIN)).toEqual([]);
    const entranceOf = (kit: string, door: DoorChild) => caveGaps(layerOf([brushed(ROOM, kit), door])).map((g) => g.entrance ?? null);
    expect(entranceOf(MOUTHS, opening([5, 0], 2))).toEqual(['mouth_a_2x2']);
    expect(entranceOf(MOUTHS, opening([5, 0], 2, { piece: 'mouth_c_2x2' }))).toEqual(['mouth_c_2x2']);
    expect(entranceOf(MOUTHS, opening([5, 0], 3, { piece: 'mouth_c_2x2' }))).toEqual(['mouth_b_2x3']);
    expect(entranceOf(MOUTHS, opening([5, 0], 1))).toEqual([null]);
    expect(entranceOf(MOUTHS, opening([5, 0], 2, { bare: false, style: 'single' }))).toEqual([null]);
    expect(entranceOf(PLAIN, opening([5, 0], 2))).toEqual([null]);
  });

  it('carries it on a drawn room walled with that rock too', () => {
    const layer = layerOf([drawn(ROOM, MOUTHS), opening([5, 0], 3)]);
    const walls = resolveWalls(layer);
    expect(doorGaps(layer, resolveDoors(layer, walls), walls).map((g) => g.entrance ?? null)).toEqual(['mouth_b_2x3']);
  });

  it('lays the piece across the opening, its joints half the overlap past its ends on the wall, shoved out with the rock', () => {
    const layer = layerOf([brushed(ROOM, MOUTHS), opening([5, 0], 2)]);
    const [cave] = laidCaves(layer);
    const kit = set();
    const [ring] = orientRings(cave.cave.rings);
    const laid = mouthPieces(ring, cave.gaps, kit, true);
    expect(laid).toHaveLength(1);
    expect(laid[0].piece.key).toBe('mouth_a_2x2');
    const half = kitOverlap(kit) / 2;
    const joints = jointsOf(laid[0].piece, laid[0].at)
      .map(([x, y]) => [x, y])
      .sort((p, q) => p[0] - q[0]);
    expect(joints[0][0]).toBeCloseTo(4 - half, 3);
    expect(joints[1][0]).toBeCloseTo(6 + half, 3);
    // Its joints lie where the rock's do, twice the kit's shove off the wall to its void side: outside the cave, north of its wall.
    for (const j of joints) expect(j[1]).toBeCloseTo(-2 * kitOut(kit), 3);
    // None across a plain Opening.
    const plain = layerOf([brushed(ROOM, PLAIN), opening([5, 0], 2)]);
    expect(mouthPieces(orientRings(laidCaves(plain)[0].cave.rings)[0], laidCaves(plain)[0].gaps, kit, true)).toEqual([]);
  });

  it('stops the rock at the opening as a plain Opening of its width does, and leaves its ends untapered', () => {
    const layer = layerOf([brushed(ROOM, MOUTHS), opening([5, 0], 2)]);
    const [cave] = laidCaves(layer);
    const kit = set();
    // On a straight wall the rock is laid exactly as at a plain Opening of the same width.
    const asPlain = cave.gaps.map(({ entrance: _, ...g }) => g);
    expect(layOutlineBand(cave.cave.rings, kit, asPlain, cave.size)).toEqual(cave.placed);
    // No rock across the opening.
    const joints = cave.placed.flat().flatMap((pl) => jointsOf(pl.piece, pl.at));
    expect(joints.filter(([x, y]) => Math.abs(y) < 0.5 && x > 4 + 0.2 && x < 6 - 0.2)).toEqual([]);
    // Its ends are met by the piece: none tapers there. A plain Opening's do.
    const ends = joints.filter(([x, y]) => Math.abs(y) < 0.5 && Math.min(Math.abs(x - 4), Math.abs(x - 6)) < 0.5);
    expect(ends.length).toBeGreaterThan(0);
    const taper = mouthEnds(cave.gaps, cave.size);
    for (const e of ends) expect(taper?.(e) ?? false).toBe(false);
    const plainTaper = mouthEnds(asPlain, cave.size)!;
    for (const e of ends) expect(plainTaper(e)).toBe(true);
  });

  it('on a curved outline opens the rock round the curve, its chord its width, and laps the piece onto the rock either side', () => {
    const layer = layerOf([brushed(CIRCLE, MOUTHS), opening([(CIRCLE[10][0] + CIRCLE[11][0]) / 2, (CIRCLE[10][1] + CIRCLE[11][1]) / 2], 2)]);
    const [cave] = laidCaves(layer);
    // Where the Opening resolved on the cave's wall.
    const mid = cave.gaps[0].position;
    const kit = set();
    const overlap = kitOverlap(kit);
    const [ring] = orientRings(cave.cave.rings);
    const rock = cave.placed[0];
    // No rock art inside the opening: every art end near it lies at least half its width along from its middle.
    const ends = artEnds(rock, overlap).filter(([x, y]) => Math.hypot(x - mid[0], y - mid[1]) < 1.5);
    const near = ends.map(([x, y]) => Math.hypot(x - mid[0], y - mid[1]));
    expect(near.filter((d) => d < 1 - 0.05)).toEqual([]);
    // The piece laps the rock's joint either side by the kit's overlap, so their art meets.
    const [pl] = mouthPieces(ring, cave.gaps, kit, true, rock);
    const rockJoints = rock.flatMap((p) => jointsOf(p.piece, p.at));
    for (const J of jointsOf(pl.piece, pl.at)) {
      const lap = Math.min(...rockJoints.map((R) => Math.hypot(R[0] - J[0], R[1] - J[1])));
      expect(lap).toBeCloseTo(overlap, 2);
    }
    // Its art ends within the overlap of the rock's: no ground shows between them.
    for (const E of artEnds([pl], overlap)) {
      expect(Math.min(...ends.map((R) => Math.hypot(R[0] - E[0], R[1] - E[1])))).toBeLessThan(overlap);
    }
  });
});

describe('the Door tool with the Opening style on a cave wall', () => {
  let tool: DoorTool;
  const doors = () => (useStore.getState().layers.find((l) => l.type === 'dungeon') as DungeonLayer).children.filter((c): c is DoorChild => c.childType === 'door');
  const click = (x: number, y: number) => {
    tool.onPointerMove({ x, y });
    tool.onPointerDown({ x, y });
    tool.onPointerUp({ x, y });
  };
  /** The default map with a cave of rock `kit` on its dungeon layer, its union worked out. */
  const withCave = (kit: string) =>
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
      l.children.push(structuredClone(brushed(ROOM, kit)) as never);
      l.mergedFloor = computeMergedFloor(l as DungeonLayer) as never;
    });

  beforeEach(() => {
    resetAssetPackManager();
    seed();
    undoManager.clear();
    useStore.getState().resetToDefault();
    useStore.getState().updateToolSettings({ doorStairs: false, doorStyle: 'archway', doorBare: true, doorWidth: 1, entranceVariant: undefined, doorFreestanding: false });
    tool = new DoorTool(new Container());
  });

  it('makes it as wide as the nearest piece the rock has, laid with the dock’s pick, and tells the dock that rock', () => {
    withCave(MOUTHS);
    tool.onPointerMove({ x: 5, y: 0.1 });
    expect(useStore.getState().selection.hoverMouthKit).toBe(MOUTHS);
    click(5, 0.1);
    expect(doors().map((d) => [d.width, d.piece, d.bare])).toEqual([[2, 'mouth_a_2x2', true]]);
    undoManager.undo();
    useStore.getState().updateToolSettings({ doorWidth: 3 });
    click(5, 0.1);
    expect(doors().map((d) => [d.width, d.piece])).toEqual([[3, 'mouth_b_2x3']]);
    undoManager.undo();
    useStore.getState().updateToolSettings({ doorWidth: 2, entranceVariant: 1 });
    click(5, 0.1);
    expect(doors().map((d) => [d.width, d.piece])).toEqual([[2, 'mouth_c_2x2']]);
  });

  it('leaves a plain Opening the asked width in rock with no mouth pieces, and the dock with none', () => {
    withCave(PLAIN);
    useStore.getState().setHoverMouthKit(MOUTHS);
    click(5, 0.1);
    expect(useStore.getState().selection.hoverMouthKit).toBeUndefined();
    expect(doors().map((d) => [d.width, d.piece])).toEqual([[1, undefined]]);
  });

  it('keeps the last rock it was told over open floor, so the dock still shows it', () => {
    withCave(MOUTHS);
    tool.onPointerMove({ x: 5, y: 0.1 });
    tool.onPointerMove({ x: 5, y: 4 });
    expect(useStore.getState().selection.hoverMouthKit).toBe(MOUTHS);
  });
});
