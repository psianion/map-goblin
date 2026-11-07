// The Water brush's mask: one per dungeon layer, painted with a round brush and drawn in
// that layer just above its floors. Shallow at the edge blends to Deep inside over the
// blend distance, measured from the mask's edge; Border lays a thin Deep line along it.
//
// Saved on the layer as a run-length string over a texel grid (8 texels a cell), trimmed
// to the wet texels, so a pool costs a few hundred bytes and a dry layer nothing.

/** Texels per grid cell, both ways. */
export const WATER_TEXELS_PER_CELL = 8;
/** The border line's width, in texels: a little under a fifth of a cell. */
export const WATER_BORDER_TEXELS = 1.5;

/** How a layer's water looks. */
export interface WaterLook {
  /** At the edge. */
  shallow: string;
  /** Inside, past the blend distance, and the border line. */
  deep: string;
  /** Cells from the edge over which Shallow blends to Deep. */
  blend: number;
  border: boolean;
}

/** A layer's water as saved: the look and the trimmed mask. */
export interface WaterBody extends WaterLook {
  /** The mask's top left, in texels from the world origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Run lengths in base 36, comma separated, row by row: dry first, then wet, alternating. */
  runs: string;
}

/** The mask while it is painted: one byte a texel, 1 wet. */
export interface WaterGrid {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8Array;
}

export const emptyWaterGrid = (): WaterGrid => ({ x: 0, y: 0, w: 0, h: 0, data: new Uint8Array(0) });

export function decodeWater(body: WaterBody | null | undefined): WaterGrid {
  if (!body || body.w <= 0 || body.h <= 0) return emptyWaterGrid();
  const data = new Uint8Array(body.w * body.h);
  let at = 0;
  let wet = false;
  for (const run of body.runs.split(',')) {
    const n = parseInt(run, 36) || 0;
    if (wet) data.fill(1, at, Math.min(data.length, at + n));
    at += n;
    wet = !wet;
  }
  return { x: body.x, y: body.y, w: body.w, h: body.h, data };
}

/** The wet texels' bounds within the grid, or null when there are none. */
function wetBounds(g: WaterGrid): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!g.data[y * g.w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** The grid as saved with `look`, trimmed to its wet texels; null when it is dry. */
export function encodeWater(g: WaterGrid, look: WaterLook): WaterBody | null {
  const b = wetBounds(g);
  if (!b) return null;
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  const runs: number[] = [];
  let wet = 0;
  let n = 0;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const v = g.data[y * g.w + x] ? 1 : 0;
      if (v === wet) n++;
      else {
        runs.push(n);
        wet = v;
        n = 1;
      }
    }
  }
  runs.push(n);
  return { ...lookOf(look), x: g.x + b.x0, y: g.y + b.y0, w, h, runs: runs.map((r) => r.toString(36)).join(',') };
}

export function lookOf(l: WaterLook): WaterLook {
  return { shallow: l.shallow, deep: l.deep, blend: l.blend, border: l.border };
}

/** `g` grown to hold the texel rect [x0, x1) × [y0, y1); `g` itself when it already does. */
function grownTo(g: WaterGrid, x0: number, y0: number, x1: number, y1: number): WaterGrid {
  if (g.w > 0 && x0 >= g.x && y0 >= g.y && x1 <= g.x + g.w && y1 <= g.y + g.h) return g;
  const nx = g.w > 0 ? Math.min(g.x, x0) : x0;
  const ny = g.w > 0 ? Math.min(g.y, y0) : y0;
  const nw = (g.w > 0 ? Math.max(g.x + g.w, x1) : x1) - nx;
  const nh = (g.w > 0 ? Math.max(g.y + g.h, y1) : y1) - ny;
  const data = new Uint8Array(nw * nh);
  for (let y = 0; y < g.h; y++) {
    data.set(g.data.subarray(y * g.w, (y + 1) * g.w), (y + g.y - ny) * nw + (g.x - nx));
  }
  return { x: nx, y: ny, w: nw, h: nh, data };
}

