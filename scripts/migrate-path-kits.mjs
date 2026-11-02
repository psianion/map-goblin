// Rewrites the bundled gg-forge pack's path materials from strips to kits.
//
//   node scripts/migrate-path-kits.mjs [--pack <dir>] [--no-index]
//
// A path material used to be a set of `path` entries: a strip tiled along the path, an edge
// strip beside it and an end cap. It is now a kit: one `kit` entry per material set whose
// manifest names the pieces the material is built from (packages/vault-engine/src/types.ts
// `KitManifest`). This keeps every material id (`gg-forge:road-dirt`), so saved maps load as
// they were, and:
//
// - turns the road-dirt, road-cobble and trail-grass strips into their kits' fill tiles for
//   now (a forge round paints proper seamless fills), and keeps the water fill;
// - builds each kit's edge, cross, rail and band pieces from the round 4 units in
//   GG_Paths_Props (scripts/install-paths-round4.mjs installs them);
// - names the water fall as the water kit's `fall` piece;
// - removes every strip, edge and end entry, and the files only they used.
//
// Rerunnable: a pack with nothing left to migrate is left alone. Then rebuilds the pack
// index the app reads at first boot (vault-cli `index`) unless --no-index.

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = join(ROOT, 'canvas', 'public', 'packs');
const packArg = process.argv.indexOf('--pack');
const PACK_DIR = packArg > 0 ? process.argv[packArg + 1] : join(PACKS, 'gg-forge');

const PI = 3.14;
const unit = (item, variant, gridSize) => `${item}_${gridSize}_object_${variant}`;
const both = (item, gridSize, weight, spacing, jitter) =>
  ['A', 'B'].map((v) => ({ key: unit(item, v, gridSize), weight, spacing, jitter }));

/** Each material set's kit. Keys name entries of the same pack; absent ones are dropped. */
const KITS = {
  'road-dirt': {
    kind: 'surface',
    fill: 'road-dirt-fill',
    edge: [...both('dirt-grass-tuft', '1x1', 2, 1, 0.5), ...both('dirt-pebbles', '1x1', 3, 0.7, PI), ...both('dirt-puddle', '1x1', 0.5, 2.5, PI)],
  },
  'road-cobble': {
    kind: 'surface',
    fill: 'road-cobble-fill',
    edge: [...both('dirt-cobbles', '1x1', 3, 0.8, PI), ...both('dirt-flagstone', '1x1', 1, 1.2, 0.4)],
  },
  'trail-grass': {
    kind: 'surface',
    fill: 'trail-grass-fill',
    edge: [...both('dirt-grass-tuft', '1x1', 3, 0.8, 0.6), { key: unit('dirt-pebbles', 'A', '1x1'), weight: 1, spacing: 1.5, jitter: PI }],
  },
  planks: {
    kind: 'planks',
    cross: [
      ...['A', 'B'].map((v) => ({ key: unit('planks-plank', v, '2x1'), weight: 4 })),
      ...['A', 'B'].map((v) => ({ key: unit('planks-plank-broken', v, '2x1'), weight: 1 })),
    ],
    railPost: unit('planks-post', 'A', '1x1'),
    rope: { color: '#b08a52', width: 0.08 },
    end: unit('planks-plank-short', 'A', '1x1'),
  },
  water: {
    kind: 'surface',
    fill: 'water-fill',
    band: {
      straight: [unit('water-bank', 'A', '2x1'), unit('water-bank', 'B', '2x1'), unit('water-bank-long', 'A', '4x1'), unit('water-bank-long', 'B', '4x1')],
      bendDrawn: true,
    },
    edge: [...both('water-reeds', '1x1', 2, 1.5, 0.5), ...both('water-lily-pads', '1x1', 1, 2.5, PI), { key: unit('water-ripple', 'A', '1x1'), weight: 1, spacing: 3, jitter: PI }],
    fall: 'water-fall',
  },
};

/** The strips that stay on as their kit's fill tile until the forge paints real fills. */
const STRIP_TO_FILL = ['road-dirt', 'road-cobble', 'trail-grass'];
/** Strip-model pieces: a path entry of one of these piece types, or a floor's edge strip. */
const isStripPiece = (e) => (e.type === 'path' && ['strip', 'edge', 'end'].includes(e.pieceType)) || e.type === 'edge';

const filePrefix = (e) => `${e.material}_${e.gridSize}_${e.variant}-`;

