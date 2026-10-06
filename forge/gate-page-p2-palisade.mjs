// Palisade P2 recipe-confirmation gate page (self-contained, data URIs).
// Clone of gate-page.mjs scoped to the P2 micro-sweep: 4 candidates (denoise
// {0.65,0.70} x seed {22,555}) beside the source ref, each self-tiled 3x plus
// an Ashen-like tint (hue sampled from the real source with sharp — sepia's
// CSS baseline hue sits ~40deg, so hue-rotate = sampledHue - 40 approximates
// it) and a Moss-green tint (brand accent preview, same recipe as fieldstone's
// Moss tint). node gate-page-p2-palisade.mjs
import fs from 'fs';
import { sharp, loadRaw, arg } from './lib.mjs';

const S = 'staging/palisade-p2';
const SRC = 'D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Wood_A/Wall_Wood_Ashen_A_Straight_A_3x1.png';
const uri = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const check = f => {
  const c = JSON.parse(fs.readFileSync(f.replace(/\.png$/, '.json'), 'utf8'));
  return `<span class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'}</span> · ink ${c.inkPx}px · mid #${c.ramp.p50.toString(16)} · seam x${c.seamRatio}`;
};

// sample the source's average hue (opaque pixels) for the Ashen-like preview
const { data: srcRaw } = await loadRaw(SRC);
let r = 0, g = 0, b = 0, n = 0;
for (let i = 0; i < srcRaw.length; i += 4) if (srcRaw[i + 3] > 12) { r += srcRaw[i]; g += srcRaw[i + 1]; b += srcRaw[i + 2]; n++; }
r /= n; g /= n; b /= n;
const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
let hue = 0;
if (d > 0) hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
if (hue < 0) hue += 360;
const ashenRotate = Math.round(hue - 40); // CSS sepia(1) baseline sits ~40deg

const TINTS = [
  ['Grey (self-tile 3x)', 'none'],
  [`Ashen-like (sampled hue ${hue.toFixed(0)}deg)`, `sepia(1) hue-rotate(${ashenRotate}deg) saturate(.55) brightness(.65)`],
  ['Moss', 'sepia(1) hue-rotate(45deg) saturate(.5) brightness(.65)'],
];

// eyeball verdicts + recipe deltas travel WITH the page — machine PASS alone is
// screening, not judgment (all four pass after post ink-thinning)
const CANDIDATES = [
  ['grey2-d0.65-s22', 'thinink 0', 'Solid planking: joints, grain, knots. Passed as generated.', ''],
  ['grey2-d0.65-s555', 'thinink 1', 'Dud paint: near-featureless smooth bars, no joints, no grain.', 'dud'],
  ['grey2-d0.70-s22', 'thinink 1', 'Best paint of the set: strong grain swirls, knot, clear staggered butts.', 'rec'],
  ['grey2-d0.70-s555', 'thinink 2', 'Dud paint: flat bars, one grain patch mid-strip, weak joints.', 'dud'],
];

const srcMeta = await sharp(SRC).metadata();

const article = async ([id, delta, verdict, cls]) => {
  const f = `${S}/${id}.png`;
  const meta = await sharp(f).metadata();
  return `
  <article class="${cls}">
    <h3>${id} <small>${check(f)} · ${delta}</small>${cls === 'rec' ? '<em class="tag">recommended</em>' : ''}</h3>
    <p class="verdict">${verdict}</p>
    <div class="rows">
      <div class="row"><span>Band detail (1:1)</span>
        <div class="tilewrap"><div class="run" style="width:${meta.width * 2}px;height:44px;background-image:url('${uri(f)}');background-position:0 -78px;background-size:auto"></div></div>
      </div>${TINTS.map(([label, filter]) => `
      <div class="row"><span>${label}</span>
        <div class="tilewrap"><div class="run" style="width:${meta.width * 3}px;background-image:url('${uri(f)}');filter:${filter}"></div></div>
      </div>`).join('')}
    </div>
  </article>`;
};

const body = (await Promise.all(CANDIDATES.map(article))).join('');

