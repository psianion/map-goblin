// Staging review: list candidates, approve into a pack source dir, reject.
import { readdir, readFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { JobSchema, type Job } from './types.js';

const GRID_PIXELS = 200;

export interface StagedJob {
  name: string;
  type: Job['type'];
  prompt: string;
  gridSize: string;
  images: string[];
}

export async function listStaging(stagingDir: string): Promise<StagedJob[]> {
  let dirs;
  try {
    dirs = await readdir(stagingDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const jobs: StagedJob[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = join(stagingDir, d.name);
    try {
      const job = JobSchema.parse(JSON.parse(await readFile(join(dir, 'job.json'), 'utf-8')));
      const images = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
      jobs.push({ name: d.name, type: job.type, prompt: job.prompt, gridSize: job.gridSize, images });
    } catch {
      continue; // not a staged job folder
    }
  }
  return jobs;
}

export interface ApproveOptions {
  stagingDir: string;
  name: string;
  /** 1-based image numbers to keep; empty/undefined = keep all */
  keep?: number[];
  /** Pack source root, e.g. packs/ai-experiments/source */
  dest: string;
}

/** Resize kept candidates to their grid-pixel size and copy into `<dest>/<type>/`. */
export async function approve(opts: ApproveOptions): Promise<string[]> {
  const dir = join(opts.stagingDir, opts.name);
  const job = JobSchema.parse(JSON.parse(await readFile(join(dir, 'job.json'), 'utf-8')));
  const [gw, gh] = job.gridSize.split('x').map(Number) as [number, number];
  const width = gw * GRID_PIXELS;
  const height = gh * GRID_PIXELS;

  const all = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
  const chosen =
    opts.keep && opts.keep.length > 0 ? opts.keep.map((n) => all[n - 1]).filter(Boolean) : all;
  if (chosen.length === 0) throw new Error('no images selected');

  const typeDir = join(opts.dest, job.type);
  await mkdir(typeDir, { recursive: true });

  const written: string[] = [];
  const variants = 'ABCDEFGH';
  for (let i = 0; i < chosen.length; i++) {
    const out = join(typeDir, `${job.name}_${job.gridSize}_${variants[i] ?? String(i)}.png`);
    await sharp(join(dir, chosen[i]!)).resize(width, height, { fit: 'fill' }).png().toFile(out);
    written.push(out);
  }

  await rm(dir, { recursive: true, force: true });
  return written;
}

/** Keep raw candidates around by copying instead of resizing (for later rework). */
export async function exportRaw(stagingDir: string, name: string, dest: string): Promise<number> {
  const dir = join(stagingDir, name);
  const all = (await readdir(dir)).filter((f) => f.endsWith('.png'));
  await mkdir(dest, { recursive: true });
  for (const f of all) await copyFile(join(dir, f), join(dest, `${name}-${f}`));
  return all.length;
}

export async function reject(stagingDir: string, name: string): Promise<void> {
  await rm(join(stagingDir, name), { recursive: true, force: true });
}
