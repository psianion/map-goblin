// Tiled upscale-repaint: keep the dungeon-classic source pattern, regenerate its paint
// at a higher px/cell so floors hold up zoomed in.
//
// The source tile is lanczos-upscaled to the target density, cut into overlapping 1024px
// windows, and each window runs img2img at low denoise — SDXL repaints brushwork but
// cannot move the layout at 0.4, which is exactly the fidelity we want. Windows are
// re-blended by collect-upscale.mjs.
//
// node upscale-floors.mjs --family stone-dressed --recipe base400
//   base400   400px/cell master, SDXL base 28-step
//   light400  400px/cell master, Lightning LoRA 8-step
//   base800c  single centre window at 800px/cell (comparison crop only, no master)
import fs from 'fs';
import path from 'path';
import { sharp, arg, loadRaw, torusExtract, savePngRaw } from './lib.mjs';
import { FAMILIES_V2 } from './floor-templates-v2.mjs';
import { graphFor } from './submit-floors-v2.mjs';

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_DIR = 'D:/ComfyUI';
const HERE = import.meta.dirname;
const PACK = 'D:/Labs/map-goblin/canvas/public/packs/dungeon-classic';
const OUT = path.join(HERE, 'staging', 'floors-v3');
const WIN = 1024;
const MAX_STRIDE = 576; // >= 448px overlap between neighbouring windows

const RECIPES = {
  base400: { scale: 2, lightning: false },
  light400: { scale: 2, lightning: true },
  base800c: { scale: 4, lightning: false, centerOnly: true },
  // Copy mode: material nouns steer SDXL to its own priors (3D asset-store cobbles) and
  // away from the input — so the prompt only describes paint style, never the subject.
  copy400: { scale: 2, lightning: true, prompt: 'prompt-floorv3-copy.txt' },
  copy800: { scale: 4, lightning: true, prompt: 'prompt-floorv3-copy.txt' },
};

const promptFor = (recipe, slug) =>
  fs.readFileSync(path.join(HERE, recipe.prompt ?? `prompt-floorv2-${slug}.txt`), 'utf8').trim();

/** Window origins along one axis: first at 0, last flush with the far edge. */
export function windowPlan(master) {
  if (master <= WIN) return [0];
  const n = Math.ceil((master - WIN) / MAX_STRIDE) + 1;
  const stride = (master - WIN) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(i * stride));
}

function lightningGraph(graph) {
  // Splice the 8-step LoRA between checkpoint and sampler; Lightning wants low cfg.
  graph[5] = {
    class_type: 'LoraLoaderModelOnly',
    inputs: { lora_name: 'sdxl_lightning_8step_lora.safetensors', strength_model: 1, model: ['4', 0] },
  };
  graph[3].inputs.model = ['5', 0];
  graph[3].inputs.steps = 8;
  graph[3].inputs.cfg = 1.5;
  graph[3].inputs.sampler_name = 'euler';
  graph[3].inputs.scheduler = 'sgm_uniform';
  return graph;
}

/**
 * Wrap-repaint pass: repaint the wrap boundary of an already-composed master with
 * windows that SPAN the seam (torus extraction), so the edge region becomes real
 * continuous paint instead of a rolled-copy blend. Replaces the heal step entirely.
 */
async function submitWrapfix(slug, recipeName, recipe, fam, denoise, seed) {
  const composedPath = path.join(OUT, `${slug}-${recipeName}-composed.png`);
  if (!fs.existsSync(composedPath)) throw new Error(`no composed master: ${composedPath}`);
  const img = await loadRaw(composedPath);
  const master = img.w;
  const wo = master - WIN / 2; // boundary sits at window centre
  const plan = windowPlan(master);
  const coords = [
    ...plan.map((y) => [wo, y]),
    ...plan.map((x) => [x, wo]),
    [wo, wo],
  ];

  const prompt = promptFor(recipe, slug);
  const negFile = fam.grey ? 'grey' : 'color';
  const negative = fs.readFileSync(path.join(HERE, `negative-floor-${negFile}.txt`), 'utf8').trim();

  const jobsPath = path.join(OUT, 'jobs.json');
  const jobs = fs.existsSync(jobsPath) ? JSON.parse(fs.readFileSync(jobsPath, 'utf8')) : [];

  for (const [x, y] of coords) {
    const key = `${slug}-${recipeName}-wrapfix-${x}x${y}`;
    const winFile = `forge-up-${key}.png`;
    await savePngRaw(torusExtract(img, x, y, WIN), WIN, WIN, path.join(COMFY_DIR, 'input', winFile));

    let graph = graphFor(key, winFile, prompt, negative, denoise, seed);
    if (recipe.lightning) graph = lightningGraph(graph);

    const res = await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // --front jumps the queue: wrapfix re-runs shouldn't wait behind hours of stage 1.
      body: JSON.stringify({ prompt: graph, client_id: 'forge-upscale', front: !!arg('front') }),
    });
    if (!res.ok) throw new Error(`submit ${key} failed: ${res.status} ${await res.text()}`);
    const { prompt_id } = await res.json();

    jobs.push({
      key, family: slug, recipe: `${recipeName}-wrapfix`, baseRecipe: recipeName,
      x, y, master, grey: !!fam.grey, wrapfix: true, denoise, seed, prompt_id,
    });
    console.log(`queued ${key.padEnd(40)} window ${x},${y}`);
  }

  fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2));
  console.log(`\n${coords.length} wrapfix window(s) queued for ${slug} ${recipeName}`);
}

