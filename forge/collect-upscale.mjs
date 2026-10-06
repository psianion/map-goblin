// Collect repainted windows, blend each (family, recipe) group back into its master,
// heal the wrap seam, and gate it. Safe to run repeatedly.
//
// Blending: windows composite in row-major order; every window with a left/top
// neighbour gets a linear alpha ramp across the overlap, so the repaint cross-fades
// instead of butting. The ramp lives in the window's own alpha channel.
//
// node collect-upscale.mjs
import fs from 'fs';
import path from 'path';
import { sharp, loadRaw, torusBlend, savePngRaw, harmonizeToBase } from './lib.mjs';
import { makeSeamless, seamError } from './seamless.mjs';

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_DIR = 'D:/ComfyUI';
const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'staging', 'floors-v3');
const WIN = 1024;

async function fetchWindow(job) {
  const raw = path.join(OUT, 'raw', `${job.key}.png`);
  if (fs.existsSync(raw)) return raw;
  const hist = await (await fetch(`${COMFY}/history/${job.prompt_id}`)).json();
  const entry = hist[job.prompt_id];
  if (entry?.status?.status_str === 'error') return 'error';
  const images = entry?.outputs?.['9']?.images;
  if (!images?.length) return null;
  const img = images[0];
  const from = path.join(COMFY_DIR, 'output', img.subfolder || '', img.filename);
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  try {
    fs.copyFileSync(from, raw);
    fs.unlinkSync(from); // standing rule: ComfyUI/output does not accumulate
  } catch {
    // Concurrent collector already claimed it; the raw check next run picks it up.
    return fs.existsSync(raw) ? raw : null;
  }
  return raw;
}

/** RGBA buffer of the window with alpha ramps on edges that overlap a neighbour. */
async function feathered(file, rampLeft, rampTop) {
  const rgb = await sharp(file).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(WIN * WIN * 4, 255);
  for (let y = 0; y < WIN; y++) {
    for (let x = 0; x < WIN; x++) {
      const i = (y * WIN + x) * 4;
      const s = (y * WIN + x) * 3;
      rgba[i] = rgb[s];
      rgba[i + 1] = rgb[s + 1];
      rgba[i + 2] = rgb[s + 2];
      let a = 1;
      if (rampLeft > 0 && x < rampLeft) a = Math.min(a, x / rampLeft);
      if (rampTop > 0 && y < rampTop) a = Math.min(a, y / rampTop);
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return rgba;
}

async function compose(group) {
  const master = group[0].master;
  const xs = [...new Set(group.map((j) => j.x))].sort((a, b) => a - b);
  const ys = [...new Set(group.map((j) => j.y))].sort((a, b) => a - b);

  const layers = [];
  for (const job of [...group].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const xi = xs.indexOf(job.x);
    const yi = ys.indexOf(job.y);
    const rampLeft = xi > 0 ? xs[xi - 1] + WIN - job.x : 0;
    const rampTop = yi > 0 ? ys[yi - 1] + WIN - job.y : 0;
    layers.push({
      input: await feathered(path.join(OUT, 'raw', `${job.key}.png`), rampLeft, rampTop),
      raw: { width: WIN, height: WIN, channels: 4 },
      left: job.x,
      top: job.y,
    });
  }

  const composed = path.join(OUT, `${group[0].family}-${group[0].recipe}-composed.png`);
  await sharp({ create: { width: master, height: master, channels: 3, background: '#000' } })
    .composite(layers)
    .png()
    .toFile(composed);
  return composed;
}

async function main() {
  const jobs = JSON.parse(fs.readFileSync(path.join(OUT, 'jobs.json'), 'utf8'));

  const groups = new Map();
  for (const j of jobs) {
    const g = `${j.family}-${j.recipe}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(j);
  }

  for (const [name, group] of groups) {
    const final = path.join(OUT, `${name}.png`);
    // A plain window group's job ends at the composed master — the shippable final only
    // ever comes from the wrapfix pass, so that's this group's completion marker.
    const marker = group[0].wrapfix || group[0].centerOnly
      ? final
      : path.join(OUT, `${name}-composed.png`);
    if (fs.existsSync(marker)) {
      console.log(`${name.padEnd(28)} done`);
      continue;
    }

    let have = 0;
    for (const job of group) {
      const r = await fetchWindow(job);
      if (r === 'error') console.log(`${job.key.padEnd(34)} ERRORED`);
      else if (r) have++;
    }
    if (have < group.length) {
      console.log(`${name.padEnd(28)} ${have}/${group.length} windows rendered`);
      continue;
    }

    if (group[0].wrapfix) {
      // Blend the boundary-spanning repaints into the composed master, torus-placed.
      // The result wraps by construction — no heal, so no rolled-copy ghosting.
      const composedPath = path.join(OUT, `${group[0].family}-${group[0].baseRecipe}-composed.png`);
      const base = await loadRaw(composedPath);
      for (const job of [...group].sort((a, b) => a.y - b.y || a.x - b.x)) {
        const win = await sharp(path.join(OUT, 'raw', `${job.key}.png`)).ensureAlpha().raw().toBuffer();
        torusBlend(base, win, WIN, job.x, job.y, 192);
      }
      // The repainted band drifts in tone against the once-painted interior (a bright
      // ring on colour families). Pin low frequencies back to the single pass — but the
      // reference must WRAP or its own lowpass re-imports the seam, so heal it first
      // (rolled-blend ghosting is invisible after the blur).
      const tonePath = composedPath.replace('-composed.png', '-toneref.png');
      await makeSeamless(composedPath, tonePath, 0.5);
      await harmonizeToBase(base, await loadRaw(tonePath));
      fs.unlinkSync(tonePath);
      const dest = path.join(OUT, `${group[0].family}-${group[0].baseRecipe}.png`);
      await savePngRaw(base.data, base.w, base.h, dest);
      const seam = await seamError(dest);
      fs.copyFileSync(dest, final); // group marker so reruns skip
      console.log(`${name.padEnd(28)} wrap-repainted — seam ratio ${seam.worstRatio}`);
      continue;
    }

    if (group[0].centerOnly) {
      // Comparison crop, no master: the raw window is the artefact.
      fs.copyFileSync(path.join(OUT, 'raw', `${group[0].key}.png`), final);
      console.log(`${name.padEnd(28)} centre crop saved`);
      continue;
    }

    const composed = await compose(group);
    const seam = await seamError(composed);
    console.log(`${name.padEnd(28)} composed ${group[0].master}px — pre-wrapfix seam ${seam.worstRatio}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
