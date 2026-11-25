import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { DungeonLayer, PlateauChild, ShapeChild } from '../store/types';
import {
  cliffOccluders,
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
  pointInPoly,
  stairFlights,
} from './plateaus';
import type { Polygon } from '../types/geometry';
import { defaultCrossingKinds } from './crossingKinds';
import { smoothRing } from './bezier';
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

  it('stands each plateau at its own height, wherever it is drawn: +2 in +1 reads 2', () => {
    const hill = plat('hill', 0, 0, 20, 20, { height: 1, edge: 'slope' });
    const summit = plat('summit', 5, 5, 10, 10, { height: 2, edge: 'cliff' });
    const infos = plateauChains([hill, summit]);
    expect(infos.get('hill')!.height).toBe(1);
    expect(infos.get('summit')!.height).toBe(2);
    expect(infos.get('summit')!.chain.map((s) => s.id)).toEqual(['hill', 'summit']);
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
    expect(infos.get('b')!.height).toBe(1);
  });
});

describe('bands and drops', () => {
  const ground = rect('ground', 0, 0, 30, 30);

  it('merges plateaus of equal level into one band and leaves floors out', () => {
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
    expect(shapeDrop(layer, 'summit')).toBe(1);
    expect(shapeDrop(layer, 'hill')).toBe(1);
  });

  it('measures a pillar in a pit as rising out of the pit, from the pit floor to its own level', () => {
    const pit = plat('pit', 2, 2, 20, 20, { height: -3, edge: 'cliff' });
    const pillar = plat('pillar', 8, 8, 12, 12, { height: -1, edge: 'cliff' });
    const layer = layerOf([ground, pit, pillar]);
    expect(layerPlateaus(layer).infos.get('pillar')!.height).toBe(-1);
    expect(shapeDrop(layer, 'pillar')).toBe(2);
    // A pillar at +2 stands above the ground round the pit: 5 out of the pit floor.
    const tall = plat('pillar', 8, 8, 12, 12, { height: 2, edge: 'cliff' });
    expect(shapeDrop(layerOf([ground, pit, tall]), 'pillar')).toBe(5);
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

  /** A hand-drawn blob round (cx, cy): off the grid at every point. */
  const blob = (id: string, cx: number, cy: number, r: number): PlateauChild => ({
    ...plat(id, 0, 0, 1, 1, { height: 1, edge: 'slope', edgeArt: 'paint' }),
    contours: [
      Array.from({ length: 48 }, (_, i): [number, number] => {
        const a = (i / 48) * Math.PI * 2;
        const rr = r * (1 + 0.12 * Math.sin(a * 5 + cx));
        return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
      }),
    ],
  });

  it.each([
    ['overlapping', blob('a', 7.137, 7.291, 3.3), blob('b', 11.413, 8.077, 3.1)],
    ['separate', blob('a', 6.137, 6.291, 3.3), blob('b', 21.413, 20.077, 3.1)],
  ])('gives every edge of two %s freehand plateaus of one height its plateau, so none falls back to cliff rock', (_name, a, b) => {
    const [band] = layerPlateaus(layerOf([ground, a, b])).bands;
    expect(band.edges.flat().length).toBeGreaterThan(40);
    expect(band.edges.flat().filter((e) => e.owner === null)).toHaveLength(0);
    for (const run of edgeRuns(band)) {
      expect(run.owner?.edgeArt).toBe('paint');
      expect(run.edge).toBe('slope');
    }
    // What reads the same edges agrees: a slope hides nothing from below, and a move
    // onto the plateau crosses its edge (an edge with no owner was skipped).
    const layer = layerOf([ground, a, b]);
    expect(cliffOccluders(layer, 1)).toEqual([]);
    const ring = a.contours[0];
    const cx = ring.reduce((n, p) => n + p[0], 0) / ring.length;
    const cy = ring.reduce((n, p) => n + p[1], 0) / ring.length;
    expect(crossingsAlong(layer, [cx - 6, cy], [cx, cy], defaultCrossingKinds()).length).toBeGreaterThan(0);
  });

  it('reads no drop where a plateau lies under a higher one it sticks out of', () => {
    // `low` pokes out of `high` to the east: its west part is covered by the higher top.
    const high = plat('high', 2, 2, 12, 12, { height: 2, edge: 'cliff' });
    const low = plat('low', 8, 5, 18, 9, { height: 1, edge: 'cliff' });
    const p = layerPlateaus(layerOf([ground, high, low]));
    expect(p.infos.get('low')!.height).toBe(1);
    const band = p.bands.find((x) => x.height === 1)!;
    const drops = band.edges.flat().map((e) => e.drop);
    // Out on the ground it drops 1; under the higher plateau there is no edge to draw.
    expect(new Set(drops)).toEqual(new Set([0, 1]));
    const covered = (a: [number, number], b: [number, number]) => a[0] === 8 && b[0] === 8;
    for (const run of edgeRuns(band)) {
      expect(run.drop).toBeGreaterThan(0);
      for (let i = 0; i + 1 < run.points.length; i++) expect(covered(run.points[i], run.points[i + 1])).toBe(false);
    }
  });

  it('unions overlapping plateaus drawn in opposite winding, and a ring that crosses itself', () => {
    const a = plat('a', 2, 2, 8, 8, { height: 1 });
    const b = { ...plat('b', 6, 2, 12, 8, { height: 1 }), contours: [[[6, 8], [12, 8], [12, 2], [6, 2]] as [number, number][]] };
    const [band] = layerPlateaus(layerOf([ground, a, b])).bands;
    expect(band.rings).toHaveLength(1);
    const xs = band.rings[0].map((p) => p[0]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([2, 12]);
    // Nothing of the overlap is cut out of the top.
    expect(elevationAt(layerOf([ground, a, b]), 7, 5)).toBe(1);

    // A bow tie: one ring crossing itself at (5, 5).
    const bow = { ...plat('bow', 0, 0, 1, 1, { height: 1 }), contours: [[[2, 2], [8, 8], [8, 2], [2, 8]] as [number, number][]] };
    const lone = layerPlateaus(layerOf([ground, bow])).bands[0];
    expect(lone.rings.length).toBeGreaterThan(0);
    for (const ring of lone.rings) {
      for (let i = 0; i < ring.length; i++) {
        for (let j = i + 2; j < ring.length; j++) {
          if (i === 0 && j === ring.length - 1) continue;
          expect(crosses(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length])).toBe(false);
        }
      }
    }
  });
});

/** Whether segments ab and cd cross at a point inside both. */
function crosses(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const side = (p: [number, number], q: [number, number], r: [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

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
  const layer = layerOf([ground, top]);
  const kinds = defaultCrossingKinds();

  it('stands a point on the plateau or the ground', () => {
    expect(elevationAt(layer, 12, 12)).toBe(3);
    expect(elevationAt(layer, 5, 5)).toBe(0);
    expect(elevationAtLayers([layerOf([ground]), layer], 12, 12)).toBe(3);
  });

  it('adds up the heights of every floor and patch covering a point, on top of the plateau under it', () => {
    const raised = rect('raised', 8, 8, 16, 16, { height: 1.5 });
    const patch = (id: string, x0: number, x1: number, height?: number) => ({
      id,
      material: 'p:water',
      rings: [[[x0, 9], [x1, 9], [x1, 15], [x0, 15]]] as [number, number][][],
      smooth: false,
      border: false,
      ...(height === undefined ? {} : { height }),
    });
    const l = { children: [ground, raised, top], materials: [patch('a', 9, 11, -1), patch('b', 10.5, 12.5, -2)] } as unknown as DungeonLayer;
    // Plateau 3, floor 1.5 under it: 4.5.
    expect(elevationAt(l, 13, 13)).toBe(4.5);
    // The floor alone, off the plateau.
    expect(elevationAt(l, 15, 9.5)).toBe(1.5);
    // A patch on the floor: the two add.
    expect(elevationAt(l, 9.5, 12)).toBe(1.5 - 1);
    // Two patches, the floor and the plateau, all four.
    expect(elevationAt(l, 10.75, 12)).toBe(3 + 1.5 - 1 - 2);
    expect(elevationAt(l, 12, 12)).toBe(3 + 1.5 - 2);
    // The plain ground and the same across layers.
    expect(elevationAt(l, 2, 2)).toBe(0);
    expect(elevationAtLayers([layerOf([ground]), l], 9.5, 12)).toBe(0.5);
    // A patch with no height of its own on a raised floor stands at the floor's height.
    const flat = { ...patch('flat', 1, 3), rings: [[[1, 1], [3, 1], [3, 3], [1, 3]]] };
    expect(elevationAt({ children: [rect('f', 0, 0, 6, 6, { height: 1 })], materials: [flat] } as unknown as DungeonLayer, 2, 2)).toBe(1);
    // A patch painted on a floor stands only where the floor is; a ground patch stands whole.
    const floorRing: [number, number][] = [[0, 0], [6, 0], [6, 6], [0, 6]];
    const spill = { id: 's', material: 'p:dirt', rings: [[[4, 1], [9, 1], [9, 3], [4, 3]]] as [number, number][][], smooth: false, border: false, height: 2 };
    const onFloor = { children: [rect('f', 0, 0, 6, 6)], materials: [spill], mergedFloor: [floorRing] } as unknown as DungeonLayer;
    expect(elevationAt(onFloor, 5, 2)).toBe(2);
    expect(elevationAt(onFloor, 8, 2)).toBe(0);
    expect(elevationAt({ ...onFloor, materials: [{ ...spill, ground: true }] } as unknown as DungeonLayer, 8, 2)).toBe(2);
    // A floor's height is kept to half steps, -10 to 10.
    expect(elevationAt(layerOf([rect('f', 0, 0, 4, 4, { height: 2.3 })]), 1, 1)).toBe(2.5);
    expect(elevationAt(layerOf([rect('f', 0, 0, 4, 4, { height: 40 })]), 1, 1)).toBe(10);
  });

  it('changes nothing with every height 0 or unset', () => {
    const flat = { children: [ground, rect('f', 8, 8, 16, 16, { height: 0 }), top], materials: [{ id: 'a', material: 'p:dirt', rings: [[[9, 9], [11, 9], [11, 11], [9, 11]]], smooth: false, border: false }] } as unknown as DungeonLayer;
    for (const [x, y] of [[12, 12], [10, 10], [5, 5], [15, 15]]) expect(elevationAt(flat, x, y)).toBe(elevationAt(layer, x, y));
  });

  it('lists the cliff a move goes over, going up or down', () => {
    const up = crossingsAlong(layer, [12, 8], [12, 11], kinds);
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ via: 'cliff', targetId: 'top', kindId: 'climb', chip: true, blocks: false, down: false });
    expect(crossingsAlong(layer, [12, 11], [12, 8], kinds)[0].down).toBe(true);
  });

  it('takes a live override over the map', () => {
    const live = crossingsAlong(layer, [12, 8], [12, 11], kinds, { edges: { top: 'impassable' } });
    expect(live[0]).toMatchObject({ kindId: 'impassable', blocks: true });
    expect(crossingsAlong(layer, [12, 8], [12, 11], kinds, { blocks: { climb: true } })[0].blocks).toBe(true);
  });
});

describe('stairs on an edge', () => {
  const ground = rect('ground', 0, 0, 30, 30);
  // A +2 cliff, 10..14 square; its outline starts at (10, 10) and runs east along y 10.
  const bare = plat('top', 10, 10, 14, 14, { height: 2, edge: 'cliff' });
  const top = { ...bare, stairs: [{ id: 's1', ring: 0, from: 1, to: 3 }] };
  const kinds = defaultCrossingKinds();

  it('splits the edge at the span and marks only the edges inside it', () => {
    const band = layerPlateaus(layerOf([ground, top])).bands[0];
    const ring = band.rings[0];
    const marked = band.edges[0].map((e, i) => [e.stairs === true, ring[i], ring[(i + 1) % ring.length]] as const).filter(([s]) => s);
    expect(marked).toHaveLength(1);
    const [, a, b] = marked[0];
    expect([a, b].map(([x, y]) => [x, y]).sort((p, q) => p[0] - q[0])).toEqual([[11, 10], [13, 10]]);
  });

  it('crosses the span freely with no chip, whatever the plateau is played as', () => {
    const layer = layerOf([ground, top]);
    const down = crossingsAlong(layer, [12, 8], [12, 11], kinds, { edges: { top: 'impassable' } });
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ kindId: 'free', blocks: false, chip: false, stairs: true, down: false });
    // The same edge beside the span is a climb.
    expect(crossingsAlong(layer, [10.5, 8], [10.5, 11], kinds)[0]).toMatchObject({ kindId: 'climb', chip: true });
    expect(crossingsAlong(layer, [13.5, 8], [13.5, 11], kinds)[0]).toMatchObject({ kindId: 'climb', chip: true });
  });

  it('hides nothing across the span, and the rest of the cliff as before', () => {
    const occ = cliffOccluders(layerOf([ground, top]), 1);
    const onTopEdge = occ.filter((o) => o.y1 === 10 && o.y2 === 10);
    const covered = (x: number) => onTopEdge.some((o) => Math.min(o.x1, o.x2) < x && Math.max(o.x1, o.x2) > x);
    expect(covered(12)).toBe(false);
    expect(covered(10.5)).toBe(true);
    expect(covered(13.5)).toBe(true);
    expect(cliffOccluders(layerOf([ground, bare]), 1).some((o) => o.y1 === 10 && Math.min(o.x1, o.x2) < 12 && Math.max(o.x1, o.x2) > 12)).toBe(true);
  });

  it('stands the flight on the low side: outside a plateau, inside a pit, as long as the drop', () => {
    const [up] = stairFlights(layerOf([ground, top]));
    expect(up.length).toBe(2);
    expect(up.down[0]).toBeCloseTo(0);
    expect(up.down[1]).toBeCloseTo(-1);
    const pit = { ...plat('pit', 10, 10, 14, 14, { height: -1 }), stairs: [{ id: 'p', ring: 0, from: 1, to: 3 }] };
    const [into] = stairFlights(layerOf([ground, pit]));
    expect(into.length).toBe(1);
    expect(into.down[1]).toBeCloseTo(1);
    expect(crossingsAlong(layerOf([ground, pit]), [12, 8], [12, 11], kinds)[0]).toMatchObject({ kindId: 'free', chip: false });
  });

  it('leaves the band exactly as it was once the stairs are gone', () => {
    const before = layerPlateaus(layerOf([ground, bare])).bands[0];
    layerPlateaus(layerOf([ground, top]));
    const after = layerPlateaus(layerOf([ground, { ...top, stairs: [] }])).bands[0];
    expect(after.rings).toEqual(before.rings);
    const plain = (edges: typeof before.edges) => edges.map((r) => r.map((e) => ({ ...e, owner: e.owner?.id })));
    expect(plain(after.edges)).toEqual(plain(before.edges));
  });
});

