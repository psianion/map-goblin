// Collect whatever the queued floor jobs have finished, heal their seams, and report.
//
// Safe to run repeatedly: finished tiles are copied out and skipped next time, so this is
// a progress check as much as a collector. Nothing here waits — the render is ComfyUI's
// job and it keeps going whether this process lives or not.
//
// node collect-floors.mjs
import fs from 'fs';
import path from 'path';
import { makeSeamless, seamError } from './seamless.mjs';

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_DIR = 'D:/ComfyUI';
const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'staging', 'floors-v1');

async function main() {
  const manifestPath = path.join(OUT, 'jobs.json');
  if (!fs.existsSync(manifestPath)) throw new Error('No jobs.json — run submit-floors.mjs first');
  const jobs = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });

  let done = 0;
  let pending = 0;
  for (const job of jobs) {
    const healed = path.join(OUT, `${job.slug}.png`);
    if (fs.existsSync(healed)) {
      done++;
      console.log(`${job.slug.padEnd(15)} already collected`);
      continue;
    }

    const hist = await (await fetch(`${COMFY}/history/${job.prompt_id}`)).json();
    const entry = hist[job.prompt_id];

    if (entry?.status?.status_str === 'error') {
      console.log(`${job.slug.padEnd(15)} ERRORED — ${JSON.stringify(entry.status?.messages ?? '').slice(0, 160)}`);
      continue;
    }
    const images = entry?.outputs?.['9']?.images;
    if (!images?.length) {
      pending++;
      console.log(`${job.slug.padEnd(15)} still rendering`);
      continue;
    }

    const img = images[0];
    const from = path.join(COMFY_DIR, 'output', img.subfolder || '', img.filename);
    const raw = path.join(OUT, 'raw', `${job.slug}.png`);
    fs.copyFileSync(from, raw);
    fs.unlinkSync(from); // standing rule: ComfyUI/output does not accumulate

    const before = await seamError(raw);
    await makeSeamless(raw, healed, job.band);
    const after = await seamError(healed);

    done++;
    console.log(
      `${job.slug.padEnd(15)} collected — seam ${before.vertical}/${before.horizontal}` +
        ` -> ${after.vertical}/${after.horizontal}`,
    );
  }

  console.log(`\n${done}/${jobs.length} collected, ${pending} still rendering`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
