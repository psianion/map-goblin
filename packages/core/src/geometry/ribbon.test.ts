import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from './Clipper2Engine';
import {
  buildEdgeStrips,
  buildRibbon,
  buildRibbonMesh,
  ribbonOutline,
  sampleCentreline,
  type RibbonMesh,
  type RibbonPoint,
} from './ribbon';

/** Same wasm hand-off as roomDetection.test.ts — jsdom can't fetch the .wasm. */
beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(
    createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'),
  );
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const pt = (x: number, y: number, extra: Partial<RibbonPoint> = {}): RibbonPoint => ({ x, y, ...extra });
const FADE = { start: 'fade', end: 'fade', length: 1 } as const;

function allFinite(mesh: RibbonMesh): boolean {
  return [mesh.positions, mesh.uvs, mesh.arc, mesh.width].every((a) => a.every(Number.isFinite));
}

/**
 * Signed areas of every triangle, against the winding a straight strip has.
 * A negative one is a fold: the strip turned over on itself.
 */
function foldedTriangles(mesh: RibbonMesh): number {
  const p = mesh.positions;
  const at = (i: number): [number, number] => [p[i * 2], p[i * 2 + 1]];
  let folded = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [at(mesh.indices[t]), at(mesh.indices[t + 1]), at(mesh.indices[t + 2])];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (area < -1e-6) folded++;
  }
  return folded;
}

function area(poly: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

describe('sampleCentreline', () => {
  it('a straight two-point path is two samples with the chord as its length', () => {
    const line = sampleCentreline([pt(0, 0), pt(10, 0)], false, 2);
    expect(line.xy).toEqual([[0, 0], [10, 0]]);
    expect(line.arc).toEqual([0, 10]);
    expect(line.width).toEqual([2, 2]);
    expect(line.height).toEqual([0, 0]);
    expect(line.length).toBe(10);
  });

  it('an S-curve passes through its points and stays within the flatten tolerance of a smooth curve', () => {
    const points = [pt(0, 0), pt(4, 3), pt(8, 0), pt(12, -3), pt(16, 0)];
    const line = sampleCentreline(points, false, 1);
    for (const p of points) {
      expect(line.xy.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 1e-9)).toBe(true);
    }
    expect(line.xy.length).toBeGreaterThan(20);
    expect(line.length).toBeGreaterThan(16);
    // The arc is monotone and matches the summed chords.
    for (let i = 1; i < line.arc.length; i++) expect(line.arc[i]).toBeGreaterThan(line.arc[i - 1]);
  });

  it('sharp points (handles null) keep straight edges', () => {
    const line = sampleCentreline([pt(0, 0), pt(4, 0, { handles: null }), pt(4, 4)], false, 1);
    expect(line.xy).toEqual([[0, 0], [4, 0], [4, 4]]);
    expect(line.length).toBe(8);
  });

  it('explicit handles bend the segment toward them', () => {
    const line = sampleCentreline(
      [pt(0, 0, { handles: { in: [0, 0], out: [0, 3] } }), pt(4, 0, { handles: { in: [0, 3], out: [0, 0] } })],
      false,
      1,
    );
    const top = Math.max(...line.xy.map(([, y]) => y));
    expect(top).toBeCloseTo(2.25, 2); // a cubic with both controls at +3 peaks at 3/4 of it
  });

  it('drops duplicate and zero-length points', () => {
    const line = sampleCentreline([pt(0, 0), pt(0, 0), pt(5, 0), pt(5, 0), pt(10, 0)], false, 1);
    expect(line.length).toBeCloseTo(10, 9);
    expect(line.xy.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(sampleCentreline([pt(3, 3)], false, 1).xy).toEqual([]);
    expect(sampleCentreline([pt(3, 3), pt(3, 3), pt(3, 3)], false, 1).length).toBe(0);
    expect(buildRibbon([pt(3, 3), pt(3, 3)], false, 1).positions.length).toBe(0);
  });

  it('a closed loop wraps back onto its first sample', () => {
    const line = sampleCentreline([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)], true, 1);
    expect(line.xy[0]).toEqual([0, 0]);
    expect(line.xy[line.xy.length - 1]).toEqual([0, 0]);
    expect(line.arc[line.arc.length - 1]).toBe(line.length);
    // Auto tangents round the corners into a near circle through them: longer than the square, shorter than that circle.
    expect(line.length).toBeGreaterThan(16);
    expect(line.length).toBeLessThan(2 * Math.PI * 2 * Math.SQRT2);
    // A repeated closing point is the same loop.
    const repeated = sampleCentreline([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4), pt(0, 0)], true, 1);
    expect(repeated.length).toBeCloseTo(line.length, 9);
  });

  it('interpolates width linearly in arc length between points (absent = the path width), and height between the points that set it', () => {
    const line = sampleCentreline(
      [pt(0, 0, { width: 1, height: 0 }), pt(10, 0), pt(20, 0, { width: 3, height: 2 }), pt(30, 0)],
      false,
      5,
    );
    const at = (x: number) => line.xy.findIndex(([px]) => Math.abs(px - x) < 1e-9);
    expect(line.width[at(0)]).toBe(1);
    expect(line.width[at(5)]).toBeUndefined();
    expect(line.width[at(10)]).toBe(5);
    expect(line.width[at(20)]).toBe(3);
    expect(line.width[at(30)]).toBe(5);
    expect(line.height[at(10)]).toBeCloseTo(1, 9);
    expect(line.height[at(30)]).toBe(2); // held past the last point that sets one
    // No point sets a width: the path default.
    expect(sampleCentreline([pt(0, 0), pt(1, 0)], false, 0.75).width).toEqual([0.75, 0.75]);
  });

  it('closed loops interpolate width across the seam', () => {
    const line = sampleCentreline(
      [pt(0, 0, { handles: null, width: 1 }), pt(4, 0, { handles: null }), pt(4, 4, { handles: null, width: 3 }), pt(0, 4, { handles: null })],
      true,
      2,
    );
    const at = (x: number, y: number) => line.xy.findIndex(([px, py]) => px === x && py === y);
    expect(line.width[at(4, 0)]).toBe(2);
    expect(line.width[line.width.length - 1]).toBe(1);
  });

  it('a taper eases the width to 0 over the end length, with samples laid inside it', () => {
    const line = sampleCentreline([pt(0, 0), pt(10, 0)], false, 2, {
      ends: { start: 'taper', end: 'taper', length: 2 },
    });
    expect(line.xy.length).toBe(2 + 8 * 2);
    expect(line.width[0]).toBe(0);
    expect(line.width[line.width.length - 1]).toBe(0);
    const at = (s: number) => line.width[line.arc.findIndex((a) => Math.abs(a - s) < 1e-9)];
    expect(at(1)).toBeCloseTo(1, 9); // smoothstep(0.5) of 2
    expect(at(9)).toBeCloseTo(1, 9);
    expect(at(10)).toBe(0);
    expect(Math.max(...line.width)).toBe(2);
  });
});

