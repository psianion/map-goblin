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
} from './plateaus';
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
