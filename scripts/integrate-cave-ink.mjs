// Folds the forge's GG_Cave_Ink build into the bundled gg-forge pack and copies its kit
// measurements over the core kit. Rerunnable: run it again whenever the forge rebuilds the set.
//
//   node scripts/integrate-cave-ink.mjs [--pack-version <semver>] [--forge <forge dir>]
//
// --pack-version defaults to 1.16.0 for the first run; pass the next patch on a re-run.
// --forge defaults to ../map-goblin-forge/forge. Reads dist/GG_Cave_Ink and
// staging/cave/kit-A/caveWallKit.json from it. STAIRS_CONTENT (stairsArt.ts) is copied by
// hand from staging/cave-props/stairs-content.json when the stairs change.

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
const VERSION = arg('--pack-version', '1.16.0');
const SET = join(FORGE, 'dist', 'GG_Cave_Ink');
const KIT = join(FORGE, 'staging', 'cave', 'kit-A', 'caveWallKit.json');
for (const p of [SET, KIT]) if (!existsSync(p)) throw new Error(`missing ${p}`);

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

copyFileSync(KIT, join(ROOT, 'packages', 'core', 'src', 'assets', 'caveWallKit.json'));
console.log(`${PACK} ${VERSION}: GG_Cave_Ink integrated, caveWallKit.json copied`);
