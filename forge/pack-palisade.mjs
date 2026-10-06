// Package the approved Timber Palisade set into dist/GG_Palisade/ — clone of
// pack-fieldstone.mjs (band 44@78, wood family, staging/palisade-s3/-s4 dirs).
// Halves are embedded into a full 200x200 tile; contentRect emitted for
// straights, connectors (incl DIAG), path.
// node pack-palisade.mjs
import fs from 'fs';
import { sharp, loadRaw } from './lib.mjs';

const OUT = 'dist/GG_Palisade';
fs.mkdirSync(OUT, { recursive: true });

const S3 = 'staging/palisade-s3', S4 = 'staging/palisade-s4';
const jobs = [];
for (const [len, picks] of [
  ['3x1', ['3x1-A', '3x1-B', '3x1-C']],
  ['2x1', ['2x1-cutA', '2x1-cutB', '2x1-cutC']],
  ['1x1', ['1x1-cutA', '1x1-cutB', '1x1-cutC']],
]) picks.forEach((p, i) =>
  jobs.push({ from: `${S3}/${len}/${p}.png`, name: `GG_Palisade_Straight_${len}_${'ABC'[i]}.png`, piece: 'straight', grid: len, variant: 'ABC'[i], rect: true }));
['half-cutA', 'half-cutB', 'half-cutC'].forEach((p, i) =>
  jobs.push({ from: `${S3}/half/${p}.png`, name: `GG_Palisade_Straight_Half_${'ABC'[i]}.png`, piece: 'straight', grid: '1x1', variant: 'ABC'[i], rect: true, embed: 200 }));
for (const [dir, name, piece, grid] of [
  ['corner-A', 'Corner_A_1x1', 'corner', '1x1'], ['corner-B', 'Corner_B_1x1', 'corner', '1x1'],
  ['corner-C', 'Corner_C_1x1', 'corner', '1x1'], ['corner-D', 'Corner_D_1x1', 'corner', '1x1'],
  ['corner-E', 'Corner_E_1x1', 'corner', '1x1'], ['corner-F', 'Corner_F_2x2', 'corner', '2x2'],
  ['corner-G', 'Corner_G_2x2', 'corner', '2x2'], ['corner-H', 'Corner_H_3x3', 'corner', '3x3'],
  ['joint-A', 'Joint_A_1x1', 'joint', '1x1'], ['joint-B', 'Joint_B_1x1', 'joint', '1x1'],
  ['joint-C', 'Joint_C_1x1', 'joint', '1x1'], ['joint-D', 'Joint_D_1x1', 'joint', '1x1'],
  ['connector-A', 'Connector_A_1x1', 'connector', '1x1'], ['connector-B', 'Connector_B_1x1', 'connector', '1x1'],
  ['diag', 'Connector_DIAG_A_1x1', 'connector', '1x1'], ['ending', 'Ending_A_1x1', 'ending', '1x1'],
  ['path', 'Straight_Path', 'path', '8x1'],
]) jobs.push({
  from: `${S4}/${dir}/${dir === 'path' ? 'path-comp' : dir + '-comp'}.png`,
  name: `GG_Palisade_${name}.png`, piece, grid,
  rect: piece === 'connector' || piece === 'path',
});

const manifest = [];
for (const j of jobs) {
  const dest = `${OUT}/${j.name}`;
  if (j.embed) {
    const meta = await sharp(j.from).metadata();
    await sharp({ create: { width: j.embed, height: j.embed, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: j.from, left: 0, top: 0 }]).png().toFile(dest);
    if (meta.width > j.embed || meta.height > j.embed) throw new Error(`embed too small for ${j.from}`);
  } else fs.copyFileSync(j.from, dest);

  const { data, w, h } = await loadRaw(dest);
  const entry = { file: j.name, piece: j.piece, gridSize: j.grid, naturalWidth: w, naturalHeight: h };
  if (j.variant) entry.variant = j.variant;
  if (j.rect) {
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    entry.contentRect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  manifest.push(entry);
}
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  set: 'GG_Palisade', family: 'wood', grid: 200, band: { h: 44, y: 78 },
  tint: 'runtime (grey master, multiplicative)', pieces: manifest,
}, null, 2));
console.log(`${manifest.length} pieces -> ${OUT} (+ manifest.json)`);
