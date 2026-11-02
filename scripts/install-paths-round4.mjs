// Installs the approved round 4 path art into the bundled gg-forge pack.
//
//   node scripts/install-paths-round4.mjs [--src <round4 cut dir>]
//
// The forge cut each round 4 item as a loose piece on transparency (200 px per cell). This
// fits them to the path piece format (forge/briefs/paths-and-plateaus.md sections 1 and 2)
// under the placeholders' entry keys (the placeholder script is gone), so they replace them in
// place, and folds the scatter pieces in as objects under GG_Paths_Props. Same
// `integrate` + `index` steps as a forge set. Rerunnable: every run rebuilds
// from the cut art and bumps the pack's minor version.
//
// Kept as placeholders: water-strip, water-fill, water-fall (no round 4 art), the cobble
// and grass trails, and the cliff (the ink ledge stays).

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = join(ROOT, 'canvas', 'public', 'packs');
const PACK = 'gg-forge';
const sharp = createRequire(join(ROOT, 'packages', 'vault-engine', 'package.json'))('sharp');

const srcArg = process.argv.indexOf('--src');
const SRC =
  srcArg > 0 ? process.argv[srcArg + 1] : join(ROOT, '..', 'map-goblin-forge', 'forge', 'staging', 'paths-plateaus', 'round4', 'cut');
const CELL = 200;

/** The cut file for `<item>/<variant>`, optionally a given seed. */
function cut(item, variant, seed) {
  const prefix = `paths-plateaus-r4__${item}__${variant}-`;
  const hits = readdirSync(SRC).filter((f) => f.startsWith(prefix) && (!seed || f.endsWith(`-s${seed}.png`)));
  if (!hits.length) throw new Error(`no cut piece for ${item}/${variant}${seed ? ` seed ${seed}` : ''} in ${SRC}`);
  return join(SRC, hits[0]);
}

async function raw(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const toPng = (img) => sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer();

/** Rows where at least 97% of the width is opaque: the solid band of a cut strip piece. */
function solidRows(img) {
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < img.h; y++) {
    let o = 0;
    for (let x = 0; x < img.w; x++) if (img.data[(y * img.w + x) * 4 + 3] > 200) o++;
    if (o / img.w > 0.97) {
      if (y0 < 0) y0 = y;
      y1 = y;
    }
  }
  return { top: y0, height: y1 - y0 + 1 };
}

/** The band of a strip piece, cropped to its solid rows and resized to w × h. */
async function band(file, w, h, { flip = false } = {}) {
  const img = await raw(file);
  const r = solidRows(img);
  let buf = await sharp(file).extract({ left: 0, top: r.top, width: img.w, height: r.height }).png().toBuffer();
  if (flip) buf = await sharp(buf).flip().png().toBuffer();
  return raw(await sharp(buf).resize(w, h, { fit: 'fill' }).png().toBuffer());
}

/**
 * Lays `segs` (each `period + overlap` wide, same height) end to end every `period` px and
 * wraps the last into the first, cross-fading `overlap` px at every join: a strip that loops.
 */
function loopStrip(segs, period, overlap) {
  const W = period * segs.length;
  const H = segs[0].h;
  const acc = new Float64Array(W * H * 4);
  const wsum = new Float64Array(W * H);
  segs.forEach((s, k) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < s.w; x++) {
        const wgt = Math.max(1e-3, Math.min(1, (x + 0.5) / overlap, (s.w - x - 0.5) / overlap));
        const X = (k * period + x) % W;
        const i = (y * s.w + x) * 4;
        const o = y * W + X;
        for (let c = 0; c < 4; c++) acc[o * 4 + c] += s.data[i + c] * wgt;
        wsum[o] += wgt;
      }
  });
  const data = Buffer.alloc(W * H * 4);
  for (let o = 0; o < W * H; o++) for (let c = 0; c < 4; c++) data[o * 4 + c] = Math.round(acc[o * 4 + c] / wsum[o]);
  return { data, w: W, h: H };
}