/**
 * One dab of the brush at (cx, cy), radius `r`, all in cells: wets the disc, or dries it
 * when `erase`. Hands back the grid it painted, grown when a wet dab runs past it.
 */
export function paintWaterDisc(g: WaterGrid, cx: number, cy: number, r: number, erase: boolean): WaterGrid {
  const t = WATER_TEXELS_PER_CELL;
  const x0 = Math.floor((cx - r) * t);
  const y0 = Math.floor((cy - r) * t);
  const x1 = Math.ceil((cx + r) * t);
  const y1 = Math.ceil((cy + r) * t);
  const grid = erase ? g : grownTo(g, x0, y0, x1, y1);
  const r2 = (r * t) ** 2;
  for (let y = Math.max(y0, grid.y); y < Math.min(y1, grid.y + grid.h); y++) {
    const dy = y + 0.5 - cy * t;
    for (let x = Math.max(x0, grid.x); x < Math.min(x1, grid.x + grid.w); x++) {
      const dx = x + 0.5 - cx * t;
      if (dx * dx + dy * dy <= r2) grid.data[(y - grid.y) * grid.w + (x - grid.x)] = erase ? 0 : 1;
    }
  }
  return grid;
}

/** Whether the texel at grid coordinates (x, y) is wet; outside the grid is dry. */
const wetAt = (g: WaterGrid, x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.data[y * g.w + x] === 1;

/**
 * Each texel's distance, in texels, to the nearest dry texel (0 on dry ones), by a two
 * pass chamfer over the grid; outside the grid is dry, so a texel on the grid's rim is 1.
 */
export function waterDistance(g: WaterGrid): Float32Array {
  const { w, h } = g;
  const d = new Float32Array(w * h);
  const D = Math.SQRT2;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let i = 0; i < d.length; i++) d[i] = g.data[i] ? Infinity : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + D, at(x + 1, y - 1) + D);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + D, at(x - 1, y + 1) + D);
    }
  }
  return d;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * How far into the blend a wet texel `d` texels from the edge is: 0 Shallow, 1 Deep. The
 * blend starts at the edge itself, so a texel on the rim is a half texel in.
 */
export function waterBlendAt(d: number, blendCells: number): number {
  if (blendCells <= 0) return 1;
  return Math.min(1, Math.max(0, (d - 0.5) / (blendCells * WATER_TEXELS_PER_CELL)));
}

/**
 * The water as RGBA pixels, one a texel, over the grid with one dry texel of margin all
 * round (so the drawn edge fades to nothing when the texture is filtered).
 */
export function waterPixels(g: WaterGrid, look: WaterLook): { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> } {
  const width = g.w + 2;
  const height = g.h + 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const dist = waterDistance(g);
  const s = rgb(look.shallow);
  const dp = rgb(look.deep);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!wetAt(g, x, y)) continue;
      const d = dist[y * g.w + x];
      const t = look.border && d <= WATER_BORDER_TEXELS ? 1 : waterBlendAt(d, look.blend);
      const o = ((y + 1) * width + (x + 1)) * 4;
      pixels[o] = s[0] + (dp[0] - s[0]) * t;
      pixels[o + 1] = s[1] + (dp[1] - s[1]) * t;
      pixels[o + 2] = s[2] + (dp[2] - s[2]) * t;
      pixels[o + 3] = 255;
    }
  }
  return { width, height, pixels };
}

/** The saved water's world bounds, in cells; null for none. */
export function waterBounds(body: WaterBody | null | undefined): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!body || body.w <= 0 || body.h <= 0) return null;
  const t = WATER_TEXELS_PER_CELL;
  return { minX: body.x / t, minY: body.y / t, maxX: (body.x + body.w) / t, maxY: (body.y + body.h) / t };
}
