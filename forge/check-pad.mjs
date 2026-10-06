// Machine acceptance gate for a padded piece. Prints a report line, writes <out>.json.
// Footprint = alpha identical to source; ink measured on runs entering content from
// top (per column) AND left (per row); open butt faces compared against a reference
// straight's end profile (same logic as mix-run.mjs cross-piece seams).
// node check-pad.mjs --png <candidate> --src <sourcePng> --ref <straightPick>
import fs from 'fs';
import { loadRaw, lum, percentiles, arg } from './lib.mjs';

const png = arg('png'), srcPath = arg('src'), refPath = arg('ref');
// curved pieces: a vertical scan crosses radial ink diagonally (2px reads ~3)
const maxInk = +arg('maxink', 2);
const { data, w, h } = await loadRaw(png);
const { data: srcData } = await loadRaw(srcPath);

// footprint: alpha verbatim (post guarantees it; catch pipeline mistakes)
let alphaMismatch = 0;
for (let i = 3; i < data.length; i += 4) if (data[i] !== srcData[i]) alphaMismatch++;

// chroma + luminance ramp over opaque pixels
let maxChroma = 0;
const lums = [];
for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 12) {
  maxChroma = Math.max(maxChroma, Math.abs(data[i] - data[i + 1]), Math.abs(data[i + 1] - data[i + 2]));
  lums.push(Math.round(lum(data, i)));
}
lums.sort((a, b) => a - b);
const [p5, p25, p50, p75, p95] = percentiles(lums, [.05, .25, .5, .75, .95]);

// outline: first dark run entering content, per column (from top) and per row (from left)
const runs = [], inkVals = [];
const scan = (n, len, at) => {
  for (let j = 5; j < n - 5; j += 3) {
    let run = 0, started = false;
    for (let t = 0; t < len; t++) {
      const i = at(j, t);
      if (data[i + 3] < 200) { if (started) break; continue; }
      if (lum(data, i) < 70) { run++; started = true; inkVals.push(lum(data, i)); }
      else if (started) break;
      else started = true;
    }
    if (run > 0) runs.push(run);
  }
};
scan(w, h, (x, y) => (y * w + x) * 4); // columns, top-down
scan(h, w, (y, x) => (y * w + x) * 4); // rows, left-right
runs.sort((a, b) => a - b);
inkVals.sort((a, b) => a - b);
const ink = runs.length ? runs[Math.floor(runs.length / 2)] : 0;
const inkDark = inkVals.length ? Math.round(inkVals[Math.floor(inkVals.length / 2)]) : 255;

// open butt faces vs the reference straight's end profile
const A = (x, y) => srcData[(y * w + x) * 4 + 3] > 128;
const spans = (test, n) => {
  const list = []; let s = -1;
  for (let i = 0; i <= n; i++) {
    const v = i < n && test(i);
    if (v && s < 0) s = i;
    if (!v && s >= 0) { list.push([s, i]); s = -1; }
  }
  return list;
};
const ref = await loadRaw(refPath);
const refJson = JSON.parse(fs.readFileSync(refPath.replace(/\.png$/, '.json'), 'utf8'));
const refMax = refJson.maxInternal;
const refCol = [];
for (let y = refJson.box.y + 4; y < refJson.box.y + refJson.box.h - 4; y++)
  refCol.push(lum(ref.data, (y * ref.w) * 4));
const profDiff = prof => {
  const n = Math.min(prof.length, refCol.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(prof[i] - refCol[i]);
  return s / n;
};
const facesOut = [];
for (const [edge, test, n, prof] of [
  ['left', y => A(0, y), h, (a, b) => { const p = []; for (let y = a + 4; y < b - 4; y++) p.push(lum(data, (y * w) * 4)); return p; }],
  ['right', y => A(w - 1, y), h, (a, b) => { const p = []; for (let y = a + 4; y < b - 4; y++) p.push(lum(data, (y * w + w - 1) * 4)); return p; }],
  ['top', x => A(x, 0), w, (a, b) => { const p = []; for (let x = a + 4; x < b - 4; x++) p.push(lum(data, x * 4)); return p; }],
  ['bottom', x => A(x, h - 1), w, (a, b) => { const p = []; for (let x = a + 4; x < b - 4; x++) p.push(lum(data, ((h - 1) * w + x) * 4)); return p; }],
]) for (const [a, b] of spans(test, n)) {
  const d = profDiff(prof(a, b));
  facesOut.push({ edge, span: [a, b], diff: +d.toFixed(1), ok: d <= refMax * 1.3 });
}

const hex = v => '#' + Math.round(v).toString(16).padStart(2, '0');
const result = {
  png,
  footprintPass: alphaMismatch === 0, alphaMismatch,
  chromaPass: maxChroma <= 2, maxChroma,
  ramp: { p5, p25, p50, p75, p95 },
  rampPass: p50 >= 140 && p50 <= 180 && inkDark <= 55,
  inkPx: ink, inkDark, inkPass: ink >= 1 && ink <= maxInk,
  faces: facesOut, refMaxInternal: refMax,
  facesPass: facesOut.every(f => f.ok),
};
result.pass = result.footprintPass && result.chromaPass && result.rampPass && result.inkPass && result.facesPass;
fs.writeFileSync(png.replace(/\.png$/, '.json'), JSON.stringify(result, null, 2));
console.log(
  `${result.pass ? 'PASS' : 'FAIL'} ${png.split(/[\\/]/).pop().padEnd(28)} ` +
  `ink ${ink}px@${hex(inkDark)}${result.inkPass ? '' : '(!)'} ` +
  `ramp ${hex(p25)}/${hex(p50)}/${hex(p75)}${result.rampPass ? '' : '(!)'} ` +
  `faces ${facesOut.map(f => `${f.edge}:${f.diff}${f.ok ? '' : '(!)'}`).join(' ') || 'none'} ` +
  `vs ref ${refMax} chroma ${maxChroma}${result.footprintPass ? '' : ' ALPHA(!)'}`
);