describe('edges where another band crosses', () => {
  const near = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
  /** The drop of the segment of a run whose middle is `mid`. */
  const dropAt = (run: ReturnType<typeof edgeRuns>[number], mid: [number, number]) => {
    const n = run.points.length;
    for (let i = 0; i < run.drops.length; i++) {
      const a = run.points[i];
      const b = run.points[(i + 1) % n];
      if (near([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], mid)) return run.drops[i];
    }
    return undefined;
  };

  it('stops a +1 run where a +2 that is not nested crosses it, not at the corner', () => {
    const low = plat('low', 0, 0, 10, 10, { height: 1, edge: 'slope' });
    // Its centroid lies outside the +1, so it stands on the ground beside it.
    const high = plat('high', 6, 4, 16, 8, { height: 2, edge: 'slope' });
    const { bands } = layerPlateaus(layerOf([low, high]));
    const runs = edgeRuns(bands.find((b) => b.height === 1)!);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run.closed).toBe(false);
    const ends = [run.points[0], run.points[run.points.length - 1]];
    expect(ends.some((p) => near(p, [10, 4]))).toBe(true);
    expect(ends.some((p) => near(p, [10, 8]))).toBe(true);
    expect(run.drops).toHaveLength(run.points.length - 1);
    // The +2's top edge drops 1 onto the +1 and 2 onto the ground past it.
    const [top] = edgeRuns(bands.find((b) => b.height === 2)!);
    expect(dropAt(top, [8, 4])).toBe(1);
    expect(dropAt(top, [13, 4])).toBe(2);
  });

  it('reports drops 3 and 2 along one edge of a +3 with a +1 against half of it', () => {
    const mesa = plat('mesa', 0, 0, 10, 10, { height: 3, edge: 'slope' });
    const shelf = plat('shelf', 8, 5, 14, 15, { height: 1, edge: 'slope' });
    const [run] = edgeRuns(layerPlateaus(layerOf([mesa, shelf])).bands.find((b) => b.height === 3)!);
    expect(run.closed).toBe(true);
    expect(run.drop).toBe(3);
    expect(run.drops).toHaveLength(run.points.length);
    expect(dropAt(run, [10, 2.5])).toBe(3);
    expect(dropAt(run, [10, 7.5])).toBe(2);
    expect(dropAt(run, [9, 10])).toBe(2);
    expect(dropAt(run, [4, 10])).toBe(3);
  });

  it('gives a curved or moved plateau its own edges in a band it shares', () => {
    const ring: [number, number][] = [[0, 0], [8, 0], [8, 6], [0, 6]];
    const curved = plat('curved', 0, 0, 0, 0, { height: 1, edge: 'slope', contours: [ring], tangents: [smoothRing(ring)] });
    const moved = plat('moved', 0, 0, 4, 4, { height: 1, edge: 'none', transform: { translate: [30, 0], rotate: 0.3, scale: [1, 1] } });
    const band = layerPlateaus(layerOf([curved, moved, plat('other', 50, 0, 54, 4, { height: 1 })])).bands[0];
    const runs = edgeRuns(band);
    expect(runs.every((r) => r.owner !== null)).toBe(true);
    expect(runs.filter((r) => r.owner?.id === 'curved').map((r) => r.edge)).toEqual(['slope']);
    expect(runs.filter((r) => r.owner?.id === 'moved').map((r) => r.edge)).toEqual(['none']);
  });

  it('leaves a plateau nothing crosses as it was: its ring, edges and run', () => {
    const lone = plat('lone', 0, 0, 10, 10, { height: 2, edge: 'cliff' });
    const far = plat('far', 20, 0, 30, 10, { height: 1, edge: 'cliff' });
    for (const children of [[lone], [lone, far]]) {
      const band = layerPlateaus(layerOf(children)).bands.find((b) => b.height === 2)!;
      expect(band.rings).toHaveLength(1);
      expect(band.rings[0]).toHaveLength(4);
      expect(band.edges[0].map((e) => e.drop)).toEqual([2, 2, 2, 2]);
      const runs = edgeRuns(band);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ closed: true, drop: 2, drops: [2, 2, 2, 2], start: 0 });
      expect(runs[0].points).toBe(band.rings[0]);
    }
  });
});

