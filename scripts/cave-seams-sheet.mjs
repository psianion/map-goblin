// Before/after sheet of the cave band's seams on the fixture outlines the cave tests use.
//
//   node scripts/cave-seams-sheet.mjs [--before <rev>] [--out <dir>]
//
// Lays each outline twice with the cave ink band kit: once with caveWalk.ts and
// caveBandRenderer.ts as they stand at <rev> (default HEAD), once with the working tree.
// Every piece is drawn from its own art at its placed size and turn; each joint bandHoles
// reports (the working tree's gate, for both) is ringed in red. Writes before.png, after.png and sheet.png (the two stacked)
// to <out> (default forge/staging/cave-seams, which git ignores).

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = join(ROOT, 'packages', 'core', 'src', 'engine');
const PACK = join(ROOT, 'canvas', 'public', 'packs', 'gg-forge');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const REV = arg('--before', 'HEAD');
const OUT = arg('--out', join(ROOT, 'forge', 'staging', 'cave-seams'));

// esbuild and sharp come in with the workspace's own tools (vitest's vite, vault-engine).
const fromCore = createRequire(join(ROOT, 'packages', 'core', 'package.json'));
const esbuild = createRequire(createRequire(fromCore.resolve('vitest/package.json')).resolve('vite'))('esbuild');
const sharp = createRequire(join(ROOT, 'packages', 'vault-engine', 'package.json'))('sharp');

const square = (s) => [[0, 0], [s, 0], [s, s], [0, s]];
const circle = (r) =>
  Array.from({ length: 64 }, (_, i) => [r * Math.cos((i / 64) * 2 * Math.PI), r * Math.sin((i / 64) * 2 * Math.PI)]);
const OUTLINES = [
  ['4x4', square(4)],
  ['10x4', [[0, 0], [10, 0], [10, 4], [0, 4]]],
  ['L', [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]]],
  ['circle 3', circle(3)],
  ['circle 6', circle(6)],
];

const tsFile = (base) => [base + '.ts', base + '.tsx', join(base, 'index.ts')].find((p) => existsSync(p)) ?? base;

/** Bundle the band layer from `walk` and `renderer` sources into one runnable module. */
async function bandModule(dir, walk, renderer) {
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    [
      `import { layBandRing, orientRings } from ${JSON.stringify(renderer)};`,
      // Both judged by the same gate: the working tree's.
      `import { bandHoles } from ${JSON.stringify(join(ENGINE, 'caveWalk.ts'))};`,
      `import { caveBandPieces } from ${JSON.stringify(join(ROOT, 'packages', 'core', 'src', 'assets', 'caveWallKit.ts'))};`,
      'export function lay(ring) {',
      '  const placed = layBandRing(orientRings([ring])[0], [], caveBandPieces());',
      '  return { placed, holes: bandHoles(placed, true) };',
      '}',
    ].join('\n'),
  );
  const copies = new Map([
    ['./caveWalk', walk],
    ['./caveBandRenderer', renderer],
  ]);
  const out = join(dir, 'band.mjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    logLevel: 'error',
    plugins: [
      {
        name: 'band-sources',
        setup(build) {
          // Only the band's own geometry runs here: Pixi stands in as empty classes.
          build.onResolve({ filter: /^pixi\.js$/ }, () => ({ path: 'pixi', namespace: 'stub' }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'module.exports = new Proxy({}, { get: (_, k) => (k === "__esModule" ? false : class {}) });',
            loader: 'js',
          }));
          // A copied source imports its neighbours from the real engine folder, and the
          // band's two files from the copies.
          build.onResolve({ filter: /^\./ }, (a) => {
            if (!a.importer.startsWith(dir)) return undefined;
            if (copies.has(a.path)) return { path: copies.get(a.path) };
            return { path: tsFile(join(ENGINE, a.path)) };
          });
        },
      },
    ],
  });
  return import(pathToFileURL(out).href + `?v=${Date.now()}`);
}

/** The art file for a kit key, as the pack ships it. */
const files = readdirSync(PACK);
const artOf = (key) => files.find((f) => f.startsWith(`${key}_A-`) && f.endsWith('.webp'));
const art = new Map();
async function artUri(key) {
  if (!art.has(key)) {
    const file = artOf(key);
    const img = sharp(join(PACK, file));
    const { width, height } = await img.metadata();
    const png = await img.png().toBuffer();
    art.set(key, { uri: `data:image/png;base64,${png.toString('base64')}`, width, height });
  }
  return art.get(key);
}

