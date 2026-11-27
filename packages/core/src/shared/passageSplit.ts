import type { Polygon } from '../geometry/GeometryEngine';
import type { ThresholdSegment } from './types';
import { clipper2Engine, isClipperReady } from '../geometry/Clipper2Engine';
import { thresholdToRects } from '../engine/roomDetection';
import { interiorPoint, pointInRing, signedArea } from './roomUtils';

/*
 * Where a floor narrows (rooms plan §3.1): the divide lines Suggest proposes so the chambers
 * of one connected floor (a cave, rooms joined by open passages) come out as rooms of their
 * own, and the passages between them as passages.
 *
 * The face is sampled at a quarter of a cell. A sample's clearance is its distance to the
 * nearest edge. Chamber cores are the samples at least CORE_CLEARANCE clear; each core grows
 * back by the same distance, nearest core first, and what no core reaches is passage. A
 * small passage hanging off one chamber is part of it (a chamber's corner, a short nook);
 * every other passage is a corridor. One straight line is proposed wherever two parts meet,
 * and kept only when cutting along it really splits the face into parts a room can hold.
 */

/** Sample spacing, cells. */
const STEP = 0.25;
/** A chamber holds a space this far from every edge: at least 2.5 cells across. */
const CORE_CLEARANCE = 1.25;
/** Smaller chamber cores are dropped, square cells. */
const CORE_MIN_AREA = 4;
/** A passage under this that touches one chamber joins it, square cells. */
const JOIN_MAX_AREA = 3;
/** How far a divide line runs past the floor's edge at each end, cells. */
const OVERRUN = 0.3;
/** No line may leave a part smaller than this, square cells. */
const PART_MIN_AREA = 1;
/** Parts this small are no face at all (`roomFaces` drops them too), square cells. */
const SPECK_AREA = 0.25;
/** Faces sampled at most this many points; a bigger one is left whole. */
const MAX_SAMPLES = 4_000_000;

const INF = 1e20;

/** One face sampled: which samples lie on its floor and how clear of an edge each one is. */
interface FaceRaster {
  /** World x, y of sample (0, 0)'s centre. */
  ox: number;
  oy: number;
  cols: number;
  rows: number;
  inside: Uint8Array;
  /** Distance from the sample to the nearest edge, cells; 0 off the floor. */
  clear: Float32Array;
}

/** The rings that bound one face: its outer ring, its own holes, and the faces sitting in those holes. */
interface FaceRings {
  face: Polygon;
  holes: Polygon[];
  islands: Polygon[];
}

function boxOf(ring: readonly [number, number][]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Sort a cut floor's rings round one face of it. */
function faceRings(face: Polygon, rings: readonly Polygon[]): FaceRings {
  const area = signedArea(face);
  const [fx0, fy0, fx1, fy1] = boxOf(face);
  const within = (ring: Polygon): boolean => {
    const [x0, y0, x1, y1] = boxOf(ring);
    if (x0 < fx0 || y0 < fy0 || x1 > fx1 || y1 > fy1) return false;
    const [px, py] = interiorPoint(ring);
    return pointInRing(px, py, face);
  };
  const islands: Polygon[] = [];
  const holes: Polygon[] = [];
  for (const ring of rings) {
    if (ring === face || ring.length < 3) continue;
    const a = signedArea(ring);
    if (a > 0 && a < area && within(ring)) islands.push(ring);
    else if (a < 0 && within(ring)) holes.push(ring);
  }
  // A hole inside one of the islands is the island's, not this face's.
  const own = holes.filter((h) => {
    const [px, py] = interiorPoint(h);
    return !islands.some((i) => pointInRing(px, py, i));
  });
  return { face, holes: own, islands };
}

/** Even-odd scan fill of `rings` over the grid: 1 where a sample's centre is inside. */
function fill(rings: readonly Polygon[], ox: number, oy: number, cols: number, rows: number, out: Uint8Array): void {
  const xs: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y = oy + r * STEP;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - ox) / STEP));
      const c1 = Math.min(cols - 1, Math.ceil((xs[k + 1] - ox) / STEP) - 1);
      for (let c = c0; c <= c1; c++) out[r * cols + c] ^= 1;
    }
  }
}

