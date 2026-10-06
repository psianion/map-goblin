// v2 templates: zoom in, so the model paints few large elements instead of many tiny ones.
//
// v1 fed a whole 5x5-cell field into a 1024px generation. That put each cobble at roughly
// 30px and each grass clump smaller still — far below what SDXL can render as a *thing*,
// so it produced the average of a thing, which is mush. It also explains why the amorphous
// families failed while slab-sized ones survived: slabs happened to be big enough.
//
// So crop a small window of the source instead and upscale that to 1024. The window covers
// CROP_CELLS grid cells, so at 200px/cell the finished tile is CROP_CELLS*200 — a normal
// texture size — while the model works at ~2.5x the linear detail it had in v1.
//
// node floor-templates-v2.mjs [--cells 2] [--only <slug>]
import fs from 'fs';
import path from 'path';
import { sharp, arg } from './lib.mjs';

const PACK = 'D:/Labs/map-goblin/canvas/public/packs/dungeon-classic';
const OUT = path.join(import.meta.dirname, 'templates');
const GEN = 1024;
const CELL_PX = 200;

export const FAMILIES_V2 = [
  { slug: 'stone-dressed', entry: 'large-flagstone-a-01_1x1_floor_A', grey: true },
  { slug: 'cave-rock', entry: 'cave-floor-06-a_1x1_floor_A', grey: true },
  { slug: 'packed-earth', entry: 'dirt-b-04_1x1_floor_A' },
  { slug: 'grass', entry: 'grass-a-01_1x1_floor_A' },
  { slug: 'plank', entry: 'Wooden_Flooring_A_Ashen_5x5_floor_A' },
  { slug: 'cobble', entry: 'cobblestone-a-01_1x1_floor_A', grey: true },
];

// The manifest filename is content-addressed and changes on every republish — resolve it
// through index.json instead of pinning a hash that the next deploy invalidates.
const index = JSON.parse(fs.readFileSync(`${PACK}/../index.json`, 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(`${PACK}/../${index.packs['dungeon-classic'].manifest}`, 'utf8'),
);

export function cropPlan(fam, cropCells) {
  const e = manifest.entries[fam.entry];
  const f = e.frame;
  const srcCells = parseInt(e.gridSize, 10);
  const srcPxPerCell = f.w / srcCells;
  // The window in *source* pixels that covers cropCells grid cells.
  const win = Math.round(srcPxPerCell * cropCells);
  return { frame: f, atlas: e.atlas, srcCells, srcPxPerCell, win, zoom: +(GEN / win).toFixed(2) };
}

async function main() {
  const cropCells = +arg('cells', 2);
  const only = arg('only');
  const families = only ? FAMILIES_V2.filter((f) => f.slug === only) : FAMILIES_V2;

  fs.mkdirSync(OUT, { recursive: true });
  console.log(`crop ${cropCells}x${cropCells} cells -> ${cropCells * CELL_PX}px final tile\n`);
  console.log('family          source     window   zoom   final');

  for (const fam of families) {
    const p = cropPlan(fam, cropCells);
    // Centre the window: edges of these tiles sometimes carry the original seam blend.
    const left = p.frame.x + Math.round((p.frame.w - p.win) / 2);
    const top = p.frame.y + Math.round((p.frame.h - p.win) / 2);

    const dest = path.join(OUT, `floorv2-${fam.slug}-src.png`);
    await sharp(`${PACK}/${p.atlas}`)
      .extract({ left, top, width: p.win, height: p.win })
      .resize(GEN, GEN, { fit: 'fill', kernel: 'lanczos3' })
      .png()
      .toFile(dest);

    console.log(
      `${fam.slug.padEnd(15)} ${String(p.frame.w + 'px/' + p.srcCells + 'c').padEnd(10)} ` +
        `${String(p.win + 'px').padEnd(8)} ${String(p.zoom + 'x').padEnd(6)} ${cropCells * CELL_PX}px`,
    );
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