const PX = 48;
const PAD = 2;

/** One row of the sheet: every outline laid, floor pale, void dark, holes ringed. */
async function row(lay, title) {
  let x = PAD;
  const parts = [];
  let height = 0;
  let total = 0;
  for (const [name, ring] of OUTLINES) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
    const w = Math.max(...xs) - x0;
    const h = Math.max(...ys) - y0;
    const { placed, holes } = lay(ring);
    total += holes.length;
    const dx = x - x0;
    const dy = PAD + 1 - y0;
    const g = [`<g transform="translate(${dx} ${dy})">`];
    g.push(`<polygon points="${ring.map((p) => p.join(',')).join(' ')}" fill="#d9cdb4"/>`);
    for (const pl of placed) {
      const a = await artUri(pl.piece.key);
      const s = pl.at.scale / 200;
      const deg = (pl.at.rotation * 180) / Math.PI;
      g.push(
        `<g transform="translate(${pl.at.position.x} ${pl.at.position.y}) rotate(${deg}) scale(${s} ${pl.at.flipY ? -s : s})">` +
          `<image href="${a.uri}" x="${-a.width / 2}" y="${-a.height / 2}" width="${a.width}" height="${a.height}"/></g>`,
      );
    }
    for (const hole of holes) {
      const [hx, hy] = hole.at.split(',').map(Number);
      g.push(`<circle cx="${hx}" cy="${hy}" r="0.45" fill="none" stroke="#e0302a" stroke-width="0.12"/>`);
    }
    g.push(`<text x="${x0}" y="${y0 + h + 1.6}" font-size="0.7" fill="#f2efe8" font-family="sans-serif">${name}: ${placed.length} pieces, ${holes.length} holes</text>`);
    g.push('</g>');
    parts.push(g.join(''));
    x += w + PAD * 2;
    height = Math.max(height, h + PAD * 2 + 2);
  }
  const width = x;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * PX}" height="${(height + 1) * PX}" viewBox="0 0 ${width} ${height + 1}">` +
    `<rect width="100%" height="100%" fill="#1d1b19"/>` +
    `<text x="${PAD}" y="1" font-size="0.8" fill="#f2efe8" font-family="sans-serif">${title}: ${total} holes</text>` +
    parts.join('') +
    '</svg>';
  return { png: await sharp(Buffer.from(svg)).png().toBuffer(), total };
}

const work = mkdtempSync(join(tmpdir(), 'cave-seams-'));
try {
  const before = join(work, 'before');
  mkdirSync(before);
  for (const f of ['caveWalk.ts', 'caveBandRenderer.ts']) {
    writeFileSync(join(before, f), execSync(`git show ${REV}:packages/core/src/engine/${f}`, { cwd: ROOT }));
  }
  const after = join(work, 'after');
  mkdirSync(after);
  const was = await bandModule(before, join(before, 'caveWalk.ts'), join(before, 'caveBandRenderer.ts'));
  const now = await bandModule(after, join(ENGINE, 'caveWalk.ts'), join(ENGINE, 'caveBandRenderer.ts'));
  mkdirSync(OUT, { recursive: true });
  const a = await row(was.lay, `before (${REV})`);
  const b = await row(now.lay, 'after (working tree)');
  writeFileSync(join(OUT, 'before.png'), a.png);
  writeFileSync(join(OUT, 'after.png'), b.png);
  const [ma, mb] = [await sharp(a.png).metadata(), await sharp(b.png).metadata()];
  const sheet = await sharp({
    create: { width: Math.max(ma.width, mb.width), height: ma.height + mb.height, channels: 4, background: '#1d1b19' },
  })
    .composite([
      { input: a.png, top: 0, left: 0 },
      { input: b.png, top: ma.height, left: 0 },
    ])
    .png()
    .toBuffer();
  writeFileSync(join(OUT, 'sheet.png'), sheet);
  console.log(`holes before ${a.total}, after ${b.total}; wrote ${join(OUT, 'sheet.png')}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
