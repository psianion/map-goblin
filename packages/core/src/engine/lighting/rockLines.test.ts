// Light, sight and movement along a measured kit's rock line (`DungeonLayer.rockLines`): the
// line blocks instead of the drawn edge it was laid for, doors keep their drawn span and are
// joined to the rock, and a line whose outline has changed is ignored.
import { describe, expect, it } from 'vitest';
import { extractMoveSegments, extractWallSegments, type Segment } from './raycaster';
import type { DoorChild } from '../../shared/types';
import type { DungeonLayer, RockLine } from '../../store/types';

type Pt = [number, number];

const ring = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];

let layerSeq = 0;
function layerOf(floor: Pt[], extra: Partial<DungeonLayer> = {}): DungeonLayer {
  return {
    id: `rock-${layerSeq++}`,
    type: 'dungeon',
    children: [],
    standaloneWalls: [],
    mergedFloor: [floor],
    style: {},
    ...extra,
  } as unknown as DungeonLayer;
}

/** The 10 by 8 ring's rock, wandering 0.3 either side of the top edge. */
const whole: RockLine = {
  edge: ring(10, 8),
  closed: true,
  runs: [[[0, 0], [2, 0.3], [4, -0.3], [6, 0.3], [8, -0.3], [10, 0], [10, 8], [0, 8], [0, 0]]],
};

/** The same rock stopped either side of a doorway from x 4 to 6 on the top edge. */
const broken: RockLine = {
  edge: ring(10, 8),
  closed: true,
  runs: [[[6.2, 0.25], [8, -0.3], [10, 0], [10, 8], [0, 8], [0, 0], [2, 0.3], [3.8, -0.25]]],
};

const door = (state: 'open' | 'closed'): DoorChild =>
  ({
    id: 'door-top',
    name: 'Door',
    childType: 'door',
    visible: true,
    wallId: '',
    position: [5, 0],
    angle: 0,
    width: 2,
    style: 'door',
    state,
    isSecret: false,
  }) as unknown as DoorChild;

const pairs = (segs: { x1: number; y1: number; x2: number; y2: number }[]) => segs.map((s) => [s.x1, s.y1, s.x2, s.y2]);
const along = (run: Pt[]) => run.slice(1).map((p, i) => [run[i][0], run[i][1], p[0], p[1]]);
/** A segment lying on the drawn top edge. */
const onTop = (s: Segment | { y1: number; y2: number }) => s.y1 === 0 && s.y2 === 0;

describe('a rock line in place of the drawn edge', () => {
  it('blocks light, sight and movement along the rock, not along the drawn top', () => {
    const layer = layerOf(ring(10, 8), { rockLines: [whole] });
    for (const kind of ['light', 'sight'] as const) {
      const segs = extractWallSegments([layer], kind);
      expect(pairs(segs)).toEqual(expect.arrayContaining(along(whole.runs[0])));
      expect(segs.some(onTop)).toBe(false);
      expect(segs.every((s) => s.direction === 'both' && s.blocksLight && s.blocksSight)).toBe(true);
    }
    const moves = extractMoveSegments([layer]);
    expect(pairs(moves)).toEqual(along(whole.runs[0]));
    expect(moves.every((m) => m.wallKind === 'floor' && m.width === 0.5)).toBe(true);
  });

  it('gives exactly today’s segments for the same layer with no rock line', () => {
    const plain = layerOf(ring(10, 8));
    const edges = along([...ring(10, 8), [0, 0]]);
    expect(pairs(extractWallSegments([plain], 'light'))).toEqual(edges);
    expect(extractWallSegments([plain], 'sight')).toEqual(
      edges.map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2, direction: 'both', blocksLight: true, blocksSight: true })),
    );
    expect(extractMoveSegments([plain])).toEqual(edges.map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2, wallKind: 'floor', width: 0.5 })));
  });

  it('ignores a line whose drawn outline has since changed', () => {
    const grown = ring(12, 8);
    const today = layerOf(grown);
    const stale = layerOf(grown, { rockLines: [whole] });
    expect(extractWallSegments([stale], 'light')).toEqual(extractWallSegments([today], 'light'));
    expect(extractMoveSegments([stale])).toEqual(extractMoveSegments([today]));
  });
});

describe('a door on a rock line', () => {
  const jambs = [
    [4, 0, 3.8, -0.25],
    [6, 0, 6.2, 0.25],
  ];

  it('still blocks between its ends when shut, and each end is joined to the rock', () => {
    const layer = layerOf(ring(10, 8), { children: [door('closed')], rockLines: [broken] });
    const light = pairs(extractWallSegments([layer], 'light'));
    expect(light).toEqual(expect.arrayContaining([[4, 0, 6, 0], ...jambs, ...along(broken.runs[0])]));
    expect(light.filter(([, y1, , y2]) => y1 === 0 && y2 === 0)).toEqual([[4, 0, 6, 0]]);
    const moves = extractMoveSegments([layer]);
    expect(moves.find((m) => m.doorId === 'door-top')).toMatchObject({ x1: 4, y1: 0, x2: 6, y2: 0 });
    expect(pairs(moves)).toEqual(expect.arrayContaining(jambs));
  });

  it('lets light through when open, and keeps the jambs', () => {
    const layer = layerOf(ring(10, 8), { children: [door('open')], rockLines: [broken] });
    for (const kind of ['light', 'sight'] as const) {
      const segs = pairs(extractWallSegments([layer], kind));
      expect(segs).toEqual(expect.arrayContaining(jambs));
      expect(segs.some(([, y1, , y2]) => y1 === 0 && y2 === 0)).toBe(false);
    }
    expect(extractMoveSegments([layer]).some((m) => m.doorId)).toBe(false);
    expect(pairs(extractMoveSegments([layer]))).toEqual(expect.arrayContaining(jambs));
  });

  it('joins nothing to an erased opening', () => {
    const opening: Pt[] = [[4, -0.5], [6, -0.5], [6, 0.5], [4, 0.5]];
    const layer = layerOf(ring(10, 8), { caveOpenings: [opening], rockLines: [broken] });
    const touchesMouth = ([x1, y1, x2, y2]: number[]) => [[x1, y1], [x2, y2]].some(([x, y]) => y === 0 && (x === 4 || x === 6));
    for (const kind of ['light', 'sight'] as const) {
      const segs = pairs(extractWallSegments([layer], kind));
      expect(segs).toEqual(along(broken.runs[0]));
    }
    expect(pairs(extractMoveSegments([layer])).some(touchesMouth)).toBe(false);
  });
});
