// Stage 4 gate page: the full modular Fieldstone set — every padded piece
// (composed vs source ref + check numbers), the assembly demo, the path ribbon.
// Self-contained (data URIs). node gate-page4.mjs
import fs from 'fs';
import { arg } from './lib.mjs';

const S = 'staging/stage4';
const SRC = 'D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A';
const uri = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const check = f => {
  const c = JSON.parse(fs.readFileSync(f.replace(/\.png$/, '.json'), 'utf8'));
  const faces = (c.faces || []).map(x => `${x.edge} ${x.diff}`).join(' · ');
  return `<span class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'}</span> · ink ${c.inkPx}px @ #${c.inkDark.toString(16)} · mid #${c.ramp.p50.toString(16)}${faces ? ' · butt faces ' + faces : ''}`;
};

const FAMILIES = [
  { title: '1x1 corners (A–E)', note: 'A/B free-standing with capped ends; C/D full-bleed; E is a curved elbow (polar-remapped texture).',
    pieces: [['corner-A', 'Corner_A_1x1'], ['corner-B', 'Corner_B_1x1'], ['corner-C', 'Corner_C_1x1'], ['corner-D', 'Corner_D_1x1'], ['corner-E', 'Corner_E_1x1']] },
  { title: 'Curved corners (F 2x2 · G 2x2 · H 3x3)', note: 'Quarter-arc sweeps; strip texture polar-remapped along the curve so the highlight rides the outer rim. G reads 3px ink to the vertical scan only because it crosses the arc diagonally — same painted weight as F/H.',
    pieces: [['corner-F', 'Corner_F_2x2'], ['corner-G', 'Corner_G_2x2'], ['corner-H', 'Corner_H_3x3']] },
  { title: 'Joints (T / X)', note: 'A/B free-standing with caps; C/D full-bleed. These are the pieces the renderer swaps in at intersections.',
    pieces: [['joint-A', 'Joint_A_1x1'], ['joint-B', 'Joint_B_1x1'], ['joint-C', 'Joint_C_1x1'], ['joint-D', 'Joint_D_1x1']] },
  { title: 'Diagonal, ending, connectors', note: 'The DIAG doubles as the doorway piece; connectors are the node-renderer fan material laid through oblique vertices.',
    pieces: [['diag', 'Connector_DIAG_A_1x1'], ['ending', 'Ending_A_1x1'], ['connector-A', 'Connector_A_1x1'], ['connector-B', 'Connector_B_1x1']] },
];

const pair = (p, s) => `
  <article>
    <h3>${p} <small>${check(`${S}/${p}/${p}-comp.png`)}</small></h3>
    <div class="pair">
      <div><h4>ours (grey master)</h4><div class="solo"><img src="${uri(`${S}/${p}/${p}-comp.png`)}"></div></div>
      <div><h4>source reference</h4><div class="solo"><img class="deswat" src="${uri(`${SRC}/Wall_Stone_Earthy_A_${s}.png`)}"></div></div>
    </div>
  </article>`;

fs.writeFileSync(`${S}/gate.html`, `<!doctype html>
<meta charset="utf-8"><title>Stage 4 gate — Fieldstone full modular set</title>
<style>
  body{background:#0f100e;color:#eaece9;font:15px 'IBM Plex Sans',system-ui,sans-serif;margin:0;padding:28px 32px;max-width:1100px}
  h1{font-size:1.25rem;font-weight:600;margin:0 0 4px}
  .lede{color:#979e94;margin:0 0 10px;max-width:72ch}
  h2{font-size:1.05rem;font-weight:600;margin:34px 0 2px;padding-top:18px;border-top:1px solid #2c2f2a}
  h3{font-size:.85rem;font-weight:600;margin:14px 0 6px;color:#c8cdc5}
  h3 small{font-weight:400;color:#979e94;margin-left:8px}
  h4{font-size:.72rem;font-weight:400;color:#979e94;margin:6px 0 4px}
  .note{color:#979e94;font-size:.85rem;margin:2px 0 12px;max-width:75ch}
  .pass{color:#91c464;font-weight:600}.fail{color:#e0857b;font-weight:600}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:640px}
  .solo{background:#232522;border-radius:4px;padding:6px}
  .solo img{width:100%;display:block;image-rendering:auto}
  .deswat{filter:saturate(0)}
  .wide{background:#232522;border-radius:4px;padding:6px;overflow-x:auto}
  .wide img{display:block;max-width:none;height:120px}
</style>
<h1>Stage 4 gate — Fieldstone full modular set</h1>
<p class="lede">The 17 pieces beyond the approved straights: 8 corners, 4 joints, diagonal, ending, 2 connectors, and the 8-cell path ribbon. All are COMPOSED from approved strip texture (fresh strips, seeds 555/777) — arms meet at feathered picture-frame miters, curves are polar-remapped so texture and highlight follow the bend, silhouettes are the source alpha verbatim, and outline gaps at curved/diagonal edges are filled from the source's thinned ink. Zero generation drift; hatch, ink weight, and tone match the straights by construction. Source refs shown desaturated — grey masters are the deliverable, color comes from the runtime tint.</p>

<h2>Assembly demo</h2>
<p class="note">Straights + corner + vertical run + T junction butted on the cell grid exactly as the wall renderer places them (corner and joint rotated by the renderer's rules).</p>
<div class="solo"><img src="${uri(`${S}/_assembly-demo.png`)}"></div>

${FAMILIES.map(f => `<h2>${f.title}</h2><p class="note">${f.note}</p>${f.pieces.map(([p, s]) => pair(p, s)).join('')}`).join('')}

<h2>Path ribbon (8.25 cells)</h2>
<p class="note">${check(`${S}/path/path-comp.png`)} — butt-composite of the two fresh strips (joins are legitimate slab joints, same as mixed runs); source alpha verbatim for the chipped ends. Scroll sideways.</p>
<div class="wide"><img src="${uri(`${S}/path/path-comp.png`)}"></div>
`);
console.log(`gate page: ${S}/gate.html (${Math.round(fs.statSync(`${S}/gate.html`).size / 1024)} KB)`);
