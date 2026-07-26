// Job runner: forge/jobs/*.json → ComfyUI → forge/staging/<job>/NNN.png
import { readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { JobSchema, type Job } from './types.js';
import { patchWorkflow, submitPrompt, waitForImages, downloadImage, type Workflow } from './comfy.js';

export interface RunOptions {
  url: string;
  jobsDir: string;
  workflowsDir: string;
  stagingDir: string;
  doneDir: string;
  log?: (msg: string) => void;
}

export interface RunResult {
  job: string;
  images: number;
  seed: number;
}

export async function runJobs(opts: RunOptions): Promise<RunResult[]> {
  const log = opts.log ?? (() => {});
  const entries = await readdir(opts.jobsDir, { withFileTypes: true });
  const jobFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => join(opts.jobsDir, e.name));

  const results: RunResult[] = [];
  for (const jobFile of jobFiles) {
    const job: Job = JobSchema.parse(JSON.parse(await readFile(jobFile, 'utf-8')));
    const seed = job.seed ?? Math.floor(Math.random() * 2 ** 31);
    log(`[${job.name}] submitting (${job.count} candidates, seed ${seed})`);

    const wfRaw = await readFile(join(opts.workflowsDir, job.workflow), 'utf-8');
    const workflow = patchWorkflow(JSON.parse(wfRaw) as Workflow, {
      positive: job.prompt,
      negative: job.negative,
      // ponytail: generate at model-native res (workflow default), resize to grid at approve
      width: job.width,
      height: job.height,
      batchSize: job.count,
      seed,
      checkpoint: job.checkpoint,
    });

    const promptId = await submitPrompt(opts.url, workflow);
    const images = await waitForImages(opts.url, promptId);
    if (images.length === 0) {
      log(`[${job.name}] WARNING: job completed but produced no images — skipping`);
      continue;
    }

    const outDir = join(opts.stagingDir, job.name);
    await mkdir(outDir, { recursive: true });
    for (let i = 0; i < images.length; i++) {
      const data = await downloadImage(opts.url, images[i]!);
      await writeFile(join(outDir, `${String(i + 1).padStart(3, '0')}.png`), data);
    }
    await writeFile(
      join(outDir, 'job.json'),
      JSON.stringify({ ...job, seed, generatedAt: new Date().toISOString() }, null, 2),
    );

    await mkdir(opts.doneDir, { recursive: true });
    await rename(jobFile, join(opts.doneDir, basename(jobFile)));
    log(`[${job.name}] ${images.length} images → staging`);
    results.push({ job: job.name, images: images.length, seed });
  }
  return results;
}
