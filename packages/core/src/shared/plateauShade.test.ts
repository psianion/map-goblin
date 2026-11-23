// The shade a raised edge throws: the drop shade's stacked bands, and the sun shadow's fill
// and clip, read along a ray the way the blur and the mask make them.
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import {
  SUN_SHADOW_ALPHA,
  SUN_SHADOW_BACK,
  DEFAULT_FACE_DIRECTION,
  FACE_DEPTH_MAX,
  FACE_DEPTH_WANDER,
  FACE_LEDGE,
  FACE_LEDGE_JITTER,
  FACE_LEDGE_STEP,
  FACE_LIFT_ALPHA,
  FACE_LIFT_COLOR,
  FACE_TILE_KEEP,
  dropShadeWidth,
  faceBandCount,
  faceBandShades,
  faceDepth,
  faceDirectionOf,
  faceReach,
  faceVector,
  highlightWeight,
  ledgeSteps,
  leeSweeps,
  linesOff,
  offsetPath,
  rimWeight,
  slopeFace,
  sunShadowLength,
  wobbleSeed,
  wrapDirection,
} from './plateauShade';
import { CLIFF_SHADOW_FADE, cliffShadowParts, reliefShadowParts } from '../engine/shadowPass';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { layerPlateaus, pointInPoly } from './plateaus';
import type { DungeonLayer, PlateauChild } from '../store/types';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const plat = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<PlateauChild> = {}): PlateauChild => ({
  id,
  name: id,
  childType: 'plateau',
  visible: true,
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  height: 1,
  edge: 'cliff',
  ...extra,
});
const layerOf = (children: unknown[]) => ({ id: 'l', type: 'dungeon', children }) as unknown as DungeonLayer;
const GROUND: Polygon[] = [[[0, 0], [30, 0], [30, 30], [0, 30]]];
const inAny = (p: [number, number], rings: Polygon[]) => rings.filter((r) => pointInPoly(p[0], p[1], r)).length % 2 === 1;

/**
 * The shadow's opacity along a ray from `from` along (dx, dy), `step` cells a sample: the fill
 * blurred across the ray (a Gaussian fading 90 % to 10 % over CLIFF_SHADOW_FADE, as the pass's
 * blur is set to), then cut by the clip. A long straight edge is all the blur sees across it.
 */
function profile(fill: Polygon[], clip: Polygon[], from: [number, number], dir: [number, number], reach: number, step = 0.02): number[] {
  const sigma = CLIFF_SHADOW_FADE / 2.5631;
  const at = (t: number): [number, number] => [from[0] + dir[0] * t, from[1] + dir[1] * t];
  const span = Math.ceil((3 * sigma) / step);
  const raw = (t: number) => (inAny(at(t), fill) ? SUN_SHADOW_ALPHA : 0);
  const out: number[] = [];
  for (let t = step / 2; t < reach; t += step) {
    let sum = 0;
    let w = 0;
    for (let k = -span; k <= span; k++) {
      const g = Math.exp(-((k * step) ** 2) / (2 * sigma * sigma));
      sum += g * raw(t + k * step);
      w += g;
    }
    out.push(inAny(at(t), clip) ? sum / w : 0);
  }
  return out;
}

describe('the drop shade', () => {
  // A faint contact shade: a quarter of the old 45 %, never wider than a third of a cell.
  it('is 0.15 + 0.06 a cell of drop wide, at most a third of a cell', () => {
    expect(dropShadeWidth(1)).toBeCloseTo(0.21);
    expect(dropShadeWidth(-2)).toBeCloseTo(0.27);
    expect(dropShadeWidth(3)).toBeCloseTo(0.33);
    expect(dropShadeWidth(9)).toBeCloseTo(1 / 3);
  });
});