/** Felzenszwalb's 1-D squared distance transform of `f` (length n) into `d`. */
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Sample one face of a cut floor. Null when it is too big to sample. */
function rasterise(rings: FaceRings): FaceRaster | null {
  const [x0, y0, x1, y1] = boxOf(rings.face);
  // One clear sample all round, so every edge has an outside beyond it.
  const ox = (Math.floor(x0 / STEP) - 1) * STEP + STEP / 2;
  const oy = (Math.floor(y0 / STEP) - 1) * STEP + STEP / 2;
  const cols = Math.ceil((x1 - ox) / STEP) + 2;
  const rows = Math.ceil((y1 - oy) / STEP) + 2;
  if (cols * rows > MAX_SAMPLES) return null;
  const n = cols * rows;
  const inside = new Uint8Array(n);
  fill([rings.face, ...rings.holes], ox, oy, cols, rows, inside);
  if (rings.islands.length > 0) {
    const island = new Uint8Array(n);
    fill(rings.islands, ox, oy, cols, rows, island);
    for (let i = 0; i < n; i++) if (island[i]) inside[i] = 0;
  }

  // Squared distance, in samples, to the nearest sample off the floor: columns, then rows.
  const m = Math.max(cols, rows);
  const f = new Float64Array(m);
  const d = new Float64Array(m);
  const v = new Int32Array(m);
  const z = new Float64Array(m + 1);
  const dist = new Float64Array(n);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) f[r] = inside[r * cols + c] ? INF : 0;
    edt1(f, rows, d, v, z);
    for (let r = 0; r < rows; r++) dist[r * cols + c] = d[r];
  }
  const clear = new Float32Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) f[c] = dist[r * cols + c];
    edt1(f, cols, d, v, z);
    // The edge lies halfway between the last sample on the floor and the first one off it.
    for (let c = 0; c < cols; c++) clear[r * cols + c] = inside[r * cols + c] ? Math.sqrt(d[c]) * STEP - STEP / 2 : 0;
  }
  return { ox, oy, cols, rows, inside, clear };
}

const N8: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Connected runs (8-way) of the samples `member` accepts, as lists of sample indices. */
function components(raster: FaceRaster, member: (i: number) => boolean): number[][] {
  const { cols, rows } = raster;
  const seen = new Uint8Array(cols * rows);
  const out: number[][] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || !member(start)) continue;
    const comp = [start];
    seen[start] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k];
      const c = i % cols;
      const r = (i - c) / cols;
      for (const [dc, dr] of N8) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (!seen[j] && member(j)) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** The face split into parts: 0 off the floor, else a part number. */
interface Parts {
  label: Int32Array;
  count: number;
  /** Part number → whether it is a corridor (no chamber core of its own). */
  corridor: boolean[];
  /** How many chamber cores the face holds. */
  cores: number;
}

