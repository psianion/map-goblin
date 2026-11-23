// A measured cave kit on a real joined map: a six-sided cave and a rectangular one joined by
// a two-cell corridor, a mouth erased into the six-sided one, a door on the rectangle, and a
// brush-painted cave. Each ring's rock is held to the rules in testing/bandChecks.ts.
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: () => loaded };
});

import { Container } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { bandPiecesFor } from '../assets/caveWallKit';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { brokenRules, checkBand, type BandCheck } from '../testing/bandChecks';
import { bandFloorFit, FIT_DOOR_PAD, fittedFloor } from './caveBandRenderer';
import { kitOverlap, type WalkPlacement } from './caveWalk';
import { computeMergedFloor } from './mergedFloor';
import { renderNodeWalls, type DoorGap } from './wallNodeRenderer';
import { laidCaves } from './material/materialRenderer';
import { ringStyles } from '../shared/wallLook';
import { doorOpeningCuts, resolveDoors, resolveWalls } from '../shared/wallResolve';
import type { BandMeasure, ManifestEntry } from './packManifest';
import type { DungeonLayer, DungeonStyle } from '../store/types';
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

const SET = 'Test_Cave';
const STONE = 'Test_Stone';

/**
 * A measured kit drawn like a real cave set: straights of 1 to 8 cells whose rock wavers
 * along a spine, and an inside and an outside bend in 2, 3 and 4 cells, each joint 0.15 cell
 * past its tile's end and 0.36 off its middle toward the void.
 */
function seedKit(): void {
  const entry = (material: string, gridSize: string, band: BandMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: ['colored'], band });
  const entries: Record<string, ManifestEntry> = {};
  for (let L = 1; L <= 8; L++) {
    const end = L / 2 + 0.15;
    const spine: [number, number][] = [];
    for (let k = 0; k <= L * 4; k++) {
      const x = L / 2 - k / 4;
      spine.push([+x.toFixed(3), +(0.12 + 0.07 * Math.sin(2.3 * x + L)).toFixed(3)]);
    }
    entries[`run_${L}x2_A`] = entry('run', `${L}x2`, { joints: [[end, 0.36], [-end, 0.36]], turnDeg: 0, spine });
  }
  for (const N of [2, 3, 4]) {
    const end = N / 2 + 0.15;
    entries[`turn_in_${N}x${N}_A`] = entry('turn_in', `${N}x${N}`, { joints: [[N / 2 - 0.64, -end], [-end, N / 2 - 0.64]], turnDeg: 90 });
    entries[`turn_out_${N}x${N}_A`] = entry('turn_out', `${N}x${N}`, { joints: [[-end, N / 2 - 1.36], [N / 2 - 1.36, -end]], turnDeg: -90 });
  }
  seedPack('test-pack', entries);
}

const floorShape = (id: string, setId: string, contour: Polygon) => ({
  id,
  name: id,
  childType: 'shape',
  visible: true,
  shapeType: 'polygon',
  contours: [contour],
  styleOverrides: { wallTextureSetId: setId },
});