const manifestName = readdirSync(PACK_DIR).find((f) => /^pack-[0-9a-f]+\.json$/.test(f));
if (!manifestName) throw new Error(`no pack-*.json in ${PACK_DIR}`);
const manifest = JSON.parse(readFileSync(join(PACK_DIR, manifestName), 'utf8'));
const entries = { ...manifest.entries };
const files = { ...manifest.files };
const renames = [];

// The strips that become fills: same image, renamed to `<set>-fill`.
for (const set of STRIP_TO_FILL) {
  const strip = entries[`${set}-strip`];
  if (!strip) continue;
  const fill = { ...strip, material: `${set}-fill`, pieceType: 'fill' };
  for (const f of Object.keys(files).filter((name) => name.startsWith(filePrefix(strip)))) {
    const to = filePrefix(fill) + f.slice(filePrefix(strip).length);
    files[to] = files[f];
    delete files[f];
    renames.push([f, to]);
  }
  delete entries[`${set}-strip`];
  entries[`${set}-fill`] = fill;
}

const removed = Object.keys(entries).filter((k) => isStripPiece(entries[k]));
for (const k of removed) delete entries[k];

// One kit per material set, its pieces limited to those the pack has.
const missing = [];
for (const [set, kit] of Object.entries(KITS)) {
  const has = (key) => {
    if (entries[key]) return true;
    missing.push(`${set}: ${key}`);
    return false;
  };
  const out = { kind: kit.kind };
  if (kit.fill && has(kit.fill)) out.fill = kit.fill;
  const edge = (kit.edge ?? []).filter((u) => has(u.key));
  if (edge.length) out.edge = edge;
  const cross = (kit.cross ?? []).filter((u) => has(u.key));
  if (cross.length) out.cross = cross;
  if (kit.railPost && has(kit.railPost)) out.railPost = kit.railPost;
  if (kit.rope) out.rope = kit.rope;
  const straight = (kit.band?.straight ?? []).filter(has);
  if (straight.length) out.band = { straight, bendDrawn: true };
  if (kit.end && has(kit.end)) out.end = kit.end;
  if (kit.fall && has(kit.fall)) out.fall = kit.fall;
  entries[`${set}-kit`] = { type: 'kit', material: set, gridSize: '1x1', pieceType: 'kit', variant: 'A', set, tags: ['path', 'kit'], kit: out };
}

const before = JSON.stringify(manifest.entries);
if (JSON.stringify(entries) === before && renames.length === 0) {
  console.log(`${manifest.name} ${manifest.version}: nothing to migrate`);
  process.exit(0);
}

// Files no entry needs any more.
const needed = new Set();
for (const e of Object.values(entries)) {
  if (e.atlas) continue;
  for (const f of Object.keys(files)) if (f.startsWith(filePrefix(e))) needed.add(f);
}
const dropped = Object.keys(files).filter((f) => !needed.has(f));
for (const f of dropped) delete files[f];

const [major, minor] = manifest.version.split('.').map(Number);
const next = { ...manifest, version: `${major}.${minor + 1}.0`, entries, files };
next.bundleSize =
  Object.values(next.files).reduce((s, r) => s + r.size, 0) + Object.values(next.atlases).reduce((s, r) => s + r.size, 0);
const json = JSON.stringify(next, null, 2);
const name = `pack-${createHash('sha256').update(Buffer.from(json)).digest('hex').slice(0, 8)}.json`;

for (const [from, to] of renames) renameSync(join(PACK_DIR, from), join(PACK_DIR, to));
for (const f of dropped) rmSync(join(PACK_DIR, f), { force: true });
writeFileSync(join(PACK_DIR, name), json);
if (name !== manifestName) rmSync(join(PACK_DIR, manifestName));

console.log(`${manifest.name} ${next.version}: ${Object.keys(KITS).length} kits; removed ${removed.join(', ') || 'nothing'}; dropped ${dropped.length} files`);
if (missing.length) console.log(`pieces not in the pack, left out of their kits: ${missing.join('; ')}`);

if (!process.argv.includes('--no-index')) {
  // One command string through the shell: pnpm is a .cmd shim on Windows.
  execSync(`pnpm --silent --filter @dnd/vault-cli cli index -d ${JSON.stringify(PACKS.split('\\').join('/'))}`, { cwd: ROOT, stdio: 'inherit' });
}
