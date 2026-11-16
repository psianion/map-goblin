// The plateau look sheet: each way a plateau reads, drawn by the editor, for a batch review of
// the drop shade, the sun shadow, the slope and the ledge.
//
//   node scripts/plateau-sheet.mjs [--hour <h>] [--out <dir>] [--port <n>]
//
// Opens the editor on a dev server (starts one on --port, default 5175, if none answers there,
// and stops it after). Outdoors at --hour (default 16) on plateau-test's field: the +2 outcrop,
// the +1 hill with its +2 summit, the -2 pit, Edge None at +1 and +3 side by side, and a +2
// slope. Indoors on the goblin warren: a +1 plateau against the den's cave wall with the
// chief's brazier below it. Writes one png per scenario and sheet.png to <out> (default
// forge/staging/plateau-look, which git ignores).
//
//   node scripts/plateau-sheet.mjs --slopes [--hour <h>] [--out <dir>] [--port <n>]
//
// Draws only the slope faces, on a sized map with a grass base ground and a walled floor on the
// same layer: +1 to +4 with a Stone face (the ledge counts); a square and a long thin wedge (the
// ends); a +3 Stone slope with a +1 Grass one against half its facing edge, in both orders (the
// join); a +1 half under a +2 that is not nested; two +2 slopes with different faces
// overlapping; a plateau painted with the Elevation brush in two strokes; a curved plateau; a
// pit; then close-ups of an end and the join at about four times an ordinary zoom. Then, on a
// sized Outdoor map of sand, two +1 slopes with a Dirt top beside two with a Grass top, once side
// by side and once overlapping (the seam between tops of one height), with a close-up of the
// seam. Then, on a sized Outdoor map of dirt, the levels: a Sand +1 inside a Grass +1, terraces
// +1, +2, +3 nested, a +1 dip in a +3 mesa and a -1 pit in a +2 mesa, with a close-up of the
// first. Writes slopes-sheet.png, the pictures in <out>/slopes-<hour>h unless --out says where.
//
//   --grid   keeps the map's grid lines on (both modes), to see them over plateau textures.
//   --hour 22 shoots at Night; 5 Dawn, 12 Day, 18 Dusk.

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const HOUR = Number(arg('--hour', '16'));
/** The editor's time of day the hour falls in. */
const TIME = HOUR * 60 < 300 || HOUR * 60 >= 1140 ? 'night' : HOUR * 60 >= 1020 ? 'dusk' : HOUR * 60 >= 420 ? 'day' : 'dawn';
const SLOPES = process.argv.includes('--slopes');
const GRID = process.argv.includes('--grid');
const OUT = arg('--out', join(ROOT, 'forge', 'staging', 'plateau-look', ...(SLOPES ? [`slopes-${HOUR}h`] : [])));
const PORT = Number(arg('--port', '5175'));
const URL_BASE = `http://localhost:${PORT}`;

// Playwright and sharp come in with the workspace's own tools (canvas's e2e, vault-engine).
const { chromium } = createRequire(join(ROOT, 'canvas', 'package.json'))('@playwright/test');
const sharp = createRequire(join(ROOT, 'packages', 'vault-engine', 'package.json'))('sharp');

const box = (id, x0, y0, x1, y1, height, edge = 'cliff') => ({
  id,
  name: id,
  childType: 'plateau',
  visible: true,
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  height,
  edge,
});

/** Each scenario: which map, its title, and the stretch of it shown (world cells). */
const SCENARIOS = [
  { name: 'outcrop', map: 'field', title: 'Outcrop +2', box: [1, 1, 16, 14] },
  { name: 'hill', map: 'field', title: 'Hill +1, summit +2', box: [14, 1, 30, 15] },
  { name: 'pit', map: 'field', title: 'Pit -2', box: [2, 14, 14, 26] },
  { name: 'none', map: 'field', title: 'Edge None +1 and +3', box: [13, 14, 35, 24] },
  { name: 'slope', map: 'field', title: 'Slope +2', box: [27, 22, 39, 32] },
  { name: 'warren', map: 'warren', title: 'Warren +1 against the cave wall, brazier below', box: [44, 2, 60, 20] },
];
const FIELD_ADDED = [
  box('none-1', 15, 16, 19, 20, 1, 'none'),
  box('none-3', 27, 16, 31, 20, 3, 'none'),
  box('slope-2', 30, 25, 36, 29, 2, 'slope'),
];
const WARREN_ADDED = [box('against-the-wall', 51, 6, 57, 11.5, 1)];

