// Mints placeholder path materials into the bundled gg-forge pack.
//
//   node scripts/gen-path-placeholders.mjs
//
// The Path tool draws a strip along a ribbon, an edge strip outward from each side, a cap
// at cut ends, and for liquids a fill tile and a fall sprite. Their real art comes from the
// forge; until then this paints flat, muted stand-ins procedurally and folds them into
// canvas/public/packs/gg-forge through the same `integrate` + `index` steps a forge set
// uses. Each material is a set named after it (`road-dirt` → `gg-forge:road-dirt`) and its
// entry keys are `<material>-<piece>`, so final art integrated later replaces them in place.
//
// Every strip loops left to right with no seam: the noise lattice and the plank and cobble
// patterns use a whole number of periods along the strip. The fill tile wraps both ways.

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

// ─── Periodic value noise ────────────────────────────────────────────────────

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Value noise on a `cellsX` × `cellsY` lattice that wraps at the tile edge. */
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
const clamp01 = (n) => Math.max(0, Math.min(1, n));

// ─── Materials ───────────────────────────────────────────────────────────────

/**
 * The base colour and a surface pattern per material, as a function of (u, v) over the
 * strip (u wraps along its length, `cells` cells long). Returns a 0..1 shade multiplier.
 */
const MATERIALS = {
  'road-dirt': {
    rgb: [139, 107, 74],
    shade: (u, v, cells) => 0.86 + fbm(u, v, 3 * cells, 3, 11) * 0.24 + (fbm(u, v, 16 * cells, 16, 19, 2) - 0.5) * 0.1,
  },
  'road-cobble': {
    rgb: [138, 136, 130],
    shade: (u, v, cells) => {
      // Stones two to a cell, offset every other row; mortar is the gap between them.
      const x = u * cells * 2;
      const row = Math.floor(v * 4);
      const sx = x + (row % 2) * 0.5;
      const fx = sx - Math.floor(sx);
      const fy = v * 4 - row;
      const mortar = Math.min(fx, 1 - fx, fy * 0.5, (1 - fy) * 0.5) < 0.06 ? 0.62 : 1;
      return mortar * (0.85 + fbm(u, v, 8 * cells, 8, 23, 3) * 0.25);
    },
  },
  'trail-grass': {
    rgb: [127, 143, 90],
    shade: (u, v, cells) => {
      // Worn down the middle: the grass thins to earth where feet go.
      const wear = 1 - Math.abs(v - 0.5) * 2;
      const tuft = fbm(u, v, 20 * cells, 20, 31, 2);
      return 0.8 + tuft * 0.3 - wear * 0.12;
    },
  },
  planks: {
    rgb: [154, 115, 70],
    shade: (u, v, cells) => {
      // Boards across the strip, four to a cell, with a grain running along each.
      const x = u * cells * 4;
      const fx = x - Math.floor(x);
      const seam = fx < 0.05 ? 0.55 : 1;
      const grain = fbm(u, v, 2 * cells, 24, 41 + Math.floor(x), 2);
      return seam * (0.82 + grain * 0.3);
    },
  },
  water: {
    rgb: [93, 143, 168],
    // Deep in the middle, shallow toward the banks.
    shade: (u, v, cells) => 0.92 + (1 - Math.abs(v - 0.5) * 2) * -0.14 + (fbm(u, v, 4 * cells, 4, 53) - 0.5) * 0.12,
  },
};

function paint(w, h, cells, mat, alphaAt) {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const s = mat.shade(u, v, cells);
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) px[i + k] = clamp(mat.rgb[k] * s);
      px[i + 3] = clamp(255 * alphaAt(u, v));
    }
  }
  return px;
}

/** 4x1, looping left to right, opaque. */
const strip = (mat) => paint(4 * CELL, CELL, 4, mat, () => 1);

/** 2x1, row 0 against the ribbon: the inner half opaque, then a ragged fade outward. */
const edge = (mat) =>
  paint(2 * CELL, CELL, 2, mat, (u, v) => {
    const ragged = (fbm(u, 0.5, 12, 1, 61, 3) - 0.5) * 0.18;
    return 1 - smooth(clamp01((v - 0.5 + ragged) / 0.5));
  });

