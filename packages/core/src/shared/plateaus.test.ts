import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { DungeonLayer, PlateauChild, ShapeChild } from '../store/types';
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
  landingGaps,
  bridgeHeights,
  bridgeLook,
  pathMaterialPatch,
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

const layerOf = (children: readonly unknown[]) => ({ children }) as unknown as DungeonLayer;

describe('plateau chains', () => {
  it('nests a plateau inside the smallest raised plateau holding its centroid', () => {
    const hill = plat('hill', 0, 0, 20, 20, { height: 1, edge: 'slope' });
    const big = plat('big', -5, -5, 30, 30, { height: 1, edge: 'cliff' });
    const summit = plat('summit', 5, 5, 10, 10, { height: 2, edge: 'cliff' });
    const infos = plateauChains([big, hill, summit]);
    expect(infos.get('summit')!.parent?.id).toBe('hill');
    expect(infos.get('hill')!.parent?.id).toBe('big');
    expect(infos.get('big')!.parent).toBeNull();
    expect(infos.get('summit')!.chain.map((s) => s.id)).toEqual(['big', 'hill', 'summit']);
  });

  it('adds heights along the chain: +2 on +1 reads 3', () => {
    const hill = plat('hill', 0, 0, 20, 20, { height: 1, edge: 'slope' });
    const summit = plat('summit', 5, 5, 10, 10, { height: 2, edge: 'cliff' });
    const infos = plateauChains([hill, summit]);
    expect(infos.get('hill')!.height).toBe(1);
    expect(infos.get('summit')!.height).toBe(3);
  });

  it('carries a plateau with no height of its own up to its parent', () => {
    const top = plat('top', 0, 0, 10, 10, { height: 2, edge: 'cliff' });
    const patch = plat('patch', 2, 2, 4, 4, { height: 0 });
    const ground = plat('ground', -10, -10, 30, 30, { height: 0 });
    const infos = plateauChains([ground, top, patch]);
    expect(infos.get('patch')!.height).toBe(2);
    expect(infos.get('ground')!.height).toBe(0);
    expect(infos.get('ground')!.chain).toEqual([]);
  });

  it('never takes a smaller plateau, or one with no height, as a parent', () => {
    const small = plat('small', 4, 4, 6, 6, { height: 3 });
    const big = plat('big', 0, 0, 10, 10, { height: 0 });
    const infos = plateauChains([small, big]);
    expect(infos.get('big')!.parent).toBeNull();
    expect(infos.get('small')!.parent).toBeNull();
  });

  it('breaks an equal-area tie by draw order, so two copies never parent each other', () => {
    const a = plat('a', 0, 0, 4, 4, { height: 1 });
    const b = plat('b', 0, 0, 4, 4, { height: 1 });
    const infos = plateauChains([a, b]);
    expect(infos.get('a')!.parent).toBeNull();
    expect(infos.get('b')!.parent?.id).toBe('a');
    expect(infos.get('b')!.height).toBe(2);
  });
});

