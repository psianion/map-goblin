// Source piece -> img2img template.
// node prep-template.mjs --src <png> --out <png> [--mode grey|edge] [--thin 1] [--pad 168] [--scale 2]
// grey: greyscale value-lifted copy of the source art on mid-grey ground, ink pre-thinned.
// edge: structural lines only (Sobel of the source) on flat ground - no source surface pixels.
import { sharp, loadRaw, lum, percentiles, arg } from './lib.mjs';

const src = arg('src'), out = arg('out');
const mode = arg('mode', 'grey');
const thin = +arg('thin', 1);
const pad = +arg('pad', 168);
const scale = +arg('scale', 2);
const GROUND = 128;

const { data, w, h } = await loadRaw(src);

// contrast stretch (p5 -> 25, p95 -> 205) instead of a multiply lift: preserves
// crevice contrast instead of clipping the top of the ramp
const lums = [];
for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 12) lums.push(lum(data, i));
lums.sort((a, b) => a - b);
const [p5s, p50, p95s] = percentiles(lums, [0.05, 0.5, 0.95]);
const stretch = v => Math.max(0, Math.min(255, 25 + (v - p5s) * (205 - 25) / Math.max(1, p95s - p5s)));

// single value plane, composited over ground by alpha
let plane = new Float32Array(w * h);
for (let p = 0, i = 0; p < plane.length; p++, i += 4) {
  const a = data[i + 3] / 255;
  plane[p] = stretch(lum(data, i)) * a + GROUND * (1 - a);
}

if (mode === 'edge') {
  // Sobel magnitude -> thin dark lines on flat ground
  const edges = new Float32Array(w * h).fill(160);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const gx = plane[p - w + 1] + 2 * plane[p + 1] + plane[p + w + 1] - plane[p - w - 1] - 2 * plane[p - 1] - plane[p + w - 1];
    const gy = plane[p + w - 1] + 2 * plane[p + w] + plane[p + w + 1] - plane[p - w - 1] - 2 * plane[p - w] - plane[p - w + 1];
    if (Math.hypot(gx, gy) > 120) edges[p] = 30;
  }
  plane = edges;
} else {
  // targeted ink thinning: erode the ink mask 1px per pass and heal ONLY the pixels
  // that fell out of the mask (with their local non-ink max), so interior surface
  // contrast survives - the round-1 global max-filter flattened all crevices
  const INK = 70;
  for (let t = 0; t < thin; t++) {
    const mask = plane.map(v => v < INK ? 1 : 0);
    const next = new Float32Array(plane);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      let interior = true;
      for (const d of [-w, -1, 1, w]) if (!mask[p + d]) { interior = false; break; }
      if (interior) continue; // stays ink
      let m = 0;
      for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) if (!mask[p + d] && plane[p + d] > m) m = plane[p + d];
      next[p] = m || plane[p];
    }
    plane = next;
  }
}

const grey = Buffer.alloc(w * h * 4);
for (let p = 0, i = 0; p < plane.length; p++, i += 4) {
  grey[i] = grey[i + 1] = grey[i + 2] = Math.round(plane[p]);
  grey[i + 3] = 255;
}

// 2x upscale, then circular horizontal pad (band is edge-to-edge, so wrap = continuation)
const W = w * scale, H = h * scale;
const up = await sharp(grey, { raw: { width: w, height: h, channels: 4 } })
  .resize(W, H, { kernel: 'lanczos3' }).png().toBuffer();
const left = await sharp(up).extract({ left: W - pad, top: 0, width: pad, height: H }).toBuffer();
const right = await sharp(up).extract({ left: 0, top: 0, width: pad, height: H }).toBuffer();
await sharp({ create: { width: W + 2 * pad, height: H, channels: 4, background: { r: GROUND, g: GROUND, b: GROUND, alpha: 1 } } })
  .composite([
    { input: left, left: 0, top: 0 },
    { input: up, left: pad, top: 0 },
    { input: right, left: pad + W, top: 0 },
  ]).png().toFile(out);
console.log(`template ${out}: ${W + 2 * pad}x${H} mode=${mode} stretch p5 ${Math.round(p5s)}->25 p95 ${Math.round(p95s)}->205 (p50 ${Math.round(p50)})`);