describe('the sun shadow off an edge', () => {
  it('is 0.8 + 0.6 a cell of drop long, whatever the sun', () => {
    expect(sunShadowLength(1)).toBeCloseTo(1.4);
    expect(sunShadowLength(-2)).toBeCloseTo(2.0);
    expect(sunShadowLength(3)).toBeCloseTo(2.6);
  });

  it('sweeps only the stretches turned from the light, reaching back behind the edge', () => {
    // A plateau ring, outside on the left of travel: (10,10) → (14,10) → (14,14) → (10,14).
    const ring: Polygon = [[10, 10], [14, 10], [14, 14], [10, 14]];
    const sweeps = leeSweeps(ring, true, true, { dx: 1, dy: 0 }, 2);
    expect(sweeps).toHaveLength(1);
    const xs = sweeps[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(14 - SUN_SHADOW_BACK);
    expect(Math.max(...xs)).toBeCloseTo(16);
    // A pit's low side is inside: the west rim is the one the light comes over.
    const pit = leeSweeps(ring, true, false, { dx: 1, dy: 0 }, 2);
    expect(pit).toHaveLength(1);
    expect(Math.min(...pit[0].map((p) => p[0]))).toBeCloseTo(10 - SUN_SHADOW_BACK);
  });

  it('starts on the edge at full strength and only lightens outward, at +1 and +3, indoors sun and out', () => {
    const dirs: [number, number][] = [[1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0.6, -0.8]];
    for (const height of [1, 3]) {
      for (const [dx, dy] of dirs) {
        const look = { dx, dy, length: 1, alpha: 0.4, color: '#000000' };
        const parts = cliffShadowParts(layerOf([plat('top', 10, 10, 16, 16, { height })]), look, GROUND);
        expect(parts).toHaveLength(1);
        const { fill, clip } = parts[0];
        // From the middle of the side the light leaves, along the sun.
        const from: [number, number] = Math.abs(dx) >= Math.abs(dy) ? [dx > 0 ? 16 : 10, 13] : [13, dy > 0 ? 16 : 10];
        const reach = sunShadowLength(height) + 1;
        const a = profile(fill, clip, from, [dx, dy], reach);
        // Dark right at the edge: within 0.02 cell of it, all but none of the full strength.
        expect(a[0]).toBeGreaterThan(0.97 * SUN_SHADOW_ALPHA);
        // No sample within 0.3 cell of the edge lighter than its neighbour further out, nor anywhere.
        for (let i = 0; i + 1 < a.length; i++) expect(a[i + 1], `+${height} (${dx},${dy}) at ${(i * 0.02).toFixed(2)}`).toBeLessThanOrEqual(a[i] + 1e-9);
        // And it is gone a cell past its length.
        expect(a[a.length - 1]).toBeLessThan(0.02);
      }
    }
  });

  it('sweeps each stretch of an edge by its own drop: shorter onto a +1 beside a +3 than onto the ground', () => {
    const look = { dx: 1, dy: 0, length: 1, alpha: 0.4, color: '#000000' };
    const mesa = plat('mesa', 10, 10, 16, 16, { height: 3 });
    // Against the lower half of the mesa's right edge, standing on the ground beside it.
    const shelf = plat('shelf', 15, 13, 22, 19, { height: 1 });
    const parts = cliffShadowParts(layerOf([mesa, shelf]), look, GROUND);
    const fill = parts.flatMap((p) => p.fill);
    const reach = (y: number) => {
      let x = 16;
      while (inAny([x + 0.02, y], fill)) x += 0.02;
      return x - 16;
    };
    expect(reach(11.5)).toBeCloseTo(sunShadowLength(3), 1);
    expect(reach(14.5)).toBeCloseTo(sunShadowLength(2), 1);
    // Per segment, the sweep itself.
    const run: Polygon = [[16, 10], [16, 13], [16, 16]];
    const [a, b] = leeSweeps(run, false, true, look, [2.6, 2]);
    expect(Math.max(...a.map((p) => p[0]))).toBeCloseTo(18.6);
    expect(Math.max(...b.map((p) => p[0]))).toBeCloseTo(18);
  });

  it('never lands on a curved caster’s own top', () => {
    const ring: Polygon = [[20, 6], [27, 5], [29.5, 9.5], [25, 13], [19.5, 11.5]];
    const tangents = ring.map((p, i) => {
      const a = ring[(i - 1 + ring.length) % ring.length];
      const b = ring[(i + 1) % ring.length];
      const t = [(b[0] - a[0]) / 6, (b[1] - a[1]) / 6];
      return { tin: [p[0] - t[0], p[1] - t[1]] as [number, number], tout: [p[0] + t[0], p[1] + t[1]] as [number, number] };
    });
    const curve = { ...plat('curve', 0, 0, 0, 0, { height: 2, edge: 'slope', faceDir: 60 }), contours: [ring], tangents: [tangents] };
    for (const look of [{ dx: -0.8, dy: 0.6 }, { dx: -1, dy: 0 }, { dx: 0.6, dy: 0.8 }]) {
      const shown = cliffShadowParts(layerOf([curve]), { ...look, length: 1, alpha: 0.4, color: '#000000' }, GROUND).flatMap(({ fill, clip }) => clipper2Engine.intersection(fill, clip));
      const top = layerPlateaus(layerOf([curve])).bands[0].rings;
      const onTop = clipper2Engine.intersection(shown, clipper2Engine.inflate(top, -0.05));
      expect(onTop.flat()).toEqual([]);
    }
  });

  it('never lands on the caster’s own top', () => {
    const look = { dx: 1, dy: 0, length: 1, alpha: 0.4, color: '#000000' };
    const [{ clip }] = cliffShadowParts(layerOf([plat('top', 10, 10, 16, 16, { height: 2 })]), look, GROUND);
    expect(inAny([15.9, 13], clip)).toBe(false);
    expect(inAny([16.1, 13], clip)).toBe(true);
  });

  it('casts off a slope too, from the foot of its own face', () => {
    const look = { dx: 0, dy: 1, length: 1, alpha: 0.4, color: '#000000' };
    const parts = cliffShadowParts(layerOf([plat('hill', 10, 10, 16, 16, { height: 1, edge: 'slope', faceDir: 90 })]), look, GROUND);
    expect(parts).toHaveLength(1);
    const [{ fill, clip }] = parts;
    expect(inAny([13, 16.5], fill)).toBe(true);
    // Not on the face under the bottom edge, from its foot on, however far the foot wanders.
    expect(inAny([13, 16 + faceDepth(1) / 2], clip)).toBe(false);
    expect(inAny([13, 16 + faceReach(1) + 0.02], clip)).toBe(true);
  });
});

describe('the shadow of a floor or patch with a height', () => {
  const look = { dx: 1, dy: 0, length: 1, alpha: 0.4, color: '#000000' };
  const shape = (height: number | undefined) => ({
    id: 'f',
    name: 'f',
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[10, 10], [14, 10], [14, 14], [10, 14]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...(height === undefined ? {} : { height }),
  });
  const shown = (parts: { fill: Polygon[]; clip: Polygon[] }[]) => parts.flatMap(({ fill, clip }) => clipper2Engine.intersection(fill, clip)).flat();

  it('falls on the low side of a raised floor, as long as a plateau of its height casts', () => {
    const pts = shown(reliefShadowParts(layerOf([shape(2)]), look, GROUND));
    expect(pts.length).toBeGreaterThan(0);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(14 - 1e-6);
      expect(x).toBeLessThanOrEqual(14 + sunShadowLength(2) + 1e-6);
      expect(y).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(y).toBeLessThanOrEqual(14 + 1e-6);
    }
  });

  it('shades a sunk patch inside its edge, from the rim the light comes over', () => {
    const patch = { id: 'p', material: 'p:water', rings: [[[10, 10], [14, 10], [14, 14], [10, 14]]], smooth: false, border: false, height: -1 };
    const pts = shown(reliefShadowParts({ ...layerOf([]), materials: [patch] } as unknown as DungeonLayer, look, GROUND));
    expect(pts.length).toBeGreaterThan(0);
    for (const [x] of pts) {
      expect(x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(x).toBeLessThanOrEqual(10 + sunShadowLength(1) + 1e-6);
    }
  });

  it('casts nothing at height 0 or unset', () => {
    expect(reliefShadowParts(layerOf([shape(0)]), look, GROUND)).toEqual([]);
    expect(reliefShadowParts(layerOf([shape(undefined)]), look, GROUND)).toEqual([]);
  });
});

describe('the slope face', () => {
  // A 4 x 4 plateau's ring, outside on the left of travel (as the bands wind theirs).
  const ring: Polygon = [[2, 2], [6, 2], [6, 6], [2, 6]];
  const box = (rings: Polygon[]) => {
    const pts = rings.flat();
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const area = (rings: Polygon[]) =>
    rings.reduce((sum, r) => sum + r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2, 0);

  it('lays one ledge more than the drop, each 0.18 thick: 2 at 1 up to 5 from 4', () => {
    expect(FACE_LEDGE).toBeCloseTo(0.18);
    expect([1, 2, 3, 4, 7].map(faceBandCount)).toEqual([2, 3, 4, 5, 5]);
    expect(faceBandCount(-2)).toBe(3);
    expect(faceDepth(1)).toBeCloseTo(0.36);
    expect(faceDepth(2)).toBeCloseTo(0.54);
    expect(faceDepth(-3)).toBeCloseTo(0.72);
    expect(faceDepth(4)).toBeCloseTo(0.9);
    expect(faceDepth(9)).toBeCloseTo(FACE_DEPTH_MAX);
    expect(FACE_DEPTH_MAX).toBeCloseTo(0.9);
    expect(faceReach(2)).toBeCloseTo(faceDepth(2) * (1 + FACE_DEPTH_WANDER));
  });

  it('over plain ground darkens only, 0.80 at the rim down to 0.54 at the foot in even steps (0.56 with two)', () => {
    for (const n of [2, 3, 4, 5]) {
      const shades = faceBandShades(n, false);
      expect(shades).toHaveLength(n);
      expect(shades.every((s) => s && !s.add)).toBe(true);
      expect(shades[0]!.alpha).toBeCloseTo(0.2);
      expect(shades[n - 1]!.alpha).toBeCloseTo(n === 2 ? 0.44 : 0.46);
      const steps = shades.slice(1).map((s, k) => s!.alpha - shades[k]!.alpha);
      for (const d of steps) expect(d).toBeCloseTo(steps[0], 9);
    }
    expect(faceBandShades(3, false).map((s) => 1 - s!.alpha)).toEqual([expect.closeTo(0.8), expect.closeTo(0.67), expect.closeTo(0.54)]);
  });

  it('over a face tile lifts the top ledge, darkens the last, the one above it half as far at 4 and 5, and leaves the rest', () => {
    const lift = { add: true, color: FACE_LIFT_COLOR, alpha: FACE_LIFT_ALPHA };
    const dark = { add: false, alpha: 1 - FACE_TILE_KEEP };
    const half = { add: false, alpha: (1 - FACE_TILE_KEEP) / 2 };
    expect(FACE_TILE_KEEP).toBeCloseTo(0.74);
    expect(faceBandShades(2, true)).toEqual([expect.objectContaining(lift), expect.objectContaining(dark)]);
    expect(faceBandShades(3, true)).toEqual([expect.objectContaining(lift), null, expect.objectContaining(dark)]);
    const four = faceBandShades(4, true);
    expect(four[0]).toMatchObject(lift);
    expect(four[1]).toBeNull();
    expect(four[2]!.alpha).toBeCloseTo(half.alpha);
    expect(four[3]).toMatchObject(dark);
    const five = faceBandShades(5, true);
    expect(five.map((s) => (s ? (s.add ? 'lift' : s.alpha > 0.2 ? 'dark' : 'half') : null))).toEqual(['lift', null, null, 'half', 'dark']);
  });

  it('points 0 right and 90 down, 60 by default, the plateau’s own over the map’s', () => {
    expect(faceVector(0)[0]).toBeCloseTo(1);
    expect(faceVector(90)[1]).toBeCloseTo(1);
    expect(faceDirectionOf(null, undefined)).toBe(DEFAULT_FACE_DIRECTION);
    expect(DEFAULT_FACE_DIRECTION).toBe(60);
    expect(faceDirectionOf({}, 135)).toBe(135);
    expect(faceDirectionOf({ faceDir: 30 }, 135)).toBe(30);
    expect(wrapDirection(-15)).toBe(345);
    expect(wrapDirection(375)).toBe(15);
  });

  /** How far below y = `rim` the rings reach at `x`: the face's width there. */
  const footAt = (rings: Polygon[], x: number, rim: number) => {
    let best = -Infinity;
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const [ax, ay] = r[i];
        const [bx, by] = r[(i + 1) % r.length];
        if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
        best = Math.max(best, ay + ((by - ay) * (x - ax)) / (bx - ax));
      }
    }
    return Math.max(0, best - rim);
  };

  it('hangs off the bottom edge only of a raised square at 90, F deep, in ledges counted from the rim', () => {
    const face = slopeFace(ring, true, true, [ring], 90, 1);
    const b = box(face.region);
    expect(b.minX).toBeGreaterThan(2 - 1e-6);
    expect(b.maxX).toBeLessThan(6 + 1e-6);
    expect(b.minY).toBeCloseTo(6);
    expect(b.maxY).toBeCloseTo(6 + faceDepth(1));
    // Two ledges, each FACE_LEDGE thick, rim first.
    expect(face.bands).toHaveLength(2);
    expect(footAt(face.steps[0], 4, 6)).toBeCloseTo(FACE_LEDGE);
    expect(footAt(face.region, 4, 6)).toBeCloseTo(2 * FACE_LEDGE);
  });

  it('eases into the rim at both ends of a facing stretch: no straight end cut', () => {
    for (const drop of [1, 3]) {
      const F = faceDepth(drop);
      const face = slopeFace(ring, true, true, [ring], 90, drop);
      // Full in the middle, under a quarter of the depth a tenth of a cell from either end.
      expect(footAt(face.region, 4, 6)).toBeCloseTo(F);
      expect(footAt(face.region, 2.1, 6)).toBeLessThan(F / 4);
      expect(footAt(face.region, 5.9, 6)).toBeLessThan(F / 4);
      // And it rises without a step along the way.
      let last = 0;
      for (let x = 2.02; x <= 4; x += 0.04) {
        const at = footAt(face.region, x, 6);
        expect(at + 1e-3).toBeGreaterThanOrEqual(last);
        last = at;
      }
    }
  });

  it('runs on to the end of an open run whose end goes on under a higher plateau', () => {
    // The bottom edge alone, travelling right to left so its low side is below.
    const run: Polygon = [[6, 6], [2, 6]];
    const F = faceDepth(2);
    const runsOn = slopeFace(run, false, true, [ring], 90, 2, undefined, { start: false, end: false });
    expect(footAt(runsOn.region, 2.1, 6)).toBeCloseTo(F);
    expect(footAt(runsOn.region, 5.9, 6)).toBeCloseTo(F);
    const eases = slopeFace(run, false, true, [ring], 90, 2, undefined, { start: true, end: false });
    expect(footAt(eases.region, 5.9, 6)).toBeLessThan(F / 4);
    expect(footAt(eases.region, 2.1, 6)).toBeCloseTo(F);
  });

  it('does not end the face at a short turned-away notch in a jagged edge', () => {
    // A bottom edge with a 0.2 cell notch turned away (its low side faces up) in the middle.
    const jag: Polygon = [[2, 2], [6, 2], [6, 6], [4.1, 6], [4.1, 5.8], [3.9, 5.8], [3.9, 6], [2, 6]];
    const face = slopeFace(jag, true, true, [jag], 90, 1);
    expect(footAt(face.region, 3.7, 6)).toBeCloseTo(faceDepth(1));
    expect(footAt(face.region, 4.3, 6)).toBeCloseTo(faceDepth(1));
  });

  it('lays four ledges where the drop is 3 and three where it is 2, the top three unbroken across the join', () => {
    const run: Polygon = [[12, 4], [6, 4], [0, 4]];
    const top: Polygon = [[0, 0], [12, 0], [12, 4], [0, 4]];
    const face = slopeFace(run, false, true, [top], 90, [3, 2], undefined, { start: false, end: false });
    expect(face.bands).toHaveLength(4);
    // The foot: 4 ledges on the drop of 3, 3 on the drop of 2, eased over FACE_JOIN round x = 6.
    expect(footAt(face.region, 9, 4)).toBeCloseTo(4 * FACE_LEDGE);
    expect(footAt(face.region, 3, 4)).toBeCloseTo(3 * FACE_LEDGE);
    const mid = footAt(face.region, 6, 4);
    expect(mid).toBeGreaterThan(3 * FACE_LEDGE);
    expect(mid).toBeLessThan(4 * FACE_LEDGE);
    // The lowest ledge only where the drop is 3; the upper three run the whole edge at full depth.
    expect(footAt(face.bands[3], 3, 4)).toBe(0);
    expect(footAt(face.bands[3], 9, 4)).toBeCloseTo(4 * FACE_LEDGE);
    for (let k = 0; k < 3; k++) {
      for (const x of [1, 3, 5.5, 6, 6.5, 9, 11]) expect(footAt(face.steps[k], x, 4), `ledge ${k} at ${x}`).toBeCloseTo((k + 1) * FACE_LEDGE);
    }
  });

  it('moves round the outline as the direction turns', () => {
    const right = box(slopeFace(ring, true, true, [ring], 0, 2).region);
    expect(right.minX).toBeCloseTo(6);
    expect(right.maxX).toBeCloseTo(6 + faceDepth(2));
    expect(right.minY).toBeGreaterThan(2 - 1e-6);
    expect(right.maxY).toBeLessThan(6 + 1e-6);
    // Lower right: the bottom and right edges both, never the top or left.
    const lowerRight = slopeFace(ring, true, true, [ring], 45, 2).region;
    for (const [x, y] of lowerRight.flat()) expect(x >= 6 - 1e-6 || y >= 6 - 1e-6).toBe(true);
  });

  it('shows a pit’s far wall inside its top rim', () => {
    const face = slopeFace(ring, true, false, [ring], 90, -2);
    const b = box(face.region);
    expect(b.minY).toBeCloseTo(2);
    expect(b.maxY).toBeCloseTo(2 + faceDepth(2));
    expect(b.minX).toBeGreaterThan(2 - 1e-6);
    expect(b.maxX).toBeLessThan(6 + 1e-6);
    expect(face.bands).toHaveLength(3);
  });

  it('lines the foot of a face, never the rim it hangs from, the foot meeting the rim at the ends', () => {
    const face = slopeFace(ring, true, true, [ring], 90, 1);
    const lines = linesOff(face.region, [ring]);
    const pts = lines.flat();
    expect(pts.length).toBeGreaterThan(0);
    // Every stretch has a point below the rim: none runs along it.
    for (const l of lines) expect(Math.max(...l.map((p) => p[1]))).toBeGreaterThan(6 + 0.1);
    // The foot runs the bottom, coming in to the rim near either corner.
    expect(Math.min(...pts.map((p) => p[0]))).toBeLessThan(2.25);
    expect(Math.max(...pts.map((p) => p[0]))).toBeGreaterThan(5.75);
  });

  it('with a seed, wanders its depth and steps its ledges along the edge, the same every time', () => {
    const wide: Polygon = [[0, 0], [12, 0], [12, 4], [0, 4]];
    const seed = wobbleSeed('mesa');
    const face = slopeFace(wide, true, true, [wide], 90, 2, seed);
    // The foot along the bottom edge away from its eased ends: deeper and shallower than F, within the wander.
    const F = faceDepth(2);
    const xs = Array.from({ length: 19 }, (_, i) => 1.5 + i * 0.5);
    const feet = xs.map((x) => footAt(face.region, x, 4));
    expect(Math.max(...feet)).toBeGreaterThan(F * 1.05);
    expect(Math.min(...feet)).toBeLessThan(F * 0.95);
    for (const d of feet) {
      expect(d).toBeLessThanOrEqual(faceReach(2) + 1e-6);
      expect(d).toBeGreaterThanOrEqual(F * (1 - FACE_DEPTH_WANDER) - 1e-6);
    }
    // The first ledge's boundary is no ruled line: its share of the depth varies along the edge, in steps.
    const ledge = xs.map((x, i) => footAt(face.steps[0], x, 4) / feet[i]);
    expect(Math.max(...ledge) - Math.min(...ledge)).toBeGreaterThan(0.05);
    for (const s of ledge) expect(s).toBeGreaterThan(0.15);
    // Three bands still make the face, nested rim to foot.
    expect(face.bands).toHaveLength(3);
    expect(area(face.bands.flat())).toBeCloseTo(area(face.region), 3);
    // The same seed draws the same rock.
    expect(slopeFace(wide, true, true, [wide], 90, 2, seed).region).toEqual(face.region);
  });

  it('keeps its ledge boundaries within half a ledge of their places, so they stay in order', () => {
    for (const seed of [1, 99, wobbleSeed('a'), wobbleSeed('summit')]) {
      for (const n of [2, 3, 5]) {
        const steps = ledgeSteps(seed, n);
        expect(steps).toHaveLength(n - 1);
        for (let u = 0; u < 20; u += 0.07) for (const s of steps) expect(Math.abs(s(u))).toBeLessThanOrEqual(FACE_LEDGE_STEP + FACE_LEDGE_JITTER + 1e-9);
      }
    }
    expect(FACE_LEDGE_STEP + FACE_LEDGE_JITTER).toBeLessThan(0.5);
  });

  it('weighs the rim by how squarely the edge faces the direction, and the highlight the other way', () => {
    expect(rimWeight(1)).toBe(1);
    expect(rimWeight(-1)).toBe(0);
    expect(highlightWeight(-1)).toBe(1);
    expect(highlightWeight(1)).toBe(0);
  });

  it('pushes a line onto the top, rounded at each corner', () => {
    // The highlight is laid along the rim pushed to its high side.
    const line = offsetPath(ring, true, false, 0.5);
    for (const [x, y] of line) {
      const inX = Math.min(x - 2, 6 - x);
      const inY = Math.min(y - 2, 6 - y);
      expect(Math.min(inX, inY)).toBeCloseTo(0.5, 6);
    }
  });
});
