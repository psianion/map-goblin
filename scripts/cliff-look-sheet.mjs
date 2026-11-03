// Side-by-side sheet of the cliff look: plateau-test's scenario 2 (the +2 outcrop, rock
// and lee shadow) and scenario 3 (the +1 hill's contoured slope round the +2 summit), each
// next to a reference picture of the look it is held to.
//
//   node scripts/cliff-look-sheet.mjs --refs <dir> [--hour <h>] [--out <dir>] [--port <n>]
//
// Opens the editor on a dev server (starts one on --port, default 5175, if none answers there,
// and stops it after), loads session/testdata/plateau-test under an outdoor sky at --hour
// (default 16) with natural shadows left unset, so the cliffs cast as they do by default, and
// shoots each scenario's stretch of the map. <refs> holds the reference pictures:
// dungeondraft-03-cliff-grow-shrink.png beside scenario 2, dungeondraft-04-stacked-cliffs.png
// beside scenario 3. Writes scenario-2.png, scenario-3.png and cliff-look-sheet.png to <out>
// (default forge/staging/cliff-look, which git ignores).

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
const OUT = arg('--out', join(ROOT, 'forge', 'staging', 'cliff-look'));
const PORT = Number(arg('--port', '5175'));
const URL_BASE = `http://localhost:${PORT}`;
if (!REFS) throw new Error('--refs <dir> is required: the folder holding the reference pictures');

// Playwright and sharp come in with the workspace's own tools (canvas's e2e, vault-engine).
const { chromium } = createRequire(join(ROOT, 'canvas', 'package.json'))('@playwright/test');
const sharp = createRequire(join(ROOT, 'packages', 'vault-engine', 'package.json'))('sharp');

/** Each scenario: the stretch of the map it covers (world cells) and its reference picture. */
const SCENARIOS = [
  { name: 'scenario-2', title: 'Scenario 2: the +2 outcrop', box: [0.5, 1.5, 15.5, 13.5], ref: 'dungeondraft-03-cliff-grow-shrink.png' },
  { name: 'scenario-3', title: 'Scenario 3: the +1 hill and +2 summit', box: [14, 1, 30, 15], ref: 'dungeondraft-04-stacked-cliffs.png' },
];
const ROW_HEIGHT = 640;
const LABEL = 44;

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

async function shoot(page) {
  const map = JSON.parse(readFileSync(join(ROOT, 'session', 'testdata', 'plateau-test.mapbuilder'), 'utf8'));
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
  }, { data: map, hour: HOUR });
  await page.keyboard.press('Control+0');
  // The pack's art lands over a few frames; give the scene time to settle.
  await page.waitForTimeout(6000);
  const shots = [];
  for (const s of SCENARIOS) {
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
  return {
    width,
    buffer: await sharp({ create: { width, height: ROW_HEIGHT + LABEL, channels: 3, background: '#f4f1ea' } })
      .composite([{ input: label(title, width), left: 0, top: 0 }, { input: img, left: 0, top: LABEL }])
      .png()
      .toBuffer(),
  };
}

mkdirSync(OUT, { recursive: true });
const server = await startServer();
let shots;
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2400, height: 1900 } });
  shots = await shoot(page);
  await browser.close();
} finally {
  stopServer(server);
}

const GAP = 16;
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
const sheet = join(OUT, 'cliff-look-sheet.png');
await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(parts).png().toFile(sheet);
console.log(`wrote ${sheet}`);