/** Mean RGB difference across each join of `segs` laid end to end (and the wrap), before any fade. */
function seamCost(segs) {
  let sum = 0;
  let n = 0;
  for (let k = 0; k < segs.length; k++) {
    const a = segs[k];
    const b = segs[(k + 1) % segs.length];
    for (let y = 0; y < a.h; y++)
      for (let c = 0; c < 3; c++) {
        sum += Math.abs(a.data[(y * a.w + a.w - 1) * 4 + c] - b.data[y * b.w * 4 + c]);
        n++;
      }
  }
  return sum / n;
}

const opaque = (img) => {
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  return img;
};

/** Multiplies alpha down to 0 between row `from` and the bottom row, ragged along x. */
function fadeDown(img, from) {
  for (let y = from; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const u = x / img.w;
      const ragged = Math.sin(u * Math.PI * 2 * 7) * 0.08 + Math.sin(u * Math.PI * 2 * 3 + 1) * 0.06;
      const t = Math.max(0, Math.min(1, (y - from) / (img.h - 1 - from) + ragged));
      const k = y === img.h - 1 ? 0 : 1 - t * t * (3 - 2 * t);
      const i = (y * img.w + x) * 4 + 3;
      img.data[i] = Math.round(img.data[i] * k);
    }
  return img;
}

/** Composites `layers` onto a transparent w × h canvas. */
async function onCanvas(w, h, layers) {
  return raw(
    await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(layers)
      .png()
      .toBuffer(),
  );
}

const trimmed = async (file) => sharp(await sharp(file).trim({ threshold: 1 }).png().toBuffer());

// ─── Path pieces ─────────────────────────────────────────────────────────────

async function roadDirtStrip() {
  const o = Math.round(4 * CELL * 0.05); // 5% cross-fade
  // Candidate 1: the two rut strips, bands stretched to the full height, end to end.
  const ruts = [await band(cut('dirt-ruts', 'A'), 2 * CELL + o, CELL), await band(cut('dirt-ruts', 'B'), 2 * CELL + o, CELL)];
  // Candidate 2: the flat floor inside each dirt patch's rim, widened to a cell, A B A' B'.
  const patch = [];
  for (const [v, flop] of [['A', false], ['B', false], ['A', true], ['B', true]]) {
    let buf = await sharp(cut('dirt-patch', v))
      .extract({ left: 135, top: 135, width: 130, height: 130 })
      .resize(CELL + o, CELL, { fit: 'fill' })
      .png()
      .toBuffer();
    if (flop) buf = await sharp(buf).flop().png().toBuffer();
    patch.push(await raw(buf));
  }
  const costs = { ruts: seamCost(ruts), patch: seamCost(patch) };
  const pick = costs.ruts <= costs.patch ? 'ruts' : 'patch';
  const segs = pick === 'ruts' ? ruts : patch;
  console.log(`road-dirt-strip: seam ruts ${costs.ruts.toFixed(1)}, patch ${costs.patch.toFixed(1)} -> ${pick}`);
  return opaque(loopStrip(segs, (4 * CELL) / segs.length, o));
}

async function roadDirtEdge() {
  // The verge has grass on top; flip it so the dirt meets the road and the grass lies outward.
  const o = Math.round(2 * CELL * 0.05);
  const v = await band(cut('dirt-verge', 'A'), 2 * CELL + o, CELL, { flip: true });
  return fadeDown(opaque(loopStrip([v], 2 * CELL, o)), Math.round(CELL * 0.6));
}

async function roadDirtEnd() {
  // The right half of the small patch, widened to the cell: its cut through the middle is the
  // opaque left edge, its rounded rim the cap.
  const f = cut('dirt-patch-small', 'A');
  return raw(
    await sharp(f).extract({ left: CELL / 2, top: 0, width: CELL / 2, height: CELL }).resize(CELL, CELL, { fit: 'fill' }).png().toBuffer(),
  );
}

async function planksStrip() {
  // Boards run across the bridge. Trim the pair to its boards, fill a 2x1, and close the
  // gaps between boards with a dark under-shadow so the strip is opaque; two of them make 4x1.
  const pair = await (await trimmed(cut('planks-plank-pair', 'A'))).resize(2 * CELL, CELL, { fit: 'fill' }).png().toBuffer();
  const flat = await sharp(pair).flatten({ background: '#2e1f12' }).ensureAlpha().png().toBuffer();
  return raw(await sharp(flat).extend({ right: 2 * CELL, extendWith: 'repeat' }).png().toBuffer());
}