fs.writeFileSync(`${S}/gate.html`, `<!doctype html>
<meta charset="utf-8"><title>Palisade P2 — recipe confirmation</title>
<style>
  body{background:#0f100e;color:#eaece9;font:15px 'IBM Plex Sans',system-ui,sans-serif;margin:0;padding:28px 32px;max-width:1100px}
  h1{font-size:1.25rem;font-weight:600;margin:0 0 4px}
  .lede{color:#979e94;margin:0 0 10px;max-width:70ch}
  h2{font-size:1.05rem;font-weight:600;margin:34px 0 2px;padding-top:18px;border-top:1px solid #2c2f2a}
  h3{font-size:.85rem;font-weight:600;margin:14px 0 6px;color:#c8cdc5}
  h3 small{font-weight:400;color:#979e94;margin-left:8px}
  .note{color:#979e94;font-size:.85rem;margin:2px 0 12px;max-width:75ch}
  .pass{color:#91c464;font-weight:600}.fail{color:#e0857b;font-weight:600}
  .solo{background:#232522;border-radius:4px;padding:6px;max-width:640px}
  .solo img{width:100%;display:block}
  .rows{display:grid;gap:4px}
  .row{display:grid;grid-template-columns:180px 1fr;gap:10px;align-items:center}
  .row span{font-size:.75rem;color:#b6bcb3;text-align:right}
  .tilewrap{overflow-x:auto;background:#232522;border-radius:4px;scrollbar-color:#3a3d38 #232522;scrollbar-width:thin}
  .tilewrap::-webkit-scrollbar{height:8px}
  .tilewrap::-webkit-scrollbar-thumb{background:#3a3d38;border-radius:4px}
  .tilewrap::-webkit-scrollbar-track{background:#232522}
  .run{height:64px;background-repeat:repeat-x;background-size:auto 100%}
  .verdict{font-size:.85rem;color:#b6bcb3;margin:0 0 8px;max-width:75ch}
  article.dud .verdict{color:#e0857b}
  article.rec{background:#1a1d18;border:1px solid #3a4433;border-radius:6px;padding:10px 14px;margin:14px 0}
  .tag{font-style:normal;font-size:.7rem;font-weight:600;color:#91c464;border:1px solid #3a4433;border-radius:3px;padding:1px 6px;margin-left:10px;vertical-align:middle}
  .decide{background:#1a1d18;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:.9rem;max-width:75ch}
  .decide b{color:#c8cdc5}
</style>
<h1>Palisade P2 — recipe confirmation</h1>
<p class="lede">Micro-sweep on Straight 3x1 (denoise {0.65, 0.70} x seed {22, 555}) against the locked fieldstone recipe (grey2 template, 28 steps dpmpp_2m/karras cfg 6.5, wrapblend 80). Wood != stone — confirming grain + staggered-butt joints hold before the full 6-seed sweep. Each candidate self-tiles 3x to preview a run; tints are CSS previews of the runtime tint (Ashen-like hue sampled from the real source, Moss is the brand accent preview). Machine gate: band 44@78 exact, chroma 0, ink 1-2px, seam within internal-joint range.</p>

<div class="decide"><b>The decision:</b> pick the recipe for the P3 6-seed sweep. Seed drove quality far more than
denoise here — both s555 strips are paint duds despite clean numbers, both s22 strips are real planking.
Recommendation: <b>d0.70 + post thinink 1</b> (richest paint; ink lands 2px). All four pass the machine gate,
so judge the paint.
<br><br><b>Fidelity finding (all four):</b> the source band is TWO stacked plank rows with a center seam;
every candidate repainted it as ONE full-height plank row. Compare the 1:1 band details below. Options:
<b>(a)</b> accept the single-row design as this set's look — footprint/ink/values all hold;
<b>(b)</b> round 2 with the center seam deterministically reinstated in post from the source's thinned ink
(keeps the model's paint, restores the two-row read; model-invented butts stay);
<b>(c)</b> re-sweep at denoise 0.60 to let the template's seam survive (risks weaker paint).
Reply with a candidate id + a/b/c, or redirect.</div>

<h2>Source reference</h2>
<p class="note">${SRC.split(/[\\/]/).pop()} (${srcMeta.width}x${srcMeta.height}) — the design being recreated: two plank rows, staggered butts, ~4px ink (targets are half-weight ink, grey master).</p>
<div class="rows">
  <div class="row"><span>Band detail (1:1)</span>
    <div class="tilewrap"><div class="run" style="width:${srcMeta.width * 2}px;height:44px;background-image:url('${uri(SRC)}');background-position:0 -78px;background-size:auto"></div></div>
  </div>
  <div class="row"><span>Self-tile 3x</span>
    <div class="tilewrap"><div class="run" style="width:${srcMeta.width * 3}px;background-image:url('${uri(SRC)}')"></div></div>
  </div>
</div>

<h2>Candidates</h2>
${body}
`);
console.log(`gate page: ${S}/gate.html (${Math.round(fs.statSync(`${S}/gate.html`).size / 1024)} KB)`);
