// Build a review contact sheet for a round: each candidate solo, tiled as a run,
// and under tint previews, with its check.mjs numbers.
// node review.mjs --dir staging/round1 --out staging/round1/review.html [--src <sourcePng>]
import fs from 'fs';
import path from 'path';
import { arg } from './lib.mjs';

const dir = arg('dir'), out = arg('out', path.join(arg('dir'), 'review.html'));
const src = arg('src', 'D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_A_3x1.png');

const TINTS = [
  ['Grey master', 'none'],
  ['Earthy', 'sepia(1) hue-rotate(-8deg) saturate(.55) brightness(.68)'],
  ['Slate', 'sepia(1) hue-rotate(160deg) saturate(.3) brightness(.62)'],
  ['Moss', 'sepia(1) hue-rotate(45deg) saturate(.5) brightness(.65)'],
];

fs.copyFileSync(src, path.join(dir, '_source-ref.png'));
const cands = fs.readdirSync(dir).filter(f => f.endsWith('.png') && !f.startsWith('_')).sort();
const block = f => {
  const checkPath = path.join(dir, f.replace(/\.png$/, '.json'));
  const c = fs.existsSync(checkPath) ? JSON.parse(fs.readFileSync(checkPath, 'utf8')) : null;
  const stat = c
    ? `<span class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'}</span> · ink ${c.inkPx}px · mid #${c.ramp.p50.toString(16)} · seam x${c.seamRatio}`
    : 'no check data';
  return `
  <section>
    <h2>${f} <small>${stat}</small></h2>
    <div class="solo"><img src="${f}"></div>
    <div class="rows">${TINTS.map(([label, filter]) => `
      <div class="row"><span>${label}</span>
        <div class="run" style="background-image:url('${f}');filter:${filter}"></div>
      </div>`).join('')}
    </div>
  </section>`;
};

fs.writeFileSync(out, `<!doctype html>
<meta charset="utf-8"><title>Round review</title>
<style>
  body{background:#0f100e;color:#eaece9;font:15px 'IBM Plex Sans',system-ui,sans-serif;margin:0;padding:24px 28px}
  h1{font-size:1.2rem;font-weight:600} h2{font-size:.95rem;font-weight:600;margin:26px 0 8px}
  h2 small{font-weight:400;color:#979e94;margin-left:10px}
  .pass{color:#91c464;font-weight:600}.fail{color:#e0857b;font-weight:600}
  .solo{background:#232522;border-radius:4px;padding:6px;margin-bottom:6px}
  .solo img{width:100%;display:block;image-rendering:auto}
  .rows{display:grid;gap:4px}
  .row{display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:center}
  .row span{font-size:.75rem;color:#b6bcb3;text-align:right}
  .run{height:72px;background-color:#232522;background-repeat:repeat-x;background-size:auto 100%;border-radius:4px}
  .ref{border:1px solid #4d544a;border-radius:6px;padding:10px;margin-top:8px}
</style>
<h1>Wall recreation — round review</h1>
<div class="ref">
  <h2 style="margin-top:0">Source reference (FA kit)</h2>
  <div class="solo"><img src="_source-ref.png"></div>
</div>
${cands.map(block).join('')}
`);
console.log(`review sheet: ${out} (${cands.length} candidates)`);