function splitParts(raster: FaceRaster): Parts {
  const { cols, rows, inside, clear } = raster;
  const n = cols * rows;
  const label = new Int32Array(n);
  const cell = STEP * STEP;

  // Chamber cores.
  const cores = components(raster, (i) => inside[i] === 1 && clear[i] >= CORE_CLEARANCE - 1e-6).filter(
    (comp) => comp.length * cell >= CORE_MIN_AREA,
  );
  const corridor: boolean[] = [false];
  cores.forEach((comp, k) => {
    for (const i of comp) label[i] = k + 1;
    corridor.push(false);
  });

  // Each core grows back by the same distance; the nearest core takes a sample.
  const reach = Math.ceil(CORE_CLEARANCE / STEP);
  const reach2 = (CORE_CLEARANCE / STEP) ** 2 + 1e-6;
  const grown = new Int32Array(label);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!inside[i] || label[i] !== 0) continue;
      let best = 0;
      let bestD = reach2;
      for (let dr = -reach; dr <= reach; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -reach; dc <= reach; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const l = label[rr * cols + cc];
          const d2 = dr * dr + dc * dc;
          if (l !== 0 && d2 <= bestD) {
            if (d2 < bestD || best === 0) best = l;
            bestD = d2;
          }
        }
      }
      grown[i] = best;
    }
  }

  // What no core reached is passage: a small one off one chamber joins it, the rest are corridors.
  let count = cores.length;
  const passages = components(raster, (i) => inside[i] === 1 && grown[i] === 0);
  const assign: [number[], number][] = [];
  for (const comp of passages) {
    const touched = new Set<number>();
    for (const i of comp) {
      const c = i % cols;
      const r = (i - c) / cols;
      for (const [dc, dr] of N8) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const l = grown[rr * cols + cc];
        if (l > 0 && l <= cores.length) touched.add(l);
      }
    }
    if (touched.size === 1 && comp.length * cell < JOIN_MAX_AREA) assign.push([comp, [...touched][0]]);
    else {
      count++;
      corridor.push(true);
      assign.push([comp, count]);
    }
  }
  for (const [comp, l] of assign) for (const i of comp) grown[i] = l;
  return { label: grown, count, corridor, cores: cores.length };
}

/** One straight line across each place two parts meet. */
function candidateLines(raster: FaceRaster, parts: Parts, bounds: readonly Polygon[]): [number, number][][] {
  const { cols, rows, ox, oy } = raster;
  const { label } = parts;
  // Midpoints between neighbouring samples of two parts, and the line each pair asks for.
  const byPair = new Map<number, { x: number; y: number; dx: number; dy: number }[]>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = label[r * cols + c];
      if (a === 0) continue;
      for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
        if (c + dc >= cols || r + dr >= rows) continue;
        const b = label[(r + dr) * cols + c + dc];
        if (b === 0 || b === a) continue;
        const key = Math.min(a, b) * 65536 + Math.max(a, b);
        let list = byPair.get(key);
        if (!list) byPair.set(key, (list = []));
        // The boundary between two side-by-side samples runs across their step.
        list.push({ x: ox + (c + dc / 2) * STEP, y: oy + (r + dr / 2) * STEP, dx: dr, dy: dc });
      }
    }
  }

  const lines: [number, number][][] = [];
  for (const points of byPair.values()) {
    // Each place the pair meets on its own: points within a step and a half of each other.
    const group = new Int32Array(points.length).fill(-1);
    let groups = 0;
    for (let s = 0; s < points.length; s++) {
      if (group[s] >= 0) continue;
      group[s] = groups;
      const queue = [s];
      for (let k = 0; k < queue.length; k++) {
        const p = points[queue[k]];
        for (let t = 0; t < points.length; t++) {
          if (group[t] >= 0) continue;
          if (Math.abs(points[t].x - p.x) <= STEP * 1.5 && Math.abs(points[t].y - p.y) <= STEP * 1.5) {
            group[t] = groups;
            queue.push(t);
          }
        }
      }
      groups++;
    }
    for (let g = 0; g < groups; g++) {
      const pts = points.filter((_, i) => group[i] === g);
      const line = fitLine(pts, bounds);
      if (line) lines.push(line);
    }
  }
  return lines;
}

