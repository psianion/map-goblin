// Drive one img2img job through ComfyUI's HTTP API and collect the output.
// node run-job.mjs --template <png> --out <png> --denoise 0.65 --seed 11 [--steps 28] [--cfg 6.5] [--prompt ...] [--negative ...]
import fs from 'fs';
import path from 'path';
import { arg } from './lib.mjs';

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_DIR = 'D:/ComfyUI';
const template = arg('template'), out = arg('out');
const denoise = +arg('denoise', 0.65), seed = +arg('seed', 11);
const steps = +arg('steps', 28), cfg = +arg('cfg', 6.5);
const prompt = arg('prompt', fs.readFileSync(new URL('./prompt-wall.txt', import.meta.url), 'utf8').trim());
const negative = arg('negative', fs.readFileSync(new URL('./negative-wall.txt', import.meta.url), 'utf8').trim());

// ComfyUI LoadImage reads from its input dir
const inputName = 'forge-' + path.basename(template);
fs.copyFileSync(template, path.join(COMFY_DIR, 'input', inputName));

const graph = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
  '10': { class_type: 'LoadImage', inputs: { image: inputName } },
  '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } },
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed, steps, cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0],
    },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'forge-wall', images: ['8', 0] } },
};

const t0 = Date.now();
const res = await fetch(`${COMFY}/prompt`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: graph, client_id: 'forge-wall' }),
});
if (!res.ok) { console.error('submit failed:', res.status, await res.text()); process.exit(1); }
const { prompt_id } = await res.json();

// poll history until the job lands. Default ceiling 40 min: this box runs ~16-18 min per
// 28-step wall strip (1536x400). Raise it with --maxwait for anything bigger — a 1024x1024
// floor tile is 1.7x the pixels and lands closer to 30 min.
const maxWaitMin = +arg('maxwait', 40);
let outputs = null;
for (let i = 0; i < (maxWaitMin * 60) / 5; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const hist = await (await fetch(`${COMFY}/history/${prompt_id}`)).json();
  const entry = hist[prompt_id];
  if (entry?.status?.status_str === 'error') { console.error('job errored:', JSON.stringify(entry.status)); process.exit(1); }
  if (entry?.outputs?.['9']?.images?.length) { outputs = entry.outputs['9'].images; break; }
}
if (!outputs) { console.error('timeout waiting for job', prompt_id); process.exit(1); }

const img = outputs[0];
const from = path.join(COMFY_DIR, 'output', img.subfolder || '', img.filename);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(from, out);
fs.unlinkSync(from); // keep ComfyUI/output clean (standing cleanup rule)
console.log(`done ${path.basename(out)} in ${Math.round((Date.now() - t0) / 1000)}s (denoise ${denoise}, seed ${seed})`);
