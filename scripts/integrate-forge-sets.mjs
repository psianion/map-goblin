// Folds forge-built sets into the bundled gg-forge pack. Rerunnable: run it again whenever
// the forge rebuilds a set.
//
//   node scripts/integrate-forge-sets.mjs <set> [<set> ...] [--pack-version <semver>] [--forge <forge dir>]
//
// Each <set> is a folder under the forge's dist/ (GG_Wild_Ground, GG_Wild_Ink).
// --pack-version defaults to the next patch of the installed gg-forge pack.
// --forge defaults to ../map-goblin-forge/forge.
// Sets with kit measurements (the cave band) go through integrate-cave-ink.mjs instead.

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = join(ROOT, 'canvas', 'public', 'packs');
const PACK = 'gg-forge';
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const FORGE = flag('--forge', join(ROOT, '..', 'map-goblin-forge', 'forge'));
const base = join(PACKS, PACK);
const baseFile = readdirSync(base).find((f) => /^pack-[0-9a-f]+\.json$/.test(f));
const pack = JSON.parse(readFileSync(join(base, baseFile), 'utf8'));
// The next patch of the installed pack: the bump is what makes returning browsers reinstall it.
const installed = pack.version.split('.');
const VERSION = flag('--pack-version', `${installed[0]}.${installed[1]}.${Number(installed[2]) + 1}`);
const sets = args;
if (sets.length === 0) throw new Error('name at least one set, e.g. GG_Wild_Ground');
for (const s of sets) if (!existsSync(join(FORGE, 'dist', s, 'manifest.json'))) throw new Error(`missing ${join(FORGE, 'dist', s)}`);

// One command string through the shell: pnpm is a .cmd shim on Windows.
const quote = (a) => JSON.stringify(a.split('\\').join('/'));
const cli = (...a) =>
  execSync(['pnpm --silent --filter @dnd/vault-cli cli', ...a.map(quote)].join(' '), { cwd: ROOT, stdio: 'inherit' });

const work = mkdtempSync(join(tmpdir(), 'forge-sets-'));
try {
  // `integrate` only adds and replaces, so a piece the forge dropped from a set would stay in
  // the pack: integrate onto a copy of the pack without those sets' pieces the build no longer has.
  const gone = new Set();
  for (const s of sets) {
    const manifest = JSON.parse(readFileSync(join(FORGE, 'dist', s, 'manifest.json'), 'utf8'));
    const kept = new Set(manifest.pieces.map((p) => `${p.material}_${p.gridSize}_${p.variant}`));
    for (const [key, e] of Object.entries(pack.entries)) {
      const id = `${e.material}_${e.gridSize}_${e.variant}`;
      if (e.set !== s || kept.has(id)) continue;
      delete pack.entries[key];
      for (const f of Object.keys(pack.files)) if (f.startsWith(`${id}-`)) gone.add(f);
    }
  }
  for (const f of gone) delete pack.files[f];
  const pruned = join(work, 'base');
  mkdirSync(pruned);
  for (const f of readdirSync(base)) if (f !== baseFile && !gone.has(f)) copyFileSync(join(base, f), join(pruned, f));
  writeFileSync(join(pruned, baseFile), JSON.stringify(pack, null, 2));
  if (gone.size > 0) console.log(`dropped from the pack: ${[...gone].join(', ')}`);

  const out = join(work, 'out');
  cli('integrate', '-b', pruned, ...sets.flatMap((s) => ['-s', join(FORGE, 'dist', s)]), '--pack-version', VERSION, '-o', out);
  // Swap the rebuilt pack in, then rebuild the index the app reads at first boot.
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base);
  for (const f of readdirSync(join(out, PACK))) writeFileSync(join(base, f), readFileSync(join(out, PACK, f)));
  cli('index', '-d', PACKS);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`${PACK} ${VERSION}: ${sets.join(', ')} integrated`);
