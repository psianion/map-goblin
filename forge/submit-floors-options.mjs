// Queue the floor options round: several candidates per family, user picks per family.
//
// The seed-11 batch tiles are carried into the candidate pool as-is (already healed), so
// the sheet compares everything; only the new seeds/prompt-variants hit the GPU.
//
// node submit-floors-options.mjs
import fs from 'fs';
import path from 'path';
import { FAMILIES_V2 } from './floor-templates-v2.mjs';
import { graphFor } from './submit-floors-v2.mjs';

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_DIR = 'D:/ComfyUI';
const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'staging', 'floors-v2-options');
const PREV = path.join(HERE, 'staging', 'floors-v2');

// prompt: which prompt file; neg: which negative file. Defaults are the batch recipe.
const NEW_JOBS = [
  { slug: 'stone-dressed', seed: 23, denoise: 0.75, neg: 'grey', band: 0.5 },
  { slug: 'stone-dressed', seed: 47, denoise: 0.75, neg: 'grey', band: 0.5 },
  { slug: 'cave-rock', seed: 23, denoise: 0.8, neg: 'grey', band: 0.5 },
  { slug: 'cave-rock', seed: 47, denoise: 0.8, neg: 'grey', band: 0.5 },
  { slug: 'packed-earth', seed: 23, denoise: 0.9, neg: 'color', band: 0.5 },
  { slug: 'packed-earth', seed: 47, denoise: 0.9, neg: 'color', band: 0.5 },
  { slug: 'plank', seed: 23, denoise: 0.85, neg: 'color', band: 0.3 },
  { slug: 'plank', seed: 47, denoise: 0.85, neg: 'color', band: 0.3 },
  // river-pebble look, second roll
  { slug: 'cobble', seed: 23, denoise: 0.9, neg: 'grey', band: 0.5 },
  // fitted-pavement variant: same template, prompt asks for laid setts instead of pebbles
  { slug: 'cobble', seed: 11, denoise: 0.9, neg: 'grey', band: 0.5, prompt: 'cobble-fitted', tag: 'fitted' },
  { slug: 'cobble', seed: 23, denoise: 0.9, neg: 'grey', band: 0.5, prompt: 'cobble-fitted', tag: 'fitted' },
  // grass rescue: hard anti-farmland negative; one near-txt2img roll to fully escape the layout
  { slug: 'grass', seed: 11, denoise: 0.9, neg: 'grass', band: 0.4, tag: 'negfix' },
  { slug: 'grass', seed: 23, denoise: 0.9, neg: 'grass', band: 0.4, tag: 'negfix' },
  { slug: 'grass', seed: 47, denoise: 0.95, neg: 'grass', band: 0.4, tag: 'negfix' },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];

  // Carry the already-rendered batch tiles in as candidates (healed, no GPU cost).
  const prevJobs = JSON.parse(fs.readFileSync(path.join(PREV, 'jobs.json'), 'utf8'));
  for (const j of prevJobs) {
    const key = `${j.slug}-s11`;
    fs.copyFileSync(path.join(PREV, `${j.slug}.png`), path.join(OUT, `${key}.png`));
    manifest.push({ ...j, key, seed: 11, tag: 'batch' });
  }

  for (const job of NEW_JOBS) {
    const fam = FAMILIES_V2.find((f) => f.slug === job.slug);
    const key = `${job.slug}${job.tag ? `-${job.tag}` : ''}-s${job.seed}`;
    const templateName = `forge-floorv2-${job.slug}.png`;
    fs.copyFileSync(
      path.join(HERE, 'templates', `floorv2-${job.slug}-src.png`),
      path.join(COMFY_DIR, 'input', templateName),
    );

    const prompt = fs
      .readFileSync(path.join(HERE, `prompt-floorv2-${job.prompt ?? job.slug}.txt`), 'utf8')
      .trim();
    const negative = fs.readFileSync(path.join(HERE, `negative-floor-${job.neg}.txt`), 'utf8').trim();

    const res = await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: graphFor(key, templateName, prompt, negative, job.denoise, job.seed),
        client_id: 'forge-floorv2-options',
      }),
    });
    if (!res.ok) throw new Error(`submit ${key} failed: ${res.status} ${await res.text()}`);
    const { prompt_id } = await res.json();

    manifest.push({
      key, slug: job.slug, cells: 2, grey: !!fam.grey, prompt_id,
      band: job.band, denoise: job.denoise, seed: job.seed, tag: job.tag ?? 'seed',
    });
    console.log(`queued ${key.padEnd(28)} denoise ${job.denoise}  seed ${job.seed}  ${prompt_id}`);
  }

  fs.writeFileSync(path.join(OUT, 'jobs.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${NEW_JOBS.length} render(s) queued, ${prevJobs.length} carried over -> ${OUT}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
