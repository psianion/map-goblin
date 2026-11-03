// Folds the forge's GG_Cave_Ink build into the bundled gg-forge pack and copies its kit
// measurements over the core kit. Rerunnable: run it again whenever the forge rebuilds the set.
//
//   node scripts/integrate-cave-ink.mjs [--pack-version <semver>] [--forge <forge dir>]
//
// --pack-version defaults to the next patch of the installed gg-forge pack.
// --forge defaults to ../map-goblin-forge/forge. Reads dist/GG_Cave_Ink and
// staging/cave/kit-A/caveWallKit.json from it; the kit is copied over the core kit. The ink
// stairs need no STAIRS_CONTENT rect: their manifest entries carry the forge's contentRect.
// The rubble band pieces are tagged `prop` on the way in, so they place as plain assets.

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
for (const p of [SET, KIT]) if (!existsSync(p)) throw new Error(`missing ${p}`);

// One command string through the shell: pnpm is a .cmd shim on Windows.
const quote = (a) => JSON.stringify(a.split('\\').join('/'));
const cli = (...args) =>
  execSync(['pnpm --silent --filter @dnd/vault-cli cli', ...args.map(quote)].join(' '), { cwd: ROOT, stdio: 'inherit' });

const base = join(PACKS, PACK);
const work = mkdtempSync(join(tmpdir(), 'cave-ink-'));
try {
  const out = join(work, 'out');
  // The rubble band pieces are hand-placed props, not walked kit: tagged `prop` so the
  // catalogue lists them in the library and keeps them out of the band set.
  const set = join(work, 'GG_Cave_Ink');
  mkdirSync(set);
  for (const f of readdirSync(SET)) copyFileSync(join(SET, f), join(set, f));
  const manifest = JSON.parse(readFileSync(join(set, 'manifest.json'), 'utf8'));
  for (const p of manifest.pieces) {
    if (/^rubble(_|$)/.test(p.material) && !p.tags.includes('prop')) p.tags = [...p.tags, 'prop', 'rubble'];
  }
  writeFileSync(join(set, 'manifest.json'), JSON.stringify(manifest, null, 2));
  cli('integrate', '-b', base, '-s', set, '--pack-version', VERSION, '-o', out);
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
console.log(`${PACK} ${VERSION}: GG_Cave_Ink integrated, caveWallKit.json copied`);