async function planksEdge() {
  // A rope rail: half a post at each end (adjacent tiles join them into one post), a rope
  // between, a soft shadow below fading outward. Drawn twice as tall as it reads: the engine
  // lays the edge at half a cell.
  const postW = 80;
  const postH = 160;
  const post = await (await trimmed(cut('planks-post', 'A'))).resize(postW, postH, { fit: 'fill' }).png().toBuffer();
  const left = await sharp(post).extract({ left: postW / 2, top: 0, width: postW / 2, height: postH }).png().toBuffer();
  const right = await sharp(post).extract({ left: 0, top: 0, width: postW / 2, height: postH }).png().toBuffer();
  const W = 2 * CELL;
  const ropeY = 70;
  const rope = `M ${postW / 2} ${ropeY} Q ${W / 2} ${ropeY + 22} ${W - postW / 2} ${ropeY}`;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${CELL}">` +
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/>` +
      `</linearGradient></defs>` +
      `<rect x="0" y="${ropeY + 8}" width="${W}" height="${CELL - ropeY - 9}" fill="url(#s)"/>` +
      `<path d="${rope}" stroke="#1d140b" stroke-width="16" fill="none"/>` +
      `<path d="${rope}" stroke="#b08a52" stroke-width="9" fill="none" stroke-dasharray="10 4"/>` +
      `</svg>`,
  );
  const img = await onCanvas(W, CELL, [
    { input: svg, left: 0, top: 0 },
    { input: left, left: 0, top: 0 },
    { input: right, left: W - postW / 2, top: 0 },
  ]);
  for (let x = 0; x < W; x++) img.data[((CELL - 1) * W + x) * 4 + 3] = 0;
  return img;
}

async function planksEnd() {
  return raw(await (await trimmed(cut('planks-plank-short', 'A'))).resize(CELL, CELL, { fit: 'fill' }).png().toBuffer());
}

async function waterEdge() {
  // The bank's wet line runs along its bottom; flip it so it meets the water.
  const o = Math.round(2 * CELL * 0.05);
  const b = await band(cut('water-bank', 'A', 66836), 2 * CELL + o, 160, { flip: true });
  const looped = opaque(loopStrip([b], 2 * CELL, o));
  const img = await onCanvas(2 * CELL, CELL, [{ input: await toPng(looped), left: 0, top: 0 }]);
  return fadeDown(img, 110);
}

const PATH_PIECES = [
  ['road-dirt', 'strip', '4x1', roadDirtStrip],
  ['road-dirt', 'edge', '2x1', roadDirtEdge],
  ['road-dirt', 'end', '1x1', roadDirtEnd],
  ['planks', 'strip', '4x1', planksStrip],
  ['planks', 'edge', '2x1', planksEdge],
  ['planks', 'end', '1x1', planksEnd],
  ['water', 'edge', '2x1', waterEdge],
];

// ─── Scatter props ───────────────────────────────────────────────────────────

// [item, variants]. water-ripple B is left out: the gate passed it but it is nearly empty.
// cliff-rock-flat failed the side-view check and is not here.
const PROPS = [
  ['cliff-rubble', ['A', 'B']],
  ['water-reeds', ['A', 'B']],
  ['water-lily-pads', ['A', 'B']],
  ['water-ripple', ['A']],
  ['dirt-pebbles', ['A', 'B']],
  ['dirt-grass-tuft', ['A', 'B']],
  ['dirt-puddle', ['A', 'B']],
  ['dirt-flagstone', ['A', 'B']],
  ['dirt-cobbles', ['A', 'B']],
  // The units the path kits are built from (scripts/migrate-path-kits.mjs): planks laid
  // across a bridge, its rail posts and end boards, and the bank a water band walks.
  ['planks-plank', ['A', 'B']],
  ['planks-plank-broken', ['A', 'B']],
  ['planks-plank-short', ['A', 'B']],
  ['planks-post', ['A', 'B']],
  ['water-bank', ['A', 'B']],
  ['water-bank-long', ['A', 'B']],
];
const PROP_SET = 'GG_Paths_Props';

// ─── Mint ────────────────────────────────────────────────────────────────────

function bumpMinor(version) {
  const [a, b] = version.split('.').map(Number);
  return `${a}.${b + 1}.0`;
}

if (!existsSync(SRC)) throw new Error(`round 4 cut art not found at ${SRC} (pass --src)`);
const preview = process.argv.includes('--preview') ? process.argv[process.argv.indexOf('--preview') + 1] : null;
const work = mkdtempSync(join(tmpdir(), 'paths-round4-'));
try {
  const keys = [];
  const sets = new Map();
  for (const [material, piece, gridSize, make] of PATH_PIECES) {
    const img = await make();
    if (!sets.has(material)) sets.set(material, []);
    const file = `${material}-${piece}.png`;
    const dir = join(work, material);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), await toPng(img));
    if (preview) writeFileSync(join(preview, file), await toPng(img));
    const entryKey = `${material}-${piece}`;
    keys.push(entryKey);
    sets.get(material).push({ file, piece, gridSize, naturalWidth: img.w, naturalHeight: img.h, entryKey, tags: ['path', 'round4'] });
  }
  const setDirs = [];
  for (const [material, pieces] of sets) {
    writeFileSync(join(work, material, 'manifest.json'), JSON.stringify({ set: material, type: 'path', loose: true, pieces }));
    setDirs.push(join(work, material));
  }

  const propDir = join(work, PROP_SET);
  mkdirSync(propDir);
  const propPieces = [];
  for (const [item, variants] of PROPS) {
    for (const variant of variants) {
      const src = cut(item, variant);
      const img = await raw(src);
      const gridSize = `${Math.round(img.w / CELL)}x${Math.round(img.h / CELL)}`;
      const file = `${item}_${gridSize}_${variant}.png`;
      writeFileSync(join(propDir, file), readFileSync(src));
      let x0 = img.w;
      let x1 = -1;
      let y0 = img.h;
      let y1 = -1;
      for (let y = 0; y < img.h; y++)
        for (let x = 0; x < img.w; x++)
          if (img.data[(y * img.w + x) * 4 + 3] > 12) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      propPieces.push({
        file,
        piece: 'object',
        gridSize,
        naturalWidth: img.w,
        naturalHeight: img.h,
        variant,
        material: item,
        contentRect: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
        tags: ['path-prop', item.split('-')[0]],
      });
      keys.push(`${item}_${gridSize}_object_${variant}`);
    }
  }
  writeFileSync(join(propDir, 'manifest.json'), JSON.stringify({ set: PROP_SET, type: 'object', grid: CELL, loose: true, pieces: propPieces }));
  setDirs.push(propDir);

  if (preview) {
    console.log(`preview written to ${preview}: ${keys.join(', ')}`);
  } else {
    const base = join(PACKS, PACK);
    const manifestName = readdirSync(base).find((f) => /^pack-[0-9a-f]+\.json$/.test(f));
    const version = bumpMinor(JSON.parse(readFileSync(join(base, manifestName), 'utf-8')).version);
    const out = join(work, 'out');

    // One command string through the shell: pnpm is a .cmd shim on Windows.
    const quote = (a) => JSON.stringify(a.split('\\').join('/'));
    const cli = (...args) =>
      execSync(['pnpm --silent --filter @dnd/vault-cli cli', ...args.map(quote)].join(' '), { cwd: ROOT, stdio: 'inherit' });
    cli('integrate', '-b', base, ...setDirs.flatMap((d) => ['-s', d]), '--pack-version', version, '-o', out);

    // Swap the rebuilt pack in, then rebuild the index the app reads at first boot.
    rmSync(base, { recursive: true, force: true });
    mkdirSync(base);
    for (const f of readdirSync(join(out, PACK))) writeFileSync(join(base, f), readFileSync(join(out, PACK, f)));
    console.log(`${PACK} ${version}: ${keys.join(', ')}`);
    // Then the strips just made become kits, and the index is rebuilt.
    execSync(`node ${quote(join(ROOT, 'scripts', 'migrate-path-kits.mjs'))}`, { cwd: ROOT, stdio: 'inherit' });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
