// Build the self-contained Stage 3 gate page (all images inlined as data URIs
// so it renders anywhere with no server). node gate-page.mjs
import fs from 'fs';
import path from 'path';

const S = 'staging/stage3';
const uri = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const check = f => {
  const c = JSON.parse(fs.readFileSync(f.replace(/\.png$/, '.json'), 'utf8'));
  return `<span class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'}</span> · ink ${c.inkPx}px · mid #${c.ramp.p50.toString(16)} · seam x${c.seamRatio}`;
};

const TINTS = [
  ['Grey master', 'none'],
  ['Earthy', 'sepia(1) hue-rotate(-8deg) saturate(.55) brightness(.68)'],
  ['Slate', 'sepia(1) hue-rotate(160deg) saturate(.3) brightness(.62)'],
  ['Moss', 'sepia(1) hue-rotate(45deg) saturate(.5) brightness(.65)'],
];

const LENGTHS = [
  { key: '3x1', title: '3x1 straight', src: `${S}/3x1/_source-ref.png`, note: 'Native generations. A = the locked round-2 winner.',
    picks: [['A', `${S}/3x1/3x1-s22.png`], ['B', `${S}/3x1/3x1-s33.png`], ['C', `${S}/3x1/3x1-s44.png`]] },
  { key: '2x1', title: '2x1 straight', src: `${S}/2x1/_source-ref.png`, note: 'Native generations.',
    picks: [['A', `${S}/2x1/2x1-s66.png`], ['B', `${S}/2x1/2x1-s77.png`], ['C', `${S}/2x1/2x1-s88.png`]] },
  { key: '1x1', title: '1x1 straight', src: `${S}/1x1/_source-ref.png`, note: 'Cut from fresh full-length strips (SDXL cannot paint small strips natively). Alternate below: the one native small piece that came out as a real slab.',
    picks: [['A', `${S}/1x1/1x1-cutA.png`], ['B', `${S}/1x1/1x1-cutB.png`], ['C', `${S}/1x1/1x1-cutC.png`], ['alt s88', `${S}/1x1/1x1-s88.png`]] },
  { key: 'half', title: 'Half straight', src: `${S}/half/_source-ref.png`, note: 'Cut from a fresh full-length strip. Stays 100×200 in staging; embedded into its 200×200 tile at packaging.',
    picks: [['A', `${S}/half/half-cutA.png`], ['B', `${S}/half/half-cutB.png`], ['C', `${S}/half/half-cutC.png`]] },
];

const section = l => `
<section>
  <h2>${l.title}</h2>
  <p class="note">${l.note}</p>
  <div class="pair">
    <div>
      <h3>Source reference</h3>
      <div class="solo"><img src="${uri(l.src)}"></div>
    </div>
    <div>
      <h3>Mixed run A|B|C|A (what the renderer produces)</h3>
      <div class="solo"><img src="${uri(`${S}/${l.key}/_mixed-run.png`)}"></div>
    </div>
  </div>
  ${l.picks.map(([v, f]) => `
  <article>
    <h3>Variant ${v} <small>${path.basename(f)} · ${check(f)}</small></h3>
    <div class="rows">${TINTS.map(([label, filter]) => `
      <div class="row"><span>${label}</span>
        <div class="run" style="background-image:url('${uri(f)}');filter:${filter}"></div>
      </div>`).join('')}
    </div>
  </article>`).join('')}
</section>`;

fs.writeFileSync(`${S}/gate.html`, `<!doctype html>
<meta charset="utf-8"><title>Stage 3 gate — Fieldstone straights</title>
<style>
  body{background:#0f100e;color:#eaece9;font:15px 'IBM Plex Sans',system-ui,sans-serif;margin:0;padding:28px 32px;max-width:1100px}
  h1{font-size:1.25rem;font-weight:600;margin:0 0 4px}
  .lede{color:#979e94;margin:0 0 10px;max-width:70ch}
  h2{font-size:1.05rem;font-weight:600;margin:34px 0 2px;padding-top:18px;border-top:1px solid #2c2f2a}
  h3{font-size:.85rem;font-weight:600;margin:14px 0 6px;color:#c8cdc5}
  h3 small{font-weight:400;color:#979e94;margin-left:8px}
  .note{color:#979e94;font-size:.85rem;margin:2px 0 12px;max-width:75ch}
  .pass{color:#91c464;font-weight:600}.fail{color:#e0857b;font-weight:600}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:800px){.pair{grid-template-columns:1fr}}
  .solo{background:#232522;border-radius:4px;padding:6px}
  .solo img{width:100%;display:block}
  .rows{display:grid;gap:4px}
  .row{display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:center}
  .row span{font-size:.75rem;color:#b6bcb3;text-align:right}
  .run{height:64px;background-color:#232522;background-repeat:repeat-x;background-size:auto 100%;border-radius:4px}
</style>
<h1>Stage 3 gate — Fieldstone straights</h1>
<p class="lede">All 12 pieces at the locked recipe (grey template v2, denoise 0.70, dressed-slab prompt, wrap-blend). Each variant row tiles the piece as a run; the mixed strip butts A|B|C|A end-to-end. Tints are CSS previews of the runtime tint. Machine gate: band exact, chroma 0, ink 1–2px, seam within internal-joint range.</p>
${LENGTHS.map(section).join('')}
`);
console.log(`gate page: ${S}/gate.html (${Math.round(fs.statSync(`${S}/gate.html`).size / 1024)} KB)`);
