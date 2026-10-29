// Mints the placeholder water textures into the bundled gg-forge pack.
//
//   node scripts/gen-water-placeholders.mjs
//
// The water tool samples two textures: a tiling surface (`water-still-a-01`) and a
// shoreline strip (`bank-grassy-01-a1`). Their real art is planned in the forge
// catalogue (forge/catalogue/water.json in map-goblin-forge) but has not been made
// yet, so this paints low-contrast stand-ins procedurally and folds them into
// canvas/public/packs/gg-forge through the same `integrate` + `index` steps a forge
// set uses. The entry keys are the catalogue's entryKeys, so final art integrated
// later replaces these entries in place and saved maps keep resolving.
//
// Both images tile with no seam: every wave and noise lattice uses a whole number of
// periods across the tile. The bank only has to tile along its length.

import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = join(ROOT, 'canvas', 'public', 'packs');
const PACK = 'gg-forge';
// sharp is a vault-engine dependency, not a root one.
const sharp = createRequire(join(ROOT, 'packages', 'vault-engine', 'package.json'))('sharp');

const CELL = 200; // px per grid cell, the pack convention
const TAU = Math.PI * 2;

// ─── Periodic value noise ────────────────────────────────────────────────────

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Value noise on a `cells`-wide lattice that wraps at the tile edge. */
function noise(u, v, cellsX, cellsY, seed) {
  const x = u * cellsX;
  const y = v * cellsY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wx = (n) => ((n % cellsX) + cellsX) % cellsX;
  const wy = (n) => ((n % cellsY) + cellsY) % cellsY;
  const a = hash(wx(x0), wy(y0), seed);
  const b = hash(wx(x0 + 1), wy(y0), seed);
  const c = hash(wx(x0), wy(y0 + 1), seed);
  const d = hash(wx(x0 + 1), wy(y0 + 1), seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function fbm(u, v, cellsX, cellsY, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(u, v, cellsX << o, cellsY << o, seed + o) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const mix = (a, b, t) => a + (b - a) * t;

// ─── Water surface ───────────────────────────────────────────────────────────

/**
 * A pale blue-grey with soft ripples. Kept light and near neutral: the renderer
 * multiplies it by the body's tint (default #9fc8e8), which supplies the colour.
 */
function waterSurface(size) {
  const px = Buffer.alloc(size * size * 4);
  // Whole wave counts across the tile, so the pattern wraps.
  const waves = [
    [3, 1, 0.0],
    [-2, 3, 1.7],
    [1, -4, 3.1],
    [5, 2, 4.4],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Domain warp by noise for organic ripples instead of straight bands.
      const warp = fbm(u, v, 4, 4, 11) * 1.4;
      let ripple = 0;
      for (const [kx, ky, ph] of waves) ripple += Math.sin(TAU * (kx * u + ky * v) + ph + warp * TAU * 0.35);
      ripple /= waves.length; // -1..1
      // Faint caustic glints: the crest of the ripple, sharpened.
      const glint = Math.pow(Math.max(0, ripple), 6);
      const body = fbm(u, v, 3, 3, 23, 3) - 0.5;
      const l = 205 + ripple * 7 + body * 12 + glint * 12;
      const i = (y * size + x) * 4;
      px[i] = clamp(l - 8);
      px[i + 1] = clamp(l - 2);
      px[i + 2] = clamp(l + 4);
      px[i + 3] = 255;
    }
  }
  return px;
}

// ─── Bank strip ──────────────────────────────────────────────────────────────

/**
 * A strip the renderer lays along the shoreline, row 0 on the shore line, running
 * left to right. Grass along the top fades into wet mud and pebbles, and the last
 * stretch fades out so the strip melts into the water instead of ending on a line.
 */
function bankStrip(w, h) {
  const px = Buffer.alloc(w * h * 4);
  const grass = [116, 128, 92];
  const grassDark = [92, 104, 76];
  const mud = [118, 104, 86];
  const wet = [96, 92, 84];
  const lenCells = w / CELL; // noise lattice periods along the strip
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      // Ragged grass line: where grass gives way to mud, wandering along the strip.
      const edge = 0.42 + (fbm(u, 0.5, 6 * lenCells, 1, 5, 3) - 0.5) * 0.28;
      const tuft = fbm(u, v, 24 * lenCells, 8, 9, 2);
      const grassAmt = 1 - smooth(Math.min(1, Math.max(0, (v - edge) / 0.12 + (tuft - 0.5) * 0.6)));
      const grain = fbm(u, v, 16 * lenCells, 16, 31, 3);
      const pebble = Math.pow(fbm(u, v, 40 * lenCells, 40, 47, 1), 5) * 2.2;
      const wetAmt = smooth(Math.min(1, Math.max(0, (v - 0.55) / 0.35)));
      const g = grass.map((c, k) => mix(grassDark[k], c, tuft) + (grain - 0.5) * 14);
      const m = mud.map((c, k) => mix(c, wet[k], wetAmt) + (grain - 0.5) * 12 + pebble * 26);
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) px[i + k] = clamp(mix(m[k], g[k], grassAmt));
      // Opaque through the grass and mud, fading over the last third into the water.
      const fade = 1 - smooth(Math.min(1, Math.max(0, (v - 0.66) / 0.34 + (grain - 0.5) * 0.25)));
      px[i + 3] = clamp(255 * fade);
    }
  }
  return px;
}

