// Build a before/after review sheet for the floor batch.
//
// Every tile is shown tiled, not as a lone swatch: a texture that looks fine at 400px can
// still pulse or grid-line once it repeats, and repeating is the only way it is ever seen
// on a map. The seam number under each one is measured on the healed tile.
//
// node floor-sheet.mjs [--out ../docs/floor-batch-v2.html]
import fs from 'fs';
import path from 'path';
import { sharp, arg } from './lib.mjs';
import { seamError } from './seamless.mjs';
import { FAMILIES_V2 } from './floor-templates-v2.mjs';

const HERE = import.meta.dirname;
const STAGING = path.join(HERE, 'staging', 'floors-v2');
// jobs.json is the record of what this batch actually rendered (cells per family).
const JOBS = JSON.parse(fs.readFileSync(path.join(STAGING, 'jobs.json'), 'utf8'));
const FAMILIES = FAMILIES_V2.map((f) => ({ ...f, ...JOBS.find((j) => j.slug === f.slug) }));
const PACK = 'D:/Labs/map-goblin/canvas/public/packs/dungeon-classic';
const SEAM_BUDGET = 9;

const LABEL = {
  'stone-dressed': 'Dressed Stone Floor',
  'cave-rock': 'Cave Rock Floor',
  'packed-earth': 'Packed Earth',
  grass: 'Grass',
  plank: 'Plank Flooring',
  cobble: 'Cobblestone',
};

// Content-addressed manifest name changes every republish — resolve through index.json.
const index = JSON.parse(fs.readFileSync(`${PACK}/../index.json`, 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(`${PACK}/../${index.packs['dungeon-classic'].manifest}`, 'utf8'),
);

async function dataUri(buf) {
  return 'data:image/webp;base64,' + buf.toString('base64');
}

/** The tile as it ships today, straight out of the atlas. */
async function beforeTile(fam) {
  const e = manifest.entries[fam.entry];
  const f = e.frame;
  return dataUri(
    await sharp(`${PACK}/${e.atlas}`)
      .extract({ left: f.x, top: f.y, width: f.w, height: f.h })
      .resize(300, 300, { fit: 'fill' })
      .webp({ quality: 80 })
      .toBuffer(),
  );
}

/** The healed draft, greyscaled for the families that ship as tint masters. */
async function afterTile(fam) {
  const src = path.join(STAGING, `${fam.slug}.png`);
  if (!fs.existsSync(src)) return null;
  const p = sharp(src).resize(300, 300, { fit: 'fill' });
  return dataUri(await (fam.grey ? p.greyscale() : p).webp({ quality: 80 }).toBuffer());
}

async function main() {
  const outPath = arg('out', path.join(HERE, '..', 'docs', 'floor-batch-v2.html'));
  const rows = [];

  for (const fam of FAMILIES) {
    const after = await afterTile(fam);
    const healedPath = path.join(STAGING, `${fam.slug}.png`);
    const rawPath = path.join(STAGING, 'raw', `${fam.slug}.png`);
    rows.push({
      slug: fam.slug,
      label: LABEL[fam.slug] ?? fam.slug,
      cells: fam.cells,
      grey: !!fam.grey,
      before: await beforeTile(fam),
      after,
      seam: fs.existsSync(healedPath) ? await seamError(healedPath) : null,
      seamRaw: fs.existsSync(rawPath) ? await seamError(rawPath) : null,
    });
  }

  const card = (r) => {
    const worst = r.seam ? Math.max(r.seam.vertical, r.seam.horizontal) : null;
    const worstRaw = r.seamRaw ? Math.max(r.seamRaw.vertical, r.seamRaw.horizontal) : null;
    return `
    <article class="row">
      <header>
        <h2>${r.label}</h2>
        <p class="meta">
          <code>${r.slug}</code> · ${r.cells}×${r.cells} cells · ${r.cells * 200}px
          ${r.grey ? '· <span class="tag">grey master</span>' : ''}
        </p>
      </header>
      <div class="pair">
        <figure>
          <div class="field" style="background-image:url('${r.before}')"></div>
          <figcaption>shipping today</figcaption>
        </figure>
        <figure>
          ${
            r.after
              ? `<div class="field" style="background-image:url('${r.after}')"></div>
                 <figcaption>forge v2 draft</figcaption>`
              : `<div class="field pending"><span>still rendering</span></div>
                 <figcaption>&nbsp;</figcaption>`
          }
        </figure>
      </div>
      ${
        worst !== null
          ? `<p class="seam ${worst <= SEAM_BUDGET ? 'ok' : 'bad'}">
               seam ${worstRaw} → <b>${worst}</b>
               <span>budget ${SEAM_BUDGET} · shipped tiles measure ~7</span>
             </p>`
          : ''
      }
    </article>`;
  };

  const done = rows.filter((r) => r.after).length;
  const html = `<title>Floor batch v2 — drafts</title>
<style>
  :root{--s0:15 16 14;--s1:24 26 23;--s3:48 51 46;--tp:234 236 233;--ts:182 188 179;
        --tm:151 158 148;--bs:77 84 74;--bd:58 62 56;--acc:145 196 100;--dan:224 133 123;}
  *{box-sizing:border-box}
  body{margin:0;padding:clamp(1.25rem,4vw,2.5rem);background:rgb(var(--s0));color:rgb(var(--tp));
       font:15px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1000px;margin:0 auto}
  h1{margin:0 0 .5rem;font-size:1.9rem;letter-spacing:-.02em;font-weight:650}
  .lede{margin:0 0 .4rem;color:rgb(var(--ts));max-width:70ch;text-wrap:pretty}
  .count{margin:0 0 2rem;font-size:12px;color:rgb(var(--tm))}
  .row{border:1px solid rgb(var(--bd));border-radius:6px;background:rgb(var(--s1));
       padding:1.1rem;margin-bottom:1.1rem}
  h2{margin:0;font-size:1.02rem;font-weight:620}
  .meta{margin:.15rem 0 .9rem;font-size:11.5px;color:rgb(var(--tm))}
  code{font-family:ui-monospace,Consolas,monospace;background:rgb(var(--s3));
       padding:.08em .36em;border-radius:3px;color:rgb(var(--ts))}
  .tag{color:rgb(var(--acc));font-weight:600}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}
  @media(max-width:640px){.pair{grid-template-columns:1fr}}
  figure{margin:0}
  .field{height:230px;border-radius:4px;border:1px solid rgb(var(--bd));
         background-size:115px 115px;background-repeat:repeat}
  .field.pending{display:grid;place-items:center;background:rgb(var(--s3));
                 color:rgb(var(--tm));font-size:12px}
  figcaption{margin-top:.35rem;font-size:10.5px;color:rgb(var(--tm));letter-spacing:.03em}
  .seam{margin:.9rem 0 0;padding-top:.75rem;border-top:1px solid rgb(var(--bd));font-size:11.5px}
  .seam.ok{color:rgb(var(--acc))}
  .seam.bad{color:rgb(var(--dan))}
  .seam span{color:rgb(var(--tm));margin-left:.5rem}
</style>
<div class="wrap">
  <h1>Floor batch v2 — drafts</h1>
  <p class="lede">Each tile is shown repeating, because repeating is the only way it is ever
  seen on a map. Left is what ships today; right is the forge draft. Grey masters are shown
  desaturated, as they will be tinted per material.</p>
  <p class="count">${done} of ${rows.length} rendered · seed 11 · SDXL img2img from the shipped tile</p>
  ${rows.map(card).join('\n')}
</div>`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`sheet written: ${outPath} (${done}/${rows.length} rendered)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
