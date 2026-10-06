// Build the per-family options sheet for the floor batch — candidates side by side,
// tiled (repeating is the only way a floor is ever seen), lettered for picking.
//
// node options-sheet.mjs [--out ../docs/floor-batch-v2-options.html]
import fs from 'fs';
import path from 'path';
import { sharp, arg } from './lib.mjs';
import { seamError } from './seamless.mjs';
import { FAMILIES_V2 } from './floor-templates-v2.mjs';

const HERE = import.meta.dirname;
const STAGING = path.join(HERE, 'staging', 'floors-v2-options');
const SEAM_BUDGET = 1.5;

const LABEL = {
  'stone-dressed': 'Dressed Stone Floor',
  'cave-rock': 'Cave Rock Floor',
  'packed-earth': 'Packed Earth',
  grass: 'Grass',
  plank: 'Plank Flooring',
  cobble: 'Cobblestone',
};

async function tileUri(file, grey) {
  const p = sharp(file).resize(300, 300, { fit: 'fill' });
  const buf = await (grey ? p.greyscale() : p).webp({ quality: 80 }).toBuffer();
  return 'data:image/webp;base64,' + buf.toString('base64');
}

async function main() {
  const outPath = arg('out', path.join(HERE, '..', 'docs', 'floor-batch-v2-options.html'));
  const jobs = JSON.parse(fs.readFileSync(path.join(STAGING, 'jobs.json'), 'utf8'));

  const sections = [];
  let rendered = 0;
  let total = 0;
  for (const fam of FAMILIES_V2) {
    const candidates = jobs.filter((j) => j.slug === fam.slug);
    const cards = [];
    for (let i = 0; i < candidates.length; i++) {
      const job = candidates[i];
      const letter = String.fromCharCode(65 + i);
      const file = path.join(STAGING, `${job.key}.png`);
      total++;
      if (!fs.existsSync(file)) {
        cards.push(`<figure><div class="tile pending"><span>rendering</span></div>
          <figcaption><b>${letter}</b> · ${job.tag} · seed ${job.seed} · d${job.denoise}</figcaption></figure>`);
        continue;
      }
      rendered++;
      const seam = await seamError(file);
      const ok = seam.worstRatio <= SEAM_BUDGET;
      cards.push(`<figure>
        <div class="tile" style="background-image:url('${await tileUri(file, fam.grey)}')"></div>
        <figcaption><b>${letter}</b> · ${job.tag} · seed ${job.seed} · d${job.denoise}
          · <span class="${ok ? 'ok' : 'bad'}">seam ${seam.worstRatio}</span></figcaption>
      </figure>`);
    }
    sections.push(`<article class="row">
      <header><h2>${LABEL[fam.slug] ?? fam.slug}</h2>
        <p class="meta"><code>${fam.slug}</code>${fam.grey ? ' · <span class="tag">grey master</span>' : ''}</p>
      </header>
      <div class="grid">${cards.join('\n')}</div>
    </article>`);
  }

  const html = `<title>Floor batch v2 — options</title>
<style>
  :root{--s0:15 16 14;--s1:24 26 23;--s3:48 51 46;--tp:234 236 233;--ts:182 188 179;
        --tm:151 158 148;--bd:58 62 56;--acc:145 196 100;--dan:224 133 123;}
  *{box-sizing:border-box}
  body{margin:0;padding:clamp(1.25rem,4vw,2.5rem);background:rgb(var(--s0));color:rgb(var(--tp));
       font:15px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1100px;margin:0 auto}
  h1{margin:0 0 .5rem;font-size:1.9rem;letter-spacing:-.02em;font-weight:650}
  .lede{margin:0 0 2rem;color:rgb(var(--ts));max-width:70ch;text-wrap:pretty}
  .row{border:1px solid rgb(var(--bd));border-radius:6px;background:rgb(var(--s1));
       padding:1.1rem;margin-bottom:1.1rem}
  h2{margin:0;font-size:1.02rem;font-weight:620}
  .meta{margin:.15rem 0 .9rem;font-size:11.5px;color:rgb(var(--tm))}
  code{font-family:ui-monospace,Consolas,monospace;background:rgb(var(--s3));
       padding:.08em .36em;border-radius:3px;color:rgb(var(--ts))}
  .tag{color:rgb(var(--acc));font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.8rem}
  figure{margin:0}
  .tile{height:200px;border-radius:4px;border:1px solid rgb(var(--bd));
        background-size:115px 115px;background-repeat:repeat}
  .tile.pending{display:grid;place-items:center;background:rgb(var(--s3));
                color:rgb(var(--tm));font-size:12px}
  figcaption{margin-top:.35rem;font-size:10.5px;color:rgb(var(--tm));letter-spacing:.03em}
  .ok{color:rgb(var(--acc))}
  .bad{color:rgb(var(--dan))}
</style>
<div class="wrap">
  <h1>Floor batch v2 — options</h1>
  <p class="lede">Every candidate shown repeating at map-ish scale. Pick one letter per family
  (or none to re-roll). Seam is the healed worst-axis ratio; budget ${SEAM_BUDGET}.
  ${rendered} of ${total} rendered.</p>
  ${sections.join('\n')}
</div>`;

  fs.writeFileSync(outPath, html);
  console.log(`options sheet: ${outPath} (${rendered}/${total} rendered)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