// ─── Mint ────────────────────────────────────────────────────────────────────

async function png(raw, width, height) {
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function bumpPatch(version) {
  const [a, b, c] = version.split('.').map(Number);
  return `${a}.${b}.${c + 1}`;
}

const work = mkdtempSync(join(tmpdir(), 'water-placeholders-'));
try {
  const setDir = join(work, 'water');
  mkdirSync(setDir);
  const SURFACE = 2 * CELL; // 2x2 cells
  const BANK_W = 2 * CELL; // 2x1 cells: the renderer scales the height to the bank width
  const BANK_H = CELL;
  writeFileSync(join(setDir, 'water-still.png'), await png(waterSurface(SURFACE), SURFACE, SURFACE));
  writeFileSync(join(setDir, 'bank-grassy.png'), await png(bankStrip(BANK_W, BANK_H), BANK_W, BANK_H));
  writeFileSync(
    join(setDir, 'manifest.json'),
    JSON.stringify({
      set: 'water',
      type: 'water',
      pieces: [
        { file: 'water-still.png', piece: 'surface', gridSize: '2x2', naturalWidth: SURFACE, naturalHeight: SURFACE, entryKey: 'water-still-a-01', tags: ['water', 'placeholder'] },
        { file: 'bank-grassy.png', piece: 'bank', gridSize: '2x1', naturalWidth: BANK_W, naturalHeight: BANK_H, entryKey: 'bank-grassy-01-a1', tags: ['bank', 'placeholder'] },
      ],
    }),
  );

  const base = join(PACKS, PACK);
  const manifestName = readdirSync(base).find((f) => /^pack-[0-9a-f]+\.json$/.test(f));
  const version = bumpPatch(JSON.parse(readFileSync(join(base, manifestName), 'utf-8')).version);
  const out = join(work, 'out');

  // One command string through the shell: pnpm is a .cmd shim on Windows.
  const quote = (a) => JSON.stringify(a.split('\\').join('/'));
  const cli = (...args) =>
    execSync(['pnpm --silent --filter @dnd/vault-cli cli', ...args.map(quote)].join(' '), {
      cwd: ROOT,
      stdio: 'inherit',
    });
  cli('integrate', '-b', base, '-s', setDir, '--pack-version', version, '-o', out);

  // Swap the rebuilt pack in, then rebuild the index the app reads at first boot.
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base);
  for (const f of readdirSync(join(out, PACK))) writeFileSync(join(base, f), readFileSync(join(out, PACK, f)));
  cli('index', '-d', PACKS);
  console.log(`${PACK} ${version}: water-still-a-01, bank-grassy-01-a1 (placeholders)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