// ─── The slope faces ───
const PACK = 'gg-forge';
const GRASS = `${PACK}:wild_grass_8x8_floor_A`;
const FACE = {
  grass: `${PACK}:face_grass_4x4_floor_A`,
  dark: `${PACK}:face_grass_dark_4x4_floor_A`,
  stone: `${PACK}:face_stone_4x4_floor_A`,
  sandstone: `${PACK}:face_sandstone_4x4_floor_A`,
};
/** A rounded mesa outline round (cx, cy), rx by ry cells, a little uneven so it reads as rock. */
const blob = (cx, cy, rx, ry) =>
  Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    const k = 1 + 0.06 * Math.sin(a * 3 + cx) + 0.04 * Math.cos(a * 5 + cy);
    return [Math.round((cx + Math.cos(a) * rx * k) * 100) / 100, Math.round((cy + Math.sin(a) * ry * k) * 100) / 100];
  });
const slope = (id, ring, height, extra = {}) => ({ id, name: id, childType: 'plateau', visible: true, contours: [ring], height, edge: 'slope', ...extra });
const SLOPE_SCENARIOS = [
  { name: 'slope-heights', map: 'slopes', title: 'Stone face at +1, +2, +3 and +4: 2 to 5 ledges', box: [0, 0, 46, 10] },
  { name: 'slope-ends', map: 'slopes', title: 'A +2 square and a long thin wedge: the ends', box: [0, 10, 31, 20] },
  { name: 'slope-join', map: 'slopes', title: '+3 Stone with a +1 Grass against half its edge, both orders', box: [31, 10, 60, 22] },
  { name: 'slope-crossing', map: 'slopes', title: 'A +1 half under a +2, not nested', box: [0, 21, 17, 33] },
  { name: 'slope-same-height', map: 'slopes', title: 'Two +2 slopes overlapping, Stone and Sandstone faces', box: [17, 21, 34, 33] },
  { name: 'slope-brush', map: 'slopes', title: 'A brushed +1 Stone slope, two strokes', box: [0, 33, 17, 46] },
  { name: 'slope-curve', map: 'slopes', title: 'A curved +2 Stone slope', box: [17, 33, 32, 46] },
  { name: 'slope-pit', map: 'slopes', title: 'A slope-edged pit -2', box: [32, 33, 47, 46] },
];
/** Close-ups, shot again at about 100 screen pixels a cell: four times an ordinary editor zoom. */
const SLOPE_DETAILS = [
  { name: 'detail-end', map: 'slopes', title: 'Close: the square’s face easing into the rim', box: [0.5, 15, 6.5, 19.5] },
  { name: 'detail-join', map: 'slopes', title: 'Close: the +3 / +1 join', box: [33.5, 13.5, 42.5, 19.5] },
  { name: 'detail-seam', map: 'seam', title: 'Close: Dirt and Grass tops of one height, side by side', box: [7.5, 2.5, 12.5, 8.5] },
  { name: 'detail-inside', map: 'levels', title: 'Close: the Sand +1 inside the Grass +1, its east side', box: [12, 6, 18, 12] },
];
const SEAM_SCENARIOS = [
  { name: 'seam', map: 'seam', title: 'Dirt and Grass tops at +1 on sand: side by side, then overlapping', box: [0, 0, 20, 22] },
];
/** Height is a plateau's own level: the cases that used to add up. */
const LEVEL_SCENARIOS = [
  { name: 'level-inside', map: 'levels', title: 'A Sand +1 brushed inside a Grass +1, on Dirt', box: [0, 0, 21, 18] },
  { name: 'level-terraces', map: 'levels', title: 'Terraces +1, +2, +3 nested: steps of 1', box: [21, 0, 40, 18] },
  { name: 'level-dip', map: 'levels', title: 'A +1 dip in a +3 mesa', box: [40, 0, 60, 18] },
  { name: 'level-pit', map: 'levels', title: 'A -1 pit in a +2 mesa', box: [0, 18, 21, 38] },
];
/** A ring's smooth handles, as a double-click on each point would set them. */
const smooth = (ring) =>
  ring.map((p, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[(i + 1) % ring.length];
    const t = [(b[0] - a[0]) / 6, (b[1] - a[1]) / 6];
    return { tin: [p[0] - t[0], p[1] - t[1]], tout: [p[0] + t[0], p[1] + t[1]] };
  });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const CURVE = [[20, 36], [27, 35], [29.5, 39.5], [25, 43], [19.5, 41.5]];
