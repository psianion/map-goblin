import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { fillMask, groupKey, groupPaths, groupSignature, pathLook, tuckEdgeStrip } from './pathRenderer';
import { DEFAULT_EDGE_WIDTH, RIBBON_FRAGMENT_SRC, liquidShade, ribbonUniforms } from './path/ribbonShader';
import { groupBounds, groupMask, maskResolution, MASK_MAX_PX } from './path/junctionMask';
import { waterfallSpans } from './path/waterfalls';
import { buildEdgeStrips, buildRibbonMesh, sampleCentreline } from '../geometry/ribbon';
import { pathOutline, pointInPath } from '../geometry/pathGeometry';
import type { RenderEngine } from './RenderEngine';
import type { PathMaterial } from '../assets/packCatalog';
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

const material = (pieces: string[]): PathMaterial =>
  ({ id: 'gg-forge:x', packId: 'gg-forge', set: 'x', label: 'X', pieces: Object.fromEntries(pieces.map((p) => [p, { id: `gg-forge:x-${p}` }])) }) as unknown as PathMaterial;

describe('groups', () => {
  it('groups paths by material, sort and edge, in first-seen order; overhead paths stand alone; hidden ones go', () => {
    const a = road({ id: 'a' });
    const b = road({ id: 'b', materialId: 'gg-forge:water' });
    const c = road({ id: 'c' });
    const d = road({ id: 'd', edge: 'hard' });
    const e = road({ id: 'e', sort: 'overhead' });
    const f = road({ id: 'f', sort: 'overhead' });
    const g = road({ id: 'g', visible: false });
    const groups = groupPaths([a, b, c, d, e, f, g]);
    expect(groups.map((x) => x.paths.map((p) => p.id))).toEqual([['a', 'c'], ['b'], ['d'], ['e'], ['f']]);
    expect(groupKey(a)).toBe(groupKey(c));
    expect(groupKey(e)).not.toBe(groupKey(f));
  });

  it('signs a group by geometry and look, not by tint or opacity', () => {
    const base = groupSignature([road()]);
    expect(groupSignature([road({ tint: '#ff0000', opacity: 0.5, name: 'Other' })])).toBe(base);
    expect(groupSignature([road({ width: 3 })])).not.toBe(base);
    expect(groupSignature([road({ points: [{ x: 0, y: 0 }, { x: 9, y: 0 }] })])).not.toBe(base);
    expect(groupSignature([road({ edge: 'hard' })])).not.toBe(base);
    expect(groupSignature([road({ ends: { start: 'taper', end: 'fade', length: 1.5 } })])).not.toBe(base);
  });
});

describe('the junction mask', () => {
  const fakeEngine = () => {
    const calls = { n: 0 };
    return { calls, engine: { renderToTexture: () => void calls.n++ } as unknown as RenderEngine };
  };
  const meshes = [road(), road({ id: 'b', points: [{ x: 4, y: -4 }, { x: 4, y: 4 }] })].map((p) =>
    buildRibbonMesh(sampleCentreline(p.points, false, p.width), {}),
  );

  it('is rebuilt only when the signature moves', () => {
    const { calls, engine } = fakeEngine();
    const first = groupMask(engine, undefined, 'one', meshes, DEFAULT_EDGE_WIDTH)!;
    expect(calls.n).toBe(1);
    expect(groupMask(engine, first, 'one', meshes, DEFAULT_EDGE_WIDTH)).toBe(first);
    expect(calls.n).toBe(1);
    const second = groupMask(engine, first, 'two', meshes, DEFAULT_EDGE_WIDTH)!;
    expect(second).not.toBe(first);
    expect(calls.n).toBe(2);
  });

  it('covers the union of the group, padded, at a resolution under the cap', () => {
    const rect = groupBounds(meshes, 0.3)!;
    expect(rect.x).toBeCloseTo(-1.3, 5); // the cut cap reaches a half width past x = 0
    expect(rect.y).toBeCloseTo(-4.3 - 1, 5); // and past y = -4
    expect(maskResolution({ width: 20, height: 10 })).toBe(32);
    expect(maskResolution({ width: 500, height: 10 }) * 500).toBeLessThanOrEqual(MASK_MAX_PX);
    expect(maskResolution({ width: 100000, height: 10 })).toBe(4);
  });
});

