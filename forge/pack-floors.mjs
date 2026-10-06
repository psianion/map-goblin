// Take healed floor drafts to pack-ready tiles and report whether each one is usable.
//
// Generation runs at 1024 because that is what SDXL is trained at. The pack needs exactly
// 200px per grid cell (`gridPixels: 200` in the pack config) — the splat shader samples at
// that density and nothing else. So every tile is resampled to cells*200 on the way out.
//
// node pack-floors.mjs [--in staging/floors-v2] [--out staging/floors-v2/pack]
//
// Families come from the batch's own jobs.json (slug, cells, grey), not a template module —
// the manifest a submit run leaves behind is the one description of what that run rendered.
import fs from 'fs';
import path from 'path';
import { sharp, arg } from './lib.mjs';
import { seamError } from './seamless.mjs';

const CELL_PX = 200;
// Seam difference as a multiple of the tile's own interior variation (see seamError).
// 1.0 is "the join looks like any other neighbouring pixels". 1.5 leaves headroom for
// directional art, where the wrap can never line up as tidily as a mottled surface.
const SEAM_BUDGET = 1.5;

const inDir = path.resolve(import.meta.dirname, arg('in', 'staging/floors-v2'));
const outDir = path.resolve(import.meta.dirname, arg('out', path.join(inDir, 'pack')));
const FAMILIES = JSON.parse(fs.readFileSync(path.join(inDir, 'jobs.json'), 'utf8'));

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];

  for (const fam of FAMILIES) {
    const src = path.join(inDir, `${fam.slug}.png`);
    if (!fs.existsSync(src)) {
      report.push({ slug: fam.slug, status: 'missing' });
      continue;
    }

    const side = fam.cells * CELL_PX;
    const dest = path.join(outDir, `GG_Floor_${fam.slug}_${fam.cells}x${fam.cells}.png`);

    // `.greyscale()` keeps the luminance and drops the hue, which is exactly what a tint
    // master needs — the tint supplies the colour later, so any residual warmth here
    // would fight it and read as mud.
    const pipeline = sharp(src).resize(side, side, { fit: 'fill', kernel: 'lanczos3' });
    await (fam.grey ? pipeline.greyscale() : pipeline).png().toFile(dest);

    // Measured on the packaged tile, not the pre-resize one: resampling is the last thing
    // that can reintroduce an edge mismatch, so it is the last thing checked.
    const seam = await seamError(dest);
    report.push({
      slug: fam.slug,
      size: `${side}x${side}`,
      cells: `${fam.cells}x${fam.cells}`,
      seam: seam.worstRatio,
      status: seam.worstRatio <= SEAM_BUDGET ? 'ok' : 'SEAM',
    });
  }

  console.log('family          cells  size        ratio  status');
  for (const r of report) {
    if (r.status === 'missing') {
      console.log(`${r.slug.padEnd(15)} —      —           —      not generated`);
      continue;
    }
    console.log(
      `${r.slug.padEnd(15)} ${r.cells.padEnd(6)} ${r.size.padEnd(11)} ${String(r.seam).padEnd(6)} ${r.status}`,
    );
  }
  const bad = report.filter((r) => r.status === 'SEAM');
  if (bad.length) {
    console.log(`\n${bad.length} tile(s) over the seam budget of ${SEAM_BUDGET} — these will show a grid line.`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