const SLOPES_ADDED = [
  slope('h1', blob(5, 5, 3.2, 2.2), 1, { faceArt: FACE.stone }),
  slope('h2', blob(16.5, 5, 3.2, 2.2), 2, { faceArt: FACE.stone }),
  slope('h3', blob(28, 5, 3.2, 2.2), 3, { faceArt: FACE.stone }),
  slope('h4', blob(39.5, 5, 3.2, 2.2), 4, { faceArt: FACE.stone }),
  slope('square', rect(2, 12, 8, 18), 2, { faceArt: FACE.stone }),
  slope('wedge', [[11, 13], [29, 15.2], [11, 16.5]], 2, { faceArt: FACE.stone, faceDir: 90 }),
  // The join: a +1 against the right half of a +3's bottom edge, the +3 first in the order …
  slope('mesa-a', rect(33, 11, 41, 16), 3, { faceArt: FACE.stone, faceDir: 90 }),
  slope('shelf-a', rect(37, 15, 44, 19), 1, { faceArt: FACE.grass, faceDir: 90 }),
  // … and the same with the +1 first.
  slope('shelf-b', rect(52, 15, 59, 19), 1, { faceArt: FACE.grass, faceDir: 90 }),
  slope('mesa-b', rect(48, 11, 56, 16), 3, { faceArt: FACE.stone, faceDir: 90 }),
  slope('low', rect(2, 23, 10, 29), 1, { faceArt: FACE.stone, faceDir: 90 }),
  slope('high', rect(7, 25, 15, 30.5), 2, { faceArt: FACE.stone, faceDir: 90 }),
  slope('same-stone', rect(19, 23, 26, 29), 2, { faceArt: FACE.stone, faceDir: 90 }),
  slope('same-sand', rect(24, 24.5, 32, 30), 2, { faceArt: FACE.sandstone, faceDir: 90 }),
  slope('curve', CURVE, 2, { faceArt: FACE.stone, tangents: [smooth(CURVE)] }),
  slope('pit', blob(39.5, 39.5, 4, 3), -2, { faceArt: FACE.stone }),
];

/**
 * A sized 60 by 46 map on a grass base ground, the grid off, with the slope scenarios on it, and
 * one walled floor (Fieldstone walls, the layer's) on the same layer as every slope: the case
 * where faces used to vanish.
 */
function slopeField() {
  const map = testMap('plateau-test');
  map.grid = { ...map.grid, visible: GRID };
  map.mapSettings = { ...map.mapSettings, ground: { textureId: GRASS }, fixedSize: { width: 60, height: 46, locked: true } };
  const layer = map.layers.find((l) => l.type === 'dungeon');
  const ground = layer.children.find((c) => c.id === 'ground');
  layer.children = [
    { ...ground, id: 'room', name: 'Stone room', contours: [[[50, 1], [56, 1], [56, 7], [50, 7]]], styleOverrides: undefined },
    ...SLOPES_ADDED,
  ];
  for (const l of map.layers) if (l.type === 'dungeon' && l !== layer) l.children = l.children.filter((c) => c.childType !== 'path');
  layer.mergedFloor = null;
  layer.rooms = [];
  return map;
}

const TOP = { dirt: `${PACK}:wild_dirt_8x8_floor_A`, grass: GRASS, sand: `${PACK}:wild_sand_8x8_floor_A` };
/**
 * A sized 20 by 22 map on a sand base ground with only the seam scenario on it: a +1 Dirt-topped
 * slope with a +1 Grass-topped one beside it sharing part of an edge, and below the same two
 * overlapping, the Grass one later in the order each time, both with Stone faces.
 */
