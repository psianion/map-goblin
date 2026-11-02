import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { DungeonLayer, ShapeChild } from '../store/types';
import {
  edgeHides,
  edgeRuns,
  hasPlateaus,
  layerPlateaus,
  plateauChains,
  shapeDrop,
  tierLift,
  crossingIdOf,
  crossingsAlong,
  elevationAt,
  elevationAtLayers,
  hiddenTops,
  uncoveredRuns,
  landingGaps,
  ringGaps,
  cliffOccluders,
} from './plateaus';
import type { PathChild } from './types';
import { defaultCrossingKinds } from './crossingKinds';
import { computeMergedFloor } from '../engine/mergedFloor';

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

const layerOf = (children: ShapeChild[]) => ({ children }) as unknown as DungeonLayer;

describe('plateau chains', () => {
  it('nests a raised floor inside the smallest raised floor holding its centroid', () => {
    const hill = rect('hill', 0, 0, 20, 20, { height: 1, edge: 'slope' });
    const big = rect('big', -5, -5, 30, 30, { height: 1, edge: 'cliff' });
    const summit = rect('summit', 5, 5, 10, 10, { height: 2, edge: 'cliff' });
    const infos = plateauChains([big, hill, summit]);
    expect(infos.get('summit')!.parent?.id).toBe('hill');
    expect(infos.get('hill')!.parent?.id).toBe('big');
    expect(infos.get('big')!.parent).toBeNull();
    expect(infos.get('summit')!.chain.map((s) => s.id)).toEqual(['big', 'hill', 'summit']);
  });

  it('adds heights along the chain: +2 on +1 reads 3', () => {
    const hill = rect('hill', 0, 0, 20, 20, { height: 1, edge: 'slope' });
    const summit = rect('summit', 5, 5, 10, 10, { height: 2, edge: 'cliff' });
    const infos = plateauChains([hill, summit]);
    expect(infos.get('hill')!.height).toBe(1);
    expect(infos.get('summit')!.height).toBe(3);
  });

  it('carries a floor with no height of its own up to its plateau', () => {
    const top = rect('top', 0, 0, 10, 10, { height: 2, edge: 'cliff' });
    const patch = rect('patch', 2, 2, 4, 4);
    const ground = rect('ground', -10, -10, 30, 30);
    const infos = plateauChains([ground, top, patch]);
    expect(infos.get('patch')!.height).toBe(2);
    expect(infos.get('ground')!.height).toBe(0);
    expect(infos.get('ground')!.chain).toEqual([]);
  });

  it('never takes a smaller floor, or a floor with no height, as a parent', () => {
    const small = rect('small', 4, 4, 6, 6, { height: 3 });
    const big = rect('big', 0, 0, 10, 10);
    const infos = plateauChains([small, big]);
    expect(infos.get('big')!.parent).toBeNull();
    expect(infos.get('small')!.parent).toBeNull();
  });

  it('breaks an equal-area tie by draw order, so two copies never parent each other', () => {
    const a = rect('a', 0, 0, 4, 4, { height: 1 });
    const b = rect('b', 0, 0, 4, 4, { height: 1 });
    const infos = plateauChains([a, b]);
    expect(infos.get('a')!.parent).toBeNull();
    expect(infos.get('b')!.parent?.id).toBe('a');
    expect(infos.get('b')!.height).toBe(2);
  });
});

