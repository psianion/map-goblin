// Stage the packed floor tiles as a forge set that vault-cli `integrate -t floor` consumes.
//
// Mirrors the wall sets' dist shape (forge/dist/GG_Fieldstone): flat PNGs + manifest.json.
// Only {set, pieces[{file, piece, gridSize, naturalWidth, naturalHeight, variant}]} is read
// by integrate; the extra top-level fields are documentation, kept for parity with walls.
//
// node build-floor-set.mjs [--in staging/floors-v2/pack] [--set GG_Floors]
import fs from 'fs';
import path from 'path';
import { sharp, arg } from './lib.mjs';

const HERE = import.meta.dirname;
const inDir = path.resolve(HERE, arg('in', 'staging/floors-v2/pack'));
const setName = arg('set', 'GG_Floors');
const outDir = path.join(HERE, 'dist', setName);

async function main() {
  const files = fs.readdirSync(inDir).filter((f) => f.endsWith('.png'));
  if (!files.length) throw new Error(`No PNGs in ${inDir} — run pack-floors.mjs first`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const pieces = [];
  for (const file of files.sort()) {
    const meta = await sharp(path.join(inDir, file)).metadata();
    fs.copyFileSync(path.join(inDir, file), path.join(outDir, file));
    pieces.push({
      file,
      piece: 'floor',
      gridSize: `${Math.round(meta.width / 200)}x${Math.round(meta.height / 200)}`,
      naturalWidth: meta.width,
      naturalHeight: meta.height,
      variant: 'A',
    });
    console.log(`${file}  ${meta.width}x${meta.height}`);
  }

  const manifest = {
    set: setName,
    family: 'floor',
    grid: 200,
    tint: 'runtime (grey masters, multiplicative); colored tiles ship as-is',
    pieces,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${pieces.length} piece(s) -> ${outDir}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