describe('a height is its own level', () => {
  const ground = rect('ground', 0, 0, 40, 40);
  const kinds = defaultCrossingKinds();
  const inR = (rings: readonly Polygon[], x: number, y: number) => rings.filter((r) => pointInPoly(x, y, r)).length % 2 === 1;

  it('makes a +1 drawn wholly inside a +1 one band with one outline and no edge between them', () => {
    const grass = plat('grass', 2, 2, 30, 30, { height: 1, edge: 'cliff' });
    const sand = plat('sand', 10, 10, 20, 20, { height: 1, edge: 'cliff' });
    const layer = layerOf([ground, grass, sand]);
    const { bands, infos } = layerPlateaus(layer);
    expect(infos.get('sand')!.parent?.id).toBe('grass');
    expect(infos.get('sand')!.height).toBe(1);
    expect(bands).toHaveLength(1);
    expect(bands[0].rings).toHaveLength(1);
    expect(bands[0].shapes.map((s) => s.id)).toEqual(['grass', 'sand']);
    const runs = edgeRuns(bands[0]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ owner: grass, closed: true, drop: 1 });
    expect(shapeDrop(layer, 'sand')).toBe(0);
    expect(inR(bands[0].surface, 15, 15)).toBe(true);
    expect(inR(bands[0].surface, 5, 5)).toBe(true);
    expect(elevationAt(layer, 15, 15)).toBe(1);
    expect(elevationAtLayers([layerOf([ground]), layer], 15, 15)).toBe(1);
    // Sight and moves see the outer outline only.
    expect(cliffOccluders(layer, 1)).toHaveLength(4);
    expect(crossingsAlong(layer, [5, 15], [15, 15], kinds)).toEqual([]);
    expect(crossingsAlong(layer, [1, 15], [15, 15], kinds).map((c) => c.targetId)).toEqual(['grass']);
  });

  it('stands nested terraces 1, 2 and 3 at 1, 2 and 3, each step a drop of 1', () => {
    const t1 = plat('t1', 2, 2, 30, 30, { height: 1, edge: 'slope' });
    const t2 = plat('t2', 6, 6, 26, 26, { height: 2, edge: 'slope' });
    const t3 = plat('t3', 10, 10, 22, 22, { height: 3, edge: 'cliff' });
    const layer = layerOf([ground, t1, t2, t3]);
    const { bands, infos } = layerPlateaus(layer);
    expect(['t1', 't2', 't3'].map((id) => infos.get(id)!.height)).toEqual([1, 2, 3]);
    expect(bands.map((b) => b.height)).toEqual([1, 2, 3]);
    for (const b of bands) expect(new Set(b.edges.flat().map((e) => e.drop))).toEqual(new Set([1]));
    expect(['t1', 't2', 't3'].map((id) => shapeDrop(layer, id))).toEqual([1, 1, 1]);
    // Each level's surface is its own step only.
    expect(inR(bands[0].surface, 4, 16)).toBe(true);
    expect(inR(bands[0].surface, 8, 16)).toBe(false);
    expect(inR(bands[1].surface, 8, 16)).toBe(true);
    expect(inR(bands[1].surface, 16, 16)).toBe(false);
    expect(inR(bands[2].surface, 16, 16)).toBe(true);
    expect([4, 8, 16].map((x) => elevationAtLayers([layerOf([ground]), layer], x, 16))).toEqual([1, 2, 3]);
    const up = crossingsAlong(layer, [1, 16], [16, 16], kinds);
    expect(up.map((c) => c.targetId)).toEqual(['t1', 't2', 't3']);
    expect(up.every((c) => !c.down)).toBe(true);
    // A 1-cell cliff hides nothing at a sight drop of 2.
    expect(cliffOccluders(layer, 2)).toEqual([]);
    expect(hiddenTops(layer, 2)).toEqual([]);
  });

  it('digs a +1 drawn inside a +3 mesa down to 1: a dip, its rim drawn inward with its own settings', () => {
    const mesa = plat('mesa', 2, 2, 30, 30, { height: 3, edge: 'cliff' });
    const dip = plat('dip', 10, 10, 20, 20, { height: 1, edge: 'slope', crossingId: 'difficult' });
    const layer = layerOf([ground, mesa, dip]);
    const { bands } = layerPlateaus(layer);
    const one = bands.find((b) => b.height === 1)!;
    const three = bands.find((b) => b.height === 3)!;
    expect(elevationAt(layer, 15, 15)).toBe(1);
    expect(elevationAt(layer, 5, 5)).toBe(3);
    expect(elevationAtLayers([layerOf([ground]), layer], 15, 15)).toBe(1);
    expect(inR(three.surface, 15, 15)).toBe(false);
    expect(inR(three.surface, 5, 5)).toBe(true);
    expect(inR(one.surface, 15, 15)).toBe(true);
    // The dip's rim: inward, with its own edge kind, a drop of 2.
    expect(edgeRuns(one)).toHaveLength(1);
    expect(edgeRuns(one)[0]).toMatchObject({ owner: dip, edge: 'slope', drop: -2, dug: true, closed: true });
    expect(shapeDrop(layer, 'dip')).toBe(-2);
    // The mesa's outer edge is unchanged.
    expect(edgeRuns(three)).toHaveLength(1);
    expect(edgeRuns(three)[0]).toMatchObject({ owner: mesa, edge: 'cliff', drop: 3, closed: true });
    // Into the dip from the mesa's top is down, out of it up, by the dip's own crossing.
    const into = crossingsAlong(layer, [5, 15], [15, 15], kinds);
    expect(into).toHaveLength(1);
    expect(into[0]).toMatchObject({ targetId: 'dip', via: 'slope', kindId: 'difficult', down: true });
    expect(crossingsAlong(layer, [15, 15], [5, 15], kinds)[0].down).toBe(false);
    // As a cliff its rim hides the dip's floor from the top round it, from inside, as a pit's does.
    const cliffDip = { ...dip, edge: 'cliff' as const, crossingId: undefined };
    const walled = layerOf([ground, mesa, cliffDip]);
    expect(edgeHides(cliffDip, 'cliff', -2, 2)).toBe(true);
    const occ = cliffOccluders(walled, 2);
    expect(occ.filter((o) => o.direction === 'right')).toHaveLength(4);
    expect(occ.filter((o) => o.direction === 'left')).toHaveLength(4);
    expect(crossingsAlong(walled, [5, 15], [15, 15], kinds)[0]).toMatchObject({ targetId: 'dip', via: 'cliff', kindId: 'climb', down: true });
    // Only the mesa's top hides from the ground; the dip lies inside it.
    expect(hiddenTops(walled, 2).map((t) => t.height)).toEqual([3]);
  });

  it('sinks a -1 pit drawn in a +2 mesa below the ground: an inner wall of 3', () => {
    const mesa = plat('mesa', 2, 2, 30, 30, { height: 2, edge: 'cliff' });
    const pit = plat('pit', 10, 10, 20, 20, { height: -1, edge: 'cliff' });
    const layer = layerOf([ground, mesa, pit]);
    const { bands } = layerPlateaus(layer);
    const low = bands.find((b) => b.height === -1)!;
    expect(elevationAt(layer, 15, 15)).toBe(-1);
    expect(elevationAtLayers([layerOf([ground]), layer], 15, 15)).toBe(-1);
    expect(inR(low.surface, 15, 15)).toBe(true);
    expect(inR(bands.find((b) => b.height === 2)!.surface, 15, 15)).toBe(false);
    expect(edgeRuns(low)).toHaveLength(1);
    expect(edgeRuns(low)[0]).toMatchObject({ owner: pit, drop: -3, dug: true, closed: true });
    expect(edgeHides(pit, 'cliff', -3, 2)).toBe(true);
    expect(cliffOccluders(layer, 2).filter((o) => o.direction === 'right')).toHaveLength(4);
    expect(crossingsAlong(layer, [5, 15], [15, 15], kinds)[0]).toMatchObject({ targetId: 'pit', via: 'cliff', down: true });
  });

  it('lets a +2 that only overlaps a +1 win the overlap, as before', () => {
    const low = plat('low', 2, 2, 12, 12, { height: 1 });
    // Its centroid lies outside the +1: it stands on the ground beside it.
    const high = plat('high', 8, 4, 20, 10, { height: 2 });
    const layer = layerOf([ground, low, high]);
    const { bands, infos } = layerPlateaus(layer);
    expect(infos.get('high')!.parent).toBeNull();
    expect(elevationAt(layer, 10, 7)).toBe(2);
    expect(elevationAtLayers([layerOf([ground]), layer], 10, 7)).toBe(2);
    const one = bands.find((b) => b.height === 1)!;
    expect(inR(one.surface, 10, 7)).toBe(false);
    expect(inR(one.surface, 5, 7)).toBe(true);
    // The +1's edge under the +2 is covered; the +2's drops 1 onto the +1 and 2 onto the ground.
    expect(one.edges.flat().filter((e) => e.drop < 0)).toEqual([]);
    expect(new Set(bands.find((b) => b.height === 2)!.edges.flat().map((e) => e.drop))).toEqual(new Set([1, 2]));
    expect(crossingsAlong(layer, [5, 7], [15, 7], kinds).map((c) => [c.targetId, c.down])).toEqual([['high', false]]);
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
