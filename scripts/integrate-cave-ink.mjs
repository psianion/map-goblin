// Folds the forge's GG_Cave_Ink build into the bundled gg-forge pack and copies its kit
// measurements over the core kit. Rerunnable: run it again whenever the forge rebuilds the set.
//
//   node scripts/integrate-cave-ink.mjs [--pack-version <semver>] [--forge <forge dir>]
//
// --pack-version defaults to the next patch of the installed gg-forge pack.
// --forge defaults to ../map-goblin-forge/forge. Reads dist/GG_Cave_Ink,
// staging/cave/kit-A/caveWallKit.json and staging/cave/geometry.json from it: the kit is
// copied over the core kit, and each ledge piece's drawn ridge (the line's centre, every
// RIDGE_STEP cell, in cells from the sprite's centre) is written to caveLedgeRidge.json, so
// the slivers under a cliff root on the line where it wanders. The ink stairs need no
// STAIRS_CONTENT rect: their manifest entries carry the forge's contentRect.

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = join(ROOT, 'canvas', 'public', 'packs');
const PACK = 'gg-forge';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const FORGE = arg('--forge', join(ROOT, '..', 'map-goblin-forge', 'forge'));
// The next patch of the installed pack: the bump is what makes returning browsers reinstall it.
const installed = JSON.parse(
  readFileSync(join(PACKS, PACK, readdirSync(join(PACKS, PACK)).find((f) => /^pack-[0-9a-f]+\.json$/.test(f))), 'utf8'),
).version.split('.');
const VERSION = arg('--pack-version', `${installed[0]}.${installed[1]}.${Number(installed[2]) + 1}`);
const SET = join(FORGE, 'dist', 'GG_Cave_Ink');
const KIT = join(FORGE, 'staging', 'cave', 'kit-A', 'caveWallKit.json');
const GEOMETRY = join(FORGE, 'staging', 'cave', 'geometry.json');
const RIDGE_STEP = 0.1;
for (const p of [SET, KIT, GEOMETRY]) if (!existsSync(p)) throw new Error(`missing ${p}`);

// One command string through the shell: pnpm is a .cmd shim on Windows.
const quote = (a) => JSON.stringify(a.split('\\').join('/'));
const cli = (...args) =>
  execSync(['pnpm --silent --filter @dnd/vault-cli cli', ...args.map(quote)].join(' '), { cwd: ROOT, stdio: 'inherit' });

const base = join(PACKS, PACK);
const work = mkdtempSync(join(tmpdir(), 'cave-ink-'));
try {
  const out = join(work, 'out');
  cli('integrate', '-b', base, '-s', SET, '--pack-version', VERSION, '-o', out);
  // Swap the rebuilt pack in, then rebuild the index the app reads at first boot.
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base);
  for (const f of readdirSync(join(out, PACK))) writeFileSync(join(base, f), readFileSync(join(out, PACK, f)));
  cli('index', '-d', PACKS);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const ASSETS = join(ROOT, 'packages', 'core', 'src', 'assets');
copyFileSync(KIT, join(ASSETS, 'caveWallKit.json'));
const ridges = {};
for (const [id, g] of Object.entries(JSON.parse(readFileSync(GEOMETRY, 'utf8')))) {
  const key = g.kit?.key;
  if (!key || !Array.isArray(g.ridge) || !/^ledge_(?!end_)/.test(key)) continue;
  const pts = [];
  let next = 0;
  for (const r of g.ridge) {
    if (r.s + 1e-9 < next && r !== g.ridge[g.ridge.length - 1]) continue;
    pts.push(r.p.map((v) => Math.round(v * 1000) / 1000));
    next = r.s + RIDGE_STEP;
  }
  ridges[key] = pts;
  if (!id.endsWith('/A')) throw new Error(`unexpected variant ${id}`);
}
const lines = Object.entries(ridges).map(([key, pts]) => `  ${JSON.stringify(key)}: ${JSON.stringify(pts)}`);
writeFileSync(join(ASSETS, 'caveLedgeRidge.json'), `{\n${lines.join(',\n')}\n}\n`);
console.log(`${PACK} ${VERSION}: GG_Cave_Ink integrated, caveWallKit.json copied, ${Object.keys(ridges).length} ledge ridges written`);