/** The "FA cave test 1" map as drawn, its sets renamed. */
function fixture(): DungeonLayer {
  const layer = {
    id: 'l1',
    name: 'Dungeon',
    type: 'dungeon',
    visible: true,
    children: [
      floorShape('six', SET, [[14.945, 6.984], [12.961, 11.969], [6.961, 12.992], [2.992, 9.023], [3.258, 7.648], [4.719, 7.648], [4.719, 6.016], [3.57, 6.016], [3.953, 4.031], [11.945, 3.016]]),
      floorShape('rect', SET, [[17.952, 4.033], [25.992, 4.033], [25.992, 11.005], [17.952, 11.005]]),
      floorShape('corridor', SET, [[13.931, 6.018], [19.02, 6.018], [19.02, 8.003], [13.931, 8.003]]),
      floorShape('stone', STONE, [[16.982, 15.014], [24.973, 15.014], [26.999, 16.964], [26.999, 22.967], [16.982, 22.967]]),
      {
        ...floorShape('cave', '', [[8.799, 13.963], [9.943, 14.317], [10.402, 14.576], [10.698, 14.824], [11.156, 15.35], [12.126, 16.769], [13.175, 17.88], [13.61, 18.451], [14.023, 19.338], [14.209, 20.279], [14.151, 21.223], [13.779, 22.195], [13.053, 23.209], [12.102, 24.092], [11.572, 24.445], [10.728, 24.865], [9.485, 25.255], [8.439, 25.306], [6.64, 25.07], [5.256, 25.154], [4.525, 25.109], [3.535, 24.901], [2.547, 24.498], [1.848, 23.94], [1.266, 23.169], [0.935, 22.467], [0.741, 21.552], [0.757, 20.81], [0.933, 20.047], [1.376, 19.037], [2.088, 17.768], [2.751, 16.757], [3.315, 16.104], [4.108, 15.45], [5.192, 14.729], [6.031, 14.314], [6.851, 14.052], [7.882, 13.91]]),
        edgeMaterial: SET,
      },
      { id: 'd1', name: 'Single 1', childType: 'door', visible: true, wallId: '', position: [16.984375, 18.99491094147583], angle: -Math.PI / 2, width: 1, style: 'single', state: 'closed', isSecret: false, roomA: null, roomB: null },
      { id: 'd2', name: 'Single 2', childType: 'door', visible: true, wallId: '', position: [19.987277353689567, 11.0078125], angle: Math.PI, width: 1, style: 'single', state: 'closed', isSecret: false, roomA: null, roomB: null },
    ],
    standaloneWalls: [],
    style: { floorColor: '#F1ECDF', wallColor: '#000000', wallWidth: 0.5, lineWidth: 0.04, wallTextureSetId: STONE, wallTextureTint: '#b09878' },
    caveOpenings: [[[4.719, 7.648], [2.383, 7.648], [2.383, 6.016], [4.719, 6.016]]],
    mergedFloor: null,
  } as unknown as DungeonLayer;
  layer.mergedFloor = computeMergedFloor(layer);
  return layer;
}

/** Every ring of the map laid with the kit, as the editor lays it, and what each measured. */
function measureMap(): { name: string; check: BandCheck; placed: WalkPlacement[] }[] {
  const layer = fixture();
  const rings = layer.mergedFloor ?? [];
  const walls = resolveWalls(layer);
  const doorGaps = resolveDoors(layer, walls).flatMap((d) => doorOpeningCuts(d, walls)) as DoorGap[];
  const overlap = kitOverlap(bandPiecesFor(SET));
  const out: { name: string; check: BandCheck; placed: WalkPlacement[] }[] = [];
  renderNodeWalls(new Container(), rings, [], layer.style as DungeonStyle, doorGaps, {}, {
    ringStyles: ringStyles(layer),
    openings: layer.caveOpenings,
    onBandLaid: ({ ring, placed, gaps, size }) => {
      const floor = fittedFloor([ring], bandFloorFit(ring, placed, gaps, size));
      out.push({ name: 'the joined caves', placed, check: checkBand({ ring, placed, gaps, openings: layer.caveOpenings, floor, size, overlap, doorPad: FIT_DOOR_PAD }) });
    },
  });
  // A painted cave's rock as drawn, and its floor fitted to that same laying as the rebuild fits it.
  for (const { rings: caveRings, placed: laid, gaps, size } of laidCaves(layer)) {
    caveRings.forEach((ring, i) => {
      const placed = laid[i];
      const floor = fittedFloor([ring], bandFloorFit(ring, placed, gaps, size));
      out.push({ name: 'the brush cave', placed, check: checkBand({ ring, placed, gaps, openings: layer.caveOpenings, floor, size, overlap, doorPad: FIT_DOOR_PAD }) });
    });
  }
  return out;
}

const fmt = (c: BandCheck): string => JSON.stringify(c, (_, v) => (typeof v === 'number' ? +v.toFixed(2) : v));

describe('a measured cave kit on a joined, carved, brushed map', () => {
  it('lays every ring with no bare wall, no rock in an opening or a corridor, the floor met and every piece at its size', () => {
    seedKit();
    const measured = measureMap();
    const report = measured.map(({ name, check }) => `${name}: ${fmt(check)}`).join('\n');
    expect(measured.map(({ name, check }) => [name, brokenRules(check)]), report).toEqual([
      ['the joined caves', []],
      ['the brush cave', []],
    ]);
  });
});
