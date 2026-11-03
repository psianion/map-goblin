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
const OUT = arg('--out', join(ROOT, 'forge', 'staging', 'plateau-look'));
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
  await page.getByTestId('v2-editor').waitFor();
  await page.evaluate(async ({ data, hour, environment }) => {
    const st = window.__store.getState();
    st.loadFromFile(structuredClone(data));
    st.setRoomsSheetOpen?.(false);
    st.setSelectedIds([]);
    await st.saveCurrentMap();
    const now = window.__store.getState();
    now.setActiveLayerId(now.layers.find((l) => l.type === 'dungeon' && l.children.some((c) => c.childType === 'shape')).id);
    window.__store.setState((s) => {
      s.mapSettings.environment = environment;
      s.mapSettings.naturalLight = true;
      s.ui.previewClock = hour * 60;
    });
  }, { data: map, hour: HOUR, environment });
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
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`console error: ${m.text().slice(0, 300)}`));
  const maps = {
    field: () => [withPlateaus('plateau-test', FIELD_ADDED), 'outdoor'],
    warren: () => [withPlateaus('goblin-warren', WARREN_ADDED), 'indoor'],
  };
  for (const [name, make] of Object.entries(maps)) {
    await open(page, ...make());
    shots.push(...(await shoot(page, SCENARIOS.filter((s) => s.map === name))));
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
const sheet = join(OUT, 'sheet.png');
await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(parts).png().toFile(sheet);
console.log(`wrote ${sheet}`);