/** The line through a place two parts meet, run across the floor to OVERRUN past its edge. */
function fitLine(pts: { x: number; y: number; dx: number; dy: number }[], bounds: readonly Polygon[]): [number, number][] | null {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let ax = 0;
  let ay = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
    ax += Math.abs(p.dx);
    ay += Math.abs(p.dy);
  }
  let ux: number;
  let uy: number;
  if (pts.length >= 3 && sxx + syy > 1e-9) {
    // The principal direction of the meeting points.
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    ux = Math.cos(theta);
    uy = Math.sin(theta);
  } else {
    const len = Math.hypot(ax, ay) || 1;
    ux = ax / len;
    uy = ay / len;
  }
  // The nearest edge crossing on each side of the centre.
  let tNeg = -Infinity;
  let tPos = Infinity;
  for (const ring of bounds) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j];
      const [x2, y2] = ring[i];
      const ex = x2 - x1;
      const ey = y2 - y1;
      const den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = x1 - cx;
      const wy = y1 - cy;
      const t = (wx * ey - wy * ex) / den;
      const s = (wx * uy - wy * ux) / den;
      if (s < 0 || s > 1) continue;
      if (t < 0 && t > tNeg) tNeg = t;
      if (t >= 0 && t < tPos) tPos = t;
    }
  }
  if (!Number.isFinite(tNeg) || !Number.isFinite(tPos)) return null;
  return [
    [cx + ux * (tNeg - OVERRUN), cy + uy * (tNeg - OVERRUN)],
    [cx + ux * (tPos + OVERRUN), cy + uy * (tPos + OVERRUN)],
  ];
}

/** The parts of `region` once `lines` cut it, those big enough to count as faces. */
function cutAreas(region: Polygon[], lines: readonly [number, number][][]): number[] {
  const rects = lines.flatMap((points) => thresholdToRects({ id: '', points }));
  return clipper2Engine
    .difference(region, rects)
    .map((p) => (p.length >= 3 ? signedArea(p) : 0))
    .filter((a) => a > SPECK_AREA);
}

/**
 * The divide lines one face of a cut floor asks for (`rings` = every ring of that cut,
 * holes included). Empty when the face is one space, when it holds fewer than `minCores`
 * chamber cores, or when no line survives the check.
 */
export function faceDivides(face: Polygon, rings: readonly Polygon[], minCores = 0): [number, number][][] {
  if (!isClipperReady() || signedArea(face) < CORE_MIN_AREA + PART_MIN_AREA) return [];
  const fr = faceRings(face, rings);
  const raster = rasterise(fr);
  if (!raster) return [];
  const parts = splitParts(raster);
  if (parts.count < 2 || parts.cores < minCores) return [];
  const bounds = [fr.face, ...fr.holes, ...fr.islands];
  const candidates = candidateLines(raster, parts, bounds).sort(
    (a, b) => Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]) - Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]),
  );

  // Each line is kept only if it splits off another part and leaves none too small to hold a room.
  const region = [fr.face, ...fr.holes];
  const kept: [number, number][][] = [];
  let faces = cutAreas(region, kept).length;
  for (const line of candidates) {
    const areas = cutAreas(region, [...kept, line]);
    if (areas.length <= faces || areas.some((a) => a < PART_MIN_AREA)) continue;
    kept.push(line);
    faces = areas.length;
  }
  return kept;
}

/**
 * Whether a face reads as a passage rather than a room: no chamber core anywhere in it, and
 * longer than it is wide (its area at least 1.75 times the square of its widest span).
 */
export function faceIsPassage(face: Polygon, rings: readonly Polygon[]): boolean {
  const raster = rasterise(faceRings(face, rings));
  if (!raster) return false;
  let maxClear = 0;
  for (let i = 0; i < raster.clear.length; i++) if (raster.clear[i] > maxClear) maxClear = raster.clear[i];
  if (maxClear >= CORE_CLEARANCE - 1e-6 && splitParts(raster).cores > 0) return false;
  const width = 2 * maxClear;
  return width > 0 && signedArea(face) >= 1.75 * width * width;
}

/** Divide lines as the thresholds they become, each with a fresh id. */
export function asThresholds(lines: readonly [number, number][][]): ThresholdSegment[] {
  return lines.map((points) => ({ id: crypto.randomUUID(), points }));
}