describe('bands and drops', () => {
  const ground = rect('ground', 0, 0, 30, 30);

  it('merges floors of equal absolute height into one band and keeps the ground apart', () => {
    const a = rect('a', 2, 2, 8, 8, { height: 2, edge: 'cliff' });
    const b = rect('b', 6, 2, 12, 8, { height: 2, edge: 'cliff' });
    const c = rect('c', 20, 20, 24, 24, { height: 1, edge: 'cliff' });
    const p = layerPlateaus(layerOf([ground, a, b, c]));
    expect(p.ground.map((s) => s.id)).toEqual(['ground']);
    expect(p.bands.map((band) => band.height)).toEqual([1, 2]);
    expect(p.bands[1].rings).toHaveLength(1);
    expect(p.bands[1].shapes.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('a plateau drops outward (positive), a pit inward (negative)', () => {
    const top = rect('top', 5, 5, 10, 10, { height: 2, edge: 'cliff' });
    const pit = rect('pit', 15, 15, 20, 20, { height: -3, edge: 'cliff' });
    const p = layerPlateaus(layerOf([ground, top, pit]));
    const drops = (h: number) => p.bands.find((b) => b.height === h)!.edges.flat().map((e) => e.drop);
    expect(new Set(drops(2))).toEqual(new Set([2]));
    expect(new Set(drops(-3))).toEqual(new Set([-3]));
  });

  it('measures a nested summit against the slope it stands on, not the ground', () => {
    const hill = rect('hill', 2, 2, 20, 20, { height: 1, edge: 'slope' });
    const summit = rect('summit', 6, 6, 12, 12, { height: 2, edge: 'cliff' });
    const layer = layerOf([ground, hill, summit]);
    expect(shapeDrop(layer, 'summit')).toBe(2);
    expect(shapeDrop(layer, 'hill')).toBe(1);
  });

  it('measures a pillar in a pit as rising out of the pit', () => {
    const pit = rect('pit', 2, 2, 20, 20, { height: -3, edge: 'cliff' });
    const pillar = rect('pillar', 8, 8, 12, 12, { height: 2, edge: 'cliff' });
    const layer = layerOf([ground, pit, pillar]);
    expect(layerPlateaus(layer).infos.get('pillar')!.height).toBe(-1);
    expect(shapeDrop(layer, 'pillar')).toBe(2);
  });

  it('winds every band ring with the low side on the left of travel', () => {
    const top = rect('top', 5, 5, 10, 10, { height: 2, edge: 'cliff' });
    const [band] = layerPlateaus(layerOf([ground, top])).bands;
    const ring = band.rings[0];
    // Walk the first edge; a point a hair to its left must be off the band.
    const [a, b] = [ring[0], ring[1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const left: [number, number] = [(a[0] + b[0]) / 2 + (b[1] - a[1]) / len * 0.1, (a[1] + b[1]) / 2 - (b[0] - a[0]) / len * 0.1];
    const inside = left[0] > 5 && left[0] < 10 && left[1] > 5 && left[1] < 10;
    expect(inside).toBe(false);
  });

  it('cuts a mixed ring into runs by owner and edge kind', () => {
    const a = rect('a', 2, 2, 8, 8, { height: 2, edge: 'cliff' });
    const b = rect('b', 8, 2, 14, 8, { height: 2, edge: 'slope' });
    const [band] = layerPlateaus(layerOf([ground, a, b])).bands;
    const runs = edgeRuns(band);
    expect(new Set(runs.map((r) => r.edge))).toEqual(new Set(['cliff', 'slope']));
    expect(runs.every((r) => !r.closed)).toBe(true);
  });
});

describe('the merged floor and rooms', () => {
  const ground = rect('ground', 0, 0, 30, 30);

  it('is unchanged on a flat layer', () => {
    expect(hasPlateaus(layerOf([ground]))).toBe(false);
    expect(computeMergedFloor(layerOf([ground]))).toEqual([ground.contours[0]]);
  });

  it('leaves cliffs, slopes and bare edges out, and keeps a raised room', () => {
    const cliff = rect('cliff', 2, 2, 6, 6, { height: 2, edge: 'cliff' });
    const slope = rect('slope', 8, 8, 12, 12, { height: 1, edge: 'slope' });
    const tower = rect('tower', 20, 20, 25, 25, { height: 3 });
    const floor = computeMergedFloor(layerOf([ground, cliff, slope, tower]))!;
    expect(floor).toHaveLength(2);
    expect(floor[0]).toEqual(ground.contours[0]);
    const xs = floor[1].map(([x]) => x);
    expect(Math.min(...xs)).toBe(20);
    expect(Math.max(...xs)).toBe(25);
  });
});

describe('sight and crossing', () => {
  it('hides from the threshold up on cliffs only, unless overridden', () => {
    expect(edgeHides(null, 'cliff', 2, 2)).toBe(true);
    expect(edgeHides(null, 'cliff', -2, 2)).toBe(true);
    expect(edgeHides(null, 'cliff', 1, 2)).toBe(false);
    expect(edgeHides(null, 'slope', 5, 2)).toBe(false);
    expect(edgeHides({ sightOverride: 'hide' }, 'slope', 1, 2)).toBe(true);
    expect(edgeHides({ sightOverride: 'show' }, 'cliff', 5, 2)).toBe(false);
    expect(edgeHides({ sightOverride: 'hide' }, 'wall', 5, 2)).toBe(false);
  });

  it('defaults the crossing by edge kind', () => {
    expect(crossingIdOf({ edge: 'cliff' })).toBe('climb');
    expect(crossingIdOf({ edge: 'slope' })).toBe('difficult');
    expect(crossingIdOf({ edge: 'none' })).toBe('free');
    expect(crossingIdOf({ edge: 'cliff', crossingId: 'impassable' })).toBe('impassable');
  });

  it('lifts a band 3 % a cell, capped at 12 %', () => {
    expect(tierLift(1)).toBeCloseTo(0.03);
    expect(tierLift(10)).toBeCloseTo(0.12);
    expect(tierLift(-2)).toBeCloseTo(-0.06);
  });
});

describe('the table: elevation and crossings', () => {
  const ground = rect('ground', 0, 0, 30, 30);
  const top = rect('top', 10, 10, 14, 14, { height: 3, edge: 'cliff' });
  // Stairs mid west edge: the outline runs (10,10)→(14,10)→(14,14)→(10,14), (10,12) at 14/16.
  const stairs = { id: 'st', name: 'st', childType: 'opening', visible: true, kind: 'stairs', shapeId: 'top', t: 14 / 16, width: 2 } as const;
  const layer = layerOf([ground, top, stairs as unknown as ShapeChild]);
  const kinds = defaultCrossingKinds();

  it('stands a point on the plateau, the ground, or part way down the stairs', () => {
    expect(elevationAt(layer, 12, 12)).toBe(3);
    expect(elevationAt(layer, 5, 5)).toBe(0);
    // Downhill runs west from (10, 12) over a reach of 3 cells: half way is half the drop.
    expect(elevationAt(layer, 8.5, 12)).toBeCloseTo(1.5);
    expect(elevationAtLayers([layerOf([ground]), layer], 12, 12)).toBe(3);
  });

  it('lists the cliff a move goes over, going up or down', () => {
    const up = crossingsAlong(layer, [12, 8], [12, 11], kinds);
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ via: 'cliff', targetId: 'top', kindId: 'climb', chip: true, blocks: false, down: false });
    expect(crossingsAlong(layer, [12, 11], [12, 8], kinds)[0].down).toBe(true);
  });

  it('takes an opening’s rule through its gap, and a live override over the map', () => {
    expect(crossingsAlong(layer, [8, 12], [11, 12], kinds)[0]).toMatchObject({ via: 'opening', kindId: 'free', chip: false });
    const live = crossingsAlong(layer, [12, 8], [12, 11], kinds, { edges: { top: 'impassable' } });
    expect(live[0]).toMatchObject({ kindId: 'impassable', blocks: true });
    expect(crossingsAlong(layer, [12, 8], [12, 11], kinds, { blocks: { climb: true } })[0].blocks).toBe(true);
  });
});

describe('a raised floor covers the wall under it', () => {
  const withFloor = (children: ShapeChild[]) => {
    const layer = { children, mergedFloor: null } as unknown as DungeonLayer;
    layer.mergedFloor = computeMergedFloor(layer);
    return layer;
  };

  it("cuts the ground's ring where a raised room stands over it, and leaves the room's own ring whole", () => {
    const layer = withFloor([rect('ground', 0, 0, 20, 16), rect('over', 16, 4, 24, 10, { height: 2, edge: 'wall' })]);
    const runs = uncoveredRuns(layer)!;
    expect(layer.mergedFloor).toHaveLength(2);
    const ground = runs(0)!;
    expect(ground).toHaveLength(1);
    // One open run, from where the east wall leaves the room to where it comes back.
    const ends = [ground[0][0], ground[0][ground[0].length - 1]].map(([x, y]) => [x, y].map((v) => Math.round(v * 100) / 100));
    expect(ends).toEqual(expect.arrayContaining([[20, 4], [20, 10]]));
    expect(ground[0].some(([x, y]) => x === 20 && y > 4 && y < 10)).toBe(false);
    expect(runs(1)).toBeNull();
  });

  it('leaves every ring alone where nothing higher stands over it', () => {
    const layer = withFloor([rect('ground', 0, 0, 20, 16), rect('inner', 3, 3, 8, 8, { height: 2, edge: 'wall' })]);
    expect(uncoveredRuns(layer)!(0)).toBeNull();
    expect(uncoveredRuns(withFloor([rect('ground', 0, 0, 20, 16)]))).toBeNull();
  });
});

describe('hidden tops', () => {
  it('lists a cliff top that hides from below, and no slope, pit or low ledge', () => {
    const tops = hiddenTops(
      layerOf([
        rect('ground', 0, 0, 40, 40),
        rect('mesa', 2, 2, 8, 8, { height: 3, edge: 'cliff' }),
        rect('hill', 10, 2, 16, 8, { height: 3, edge: 'slope' }),
        rect('pit', 20, 2, 26, 8, { height: -3, edge: 'cliff' }),
        rect('ledge', 30, 2, 36, 8, { height: 1, edge: 'cliff' }),
      ]),
      2,
    );
    expect(tops.map((t) => t.height)).toEqual([3]);
  });
});

describe('a lone floor at height keeps its band', () => {
  const withFloor = (children: ShapeChild[]) => {
    const layer = { children, mergedFloor: null } as unknown as DungeonLayer;
    layer.mergedFloor = computeMergedFloor(layer);
    return layer;
  };
  // Same ring whatever its start or winding: the band ring is wound outside-left.
  const canon = (ring: readonly (readonly number[])[]) => {
    const keys = ring.map(([x, y]) => `${x},${y}`).sort();
    return keys.join(' ');
  };
  const flat = withFloor([rect('cave', 0, 0, 8, 7)]);

  for (const height of [1, -1]) {
    for (const edge of ['cliff', 'slope', 'none'] as const) {
      it(`keeps the floor of a lone cave at ${height} with a ${edge} edge`, () => {
        const layer = withFloor([rect('cave', 0, 0, 8, 7, { height, edge })]);
        expect(layer.mergedFloor).not.toBeNull();
        expect(layer.mergedFloor).toHaveLength(1);
        expect(canon(layer.mergedFloor![0])).toBe(canon(flat.mergedFloor![0]));
      });
    }
  }

  it('keeps a cliff plateau standing on the ground out of the floor union', () => {
    const layer = withFloor([rect('ground', 0, 0, 20, 16), rect('mesa', 3, 3, 8, 8, { height: 2, edge: 'cliff' })]);
    expect(layer.mergedFloor).toHaveLength(1);
  });

  it('keeps a ledge on a lone cliff floor out of the union, and the floor in it', () => {
    const layer = withFloor([
      rect('cave', 0, 0, 20, 16, { height: 1, edge: 'cliff' }),
      rect('ledge', 3, 3, 8, 8, { height: 1, edge: 'cliff' }),
    ]);
    expect(layer.mergedFloor).toHaveLength(1);
    expect(canon(layer.mergedFloor![0])).toBe(canon(rect('x', 0, 0, 20, 16).contours[0]));
    // The ledge stands above the cave floor's ring: the cave's ring is covered nowhere.
    expect(uncoveredRuns(layer)!(0)).toBeNull();
  });

  it('gives each returned ring its own height for the covering test', () => {
    // A cliff cave at +1 on void, a raised room at +3 over its east edge.
    const layer = withFloor([
      rect('cave', 0, 0, 20, 16, { height: 1, edge: 'cliff' }),
      rect('over', 16, 4, 24, 10, { height: 2, edge: 'wall' }),
    ]);
    expect(layer.mergedFloor).toHaveLength(2);
    const runs = uncoveredRuns(layer)!;
    expect(runs(0)).not.toBeNull();
    expect(runs(1)).toBeNull();
  });
});

describe('bridge landings', () => {
  // The plateau-test bridge: from the +2 outcrop's south edge to the +3 mesa's north edge.
  const outcrop = rect('outcrop', 4, 4, 12, 11, { height: 2, edge: 'cliff' });
  const mesa = rect('mesa', 4, 26, 12, 31, { height: 3, edge: 'cliff' });
  const bridge = (over: Partial<PathChild> = {}): PathChild => ({
    id: 'bridge',
    name: 'Bridge',
    childType: 'path',
    visible: true,
    points: [{ x: 7, y: 11, height: 2 }, { x: 7, y: 26, height: 3 }],
    closed: false,
    width: 2,
    heightMode: 'set',
    materialId: 'gg-forge:planks',
    tint: '#ffffff',
    opacity: 1,
    offset: 0,
    flip: false,
    edge: 'soft',
    ends: { start: 'cut', end: 'cut', length: 1 },
    sort: 'overhead',
    ...over,
  });
  const layerWith = (...children: unknown[]) => ({ children }) as unknown as DungeonLayer;

  it('opens a gap as wide as the bridge where each of its ends rests on a ring', () => {
    const gaps = landingGaps(layerWith(outcrop, mesa, bridge()));
    expect(gaps).toHaveLength(2);
    const [a, b] = gaps;
    expect(a.id).toBe('landing:bridge:start');
    expect(a.position[0]).toBeCloseTo(7, 6);
    expect(a.position[1]).toBeCloseTo(11, 6);
    expect(a.width).toBe(2);
    expect(b.id).toBe('landing:bridge:end');
    expect(b.position[1]).toBeCloseTo(26, 6);
    // The landing is part of every ring gap, so the ledge rock and the sight lines part there.
    expect(ringGaps(layerWith(outcrop, mesa, bridge())).map((g) => g.id)).toEqual(['landing:bridge:start', 'landing:bridge:end']);
  });

  it('takes the width the bridge has at that end, and snaps an end just off the ring onto it', () => {
    const p = bridge({ points: [{ x: 7.3, y: 11.2, width: 3 }, { x: 7, y: 25.8 }] });
    const [a, b] = landingGaps(layerWith(outcrop, mesa, p));
    expect(a.width).toBe(3);
    expect(a.position[1]).toBeCloseTo(11, 6);
    expect(a.position[0]).toBeCloseTo(7.3, 6);
    expect(b.width).toBe(2);
  });

  it('leaves no cliff occluder across the landing', () => {
    const layer = layerWith(outcrop, mesa, bridge());
    for (const o of cliffOccluders(layer, 0)) {
      // The outcrop's south edge runs y = 11; nothing of it within the bridge's half width of x = 7.
      if (Math.abs(o.y1 - 11) < 1e-6 && Math.abs(o.y2 - 11) < 1e-6) {
        const lo = Math.min(o.x1, o.x2);
        const hi = Math.max(o.x1, o.x2);
        expect(hi <= 6 + 1e-6 || lo >= 8 - 1e-6, `occluder ${lo}..${hi}`).toBe(true);
      }
    }
  });

  it('opens nothing for a path that is not a bridge, an end away from any ring, or a hidden bridge', () => {
    expect(landingGaps(layerWith(outcrop, mesa, bridge({ sort: 'under' })))).toEqual([]);
    expect(landingGaps(layerWith(outcrop, mesa, bridge({ visible: false })))).toEqual([]);
    const loose = bridge({ points: [{ x: 7, y: 15 }, { x: 7, y: 20 }] });
    expect(landingGaps(layerWith(outcrop, mesa, loose))).toEqual([]);
  });
});