/** 1x1, the cap at a cut end: opaque at the left (the path), rounded off toward +U. */
const end = (mat) =>
  paint(CELL, CELL, 1, mat, (u, v) => {
    const r = Math.hypot(u, (v - 0.5) * 2);
    return 1 - smooth(clamp01((r - 0.75) / 0.25));
  });

/** 4x4, seamless both ways: the interior of a closed, filled path. */
function fill(mat) {
  const size = 4 * CELL;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const s = 0.8 + (fbm(u, v, 4, 4, 71) - 0.5) * 0.16;
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) px[i + k] = clamp(mat.rgb[k] * s);
      px[i + 3] = 255;
    }
  }
  return px;
}

/** 2x2, a white-blue fall: bright at the lip (top), foaming out at the foot. */
function fall() {
  const size = 2 * CELL;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const streak = fbm(u, 0.5, 16, 1, 83, 2);
      const t = clamp01(v * 0.8 + streak * 0.2);
      const i = (y * size + x) * 4;
      px[i] = clamp(235 - t * 90);
      px[i + 1] = clamp(245 - t * 70);
      px[i + 2] = clamp(255 - t * 40);
      px[i + 3] = clamp(255 * (1 - smooth(clamp01((v - 0.8) / 0.2)) * 0.6));
    }
  }
  return px;
}

// ─── Mint ────────────────────────────────────────────────────────────────────

async function png(raw, width, height) {
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function bumpMinor(version) {
  const [a, b] = version.split('.').map(Number);
  return `${a}.${b + 1}.0`;
}

const work = mkdtempSync(join(tmpdir(), 'path-placeholders-'));
try {
  const setDirs = [];
  const keys = [];
  for (const [name, mat] of Object.entries(MATERIALS)) {
    const setDir = join(work, name);
    mkdirSync(setDir);
    const pieces = [
      ['strip', '4x1', strip(mat), 4 * CELL, CELL],
      ['edge', '2x1', edge(mat), 2 * CELL, CELL],
      ['end', '1x1', end(mat), CELL, CELL],
    ];
    if (name === 'water') {
      pieces.push(['fill', '4x4', fill(mat), 4 * CELL, 4 * CELL]);
      pieces.push(['fall', '2x2', fall(), 2 * CELL, 2 * CELL]);
    }
    const manifestPieces = [];
    for (const [piece, gridSize, raw, w, h] of pieces) {
      const file = `${name}-${piece}.png`;
      writeFileSync(join(setDir, file), await png(raw, w, h));
      const entryKey = `${name}-${piece}`;
      keys.push(entryKey);
      manifestPieces.push({ file, piece, gridSize, naturalWidth: w, naturalHeight: h, entryKey, tags: ['path', 'placeholder'] });
    }
    writeFileSync(join(setDir, 'manifest.json'), JSON.stringify({ set: name, type: 'path', loose: true, pieces: manifestPieces }));
    setDirs.push(setDir);
  }

  const base = join(PACKS, PACK);
  const manifestName = readdirSync(base).find((f) => /^pack-[0-9a-f]+\.json$/.test(f));
  const version = bumpMinor(JSON.parse(readFileSync(join(base, manifestName), 'utf-8')).version);
  const out = join(work, 'out');

  // One command string through the shell: pnpm is a .cmd shim on Windows.
  const quote = (a) => JSON.stringify(a.split('\\').join('/'));
  const cli = (...args) =>
    execSync(['pnpm --silent --filter @dnd/vault-cli cli', ...args.map(quote)].join(' '), {
      cwd: ROOT,
      stdio: 'inherit',
    });
  cli('integrate', '-b', base, ...setDirs.flatMap((d) => ['-s', d]), '--pack-version', version, '-o', out);

  // Swap the rebuilt pack in, then rebuild the index the app reads at first boot.
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base);
  for (const f of readdirSync(join(out, PACK))) writeFileSync(join(base, f), readFileSync(join(out, PACK, f)));
  cli('index', '-d', PACKS);
  console.log(`${PACK} ${version}: ${keys.join(', ')} (placeholders)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
