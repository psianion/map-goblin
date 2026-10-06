// Gate-1 mockup for one floor family: legacy vs repainted master, in map context —
// a wide floor area with the grid overlaid, at table zoom and at 4x zoom.
//
// The regen master is 400px/cell, legacy is 200px/cell; both are drawn at the same
// CSS cell pitch, so the browser upsamples each exactly like the canvas would. What
// you see at "4x" is what the table would show.
//
// node mockup-floor.mjs --family stone-dressed [--out ../docs/floor-mockup-<family>.html]
import fs from 'fs';
import path from 'path';
import { sharp, arg } from './lib.mjs';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'staging', 'floors-v3');

async function dataUri(file) {
  const buf = await sharp(file).webp({ quality: 90 }).toBuffer();
  return 'data:image/webp;base64,' + buf.toString('base64');
}

async function main() {
  const slug = arg('family');
  if (!slug) throw new Error('need --family <slug>');
  const outPath = arg('out', path.join(HERE, '..', 'docs', `floor-mockup-${slug}.html`));

  const legacyFile = path.join(OUT, 'src', `${slug}-legacy.png`);
  const legacyPx = (await sharp(legacyFile).metadata()).width;
  const legacyCells = Math.round(legacyPx / 200);

  const variants = [{ name: 'legacy (200px/cell)', file: legacyFile, cells: legacyCells }];
  for (const f of fs.readdirSync(OUT)) {
    const m = f.match(new RegExp(`^${slug}-(.+)\\.png$`));
    if (!m || m[1].endsWith('composed') || m[1].endsWith('wrapfix') || m[1].startsWith('base800c')) continue;
    const px = (await sharp(path.join(OUT, f)).metadata()).width;
    variants.push({ name: m[1], file: path.join(OUT, f), cells: legacyCells, px });
  }

  const zooms = [
    { label: 'table zoom', cellPx: 64 },
    { label: '4x zoom', cellPx: 256 },
  ];

  const sections = [];
  for (const z of zooms) {
    const panels = [];
    for (const v of variants) {
      const uri = await dataUri(v.file);
      panels.push(`<figure>
        <div class="map" style="background-image:url('${uri}');
             background-size:${v.cells * z.cellPx}px ${v.cells * z.cellPx}px;
             --cell:${z.cellPx}px"></div>
        <figcaption>${v.name}</figcaption>
      </figure>`);
    }
    sections.push(`<section><h2>${z.label} (${z.cellPx}px/cell)</h2>
      <div class="grid">${panels.join('\n')}</div></section>`);
  }

  const html = `<title>${slug} — floor mockup</title>
<style>
  :root{--s0:15 16 14;--s1:24 26 23;--tp:234 236 233;--tm:151 158 148;--bd:58 62 56;}
  *{box-sizing:border-box}
  body{margin:0;padding:clamp(1.25rem,4vw,2.5rem);background:rgb(var(--s0));color:rgb(var(--tp));
       font:15px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif}
  .wrap{max-width:1240px;margin:0 auto}
  h1{margin:0 0 .3rem;font-size:1.9rem;letter-spacing:-.02em;font-weight:650}
  .lede{margin:0 0 1.6rem;color:rgb(var(--tm));max-width:75ch}
  h2{font-size:1.02rem;font-weight:620;margin:1.4rem 0 .6rem}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1rem}
  figure{margin:0}
  .map{height:420px;border-radius:6px;border:1px solid rgb(var(--bd));position:relative;
       background-repeat:repeat}
  .map::after{content:'';position:absolute;inset:0;pointer-events:none;
    background:
      repeating-linear-gradient(to right, rgba(255,255,255,.07) 0 1px, transparent 1px var(--cell)),
      repeating-linear-gradient(to bottom, rgba(255,255,255,.07) 0 1px, transparent 1px var(--cell))}
  figcaption{margin-top:.4rem;font-size:11px;color:rgb(var(--tm));letter-spacing:.03em}
</style>
<div class="wrap">
  <h1>${slug}</h1>
  <p class="lede">Same source pattern, repainted at 400px/cell. Both panels tile the full
  master with the grid overlaid; the browser upsamples each exactly as the canvas would,
  so the 4x panels show real table behaviour. Grey-master families are shown as painted —
  tinting happens at pack time.</p>
  ${sections.join('\n')}
</div>`;

  fs.writeFileSync(outPath, html);
  console.log(`mockup: ${outPath} (${variants.length - 1} regen variant(s))`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
