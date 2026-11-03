// The paths and plateaus sheet: every scenario of the plan drawn by the editor, each beside a
// reference picture of the look it is held to, for a batch review.
//
//   node scripts/paths-sheet.mjs --refs <dir> [--hour <h>] [--out <dir>] [--port <n>]
//
// Opens the editor on a dev server (starts one on --port, default 5175, if none answers there,
// and stops it after) under an outdoor sky at --hour (default 16). plateau-test gives the
// outcrop, the hill, the river's fall, the bridge over the pit and the cobble road; a stretch
// of ground added east of it takes a dirt road junction and a lake, drawn after the load so
// their kits lay their attached objects (trees, reeds, lily pads). The outcrop, the hill and
// its summit are taken off the map and drawn again with the Plateau tool, click by click, as
// a hand would. The goblin warren is loaded with its cave floor raised to +1 on a cliff.
// <refs> holds the reference pictures
// named in SCENARIOS. Writes one png per scenario and sheet.png to <out> (default
// forge/staging/final-sheet, which git ignores).

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
const REFS = arg('--refs', null);
const HOUR = Number(arg('--hour', '16'));
const OUT = arg('--out', join(ROOT, 'forge', 'staging', 'final-sheet'));
const PORT = Number(arg('--port', '5175'));
const URL_BASE = `http://localhost:${PORT}`;
if (!REFS) throw new Error('--refs <dir> is required: the folder holding the reference pictures');

// Playwright and sharp come in with the workspace's own tools (canvas's e2e, vault-engine).
const { chromium } = createRequire(join(ROOT, 'canvas', 'package.json'))('@playwright/test');
const sharp = createRequire(join(ROOT, 'packages', 'vault-engine', 'package.json'))('sharp');

/** Each scenario: which map, the stretch of it (world cells), and its reference picture. */
const SCENARIOS = [
  { name: 'dirt-junction', map: 'plateau', title: 'Dirt road junction: one surface, verge units, trees', box: [41, 0, 59, 16], ref: 'canvasofkings-01-path-tool-palette-nodes.jpg' },
  { name: 'cobble-road', map: 'plateau', title: 'Cobble road and the dirt road meeting it', box: [24, 10, 40, 32], ref: 'dungeondraft-01-smoothness-max.png' },
  { name: 'bridge-pit', map: 'plateau', title: 'Plank bridge over the pit, outcrop to far mesa', box: [1, 9, 13, 32], ref: 'canvasofkings-02-plot-tool-has-cliffs.jpg' },
  { name: 'river-fall', map: 'plateau', title: 'River off the outcrop: bank and fall', box: [0, 3, 11, 17], ref: 'canvasofkings-02-plot-tool-has-cliffs.jpg' },
  { name: 'lake', map: 'plateau', title: 'Lake: fill, bank, reeds and lily pads', box: [41, 17, 59, 32], ref: 'dungeondraft-02-smoothness-min.png' },
  { name: 'outcrop', map: 'plateau', title: 'The +2 outcrop: rock, foot, lee shadow', box: [0.5, 1.5, 15.5, 13.5], ref: 'dungeondraft-03-cliff-grow-shrink.png' },
  { name: 'hill', map: 'plateau', title: 'The +1 hill and +2 summit', box: [14, 1, 30, 15], ref: 'dungeondraft-04-stacked-cliffs.png' },
  { name: 'warren', map: 'warren', title: 'Goblin warren raised to +1 on a cliff', box: [0, 0, 60, 47], ref: 'canvasofkings-03-walls-roofs-result.jpg' },
];
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

/** The plateaus plateau-test's sheet draws with the Plateau tool, outermost first. */
const TOOL_DRAWN = ['outcrop-plateau', 'hill-plateau', 'summit-plateau'];

/**
 * plateau-test with a stretch of the same ground added east of it, for the junction and the
 * lake, and the TOOL_DRAWN plateaus taken off it: returned beside the map, to be drawn again.
 */
function plateauMap() {
  const map = testMap('plateau-test');
  const layer = map.layers.find((l) => l.type === 'dungeon');
  const ground = layer.children.find((c) => c.id === 'ground');
  layer.children.splice(layer.children.indexOf(ground) + 1, 0, { ...ground, id: 'ground-east', name: 'East ground', contours: [[[40, 0], [64, 0], [64, 32], [40, 32]]] });
  const drawn = TOOL_DRAWN.map((id) => layer.children.find((c) => c.id === id));
  layer.children = layer.children.filter((c) => !TOOL_DRAWN.includes(c.id));
  return { map, plateaus: drawn };
}

/**
 * Each plateau drawn with the Plateau tool on the active layer: its height and edge set in the
 * tool's settings, E, a click on each corner and one on the first to close. Its openings are
 * pointed at the plateau the tool made.
 */
