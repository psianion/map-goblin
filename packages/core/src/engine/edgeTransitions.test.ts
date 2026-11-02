import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { planEdgeBorders, sharedBoundary } from './edgeTransitions';
import { floorEdgeStrip } from '../assets/packCatalog';
import { getAssetPackManager, resetAssetPackManager } from './assetPackInstance';
import type { ManifestEntry, PackManifest } from './assetPackManager';
import type { ShapeChild } from '../shared/types';

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const shape = (id: string, ring: [number, number][], textureId?: string): ShapeChild => ({
  id,
  name: id,
  childType: 'shape',
  visible: true,
  shapeType: 'polygon',
  contours: [ring],
  textureId,
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
});

/** One run of the top ring, from `a` to `b`, every point on the line between them. */
function expectRun(chains: [number, number][][], a: [number, number], b: [number, number]) {
  expect(chains).toHaveLength(1);
  const run = chains[0];
  expect(run[0]).toEqual(a);
  expect(run[run.length - 1]).toEqual(b);
  for (const [x, y] of run) expect((x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])).toBeCloseTo(0, 9);
}

describe('sharedBoundary', () => {
  it('finds the stretch of the top ring that lies over the shape beneath', () => {
    // Top overlaps the right half of the bottom: its left edge (x = 5) runs over the bottom.
    const { chains, closed } = sharedBoundary(square(5, 0, 15, 10), square(0, 0, 10, 10));
    expect(closed).toBe(false);
    expectRun(chains, [5, 10], [5, 0]);
  });

  it('runs that cross the ring’s seam come back as one', () => {
    // The top's first and last edges both lie over the bottom.
    // The ring starts halfway up its left side: the run over the bottom shape (its left side
    // and the first three cells of its top and bottom) wraps past the start.
    const { chains } = sharedBoundary([[5, 5], [5, 0], [15, 0], [15, 10], [5, 10]], square(0, -5, 8, 15));
    expect(chains).toHaveLength(1);
    expect(chains[0][0]).toEqual([8, 10]);
    expect(chains[0][chains[0].length - 1]).toEqual([8, 0]);
    expect(chains[0]).toContainEqual([5, 5]);
  });

  it('takes the part of an edge that runs over the shape beneath, not the whole edge', () => {
    // The top's long sides run four cells over the bottom, then six cells past it.
    const { chains } = sharedBoundary(square(-2, -3, 8, 3), square(-8, -5, 2, 5));
    expect(chains).toHaveLength(1);
    const run = chains[0];
    expect(run[0]).toEqual([2, 3]);
    expect(run[run.length - 1]).toEqual([2, -3]);
    expect(run).toContainEqual([-2, 3]);
    expect(run).toContainEqual([-2, -3]);
    expect(run.every(([x]) => x <= 2)).toBe(true);
  });

  it('a shape set inside another borders all round; shapes apart share nothing', () => {
    expect(sharedBoundary(square(2, 2, 4, 4), square(0, 0, 10, 10)).closed).toBe(true);
    expect(sharedBoundary(square(20, 20, 30, 30), square(0, 0, 10, 10)).chains).toEqual([]);
  });

  it('works whichever way the top ring winds', () => {
    const cw = [...square(5, 0, 15, 10)].reverse();
    expect(sharedBoundary(cw, square(0, 0, 10, 10)).chains).toHaveLength(1);
  });
});

describe('planEdgeBorders', () => {
  const a = shape('a', square(0, 0, 10, 10), 'pack:stone');
  const b = shape('b', square(5, 0, 15, 10), 'pack:cave');

  it('the shape on top lays its texture’s strip along the boundary over the one beneath', () => {
    const plan = planEdgeBorders([a, b], 0.5, (s) => (s.textureId === 'pack:cave' ? 'pack:cave_edge_2x1' : undefined));
    expect(plan.blends).toEqual([]);
    expect(plan.strips).toMatchObject([{ top: 1, bottom: 0, stripId: 'pack:cave_edge_2x1', closed: false }]);
    expectRun(plan.strips[0].chains, [5, 10], [5, 0]);
  });

  it('falls back to the colour blend when the top texture has no strip, even if the one beneath does', () => {
    const plan = planEdgeBorders([b, a], 0.5, (s) => (s.textureId === 'pack:cave' ? 'pack:cave_edge_2x1' : undefined));
    expect(plan.strips).toEqual([]);
    expect(plan.blends).toEqual([[b, a]]);
  });

  it('same textures, and shapes far apart, border nothing', () => {
    const same = shape('c', square(5, 0, 15, 10), 'pack:stone');
    const far = shape('d', square(40, 40, 50, 50), 'pack:cave');
    expect(planEdgeBorders([a, same, far], 0.5, () => 'x')).toEqual({ strips: [], blends: [] });
  });
});

describe('floorEdgeStrip', () => {
  const entry = (material: string, type: string, gridSize: string): ManifestEntry =>
    ({ type, material, gridSize, pieceType: type, variant: 'A', set: 'S', tags: [] }) as unknown as ManifestEntry;
  beforeEach(() => {
    resetAssetPackManager();
    const manifest: PackManifest = {
      name: 'gg-forge',
      description: '',
      version: '1',
      bundleSize: 0,
      atlases: {},
      files: {},
      entries: {
        cave_floor_8x8_floor_A: entry('cave_floor', 'floor', '8x8'),
        cave_floor_edge_2x1: entry('cave_floor_edge_2x1', 'edge', '2x1'),
        stone_8x8_floor_A: entry('stone', 'floor', '8x8'),
      },
    };
    const manager = getAssetPackManager();
    (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set('gg-forge', manifest);
    manager.catalogVersion++;
  });
  afterEach(() => resetAssetPackManager());

  it('finds `<material>_edge_2x1` beside a floor texture, by full or bare id', () => {
    expect(floorEdgeStrip('gg-forge:cave_floor_8x8_floor_A')?.id).toBe('gg-forge:cave_floor_edge_2x1');
    expect(floorEdgeStrip('cave_floor_8x8_floor_A')?.id).toBe('gg-forge:cave_floor_edge_2x1');
    expect(floorEdgeStrip('gg-forge:stone_8x8_floor_A')).toBeUndefined();
    expect(floorEdgeStrip(undefined)).toBeUndefined();
  });
});
