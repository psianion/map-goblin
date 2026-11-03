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
// - lays edge units at half their painted size (the kit's `scale`), spaced to cover about a
//   third of their verge, and the water bank at its own size;
// - gives kits their attached objects: trees (gg-demo's) along the dirt road's verge, reeds
//   on a shore and lily pads on the water (moved off the water's edge units);
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
/** Attached objects of both variants of an item, on `side` of the outline. */
const objects = (item, gridSize, weight, spacing, jitter, side) => both(item, gridSize, weight, spacing, jitter).map((o) => ({ ...o, side }));

/** Each material set's kit. Keys name entries of the same pack; absent ones are dropped. */
const KITS = {
  'road-dirt': {
    kind: 'surface',
    fill: 'road-dirt-fill',
    scale: 0.5,
    edge: [...both('dirt-grass-tuft', '1x1', 2, 0.7, 0.5), ...both('dirt-pebbles', '1x1', 3, 0.6, PI), ...both('dirt-puddle', '1x1', 0.5, 1.5, PI)],
    objects: ['tree_small_1_3x3_object_A', 'tree_small_2_3x3_object_A'].map((key) => ({ key: `gg-demo:${key}`, weight: 1, spacing: 5, jitter: PI, side: 1 })),
  },
  'road-cobble': {
    kind: 'surface',
    fill: 'road-cobble-fill',
    scale: 0.5,
    edge: [...both('dirt-cobbles', '1x1', 3, 0.65, PI), ...both('dirt-flagstone', '1x1', 1, 0.8, 0.4)],
  },
  'trail-grass': {
    kind: 'surface',
    fill: 'trail-grass-fill',
    scale: 0.5,
    edge: [...both('dirt-grass-tuft', '1x1', 3, 0.65, 0.6), { key: unit('dirt-pebbles', 'A', '1x1'), weight: 1, spacing: 1, jitter: PI }],
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
      scale: 1,
    },
    scale: 0.5,
    edge: [{ key: unit('water-ripple', 'A', '1x1'), weight: 1, spacing: 3, jitter: PI }],
    objects: [...objects('water-reeds', '1x1', 2, 2.5, 0.5, 0), ...objects('water-lily-pads', '1x1', 1, 3.5, PI, -1)],
    fall: 'water-fall',
  },
};

/** The strips that stay on as their kit's fill tile until the forge paints real fills. */
const STRIP_TO_FILL = ['road-dirt', 'road-cobble', 'trail-grass'];
/** Strip-model pieces: a path entry of one of these piece types, or a floor's edge strip. */
const isStripPiece = (e) => (e.type === 'path' && ['strip', 'edge', 'end'].includes(e.pieceType)) || e.type === 'edge';

const filePrefix = (e) => `${e.material}_${e.gridSize}_${e.variant}-`;

/** Whether `<packId>:<entry>` names an entry of another installed pack. */
function otherPackHas(key) {
  const [packId, entry] = key.split(':');
  const dir = join(PACKS, packId);
  const name = readdirSync(dir).find((f) => /^pack-[0-9a-f]+\.json$/.test(f));
  return !!name && !!JSON.parse(readFileSync(join(dir, name), 'utf8')).entries[entry];
}

const manifestName =readdirSync(PACK_DIR).find((f) => /^pack-[0-9a-f]+\.json$/.test(f));
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
    if (key.includes(':') ? otherPackHas(key) : entries[key]) return true;
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
  if (straight.length) out.band = { straight, bendDrawn: true, ...(kit.band.scale ? { scale: kit.band.scale } : {}) };
  if (kit.end && has(kit.end)) out.end = kit.end;
  if (kit.fall && has(kit.fall)) out.fall = kit.fall;
  if (kit.scale) out.scale = kit.scale;
  const objs = (kit.objects ?? []).filter((o) => has(o.key));
  if (objs.length) out.objects = objs;
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
