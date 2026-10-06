// Machine acceptance gate for a candidate piece. Prints a report line, writes <out>.json.
// node check.mjs --png <candidate> [--band 68 --bandy 66] (band args in source-cell pixels)
import fs from 'fs';
import { loadRaw, lum, percentiles, arg } from './lib.mjs';

const png = arg('png');
const expH = +arg('band', 68), expY = +arg('bandy', 66);
const { data, w, h } = await loadRaw(png);

// content box (alpha > 12)
let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
  if (data[(y * w + x) * 4 + 3] > 12) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

// chroma (should be 0 after post)
let maxChroma = 0;
const lums = [];
for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 12) {
  maxChroma = Math.max(maxChroma, Math.abs(data[i] - data[i + 1]), Math.abs(data[i + 1] - data[i + 2]));
  lums.push(Math.round(lum(data, i)));
}
lums.sort((a, b) => a - b);
const [p5, p25, p50, p75, p95] = percentiles(lums, [.05, .25, .5, .75, .95]);

// outline: median first dark run entering the band from the top, per column,
// plus the median darkness of those ink pixels (a smooth slab's outline is too few
// pixels to show up in global percentiles - measure the ink itself)
const runs = [], inkVals = [];
for (let x = 5; x < w - 5; x += 3) {
  let run = 0, started = false;
  for (let y = 0; y < h; y++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 200) { if (started) break; continue; }
    if (lum(data, i) < 70) { run++; started = true; inkVals.push(lum(data, i)); }
    else if (started) break;
    else started = true;
  }
  if (run > 0) runs.push(run);
}
runs.sort((a, b) => a - b);
inkVals.sort((a, b) => a - b);
const ink = runs.length ? runs[Math.floor(runs.length / 2)] : 0;
const inkDark = inkVals.length ? Math.round(inkVals[Math.floor(inkVals.length / 2)]) : 255;

// seam: wrap-tile edge difference vs the strip's own internal column transitions.
// A dressed-slab strip legitimately contains dark joint lines; a joint landing on the
// wrap is fine - only a transition HARSHER than any internal joint is a real seam.
const colDiff = new Float64Array(w - 1);
let seam = 0, n = 0;
for (let y = expY + 4; y < expY + expH - 4; y++) {
  seam += Math.abs(lum(data, (y * w) * 4) - lum(data, (y * w + w - 1) * 4));
  for (let x = 0; x < w - 1; x++)
    colDiff[x] += Math.abs(lum(data, (y * w + x) * 4) - lum(data, (y * w + x + 1) * 4));
  n++;
}
seam /= n;
let typ = 0, maxInternal = 0;
for (let x = 3; x < w - 4; x++) {
  const d = colDiff[x] / n;
  typ += d;
  if (d > maxInternal) maxInternal = d;
}
typ /= (w - 7);
const seamRatio = typ > 0.5 ? seam / typ : seam;

const hex = v => '#' + Math.round(v).toString(16).padStart(2, '0');
const result = {
  png, box, expected: { h: expH, y: expY },
  bandPass: box.h === expH && box.y === expY && box.x === 0 && box.w === w,
  chromaPass: maxChroma <= 2, maxChroma,
  ramp: { p5, p25, p50, p75, p95 },
  rampPass: p50 >= 140 && p50 <= 180 && inkDark <= 55,
  inkPx: ink, inkDark, inkPass: ink >= 1 && ink <= 2,
  seam: +seam.toFixed(1), seamTypical: +typ.toFixed(1), maxInternal: +maxInternal.toFixed(1),
  seamRatio: +seamRatio.toFixed(2),
  seamPass: seamRatio < 2.5 || seam <= maxInternal * 1.3,
};
result.pass = result.bandPass && result.chromaPass && result.rampPass && result.inkPass && result.seamPass;
fs.writeFileSync(png.replace(/\.png$/, '.json'), JSON.stringify(result, null, 2));
console.log(
  `${result.pass ? 'PASS' : 'FAIL'} ${png.split(/[\\/]/).pop().padEnd(28)} ` +
  `band ${box.w}x${box.h}@y${box.y}${result.bandPass ? '' : '(!)'} ` +
  `ink ${ink}px@${hex(inkDark)}${result.inkPass ? '' : '(!)'} ` +
  `ramp ${hex(p25)}/${hex(p50)}/${hex(p75)}${result.rampPass ? '' : '(!)'} ` +
  `seam ${result.seam}v${result.maxInternal}(x${result.seamRatio.toFixed(1)})${result.seamPass ? '' : '(!)'} chroma ${maxChroma}`
);