function seamField() {
  const map = testMap('plateau-test');
  map.grid = { ...map.grid, visible: GRID };
  map.mapSettings = { ...map.mapSettings, ground: { textureId: `${PACK}:wild_sand_8x8_floor_A` }, fixedSize: { width: 20, height: 22, locked: true } };
  delete map.mapSettings.terrain;
  const layer = map.layers.find((l) => l.type === 'dungeon');
  for (const l of map.layers) if (l.type === 'dungeon') l.children = [];
  const face = { faceArt: FACE.stone, faceDir: 90 };
  layer.children = [
    slope('dirt-side', rect(2, 2, 10, 9), 1, { ...face, topArt: TOP.dirt }),
    slope('grass-side', rect(10, 3, 17, 8), 1, { ...face, topArt: TOP.grass }),
    slope('dirt-over', rect(2, 12, 10, 19), 1, { ...face, topArt: TOP.dirt }),
    slope('grass-over', rect(8, 13.5, 15, 17.5), 1, { ...face, topArt: TOP.grass }),
  ];
  layer.mergedFloor = null;
  layer.rooms = [];
  return map;
}

/**
 * A sized 60 by 38 map on a dirt base ground with the level scenarios on it: a Sand-topped +1
 * drawn as a brush would leave it, later in the order, inside a Grass-topped +1 (one band: the
 * sand fades into the grass all round, no rim, face or line between them); terraces +1, +2, +3
 * each drawn inside the last; a +1 Stone slope dug into a +3 cliff mesa; a -1 cliff pit in a +2
 * cliff mesa.
 */
function levelField() {
  const map = testMap('plateau-test');
  map.grid = { ...map.grid, visible: GRID };
  map.mapSettings = { ...map.mapSettings, ground: { textureId: TOP.dirt }, fixedSize: { width: 60, height: 38, locked: true } };
  delete map.mapSettings.terrain;
  const layer = map.layers.find((l) => l.type === 'dungeon');
  for (const l of map.layers) if (l.type === 'dungeon') l.children = [];
  const face = { faceArt: FACE.stone, faceDir: 90 };
  layer.children = [
    slope('grass', blob(10.5, 9, 8.5, 6.5), 1, { faceArt: FACE.grass, faceDir: 90, topArt: TOP.grass }),
    slope('sand', blob(11, 9, 4, 2.6), 1, { faceArt: FACE.grass, faceDir: 90, topArt: TOP.sand }),
    slope('terrace-1', rect(22, 2, 39, 16), 1, face),
    slope('terrace-2', rect(25, 4.5, 36, 13.5), 2, face),
    slope('terrace-3', rect(28, 7, 33, 11), 3, face),
    { ...slope('dip-mesa', rect(42, 2, 58, 16), 3), edge: 'cliff' },
    slope('dip', rect(46, 5.5, 54, 12.5), 1, face),
    { ...slope('pit-mesa', rect(2, 20, 19, 36), 2), edge: 'cliff' },
    { ...slope('pit', rect(6.5, 24, 14.5, 32), -1), edge: 'cliff' },
  ];
  layer.mergedFloor = null;
  layer.rooms = [];
  return map;
}
const ROW_HEIGHT = 520;
const LABEL = 44;
const GAP = 16;

const up = async () => {
  try {
    return (await fetch(URL_BASE)).ok;
  } catch {
    return false;
  }
};