describe('bands and drops', () => {
  const ground = rect('ground', 0, 0, 30, 30);

  it('merges plateaus of equal absolute height into one band and leaves floors out', () => {
    const a = plat('a', 2, 2, 8, 8, { height: 2, edge: 'cliff' });
    const b = plat('b', 6, 2, 12, 8, { height: 2, edge: 'cliff' });
    const c = plat('c', 20, 20, 24, 24, { height: 1, edge: 'cliff' });
    const p = layerPlateaus(layerOf([ground, a, b, c]));
    expect(p.infos.has('ground')).toBe(false);
    expect(p.bands.map((band) => band.height)).toEqual([1, 2]);
    expect(p.bands[1].rings).toHaveLength(1);
    expect(p.bands[1].shapes.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('a plateau drops outward (positive), a pit inward (negative)', () => {
    const top = plat('top', 5, 5, 10, 10, { height: 2, edge: 'cliff' });
    const pit = plat('pit', 15, 15, 20, 20, { height: -3, edge: 'cliff' });
    const p = layerPlateaus(layerOf([ground, top, pit]));
    const drops = (h: number) => p.bands.find((b) => b.height === h)!.edges.flat().map((e) => e.drop);
    expect(new Set(drops(2))).toEqual(new Set([2]));
    expect(new Set(drops(-3))).toEqual(new Set([-3]));
  });

  it('measures a nested summit against the slope it stands on, not the ground', () => {
    const hill = plat('hill', 2, 2, 20, 20, { height: 1, edge: 'slope' });
    const summit = plat('summit', 6, 6, 12, 12, { height: 2, edge: 'cliff' });
    const layer = layerOf([ground, hill, summit]);
    expect(shapeDrop(layer, 'summit')).toBe(2);
    expect(shapeDrop(layer, 'hill')).toBe(1);
  });

  it('measures a pillar in a pit as rising out of the pit', () => {
    const pit = plat('pit', 2, 2, 20, 20, { height: -3, edge: 'cliff' });
    const pillar = plat('pillar', 8, 8, 12, 12, { height: 2, edge: 'cliff' });
    const layer = layerOf([ground, pit, pillar]);
    expect(layerPlateaus(layer).infos.get('pillar')!.height).toBe(-1);
    expect(shapeDrop(layer, 'pillar')).toBe(2);
  });

  it('winds every band ring with the low side on the left of travel', () => {
    const top = plat('top', 5, 5, 10, 10, { height: 2, edge: 'cliff' });
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
    const a = plat('a', 2, 2, 8, 8, { height: 2, edge: 'cliff' });
    const b = plat('b', 8, 2, 14, 8, { height: 2, edge: 'slope' });
    const [band] = layerPlateaus(layerOf([ground, a, b])).bands;
    const runs = edgeRuns(band);
    expect(new Set(runs.map((r) => r.edge))).toEqual(new Set(['cliff', 'slope']));
    expect(runs.every((r) => !r.closed)).toBe(true);
  });
});

describe('the merged floor', () => {
  const ground = rect('ground', 0, 0, 30, 30);

  it('is unchanged on a flat layer', () => {
    expect(hasPlateaus(layerOf([ground]))).toBe(false);
    expect(computeMergedFloor(layerOf([ground]))).toEqual([ground.contours[0]]);
  });

  it('never takes a plateau in, whatever its edge, height or place', () => {
    const flat = computeMergedFloor(layerOf([ground]));
    const cliff = plat('cliff', 2, 2, 6, 6, { height: 2, edge: 'cliff' });
    const slope = plat('slope', 8, 8, 12, 12, { height: 1, edge: 'slope' });
    const pit = plat('pit', 14, 14, 18, 18, { height: -2, edge: 'none' });
    const straddle = plat('straddle', 25, 25, 40, 40, { height: 3 });
    const layer = layerOf([ground, cliff, slope, pit, straddle]);
    expect(hasPlateaus(layer)).toBe(true);
    expect(computeMergedFloor(layer)).toEqual(flat);
    expect(computeMergedFloor(layerOf([cliff]))).toBeNull();
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
  });

  it('defaults the crossing by edge kind', () => {
    expect(crossingIdOf({ edge: 'cliff' })).toBe('climb');
    expect(crossingIdOf({ edge: 'slope' })).toBe('difficult');
    expect(crossingIdOf({ edge: 'none' })).toBe('free');
    expect(crossingIdOf({ edge: 'cliff', crossingId: 'impassable' })).toBe('impassable');
  });

  it('lifts a band 7 % a cell, capped at 35 %, and sinks a pit by the same steps', () => {
    expect(tierLift(1)).toBeCloseTo(0.07);
    expect(tierLift(2)).toBeCloseTo(0.14);
    expect(tierLift(3)).toBeCloseTo(0.21);
    expect(tierLift(5)).toBeCloseTo(0.35);
    expect(tierLift(10)).toBeCloseTo(0.35);
    expect(tierLift(-1)).toBeCloseTo(-0.07);
    expect(tierLift(-2)).toBeCloseTo(-0.14);
    expect(tierLift(-10)).toBeCloseTo(-0.35);
  });
});

describe('the table: elevation and crossings', () => {
  const ground = rect('ground', 0, 0, 30, 30);
  const top = plat('top', 10, 10, 14, 14, { height: 3, edge: 'cliff' });
  // Stairs mid west edge: the outline runs (10,10)→(14,10)→(14,14)→(10,14), (10,12) at 14/16.
  const stairs = { id: 'st', name: 'st', childType: 'opening', visible: true, kind: 'stairs', hostId: 'top', t: 14 / 16, width: 2 } as const;
  const layer = layerOf([ground, top, stairs]);
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

describe('hidden tops', () => {
  it('lists a cliff top that hides from below, and no slope, pit or low ledge', () => {
    const tops = hiddenTops(
      layerOf([
        rect('ground', 0, 0, 40, 40),
        plat('mesa', 2, 2, 8, 8, { height: 3, edge: 'cliff' }),
        plat('hill', 10, 2, 16, 8, { height: 3, edge: 'slope' }),
        plat('pit', 20, 2, 26, 8, { height: -3, edge: 'cliff' }),
        plat('ledge', 30, 2, 36, 8, { height: 1, edge: 'cliff' }),
      ]),
      2,
    );
    expect(tops.map((t) => t.height)).toEqual([3]);
  });
});

describe('bridge landings', () => {
  // The plateau-test bridge: from the +2 outcrop's south edge to the +3 mesa's north edge.
  const outcrop = plat('outcrop', 4, 4, 12, 11, { height: 2, edge: 'cliff' });
  const mesa = plat('mesa', 4, 26, 12, 31, { height: 3, edge: 'cliff' });
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

  it('opens a gap as wide as the bridge and a quarter cell each side where each of its ends rests on a ring', () => {
    const gaps = landingGaps(layerWith(outcrop, mesa, bridge()));
    expect(gaps).toHaveLength(2);
    const [a, b] = gaps;
    expect(a.id).toBe('landing:bridge:start');
    expect(a.position[0]).toBeCloseTo(7, 6);
    expect(a.position[1]).toBeCloseTo(11, 6);
    expect(a.width).toBe(2.5);
    expect(b.id).toBe('landing:bridge:end');
    expect(b.position[1]).toBeCloseTo(26, 6);
    // The landing is part of every ring gap, so the ledge rock and the sight lines part there.
    expect(ringGaps(layerWith(outcrop, mesa, bridge())).map((g) => g.id)).toEqual(['landing:bridge:start', 'landing:bridge:end']);
  });

  it('takes the width the bridge has at that end, and snaps an end just off the ring onto it', () => {
    const p = bridge({ points: [{ x: 7.3, y: 11.2, width: 3 }, { x: 7, y: 25.8 }] });
    const [a, b] = landingGaps(layerWith(outcrop, mesa, p));
    expect(a.width).toBe(3.5);
    expect(a.position[1]).toBeCloseTo(11, 6);
    expect(a.position[0]).toBeCloseTo(7.3, 6);
    expect(b.width).toBe(2.5);
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

describe('bridges as they are drawn', () => {
  const ground = rect('ground', 0, 0, 30, 30);
  const near = plat('near', 4, 4, 12, 10, { height: 1, edge: 'cliff' });
  const far = plat('far', 4, 15, 12, 21, { height: 2, edge: 'cliff' });
  const layer = { children: [ground, near, far] } as unknown as DungeonLayer;

  it('takes a bridge’s sort and height with a planks material, only where the path still has the plain ones', () => {
    expect(bridgeLook({ sort: 'under', heightMode: 'ground' }, 'gg-forge:planks')).toEqual({ sort: 'overhead', heightMode: 'set' });
    expect(bridgeLook({ sort: 'over', heightMode: 'ground' }, 'gg-forge:planks')).toEqual({ heightMode: 'set' });
    expect(bridgeLook({ sort: 'under', heightMode: 'set' }, 'gg-forge:planks')).toEqual({ sort: 'overhead' });
    expect(bridgeLook({ sort: 'under', heightMode: 'ground' }, 'gg-forge:road-dirt')).toEqual({});
  });

  it('stands each end at the height of the cliff it rests on, the points between eased', () => {
    const pts = bridgeHeights(layer, [{ x: 8, y: 10 }, { x: 8, y: 12.5 }, { x: 8, y: 15 }]);
    expect(pts.map((p) => p.height)).toEqual([1, 1.5, 2]);
  });

  it('switches a road to planks as a bridge, heights and all, and a road back leaves them be', () => {
    const road = { sort: 'under' as const, heightMode: 'ground' as const, points: [{ x: 8, y: 10 }, { x: 8, y: 15 }] };
    expect(pathMaterialPatch(layer, road, 'gg-forge:planks')).toEqual({
      materialId: 'gg-forge:planks',
      sort: 'overhead',
      heightMode: 'set',
      points: [{ x: 8, y: 10, height: 1 }, { x: 8, y: 15, height: 2 }],
    });
    expect(pathMaterialPatch(layer, { ...road, sort: 'overhead', heightMode: 'set' }, 'gg-forge:road-dirt')).toEqual({ materialId: 'gg-forge:road-dirt' });
  });
});