describe('buildRibbonMesh', () => {
  it('a straight faded path is one quad with U along the arc and V across', () => {
    const mesh = buildRibbon([pt(0, 0), pt(10, 0)], false, 2, { ends: FADE, offset: 0.5 });
    expect(Array.from(mesh.positions)).toEqual([0, 1, 0, -1, 10, 1, 10, -1]);
    expect(Array.from(mesh.uvs)).toEqual([0.5, 0, 0.5, 1, 10.5, 0, 10.5, 1]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 1, 3, 2]);
    expect(Array.from(mesh.arc)).toEqual([0, 0, 10, 10]);
    expect(Array.from(mesh.width)).toEqual([2, 2, 2, 2]);
    expect(mesh.length).toBe(10);
  });

  it('cut ends get round caps that reach half the width past each end', () => {
    const mesh = buildRibbon([pt(0, 0), pt(10, 0)], false, 2);
    const xs = Array.from(mesh.positions).filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-1, 6);
    expect(Math.max(...xs)).toBeCloseTo(11, 6);
    expect(Math.min(...mesh.arc)).toBeCloseTo(-1, 6);
    expect(mesh.positions.length / 2).toBe(20);
    expect(foldedTriangles(mesh)).toBe(0);
    expect(mesh.indices).toBeInstanceOf(Uint16Array);
  });

  it('an S-curve builds without folds or NaN', () => {
    const mesh = buildRibbon([pt(0, 0), pt(4, 3), pt(8, 0), pt(12, -3), pt(16, 0)], false, 1.5, { ends: FADE });
    expect(allFinite(mesh)).toBe(true);
    expect(foldedTriangles(mesh)).toBe(0);
    expect(mesh.positions.length / 2).toBe(2 * sampleCentreline([pt(0, 0), pt(4, 3), pt(8, 0), pt(12, -3), pt(16, 0)], false, 1.5).xy.length);
  });

  it('a hairpin far tighter than the width neither folds nor goes NaN', () => {
    const points = [pt(0, 0), pt(6, 0), pt(6.4, 0.3), pt(6, 0.6), pt(0, 0.6)];
    const mesh = buildRibbon(points, false, 3);
    expect(allFinite(mesh)).toBe(true);
    expect(foldedTriangles(mesh)).toBe(0);
    // The guard did the work: inner vertices collapsed onto their predecessors.
    const p = mesh.positions;
    let collapsed = 0;
    for (let k = 4; k < p.length; k += 2) if (p[k] === p[k - 4] && p[k + 1] === p[k - 3]) collapsed++;
    expect(collapsed).toBeGreaterThan(0);
  });

  it('a sharp hairpin fans round its outer side and collapses the inner one', () => {
    const mesh = buildRibbon([pt(0, 0), pt(6, 0, { handles: null }), pt(0, 0.5)], false, 2, { ends: FADE });
    expect(allFinite(mesh)).toBe(true);
    expect(foldedTriangles(mesh)).toBe(0);
    // The outer fan sweeps past the corner point by half the width.
    const xs = Array.from(mesh.positions).filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeGreaterThan(6.9);
  });

  it('mitres a right angle within the limit and keeps the join to one pair', () => {
    const mesh = buildRibbon([pt(0, 0), pt(4, 0, { handles: null }), pt(4, 4)], false, 2, { ends: FADE });
    expect(mesh.positions.length / 2).toBe(6);
    // The corner pair sits on the mitre: outer (5,-1), inner (3,1).
    expect(mesh.positions[4]).toBeCloseTo(3, 6);
    expect(mesh.positions[5]).toBeCloseTo(1, 6);
    expect(mesh.positions[6]).toBeCloseTo(5, 6);
    expect(mesh.positions[7]).toBeCloseTo(-1, 6);
  });

  it('a closed loop closes the strip on itself with no caps', () => {
    const mesh = buildRibbon([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)], true, 1);
    const n = mesh.positions.length;
    expect(Array.from(mesh.positions.slice(0, 4)).map((v) => +v.toFixed(5))).toEqual(
      Array.from(mesh.positions.slice(n - 4)).map((v) => +v.toFixed(5)),
    );
    expect(allFinite(mesh)).toBe(true);
    expect(foldedTriangles(mesh)).toBe(0);
    expect(Math.min(...mesh.arc)).toBe(0);
  });

  it('a tapered path comes to a point at both ends', () => {
    const mesh = buildRibbon([pt(0, 0), pt(10, 0)], false, 2, { ends: { start: 'taper', end: 'taper', length: 2 } });
    expect(mesh.positions.length / 2).toBe(36); // no caps on a taper
    expect([mesh.positions[0], mesh.positions[1]]).toEqual([mesh.positions[2], mesh.positions[3]]);
    expect(allFinite(mesh)).toBe(true);
  });

  it('carries per-vertex width into the mesh', () => {
    const line = sampleCentreline([pt(0, 0, { width: 1 }), pt(10, 0, { width: 3 })], false, 2);
    const mesh = buildRibbonMesh(line, { ends: FADE });
    expect(Array.from(mesh.width)).toEqual([1, 1, 3, 3]);
    expect(Array.from(mesh.positions)).toEqual([0, 0.5, 0, -0.5, 10, 1.5, 10, -1.5]);
  });
});

