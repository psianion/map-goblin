// Queue the v2 floor batch: zoomed templates, normal-size tiles.
//
// Same submit-and-walk-away shape as v1 (ComfyUI's queue outlives this process), but the
// templates are 2x2-cell windows rather than whole 5x5 fields, and denoise runs hotter.
//
// Why hotter: element *density* is low-frequency layout, and img2img preserves layout. The
// shipped cobble tile is ~200 stones per 2x2 cells — gravel at map scale — so tracing it
// faithfully would just reproduce gravel in nicer paint. The zoom fixes how many pixels
// each element gets; the denoise is what lets the count change.
//
// node submit-floors-v2.mjs [--only <slug>] [--cells 2]
import fs from 'fs';
import path from 'path';
import { arg } from './lib.mjs';
import { FAMILIES_V2 } from './floor-templates-v2.mjs';

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_DIR = 'D:/ComfyUI';
const HERE = import.meta.dirname;

const RECIPE = {
  // Slabs are already about one cell each at this zoom — the layout is worth keeping.
  'stone-dressed': { denoise: 0.75, neg: 'grey', band: 0.5 },
  'cave-rock': { denoise: 0.8, neg: 'grey', band: 0.5 },
  // These four all need the source's element count broken, not preserved.
  cobble: { denoise: 0.9, neg: 'grey', band: 0.5 },
  'packed-earth': { denoise: 0.9, neg: 'color', band: 0.5 },
  grass: { denoise: 0.9, neg: 'color', band: 0.4 },
  plank: { denoise: 0.85, neg: 'color', band: 0.3 },
};

const SEED = 11;
const STEPS = 28;
const CFG = 6.5;

export function graphFor(slug, templateName, prompt, negative, denoise, seed = SEED) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    10: { class_type: 'LoadImage', inputs: { image: templateName } },
    11: { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps: STEPS, cfg: CFG, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise,
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: `forge-floorv2-${slug}`, images: ['8', 0] } },
  };
}

async function main() {
  const only = arg('only');
  const cells = +arg('cells', 2);
  const families = only ? FAMILIES_V2.filter((f) => f.slug === only) : FAMILIES_V2;
  if (families.length === 0) throw new Error(`No family matching "${only}"`);

  const submitted = [];
  for (const fam of families) {
    const r = RECIPE[fam.slug];
    const template = path.join(HERE, 'templates', `floorv2-${fam.slug}-src.png`);
    if (!fs.existsSync(template)) {
      throw new Error(`Missing ${template} — run floor-templates-v2.mjs --cells ${cells} first`);
    }
    const templateName = `forge-floorv2-${fam.slug}.png`;
    fs.copyFileSync(template, path.join(COMFY_DIR, 'input', templateName));

    const prompt = fs.readFileSync(path.join(HERE, `prompt-floorv2-${fam.slug}.txt`), 'utf8').trim();
    const negative = fs.readFileSync(path.join(HERE, `negative-floor-${r.neg}.txt`), 'utf8').trim();

    const res = await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: graphFor(fam.slug, templateName, prompt, negative, r.denoise),
        client_id: 'forge-floorv2',
      }),
    });
    if (!res.ok) throw new Error(`submit ${fam.slug} failed: ${res.status} ${await res.text()}`);
    const { prompt_id } = await res.json();

    submitted.push({ slug: fam.slug, cells, grey: !!fam.grey, prompt_id, band: r.band, denoise: r.denoise });
    console.log(`queued ${fam.slug.padEnd(15)} denoise ${r.denoise}  ${prompt_id}`);
  }

  const manifest = path.join(HERE, 'staging', 'floors-v2', 'jobs.json');
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify(submitted, null, 2));
  console.log(`\n${submitted.length} job(s) queued -> ${cells * 200}px tiles. Manifest: ${manifest}`);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