async function main() {
  const slug = arg('family');
  const recipeName = arg('recipe', 'base400');
  const denoise = +arg('denoise', 0.4);
  const seed = +arg('seed', 11);
  const fam = FAMILIES_V2.find((f) => f.slug === slug);
  const recipe = RECIPES[recipeName];
  if (!fam || !recipe) throw new Error(`need --family <slug> and a known --recipe`);
  if (arg('wrapfix')) return submitWrapfix(slug, recipeName, recipe, fam, denoise, seed);

  const manifestIndex = JSON.parse(fs.readFileSync(`${PACK}/../index.json`, 'utf8'));
  const manifest = JSON.parse(
    fs.readFileSync(`${PACK}/../${manifestIndex.packs['dungeon-classic'].manifest}`, 'utf8'),
  );
  const e = manifest.entries[fam.entry];
  const master = e.frame.w * recipe.scale;

  fs.mkdirSync(path.join(OUT, 'src'), { recursive: true });

  // Legacy source (for mockups) + the upscaled repaint template.
  const legacy = path.join(OUT, 'src', `${slug}-legacy.png`);
  await sharp(`${PACK}/${e.atlas}`)
    .extract({ left: e.frame.x, top: e.frame.y, width: e.frame.w, height: e.frame.h })
    .png().toFile(legacy);
  const upscaled = path.join(OUT, 'src', `${slug}-${recipeName}-up.png`);
  await sharp(legacy).resize(master, master, { fit: 'fill', kernel: 'lanczos3' }).png().toFile(upscaled);

  const origins = recipe.centerOnly
    ? [Math.round((master - WIN) / 2)]
    : windowPlan(master);
  const coords = recipe.centerOnly
    ? [[origins[0], origins[0]]]
    : origins.flatMap((y) => origins.map((x) => [x, y]));

  const prompt = promptFor(recipe, slug);
  const negFile = fam.grey ? 'grey' : 'color';
  const negative = fs.readFileSync(path.join(HERE, `negative-floor-${negFile}.txt`), 'utf8').trim();

  const jobsPath = path.join(OUT, 'jobs.json');
  const jobs = fs.existsSync(jobsPath) ? JSON.parse(fs.readFileSync(jobsPath, 'utf8')) : [];

  for (const [x, y] of coords) {
    const key = `${slug}-${recipeName}-${x}x${y}`;
    const winFile = `forge-up-${key}.png`;
    await sharp(upscaled).extract({ left: x, top: y, width: WIN, height: WIN })
      .png().toFile(path.join(COMFY_DIR, 'input', winFile));

    let graph = graphFor(key, winFile, prompt, negative, denoise, seed);
    if (recipe.lightning) graph = lightningGraph(graph);

    const res = await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: 'forge-upscale' }),
    });
    if (!res.ok) throw new Error(`submit ${key} failed: ${res.status} ${await res.text()}`);
    const { prompt_id } = await res.json();

    jobs.push({
      key, family: slug, recipe: recipeName, x, y, master,
      scale: recipe.scale, grey: !!fam.grey, centerOnly: !!recipe.centerOnly,
      denoise, seed, band: 0.5, prompt_id,
    });
    console.log(`queued ${key.padEnd(34)} window ${x},${y} / master ${master}`);
  }

  fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2));
  console.log(`\n${coords.length} window(s) queued for ${slug} ${recipeName} (${master}px master)`);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
