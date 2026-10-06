// Queue every floor draft on ComfyUI at once, then exit.
//
// The wall scripts submit one job and poll until it lands. That works when the driver is
// allowed to sit for 20 minutes; here it is not, and a driver killed mid-poll took a
// finished 17-minute render down with it. ComfyUI's own queue outlives this process, so
// submitting the whole batch up front and collecting separately makes the render immune
// to anything that happens to the shell.
//
// node submit-floors.mjs [--only <slug>]
import fs from 'fs';
import path from 'path';
import { arg } from './lib.mjs';
import { FAMILIES } from './floor-templates.mjs';

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_DIR = 'D:/ComfyUI';
const HERE = import.meta.dirname;

/** Per-family sampling. See run-floors.sh for the reasoning behind each denoise. */
const RECIPE = {
  'stone-dressed': { denoise: 0.7, neg: 'grey', band: 0.5 },
  'cave-rock': { denoise: 0.7, neg: 'grey', band: 0.5 },
  cobble: { denoise: 0.7, neg: 'grey', band: 0.5 },
  'packed-earth': { denoise: 0.85, neg: 'color', band: 0.5 },
  grass: { denoise: 0.85, neg: 'color', band: 0.5 },
  plank: { denoise: 0.65, neg: 'color', band: 0.3 },
};

const SEED = 11;
const STEPS = 28;
const CFG = 6.5;

function graphFor(slug, templateName, prompt, negative, denoise) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    10: { class_type: 'LoadImage', inputs: { image: templateName } },
    11: { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed: SEED, steps: STEPS, cfg: CFG, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise,
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    // Prefix per family so collection never has to guess which image belongs to which.
    9: { class_type: 'SaveImage', inputs: { filename_prefix: `forge-floor-${slug}`, images: ['8', 0] } },
  };
}

async function main() {
  const only = arg('only');
  const families = only ? FAMILIES.filter((f) => f.slug === only) : FAMILIES;
  if (families.length === 0) throw new Error(`No family matching "${only}"`);

  const submitted = [];
  for (const fam of families) {
    const r = RECIPE[fam.slug];
    if (!r) throw new Error(`No recipe for ${fam.slug}`);

    const template = path.join(HERE, 'templates', `floor-${fam.slug}-src.png`);
    const templateName = `forge-floor-${fam.slug}.png`;
    fs.copyFileSync(template, path.join(COMFY_DIR, 'input', templateName));

    const prompt = fs.readFileSync(path.join(HERE, `prompt-floor-${fam.slug}.txt`), 'utf8').trim();
    const negative = fs.readFileSync(path.join(HERE, `negative-floor-${r.neg}.txt`), 'utf8').trim();

    const res = await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: graphFor(fam.slug, templateName, prompt, negative, r.denoise),
        client_id: 'forge-floor',
      }),
    });
    if (!res.ok) throw new Error(`submit ${fam.slug} failed: ${res.status} ${await res.text()}`);
    const { prompt_id } = await res.json();

    submitted.push({ slug: fam.slug, cells: fam.cells, prompt_id, band: r.band, denoise: r.denoise });
    console.log(`queued ${fam.slug.padEnd(15)} denoise ${r.denoise}  ${prompt_id}`);
  }

  const manifest = path.join(HERE, 'staging', 'floors-v1', 'jobs.json');
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify(submitted, null, 2));
  console.log(`\n${submitted.length} job(s) queued. Manifest: ${manifest}`);
  console.log('Collect with: node collect-floors.mjs');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
