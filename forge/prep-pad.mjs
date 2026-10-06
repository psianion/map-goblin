// Source padded piece -> img2img template (pad variant of prep-template.mjs).
// Grey value-lifted copy on mid-grey ground, upscaled, GROUND pad on all sides.
// Open butt faces (alpha touching a tile edge) get MIRRORED arm continuation in
// the pad so the model paints the arm as continuing instead of capping it off.
// node prep-pad.mjs --src <png> --out <png> [--thin 1] [--pad 84] [--scale 3]
import { sharp, loadRaw, lum, percentiles, arg } from './lib.mjs';

const src = arg('src'), out = arg('out');
const thin = +arg('thin', 1);
const pad = +arg('pad', 84);   // canvas px
const scale = +arg('scale', 3);
const GROUND = 128;

const { data, w, h } = await loadRaw(src);

// grey plane: contrast stretch + targeted ink thinning
// ponytail: duplicated from prep-template.mjs grey mode — that script is locked
// with the straights recipe; not refactoring shared lib under a locked pipeline
const lums = [];
for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 12) lums.push(lum(data, i));
lums.sort((a, b) => a - b);
const [p5s, p50, p95s] = percentiles(lums, [0.05, 0.5, 0.95]);
const stretch = v => Math.max(0, Math.min(255, 25 + (v - p5s) * (205 - 25) / Math.max(1, p95s - p5s)));
let plane = new Float32Array(w * h);
for (let p = 0, i = 0; p < plane.length; p++, i += 4) {
  const a = data[i + 3] / 255;
  plane[p] = stretch(lum(data, i)) * a + GROUND * (1 - a);
}
const INK = 70;
for (let t = 0; t < thin; t++) {
  const mask = plane.map(v => v < INK ? 1 : 0);
  const next = new Float32Array(plane);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    if (!mask[p]) continue;
    let interior = true;
    for (const d of [-w, -1, 1, w]) if (!mask[p + d]) { interior = false; break; }
    if (interior) continue;
    let m = 0;
    for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) if (!mask[p + d] && plane[p + d] > m) m = plane[p + d];
    next[p] = m || plane[p];
  }
  plane = next;
}

// open butt faces: contiguous alpha spans along each source tile edge
const A = (x, y) => data[(y * w + x) * 4 + 3] > 128;
const spans = (test, n) => {
  const list = []; let s = -1;
  for (let i = 0; i <= n; i++) {
    const v = i < n && test(i);
    if (v && s < 0) s = i;
    if (!v && s >= 0) { list.push([s, i]); s = -1; }
  }
  return list;
};
const faces = [];
for (const [edge, test, n] of [
  ['left', y => A(0, y), h], ['right', y => A(w - 1, y), h],
  ['top', x => A(x, 0), w], ['bottom', x => A(x, h - 1), w],
]) for (const [a, b] of spans(test, n)) faces.push({ edge, a, b });

// upscale the grey plane, then blit centered on a GROUND canvas
const grey = Buffer.alloc(w * h * 4);
for (let p = 0, i = 0; p < plane.length; p++, i += 4) {
  grey[i] = grey[i + 1] = grey[i + 2] = Math.round(plane[p]);
  grey[i + 3] = 255;
}
const W = w * scale, H = h * scale;
const up = await sharp(grey, { raw: { width: w, height: h, channels: 4 } })
  .resize(W, H, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
const CW = W + 2 * pad, CH = H + 2 * pad;
const canvas = Buffer.alloc(CW * CH * 4);
for (let i = 0; i < canvas.length; i += 4) {
  canvas[i] = canvas[i + 1] = canvas[i + 2] = GROUND; canvas[i + 3] = 255;
}
for (let y = 0; y < H; y++) up.copy(canvas, ((y + pad) * CW + pad) * 4, y * W * 4, (y * W + W) * 4);

// mirror arm continuation into the pad at each open face (continuous at the edge)
const px = (x, y) => (y * CW + x) * 4;
const copy3 = (dst, sub) => { for (let c = 0; c < 3; c++) canvas[dst + c] = canvas[sub + c]; };
for (const f of faces) {
  const a = f.a * scale, b = f.b * scale;
  for (let k = 0; k < pad; k++) {
    if (f.edge === 'right') for (let y = a; y < b; y++) copy3(px(pad + W + k, pad + y), px(pad + W - 1 - k, pad + y));
    if (f.edge === 'left') for (let y = a; y < b; y++) copy3(px(pad - 1 - k, pad + y), px(pad + k, pad + y));
    if (f.edge === 'bottom') for (let x = a; x < b; x++) copy3(px(pad + x, pad + H + k), px(pad + x, pad + H - 1 - k));
    if (f.edge === 'top') for (let x = a; x < b; x++) copy3(px(pad + x, pad - 1 - k), px(pad + x, pad + k));
  }
}

await sharp(canvas, { raw: { width: CW, height: CH, channels: 4 } }).png().toFile(out);
console.log(`template ${out}: ${CW}x${CH} scale=${scale} pad=${pad} faces=[${faces.map(f => f.edge).join(',') || 'none'}] stretch p5 ${Math.round(p5s)}->25 p95 ${Math.round(p95s)}->205 (p50 ${Math.round(p50)})`);
