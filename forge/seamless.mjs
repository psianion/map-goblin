// Make a generated floor tile wrap cleanly, and prove that it does.
//
// The wall pipeline never needed this. A wall is a strip with a fixed band; a floor is
// sampled with wrap by the terrain shader, so any discontinuity between the left and
// right edge becomes a hard line ruled across every painted cell on the map. SDXL does
// not preserve tileability — the input tile is seamless, the output is not — and there
// is no circular-padding node installed, so the fix is post-hoc and deterministic.
//
// Method: blend the tile with a copy of itself rolled by half, weighted by distance to
// the nearest edge.
//
//   - The rolled copy R is continuous across the original wrap edges (interior content
//     sits there now) but carries its own discontinuity through the centre.
//   - The original A is discontinuous at the edges and clean through the centre.
//   - Weighting toward R at the edges and toward A at the centre takes the clean half of
//     each. At the edge the pixels come from R, which wraps — so the tile wraps.
//
// Cost: a soft double-exposure in the mid band. On painterly stone, earth and grass that
// reads as extra variation. On strongly directional art (planks) it is visible, which is
// why plank uses a narrower heal band.
//
// node seamless.mjs --in <png> --out <png> [--band 0.5] [--check]
import fs from 'fs';
import { sharp, arg } from './lib.mjs';

const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * @param band 0..1 — how far in from the edge the heal reaches. 0.5 blends across the
 *   whole tile (softest, safest seam); 0.25 keeps the centre pristine and concentrates
 *   the blend near the edges.
 */
export async function makeSeamless(inPath, outPath, band = 0.5) {
  const img = sharp(inPath).ensureAlpha();
  const { width: w, height: h } = await img.metadata();
  const A = await img.raw().toBuffer();
  const at = (x, y, c) => A[(y * w + x) * 4 + c];

  // Where to cut. The obvious choice is the exact half, and that is what this did first —
  // but the roll offset decides which pair of source columns ends up adjacent across the
  // finished wrap, and half can land on a hard edge. On the plank tile it landed exactly
  // on a board gap and the "heal" tripled the seam it was meant to remove (10.4 -> 28.1).
  //
  // So pick the quietest join instead: the seam of the healed tile is the pair of source
  // lines the offset puts together, so choose the pair that already matches. Searched near
  // the middle, because the blend still needs the two halves to be far apart.
  const quietestOffset = (axis) => {
    const n = axis === 'x' ? w : h;
    const other = axis === 'x' ? h : w;
    const lo = Math.floor(n * 0.25);
    const hi = Math.floor(n * 0.75);
    let best = Math.floor(n / 2);
    let bestDelta = Infinity;
    for (let k = lo; k < hi; k++) {
      let s = 0;
      for (let j = 0; j < other; j += 3) {
        for (let c = 0; c < 3; c++) {
          s +=
            axis === 'x'
              ? Math.abs(at(k - 1, j, c) - at(k, j, c))
              : Math.abs(at(j, k - 1, c) - at(j, k, c));
        }
      }
      if (s < bestDelta) {
        bestDelta = s;
        best = k;
      }
    }
    return best;
  };

  const R = Buffer.alloc(A.length);
  const hw = quietestOffset('x');
  const hh = quietestOffset('y');
  for (let y = 0; y < h; y++) {
    const sy = (y + hh) % h;
    for (let x = 0; x < w; x++) {
      const sx = (x + hw) % w;
      const di = (y * w + x) * 4;
      const si = (sy * w + sx) * 4;
      R[di] = A[si];
      R[di + 1] = A[si + 1];
      R[di + 2] = A[si + 2];
      R[di + 3] = A[si + 3];
    }
  }

  const out = Buffer.alloc(A.length);
  for (let y = 0; y < h; y++) {
    // Normalised distance to the nearest horizontal edge: 0 at the edge, 1 at centre.
    const uy = Math.min(y, h - 1 - y) / ((h - 1) / 2);
    for (let x = 0; x < w; x++) {
      const ux = Math.min(x, w - 1 - x) / ((w - 1) / 2);

      // min(): a corner is near two edges at once and must come fully from R.
      // Divide by band so the ramp finishes early and the centre stays pure A.
      const u = Math.min(1, Math.min(ux, uy) / band);
      const wa = smoothstep(u); // weight of the original
      const wr = 1 - wa;

      const i = (y * w + x) * 4;
      out[i] = A[i] * wa + R[i] * wr;
      out[i + 1] = A[i + 1] * wa + R[i + 1] * wr;
      out[i + 2] = A[i + 2] * wa + R[i + 2] * wr;
      out[i + 3] = A[i + 3] * wa + R[i + 3] * wr;
    }
  }

  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(outPath);
  return { w, h };
}

/**
 * How visible the wrap is, as a ratio against the tile's own internal variation.
 *
 * The raw difference across the wrap is not the answer on its own. Two adjacent columns
 * of grass blades differ hugely while being perfectly continuous, so a fixed threshold
 * measures texture frequency rather than seam quality — it fails a good high-frequency
 * tile and passes a smooth one that genuinely does not wrap.
 *
 * So the seam difference is divided by the mean difference between neighbouring interior
 * columns/rows. ~1.0 means the join looks like any other pair of neighbouring pixels,
 * which is exactly what seamless means. Well above 1 is a line the eye will find.
 */
export async function seamError(pngPath) {
  const img = sharp(pngPath).ensureAlpha();
  const { width: w, height: h } = await img.metadata();
  const p = await img.raw().toBuffer();
  const at = (x, y, c) => p[(y * w + x) * 4 + c];

  let vert = 0;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) vert += Math.abs(at(w - 1, y, c) - at(0, y, c));
  }
  let horz = 0;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) horz += Math.abs(at(x, h - 1, c) - at(x, 0, c));
  }
  vert /= h * 3;
  horz /= w * 3;

  // Sampled every 7th line — this is a baseline, not a census, and reading every column
  // triples the cost of a check that runs on every tile.
  let iv = 0;
  let nv = 0;
  for (let x = 0; x < w - 1; x += 7) {
    let s = 0;
    for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) s += Math.abs(at(x, y, c) - at(x + 1, y, c));
    iv += s / (h * 3);
    nv++;
  }
  let ih = 0;
  let nh = 0;
  for (let y = 0; y < h - 1; y += 7) {
    let s = 0;
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) s += Math.abs(at(x, y, c) - at(x, y + 1, c));
    ih += s / (w * 3);
    nh++;
  }
  iv = Math.max(iv / nv, 0.5); // floor guards a flat tile from dividing by ~0
  ih = Math.max(ih / nh, 0.5);

  return {
    vertical: +vert.toFixed(2),
    horizontal: +horz.toFixed(2),
    ratioV: +(vert / iv).toFixed(2),
    ratioH: +(horz / ih).toFixed(2),
    worstRatio: +Math.max(vert / iv, horz / ih).toFixed(2),
  };
}

if (import.meta.filename === process.argv[1]) {
  const inPath = arg('in');
  const outPath = arg('out');
  const band = +arg('band', 0.5);

  if (arg('check') && !outPath) {
    console.log(inPath, await seamError(inPath));
  } else {
    if (!inPath || !outPath) {
      console.error('usage: node seamless.mjs --in <png> --out <png> [--band 0.5] | --in <png> --check');
      process.exit(1);
    }
    const before = await seamError(inPath);
    await makeSeamless(inPath, outPath, band);
    const after = await seamError(outPath);
    console.log(
      `${inPath}\n  seam before: v=${before.vertical} h=${before.horizontal}` +
        `\n  seam after:  v=${after.vertical} h=${after.horizontal}`,
    );
  }
}
