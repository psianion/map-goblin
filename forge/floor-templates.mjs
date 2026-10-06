// Build img2img templates for the floor batch from the tiles the pack ships today.
//
// The walls started from grey renders of licensed source art. Floors start from the
// existing pack tile instead: it is already seamless and already the right structure,
// so img2img only has to change how it is *painted*, not what it is. Denoise carries
// the style; the composition underneath survives.
//
// SDXL is trained at 1024. The pack tiles run 600–1600px, so each is resampled to 1024
// for generation and returned to its exact cell size at packaging.
//
// node floor-templates.mjs
import fs from 'fs';
import path from 'path';
import { sharp } from './lib.mjs';

const PACK = 'D:/Labs/map-goblin/canvas/public/packs/dungeon-classic';
const OUT = path.join(import.meta.dirname, 'templates');
const GEN = 1024;

/**
 * The six families, and the pack entry each one is repainted from.
 *
 * `grey: true` means the family ships as a neutral master to be tinted per material, the
 * way Fieldstone and Palisade were built. The prompt asks for grayscale and the negative
 * bans colour, but img2img inherits the warmth of whatever it starts from — and these
 * templates are the existing *coloured* tiles, not the grey renders the walls started
 * from. So the desaturation happens at packaging instead. Structure is what the render
 * is for; neutrality is a colour operation and costs nothing here.
 */
export const FAMILIES = [
  { slug: 'stone-dressed', entry: 'large-flagstone-a-01_1x1_floor_A', cells: 5, grey: true },
  { slug: 'cave-rock', entry: 'cave-floor-06-a_1x1_floor_A', cells: 5, grey: true },
  { slug: 'packed-earth', entry: 'dirt-b-04_1x1_floor_A', cells: 5 },
  { slug: 'grass', entry: 'grass-a-01_1x1_floor_A', cells: 6 },
  { slug: 'plank', entry: 'Wooden_Flooring_A_Ashen_5x5_floor_A', cells: 5 },
  // Rebuilt at 5x5: the shipped cobblestone is 3x3, the smallest tile in the pack and
  // the one that visibly repeats first. Upsampling 600->1024 also gives the model room
  // to paint larger stones instead of reproducing the existing gravel-sized ones.
  { slug: 'cobble', entry: 'cobblestone-a-01_1x1_floor_A', cells: 5, grey: true },
];

const manifest = JSON.parse(fs.readFileSync(`${PACK}/pack-4a9bdbee.json`, 'utf8'));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const fam of FAMILIES) {
    const entry = manifest.entries[fam.entry];
    if (!entry) throw new Error(`No manifest entry: ${fam.entry}`);
    const f = entry.frame;

    const dest = path.join(OUT, `floor-${fam.slug}-src.png`);
    await sharp(`${PACK}/${entry.atlas}`)
      .extract({ left: f.x, top: f.y, width: f.w, height: f.h })
      .resize(GEN, GEN, { fit: 'fill', kernel: 'lanczos3' })
      .png()
      .toFile(dest);

    console.log(
      `${fam.slug.padEnd(14)} ${entry.gridSize.padEnd(5)} ${f.w}x${f.h} -> ${GEN}x${GEN}  ${path.basename(dest)}`,
    );
  }
}

// Only rebuild when run directly. FAMILIES is imported by submit/pack, and without this
// guard merely importing the list regenerated every template as a side effect.
if (import.meta.filename === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
