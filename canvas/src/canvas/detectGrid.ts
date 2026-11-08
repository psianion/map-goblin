/**
 * Finds the grid printed on a battlemap: the size of one square in the image's own pixels
 * and where its lines fall, from the picture alone.
 *
 * Grid lines are edges that repeat. The luminance gradient is summed down every column and
 * along every row, which turns the lines into a comb on each axis; the art underneath adds
 * edges too, but not at one fixed spacing. Each plausible spacing is scored by folding the
 * comb onto one period and asking how much of its variance the folded shape explains (the
 * share a random signal would reach by chance is taken off, so a longer period earns
 * nothing for being longer). Both axes share the spacing, because squares are square. The
 * fold's peak gives the line offset on each axis.
 *
 * Pure: it reads RGBA pixels and nothing else. `sampleForDetection` makes those pixels from
 * a decoded bitmap, at most `MAX_SAMPLE_WIDTH` across so a large map stays quick.
 */

export const MAX_SAMPLE_WIDTH = 1024;

/** RGBA pixels, the shape of `ImageData`. */
export interface GridSample {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface GridEstimate {
  /** Source pixels per square. */
  pxPerCell: number;
  /** Where a vertical grid line falls, source pixels from the left edge, in [0, pxPerCell). */
  originX: number;
  /** Where a horizontal grid line falls, source pixels from the top edge, in [0, pxPerCell). */
  originY: number;
  /** 0 to 1: how much of the picture's repeating edge structure the grid accounts for. */
  confidence: number;
}

export interface DetectOptions {
  /** Squares across and down, from the file name or the dialog; narrows the search to 15% of it. */
  seed?: { width: number; height: number } | null;
  /** The source image's pixel size when `sample` was downsampled from it. */
  source?: { width: number; height: number };
}

/** The plausible range without a seed: the picture is 8 to 80 squares across. */
const MIN_CELLS = 8;
const MAX_CELLS = 80;
const SEED_SLACK = 0.15;
/** Coarse search step, as a factor on the period: drift stays under a pixel across 1024. */
const COARSE_STEP = 1.002;
const FINE_STEPS = 20;
/** A whole fraction of the best period that scores this close is the true one (2p fits a p grid too). */
const HARMONIC_KEEP = 0.85;
/** Score at which confidence reaches 1. */
const FULL_SCORE = 0.3;
/** Bins either side of the fold's peak that count toward where the line is. */
const PEAK_REACH = 2;
const NONE: GridEstimate = { pxPerCell: 0, originX: 0, originY: 0, confidence: 0 };

function luminance(img: GridSample): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) out[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  return out;
}

/** Gradient strength between neighbouring columns (x) and rows (y), averaged across the other axis. */
function edgeProfiles(img: GridSample): { x: Float64Array; y: Float64Array } {
  const { width: w, height: h } = img;
  const lum = luminance(img);
  const x = new Float64Array(Math.max(0, w - 1));
  const y = new Float64Array(Math.max(0, h - 1));
  for (let j = 0; j < h; j++) {
    const row = j * w;
    for (let i = 0; i < w; i++) {
      const v = lum[row + i];
      if (i + 1 < w) x[i] += Math.abs(lum[row + i + 1] - v);
      if (j + 1 < h) y[j] += Math.abs(lum[row + w + i] - v);
    }
  }
  for (let i = 0; i < x.length; i++) x[i] /= h;
  for (let j = 0; j < y.length; j++) y[j] /= w;
  return { x, y };
}

/** What stands above the local average, so slow shading in the art does not count. */
function highPass(p: Float64Array, radius: number): Float64Array {
  const n = p.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + p[i];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius);
    const b = Math.min(n, i + radius + 1);
    out[i] = Math.max(0, p[i] - (prefix[b] - prefix[a]) / (b - a));
  }
  return out;
}

/**
 * How well period `q` explains `p`: the share of its variance the per-phase means carry,
 * less the share that many phase bins would carry for noise. Also where the peak phase is.
 */
