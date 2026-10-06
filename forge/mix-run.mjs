// Cross-variant seam matrix for one length: composes an A|B|C|A run image and
// prints the band-row luminance step across each butt joint vs the pieces' own
// internal transitions (same logic as check.mjs seam, but across pieces).
// node mix-run.mjs --a <png> --b <png> --c <png> --out <png> [--bandy 66 --band 68]
import { sharp, loadRaw, lum, arg } from './lib.mjs';

const files = { A: arg('a'), B: arg('b'), C: arg('c') };
const out = arg('out');
const bandY = +arg('bandy', 66), bandH = +arg('band', 68);

const pieces = {};
for (const [k, f] of Object.entries(files)) pieces[k] = await loadRaw(f);

const edgeCol = (p, x) => {
  const col = [];
  for (let y = bandY + 4; y < bandY + bandH - 4; y++) col.push(lum(p.data, (y * p.w + x) * 4));
  return col;
};
const meanDiff = (u, v) => u.reduce((s, a, i) => s + Math.abs(a - v[i]), 0) / u.length;

// internal typical/max transition per piece (band rows)
const internal = {};
for (const [k, p] of Object.entries(pieces)) {
  let max = 0, sum = 0, n = 0;
  for (let x = 3; x < p.w - 4; x++) {
    const d = meanDiff(edgeCol(p, x), edgeCol(p, x + 1));
    sum += d; n++;
    if (d > max) max = d;
  }
  internal[k] = { typ: sum / n, max };
}

for (const [l, r] of [['A', 'B'], ['B', 'C'], ['C', 'A']]) {
  const d = meanDiff(edgeCol(pieces[l], pieces[l].w - 1), edgeCol(pieces[r], 0));
  const worstMax = Math.max(internal[l].max, internal[r].max);
  const ok = d <= worstMax * 1.3;
  console.log(`${l}|${r} joint ${d.toFixed(1)} vs maxInternal ${worstMax.toFixed(1)} ${ok ? 'ok' : '(!)'}`);
}

// composed run A|B|C|A
const seq = ['A', 'B', 'C', 'A'];
const W = seq.reduce((s, k) => s + pieces[seq[0]].h * 0 + pieces[k].w, 0);
const H = pieces.A.h;
let comps = [], x = 0;
for (const k of seq) {
  comps.push({ input: files[k], left: x, top: 0 });
  x += pieces[k].w;
}
await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(comps).png().toFile(out);
console.log(`run ${out}: ${W}x${H}`);