describe('buildEdgeStrips', () => {
  it('lays a strip outward from each edge with V = 0 against the ribbon', () => {
    const line = sampleCentreline([pt(0, 0), pt(10, 0)], false, 2);
    const { left, right } = buildEdgeStrips(line, 0.5);
    expect(Array.from(left.positions)).toEqual([0, 1, 0, 1.5, 10, 1, 10, 1.5]);
    expect(Array.from(right.positions)).toEqual([0, -1, 0, -1.5, 10, -1, 10, -1.5]);
    expect(Array.from(left.uvs)).toEqual([0, 0, 0, 1, 10, 0, 10, 1]);
    expect(Array.from(right.uvs)).toEqual([0, 0, 0, 1, 10, 0, 10, 1]);
  });

  it('follows a curve and its corners without NaN', () => {
    const line = sampleCentreline([pt(0, 0), pt(6, 0, { handles: null }), pt(0, 0.5)], false, 2);
    const { left, right } = buildEdgeStrips(line, 0.5);
    expect(allFinite(left) && allFinite(right)).toBe(true);
    expect(left.positions.length).toBeGreaterThan(0);
    expect(right.positions.length).toBeGreaterThan(0);
    expect(buildEdgeStrips(line, 0).left.positions.length).toBe(0);
  });
});

describe('ribbonOutline', () => {
  it('a straight path outlines as a capsule', () => {
    const polys = ribbonOutline(sampleCentreline([pt(0, 0), pt(10, 0)], false, 2));
    expect(polys).toHaveLength(1);
    expect(Math.abs(area(polys[0]))).toBeCloseTo(20 + Math.PI, 1);
  });

  it('a closed path outlines as a ring, and as one solid shape with fill', () => {
    const line = sampleCentreline(
      [pt(0, 0, { handles: null }), pt(10, 0, { handles: null }), pt(10, 10, { handles: null }), pt(0, 10, { handles: null })],
      true,
      2,
    );
    const ring = ribbonOutline(line);
    expect(ring).toHaveLength(2);
    const filled = ribbonOutline(line, true);
    expect(filled).toHaveLength(1);
    // 12 × 12 with the round outer corners shaved.
    expect(Math.abs(area(filled[0]))).toBeCloseTo(144 - (4 - Math.PI), 1);
  });

  it('variable width unions one offset per run', () => {
    const line = sampleCentreline([pt(0, 0, { width: 1 }), pt(5, 0), pt(10, 0, { width: 3 })], false, 2);
    const polys = ribbonOutline(line);
    expect(polys).toHaveLength(1);
    const ys = polys[0].map(([, y]) => y);
    expect(Math.max(...ys)).toBeCloseTo(1.5, 1);
  });

  it('an empty line has no outline', () => {
    expect(ribbonOutline(sampleCentreline([pt(1, 1)], false, 1))).toEqual([]);
  });
});