describe('shader inputs', () => {
  it('maps a path’s look onto the uniforms', () => {
    const p = road({ tint: '#ff8000', opacity: 0.5, flip: true });
    const look = pathLook(p, material(['strip']), 'gg-forge:none', 8);
    const u = ribbonUniforms(look, { x: 0, y: 0, width: 1, height: 1 });
    expect(Array.from(u.uTint)).toEqual([1, 128 / 255, 0, 0.5].map((v) => Math.fround(v)));
    expect(Array.from(u.uEnds)).toEqual([0, 1, 1.5, 8]);
    expect(Array.from(u.uEdge)).toEqual([1, Math.fround(DEFAULT_EDGE_WIDTH)]);
    expect(u.uFlip).toBe(1);
    expect(u.uWater).toBe(0);
    expect(u.uMasked).toBe(0);
    // A strip's length along U is its grid width; an unknown one tiles per cell.
    expect(u.uStripLen).toBe(1);
  });

  it('a closed path fades no ends; a hard edge has no soft edge; a mask replaces the edge', () => {
    const closed = pathLook(road({ closed: true, ends: { start: 'fade', end: 'fade', length: 1 } }), material(['strip']), 'x', 10);
    expect([closed.fadeStart, closed.fadeEnd]).toEqual([false, false]);
    expect(pathLook(road({ edge: 'hard' }), material(['strip']), 'x', 1).soft).toBe(false);
    const masked = ribbonUniforms(
      { ...closed, mask: { source: {} as never, rect: { x: 1, y: 2, width: 3, height: 4 } } },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    );
    expect(masked.uMasked).toBe(1);
    expect(Array.from(masked.uMaskRect)).toEqual([1, 2, 3, 4]);
    expect(Array.from(masked.uFrame)).toEqual([0.5, 0, 0.5, 1]);
  });

  it('a liquid (a material with a fill) is shallow at its banks and deep down the middle', () => {
    expect(pathLook(road(), material(['strip', 'fill']), 'x', 1).water).toBe(true);
    expect(liquidShade(0)).toBe(1);
    expect(liquidShade(1)).toBe(1);
    expect(liquidShade(0.5)).toBeCloseTo(0.68, 9);
    expect(liquidShade(0.25)).toBeCloseTo(0.84, 9);
    // The shader runs the same curve.
    expect(RIBBON_FRAGMENT_SRC.replace(/\s+/g, ' ')).toContain('mix(1.0, 0.68, 1.0 - abs(v - 0.5) * 2.0)');
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

describe('an edge strip under a soft edge', () => {
  it('reaches under the ribbon solid, its art still starting at the ribbon edge', () => {
    const line = sampleCentreline([{ x: 0, y: 0 }, { x: 8, y: 0 }], false, 2);
    const { left } = buildEdgeStrips(line, 0.5, {}, 0.5);
    tuckEdgeStrip(left, 0.5, 0.5);
    // Inner side at half the width less the tuck; V -1 there, so V 0 falls on the ribbon edge.
    expect(Array.from(left.positions.slice(0, 4))).toEqual([0, 0.5, 0, 1.5]);
    expect(Array.from(left.uvs.slice(0, 4))).toEqual([0, -1, 0, 1]);
    // The inner row is clamped in the shader: what lies under the ribbon is the art's solid edge.
    expect(RIBBON_FRAGMENT_SRC).toContain('clamp(vUV.y, 0.0, 1.0)');
    const hard = buildEdgeStrips(line, 0.5).left;
    tuckEdgeStrip(hard, 0, 0.5);
    expect(Array.from(hard.uvs.slice(0, 4))).toEqual([0, 0, 0, 1]);
  });
});

describe('a concave lake', () => {
  it('fills its own shape, the notch left empty', () => {
    // An L: the notch at the top right is outside the shore.
    const shore = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]].map(([x, y]) => ({ x, y, handles: null }));
    const g = fillMask(road({ closed: true, fill: true, points: shore }))!;
    expect(g.containsPoint({ x: 2, y: 8 })).toBe(true);
    expect(g.containsPoint({ x: 8, y: 2 })).toBe(true);
    expect(g.containsPoint({ x: 7, y: 7 })).toBe(false);
    expect(fillMask(road({ closed: true, points: shore.slice(0, 2) }))).toBeNull();
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