function fold(p: Float64Array, q: number): { score: number; phase: number } {
  const n = p.length;
  const bins = Math.max(4, Math.round(q));
  if (n < 2 * q || n <= bins) return { score: 0, phase: 0 };
  const sums = new Float64Array(bins);
  const counts = new Float64Array(bins);
  // Where in the period each bin's samples actually fall, on average: with a period that is
  // not a whole number of pixels they do not sit at the bin's middle.
  const places = new Float64Array(bins);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t = i - Math.floor(i / q) * q;
    const b = Math.min(bins - 1, Math.floor((t / q) * bins));
    sums[b] += p[i];
    counts[b] += 1;
    places[b] += t;
    total += p[i];
  }
  const mean = total / n;
  let ssTot = 0;
  for (let i = 0; i < n; i++) ssTot += (p[i] - mean) ** 2;
  if (!(ssTot > 0)) return { score: 0, phase: 0 };
  const avg = (b: number) => {
    const k = (b + bins) % bins;
    return counts[k] ? sums[k] / counts[k] : 0;
  };
  let ssBetween = 0;
  let peak = 0;
  for (let b = 0; b < bins; b++) {
    if (!counts[b]) continue;
    ssBetween += counts[b] * (avg(b) - mean) ** 2;
    if (avg(b) > avg(peak)) peak = b;
  }
  const chance = (bins - 1) / (n - 1);
  const score = (ssBetween / ssTot - chance) / (1 - chance);
  // A line shows as two edges a pixel or two apart; the centroid of the bins around the
  // peak lands between them, on the line's middle.
  let weight = 0;
  let moment = 0;
  for (let d = -PEAK_REACH; d <= PEAK_REACH; d++) {
    const v = avg(peak + d) - mean;
    const k = (peak + d + bins) % bins;
    if (v <= 0 || !counts[k]) continue;
    // Unwrapped across the period's ends, so a peak on the seam is not torn in two.
    const at = places[k] / counts[k] + (peak + d < 0 ? -q : peak + d >= bins ? q : 0);
    weight += v;
    moment += v * at;
  }
  const centre = weight > 0 ? moment / weight : ((peak + 0.5) / bins) * q;
  // Entry i is the step from pixel i to pixel i+1, so its edge is the boundary at i + 1.
  const phase = (((centre + 1) % q) + q) % q;
  return { score, phase };
}

function scoreBoth(x: Float64Array, y: Float64Array, q: number) {
  const fx = fold(x, q);
  const fy = fold(y, q);
  const usable = (x.length >= 2 * q ? 1 : 0) + (y.length >= 2 * q ? 1 : 0) || 1;
  return { score: (fx.score + fy.score) / usable, phaseX: fx.phase, phaseY: fy.phase };
}

/** The best period in [lo, hi], searched on a multiplicative ladder then refined. */
function search(x: Float64Array, y: Float64Array, lo: number, hi: number) {
  let best = { q: lo, score: -Infinity };
  for (let q = lo; q <= hi; q *= COARSE_STEP) {
    const s = scoreBoth(x, y, q).score;
    if (s > best.score) best = { q, score: s };
  }
  const a = best.q / COARSE_STEP;
  const b = best.q * COARSE_STEP;
  for (let k = 0; k <= FINE_STEPS; k++) {
    const q = a + ((b - a) * k) / FINE_STEPS;
    const s = scoreBoth(x, y, q).score;
    if (s > best.score) best = { q, score: s };
  }
  return best;
}

/**
 * The grid printed on `sample`, in the source image's pixels. Confidence 0 for a picture too
 * small to hold two squares.
 */
export function detectGrid(sample: GridSample, options: DetectOptions = {}): GridEstimate {
  const { width: w, height: h } = sample;
  if (w < 16 || h < 16 || sample.data.length < w * h * 4) return NONE;
  const sx = (options.source?.width ?? w) / w;
  const sy = (options.source?.height ?? h) / h;

  const seed = options.seed;
  let lo: number;
  let hi: number;
  if (seed && seed.width >= 1) {
    const q0 = w / seed.width;
    lo = q0 * (1 - SEED_SLACK);
    hi = q0 * (1 + SEED_SLACK);
  } else {
    lo = w / MAX_CELLS;
    hi = w / MIN_CELLS;
  }
  lo = Math.max(lo, 3);
  if (!(hi > lo)) return NONE;

  const raw = edgeProfiles(sample);
  const radius = Math.max(2, Math.floor(lo / 2));
  const x = highPass(raw.x, radius);
  const y = highPass(raw.y, radius);

  let best = search(x, y, lo, hi);
  // A grid of period p also repeats at 2p and 3p, and the search may land there; prefer
  // the finest whole fraction that explains it nearly as well.
  if (!seed) {
    for (const k of [4, 3, 2]) {
      const q = best.q / k;
      if (q < lo) continue;
      const near = search(x, y, q / 1.01, q * 1.01);
      if (near.score >= HARMONIC_KEEP * best.score) {
        best = near;
        break;
      }
    }
  }
  if (!(best.score > 0)) return NONE;

  const { phaseX, phaseY } = scoreBoth(x, y, best.q);
  return {
    pxPerCell: best.q * sx,
    originX: phaseX * sx,
    originY: phaseY * sy,
    confidence: Math.max(0, Math.min(1, best.score / FULL_SCORE)),
  };
}

/**
 * The bitmap's pixels at most `MAX_SAMPLE_WIDTH` across, for `detectGrid`. Null where the
 * browser cannot draw off screen (and in tests without a canvas).
 */
export function sampleForDetection(bitmap: ImageBitmap): GridSample | null {
  if (typeof OffscreenCanvas === 'undefined' || !(bitmap.width > 0) || !(bitmap.height > 0)) return null;
  const s = Math.min(1, MAX_SAMPLE_WIDTH / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * s));
  const h = Math.max(1, Math.round(bitmap.height * s));
  try {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
}
