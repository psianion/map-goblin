// Raw ComfyUI output -> candidate: unpad, downscale, desaturate + normalize to master ramp,
// re-apply the SOURCE alpha (footprint is exact by construction).
// node post.mjs --raw <png> --src <sourcePng> --out <png> [--pad 168] [--scale 2]
import { sharp, loadRaw, lum, percentiles, arg } from './lib.mjs';

const rawPath = arg('raw'), srcPath = arg('src'), out = arg('out');
const pad = +arg('pad', 168), scale = +arg('scale', 2);
const wrapblend = +arg('wrapblend', 0); // raw-space px; makes the wrap seam continuous
const thinink = +arg('thinink', 0); // erosion passes on the raw ink mask (thick-ink fallback, phase plan)
const seam = +arg('seam', 0); // reinstate the source's center plank seam (two-row read)
const MID = 160; // master ramp anchor #A0

const srcMeta = await sharp(srcPath).metadata();
const tw = srcMeta.width, th = srcMeta.height;

let rawBuf = await sharp(rawPath).ensureAlpha().raw().toBuffer();
const rawMeta = await sharp(rawPath).metadata();
const RW = rawMeta.width, RH = rawMeta.height;

if (wrapblend > 0) {
  // The right pad [pad+W, pad+W+K) is the model's own continuation of the strip's
  // end, i.e. its version of the strip's START. Blending the start from it makes
  // col 0 flow from col W-1 by construction.
  const W = tw * scale;
  for (let y = 0; y < RH; y++) for (let k = 0; k < wrapblend; k++) {
    const t = k / wrapblend;
    const a = (y * RW + pad + k) * 4, b = (y * RW + pad + W + k) * 4;
    for (let c = 0; c < 3; c++) rawBuf[a + c] = Math.round(rawBuf[b + c] * (1 - t) + rawBuf[a + c] * t);
  }
}

if (thinink > 0) {
  // same targeted erosion as prep-template: shave 1px off ink-mask boundaries per
  // pass, heal shaved pixels with their local non-ink max (runs at raw scale so the
  // downscale antialiases the thinned line instead of leaving a wispy 1px run)
  const INK = 70;
  let plane = new Float32Array(RW * RH);
  for (let p = 0, i = 0; p < plane.length; p++, i += 4) plane[p] = lum(rawBuf, i);
  for (let t = 0; t < thinink; t++) {
    const mask = plane.map(v => v < INK ? 1 : 0);
    const next = new Float32Array(plane);
    for (let y = 1; y < RH - 1; y++) for (let x = 1; x < RW - 1; x++) {
      const p = y * RW + x;
      if (!mask[p]) continue;
      let interior = true;
      for (const d of [-RW, -1, 1, RW]) if (!mask[p + d]) { interior = false; break; }
      if (interior) continue;
      let m = 0;
      for (const d of [-RW - 1, -RW, -RW + 1, -1, 1, RW - 1, RW, RW + 1]) if (!mask[p + d] && plane[p + d] > m) m = plane[p + d];
      next[p] = m || plane[p];
    }
    plane = next;
  }
  for (let p = 0, i = 0; p < plane.length; p++, i += 4) {
    const v = Math.round(plane[p]);
    rawBuf[i] = rawBuf[i + 1] = rawBuf[i + 2] = v;
  }
}

const cropped = await sharp(rawBuf, { raw: { width: RW, height: RH, channels: 4 } })
  .extract({ left: pad, top: 0, width: tw * scale, height: th * scale })
  .resize(tw, th, { kernel: 'lanczos3' })
  .ensureAlpha().raw().toBuffer();

const { data: srcData } = await loadRaw(srcPath);

// normalize luminance so opaque p50 lands on the master mid
const lums = [];
for (let i = 0; i < cropped.length; i += 4) if (srcData[i + 3] > 12) lums.push(lum(cropped, i));
lums.sort((a, b) => a - b);
const [p50] = percentiles(lums, [0.5]);
const k = MID / p50;

const outBuf = Buffer.alloc(cropped.length);
for (let i = 0; i < cropped.length; i += 4) {
  const v = Math.max(0, Math.min(255, Math.round(lum(cropped, i) * k)));
  outBuf[i] = outBuf[i + 1] = outBuf[i + 2] = v;
  outBuf[i + 3] = srcData[i + 3]; // source alpha verbatim
}

if (seam) {
  // stamp the source's ~2px center seam (rows around y100) back onto the candidate
  // so the band reads as two plank rows again. Horizontal run-length >= 12 filters
  // out crossings of the source's OWN butt joints — the model invented new butts
  // elsewhere and stray source-butt fragments would contradict them.
  const INK = 70, Y0 = 96, Y1 = 104, MINRUN = 12;
  const mask = new Uint8Array(tw * th);
  for (let y = Y0; y <= Y1; y++) {
    let x = 0;
    while (x < tw) {
      const i = (y * tw + x) * 4;
      if (srcData[i + 3] > 12 && lum(srcData, i) < INK) {
        let e = x;
        while (e < tw && srcData[(y * tw + e) * 4 + 3] > 12 && lum(srcData, (y * tw + e) * 4) < INK) e++;
        if (e - x >= MINRUN) for (let q = x; q < e; q++) mask[y * tw + q] = 1;
        x = e;
      } else x++;
    }
  }
  for (let y = Y0; y <= Y1; y++) for (let x = 0; x < tw; x++) {
    const p = y * tw + x;
    if (!mask[p]) continue;
    const i = p * 4, sv = lum(srcData, i), v = outBuf[i];
    // core rows (a masked vertical neighbor) take the source ink at full min;
    // lone rows soften 50% so the line keeps antialiased shoulders
    const core = mask[p - tw] || mask[p + tw];
    const nv = Math.min(v, core ? sv : Math.round((sv + v) / 2));
    outBuf[i] = outBuf[i + 1] = outBuf[i + 2] = nv;
  }
}
await sharp(outBuf, { raw: { width: tw, height: th, channels: 4 } }).png().toFile(out);
console.log(`candidate ${out}: ${tw}x${th} norm k=${k.toFixed(2)} (raw p50 ${Math.round(p50)})`);
