import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { groupKey, groupOutline, groupPaths } from './pathRenderer';
import { waterfallSpans } from './path/waterfalls';
import { pathOutline, pointInPath } from '../geometry/pathGeometry';
import type { PathChild } from '../shared/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const road = (over: Partial<PathChild> = {}): PathChild => ({
  id: 'road',
  name: 'Road',
  childType: 'path',
  visible: true,
  points: [{ x: 0, y: 0 }, { x: 8, y: 0 }],
  closed: false,
  width: 2,
  heightMode: 'ground',
  materialId: 'gg-forge:road-dirt',
  tint: '#ffffff',
  opacity: 1,
  offset: 0.5,
  flip: false,
  edge: 'soft',
  edgeStrip: true,
  ends: { start: 'cut', end: 'fade', length: 1.5 },
  sort: 'under',
  ...over,
});


describe('groups', () => {
  it('groups paths by material and sort, in first-seen order; overhead paths stand alone; hidden ones go', () => {
    const a = road({ id: 'a' });
    const b = road({ id: 'b', materialId: 'gg-forge:water' });
    const c = road({ id: 'c' });
    const d = road({ id: 'd', edge: 'hard' });
    const e = road({ id: 'e', sort: 'overhead' });
    const f = road({ id: 'f', sort: 'overhead' });
    const g = road({ id: 'g', visible: false });
    const groups = groupPaths([a, b, c, d, e, f, g]);
    // The edge no longer parts a group: a soft or hard edge is the kit's units, not the fill.
    expect(groups.map((x) => x.paths.map((p) => p.id))).toEqual([['a', 'c', 'd'], ['b'], ['e'], ['f']]);
    expect(groupKey(a)).toBe(groupKey(c));
    expect(groupKey(e)).not.toBe(groupKey(f));
  });

});

describe('a filled lake', () => {
  it('is picked across its whole interior; an unfilled closed path only on its band', () => {
    const ring = [{ x: 0, y: 0, handles: null }, { x: 10, y: 0, handles: null }, { x: 10, y: 10, handles: null }, { x: 0, y: 10, handles: null }];
    const lake = road({ closed: true, fill: true, points: ring });
    expect(pathOutline(lake)).toHaveLength(1);
    expect(pointInPath(lake, [5, 5])).toBe(true);
    const moat = road({ closed: true, points: ring });
    expect(pathOutline(moat)).toHaveLength(2);
    expect(pointInPath(moat, [5, 5])).toBe(false);
    expect(pointInPath(moat, [0, 5])).toBe(true);
  });
});

/** Even-odd over a set of rings. */
const inside = (rings: [number, number][][], [x, y]: [number, number]): boolean => {
  let n = 0;
  for (const ring of rings) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    if (hit) n++;
  }
  return n % 2 === 1;
};

describe('the fill outline', () => {
  it('unions two crossing roads of one material into one outline', () => {
    const a = road({ id: 'a', points: [{ x: -6, y: 0 }, { x: 6, y: 0 }] });
    const b = road({ id: 'b', points: [{ x: 0, y: -5 }, { x: 0, y: 5 }] });
    const [group] = groupPaths([a, b]);
    expect(group.paths).toHaveLength(2);
    const rings = groupOutline(group.paths);
    expect(rings).toHaveLength(1);
    for (const p of [[-5, 0], [0, 4], [0, 0], [0.9, 0.9]] as [number, number][]) expect(inside(rings, p), `${p}`).toBe(true);
    expect(inside(rings, [3, 3])).toBe(false);
  });

  it('keeps two materials apart: one outline each', () => {
    const a = road({ id: 'a', points: [{ x: -6, y: 0 }, { x: 6, y: 0 }] });
    const b = road({ id: 'b', materialId: 'gg-forge:road-cobble', points: [{ x: 0, y: -5 }, { x: 0, y: 5 }] });
    expect(groupPaths([a, b]).map((g) => groupOutline(g.paths).length)).toEqual([1, 1]);
  });

  it('fills a concave lake to its own shape, the notch left empty, and leaves a moat its middle', () => {
    // An L: the notch at the top right is outside the shore.
    const shore = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]].map(([x, y]) => ({ x, y, handles: null }));
    const lake = groupOutline([road({ closed: true, fill: true, width: 1, points: shore })]);
    expect(inside(lake, [2, 8])).toBe(true);
    expect(inside(lake, [8, 2])).toBe(true);
    expect(inside(lake, [7, 7])).toBe(false);
    const ring = [[0, 0], [10, 0], [10, 10], [0, 10]].map(([x, y]) => ({ x, y, handles: null }));
    const moat = groupOutline([road({ closed: true, width: 1, points: ring })]);
    expect(inside(moat, [0, 5])).toBe(true);
    expect(inside(moat, [5, 5])).toBe(false);
    expect(groupOutline([road({ closed: true, points: shore.slice(0, 1) })])).toEqual([]);
  });
});

describe('waterfallSpans', () => {
  it('hangs one fall across a river where it crosses a cliff, falling the way given', () => {
    const river = road({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], width: 2 });
    const [f] = waterfallSpans(river, [{ start: 4, end: 4, down: 1, drop: 2 }]);
    expect(f).toMatchObject({ width: 2, length: 2 });
    expect(f.x).toBeCloseTo(5, 6);
    expect(f.y).toBeCloseTo(0, 6);
    expect(f.angle).toBeCloseTo(0, 6);
    const [back] = waterfallSpans(river, [{ start: 4, end: 4, down: -1, drop: 1 }]);
    expect(back.x).toBeCloseTo(3.5, 6);
    expect(Math.abs(back.angle)).toBeCloseTo(Math.PI, 6);
  });

  it('lays pieces along a lake’s shore span, outside the shoreline, falling outward', () => {
    const lake = road({
      closed: true,
      fill: true,
      width: 1,
      points: [{ x: 0, y: 0, handles: null }, { x: 8, y: 0, handles: null }, { x: 8, y: 8, handles: null }, { x: 0, y: 8, handles: null }],
    });
    const falls = waterfallSpans(lake, [{ start: 0, end: 8, down: 1, drop: 3 }]);
    expect(falls).toHaveLength(4);
    for (const f of falls) {
      expect(f.y).toBeCloseTo(-(0.5 + 1.5), 6); // the top edge is the outside: half the band, then half the fall
      expect(f.width).toBeCloseTo(2, 6);
      expect(f.angle).toBeCloseTo(-Math.PI / 2, 6);
    }
    expect(falls.map((f) => f.x)).toEqual([1, 3, 5, 7]);
  });

  it('places nothing without crossings', () => {
    expect(waterfallSpans(road(), [])).toEqual([]);
  });
});