async function startServer() {
  if (await up()) return null;
  // One command string through the shell: pnpm is a .cmd shim on Windows.
  const child = spawn(`pnpm dev --port ${PORT} --strictPort`, { cwd: join(ROOT, 'canvas'), shell: true, stdio: 'ignore' });
  for (let i = 0; i < 180; i++) {
    if (await up()) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no dev server on ${URL_BASE}`);
}

function stopServer(child) {
  if (!child) return;
  if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  else child.kill();
}

const testMap = (name) => JSON.parse(readFileSync(join(ROOT, 'session', 'testdata', `${name}.mapbuilder`), 'utf8'));

/** A test map with `added` plateaus on its dungeon layer and its paths dropped. */
function withPlateaus(name, added) {
  const map = testMap(name);
  const layer = map.layers.find((l) => l.type === 'dungeon');
  for (const l of map.layers) if (l.type === 'dungeon') l.children = l.children.filter((c) => c.childType !== 'path');
  layer.children.push(...added);
  return map;
}

async function open(page, map, environment) {
  await page.goto(`${URL_BASE}/v2?e2e=1`);
  await page.waitForFunction(() => window.__store && window.__pixiApp, null, { timeout: 120_000 });
  await page.getByTestId('v2-new-map-card').click();
  await page.getByTestId('v2-new-map-submit').click();
  await page.getByTestId('shell').waitFor({ timeout: 60_000 });
  await page.evaluate(async ({ data, time, environment }) => {
    const st = window.__store.getState();
    st.loadFromFile(structuredClone(data));
    st.setRoomsSheetOpen?.(false);
    st.setSelectedIds([]);
    await st.saveCurrentMap();
    const now = window.__store.getState();
    const dungeons = now.layers.filter((l) => l.type === 'dungeon');
    now.setActiveLayerId((dungeons.find((l) => l.children.some((c) => c.childType === 'shape')) ?? dungeons.find((l) => l.children.length > 0) ?? dungeons[0]).id);
    window.__store.setState((s) => {
      s.mapSettings.environment = environment;
      s.mapSettings.naturalLight = true;
      s.ui.previewTime = time;
    });
  }, { data: map, time: TIME, environment });
  await page.waitForTimeout(4000);
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(1000);
  // The pack's art lands over a few frames; give the scene time to settle.
  await page.waitForTimeout(7000);
}

async function shoot(page, list) {
  const shots = [];
  for (const s of list) {
    const clip = await page.evaluate(([x0, y0, x1, y1]) => {
      const r = window.__pixiApp.canvas.getBoundingClientRect();
      const w = window.__pixiApp.stage.children[0];
      const at = (x, y) => [r.left + x * w.scale.x + w.position.x, r.top + y * w.scale.x + w.position.y];
      const [ax, ay] = at(x0, y0);
      const [bx, by] = at(x1, y1);
      return { x: ax, y: ay, width: bx - ax, height: by - ay };
    }, s.box);
    const file = join(OUT, `${s.name}.png`);
    await page.screenshot({ path: file, clip });
    shots.push({ ...s, file });
  }
  return shots;
}

/** World cells to the page's pixels. */
const screenOf = (page, x, y) =>
  page.evaluate(([x, y]) => {
    const r = window.__pixiApp.canvas.getBoundingClientRect();
    const w = window.__pixiApp.stage.children[0];
    return [r.left + x * w.scale.x + w.position.x, r.top + y * w.scale.x + w.position.y];
  }, [x, y]);

/** Paints a +1 Stone slope with the Elevation tool's brush, as a hand would: a wavy stroke, then a second one growing it. */
async function brushPlateau(page) {
  await page.evaluate(() => {
    const st = window.__store.getState();
    st.updateToolSettings({ plateau: { height: 1, edge: 'slope', faceArt: 'gg-forge:face_stone_4x4_floor_A', input: 'brush', brushRadius: 1.5 } });
    st.setActiveTool('plateau');
  });
  const strokes = [
    Array.from({ length: 23 }, (_, i) => [3 + i * 0.5, 37.5 + Math.sin(i / 3) * 1.2]),
    Array.from({ length: 9 }, (_, i) => [9 + i * 0.4, 39 + i * 0.5]),
  ];
  for (const stroke of strokes) {
    const [x0, y0] = await screenOf(page, ...stroke[0]);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (const [x, y] of stroke.slice(1)) {
      const [sx, sy] = await screenOf(page, x, y);
      await page.mouse.move(sx, sy, { steps: 3 });
    }
    await page.mouse.up();
    await page.waitForTimeout(800);
  }
  const count = await page.evaluate(() => window.__store.getState().layers.flatMap((l) => l.children ?? []).filter((c) => c.childType === 'plateau' && c.name.startsWith('Plateau ')).length);
  console.log(`brushed plateaus: ${count}`);
  await page.evaluate(() => {
    const st = window.__store.getState();
    st.setActiveTool('select');
    st.setSelectedIds([]);
  });
  await page.waitForTimeout(2000);
}

/** Each close-up: zoomed in on its middle with the wheel to about `pxPerCell`, shot, then fit again. */
async function shootClose(page, list, pxPerCell = 100) {
  const shots = [];
  for (const s of list) {
    const scale = () => page.evaluate(() => window.__pixiApp.stage.children[0].scale.x);
    const middle = () =>
      page.evaluate(([x, y]) => {
        const r = window.__pixiApp.canvas.getBoundingClientRect();
        const w = window.__pixiApp.stage.children[0];
        return [r.left + x * w.scale.x + w.position.x, r.top + y * w.scale.x + w.position.y];
      }, [(s.box[0] + s.box[2]) / 2, (s.box[1] + s.box[3]) / 2]);
    for (let i = 0; i < 40 && (await scale()) < pxPerCell; i++) {
      const [x, y] = await middle();
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(2500);
    shots.push(...(await shoot(page, [s])));
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(1500);
  }
  return shots;
}

const label = (text, width) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}"><rect width="100%" height="100%" fill="#f4f1ea"/>` +
      `<text x="14" y="29" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#2b2420">${text}</text></svg>`,
  );

async function tile(file, title) {
  const img = await sharp(file).resize({ height: ROW_HEIGHT }).png().toBuffer();
  const { width } = await sharp(img).metadata();
  const w = Math.max(width, 420);
  return {
    width: w,
    buffer: await sharp({ create: { width: w, height: ROW_HEIGHT + LABEL, channels: 3, background: '#f4f1ea' } })
      .composite([{ input: label(title, w), left: 0, top: 0 }, { input: img, left: 0, top: LABEL }])
      .png()
      .toBuffer(),
  };
}

mkdirSync(OUT, { recursive: true });
const server = await startServer();
const shots = [];
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2400, height: 1900 } });
  // The editor draws lit only when Preview as (the status bar's, kept in the page's storage) is a
  // time; left alone it starts Unlit, and the hour set below would never show.
  await page.addInitScript((time) => localStorage.setItem('mapbuilder-preview', time), TIME);
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`console error: ${m.text().slice(0, 300)}`));
  const maps = SLOPES
    ? { slopes: () => [slopeField(), 'outdoor'], seam: () => [seamField(), 'outdoor'], levels: () => [levelField(), 'outdoor'] }
    : {
        field: () => [withPlateaus('plateau-test', FIELD_ADDED), 'outdoor'],
        warren: () => [withPlateaus('goblin-warren', WARREN_ADDED), 'indoor'],
      };
  for (const [name, make] of Object.entries(maps)) {
    await open(page, ...make());
    if (name === 'slopes') await brushPlateau(page);
    shots.push(...(await shoot(page, (SLOPES ? [...SLOPE_SCENARIOS, ...SEAM_SCENARIOS, ...LEVEL_SCENARIOS] : SCENARIOS).filter((s) => s.map === name))));
    if (SLOPES) shots.push(...(await shootClose(page, SLOPE_DETAILS.filter((s) => s.map === name))));
  }
  await browser.close();
} finally {
  stopServer(server);
}

// Two tiles a row.
const tiles = [];
for (const s of shots) tiles.push(await tile(s.file, s.map === 'warren' ? `${s.title}, indoors` : `${s.title}, ${HOUR}:00 outdoors`));
const rows = [];
for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));
const width = Math.max(...rows.map((r) => r.reduce((w, t) => w + t.width + GAP, GAP)));
const height = rows.length * (ROW_HEIGHT + LABEL) + (rows.length + 1) * GAP;
const parts = rows.flatMap((r, i) => {
  const top = GAP + i * (ROW_HEIGHT + LABEL + GAP);
  let left = GAP;
  return r.map((t) => {
    const part = { input: t.buffer, left, top };
    left += t.width + GAP;
    return part;
  });
});
const sheet = join(OUT, SLOPES ? 'slopes-sheet.png' : 'sheet.png');
await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(parts).png().toFile(sheet);
console.log(`wrote ${sheet}`);