async function drawPlateaus(page, plateaus) {
  for (const p of plateaus) {
    await page.evaluate(({ height, edge }) => {
      const st = window.__store.getState();
      st.updateToolSettings({ plateau: { height, edge } });
      st.setSelectedIds([]);
      document.activeElement?.blur?.();
    }, p);
    await page.keyboard.press('e');
    const before = await page.evaluate(() => window.__store.getState().layers.flatMap((l) => l.children ?? []).filter((c) => c.childType === 'plateau').length);
    for (const [x, y] of [...p.contours[0], p.contours[0][0]]) {
      const at = await page.evaluate(([x, y]) => {
        const r = window.__pixiApp.canvas.getBoundingClientRect();
        const w = window.__pixiApp.stage.children[0];
        return { x: r.left + x * w.scale.x + w.position.x, y: r.top + y * w.scale.x + w.position.y };
      }, [x, y]);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(350);
    }
    await page.waitForFunction((n) => window.__store.getState().layers.flatMap((l) => l.children ?? []).filter((c) => c.childType === 'plateau').length > n, before);
    await page.evaluate((old) => {
      const st = window.__store.getState();
      const layer = st.layers.find((l) => l.id === st.ui.activeLayerId);
      const made = st.selection.selectedIds[0];
      for (const c of layer.children) if (c.childType === 'opening' && c.hostId === old) st.updateChild(layer.id, c.id, { hostId: made });
    }, p.id);
  }
  await page.keyboard.press('v');
  await page.evaluate(() => window.__store.getState().setSelectedIds([]));
}

/** The goblin warren with its cave floor raised to +1 on a cliff. */
function warrenMap() {
  const map = testMap('goblin-warren');
  for (const layer of map.layers) {
    if (layer.type !== 'dungeon') continue;
    layer.children = layer.children.map((c) => (c.childType === 'shape' ? { ...c, height: 1, edge: 'cliff' } : c));
  }
  return map;
}

const path = (id, points, over) => ({
  id, name: id, childType: 'path', visible: true, points, closed: false, width: 2, heightMode: 'ground',
  materialId: 'gg-forge:road-dirt', tint: '#ffffff', opacity: 1, offset: 0, flip: false, edge: 'soft',
  ends: { start: 'cut', end: 'cut', length: 1 }, sort: 'under', ...over,
});

/** Drawn after the load, as a hand would: their kits lay their objects. */
const ADDED = [
  path('junction-a', [{ x: 42, y: 8 }, { x: 58, y: 8 }]),
  path('junction-b', [{ x: 50, y: 1 }, { x: 50, y: 15 }]),
  path(
    'lake',
    Array.from({ length: 8 }, (_, i) => ({ x: 50 + 6.5 * Math.cos((i / 8) * 2 * Math.PI), y: 24.5 + 4.5 * Math.sin((i / 8) * 2 * Math.PI) })),
    { materialId: 'gg-forge:water', closed: true, fill: true, width: 1.5 },
  ),
];

async function open(page, data, added, plateaus = []) {
  await page.goto(`${URL_BASE}/v2?e2e=1`);
  await page.waitForFunction(() => window.__store && window.__pixiApp, null, { timeout: 120_000 });
  await page.getByTestId('v2-new-map-card').click();
  await page.getByTestId('v2-new-map-submit').click();
  await page.getByTestId('v2-editor').waitFor();
  await page.evaluate(async ({ data, hour }) => {
    const st = window.__store.getState();
    st.loadFromFile(structuredClone(data));
    st.setRoomsSheetOpen?.(false);
    st.setSelectedIds([]);
    await st.saveCurrentMap();
    const now = window.__store.getState();
    now.setActiveLayerId(now.layers.find((l) => l.type === 'dungeon' && l.children.some((c) => c.childType === 'shape')).id);
    window.__store.setState((s) => {
      s.mapSettings.environment = 'outdoor';
      s.ui.previewClock = hour * 60;
    });
  }, { data, hour: HOUR });
  // Let the editor settle on the opened map (it remounts the canvas once the map is saved)
  // before the new paths arrive, so their kits see them drawn.
  await page.waitForTimeout(4000);
  await page.evaluate((added) => {
    const st = window.__store.getState();
    for (const p of added) st.addChild(st.ui.activeLayerId, p);
  }, added);
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(1000);
  await drawPlateaus(page, plateaus);
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
  const plateau = plateauMap();
  await open(page, plateau.map, ADDED, plateau.plateaus);
  shots.push(...(await shoot(page, SCENARIOS.filter((s) => s.map === 'plateau'))));
  await open(page, warrenMap(), []);
  shots.push(...(await shoot(page, SCENARIOS.filter((s) => s.map === 'warren'))));
  await browser.close();
} finally {
  stopServer(server);
}

const rows = [];
for (const s of shots) {
  const ours = await tile(s.file, `${s.title}, ${HOUR}:00 outdoors`);
  const ref = await tile(join(REFS, s.ref), `Reference: ${s.ref}`);
  rows.push({ ours, ref, width: ours.width + GAP + ref.width });
}
const width = Math.max(...rows.map((r) => r.width)) + 2 * GAP;
const height = rows.length * (ROW_HEIGHT + LABEL) + (rows.length + 1) * GAP;
const parts = rows.flatMap((r, i) => {
  const top = GAP + i * (ROW_HEIGHT + LABEL + GAP);
  return [
    { input: r.ours.buffer, left: GAP, top },
    { input: r.ref.buffer, left: GAP + r.ours.width + GAP, top },
  ];
});
const sheet = join(OUT, 'sheet.png');
await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(parts).png().toFile(sheet);
console.log(`wrote ${sheet}`);
