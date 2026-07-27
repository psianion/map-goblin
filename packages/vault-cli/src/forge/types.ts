// Forge job definitions — a job is one prompt fanned out into N candidate images.
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const JobSchema = z.object({
  name: z.string().min(1).regex(/^[\w-]+$/, 'name must be filesystem-safe'),
  type: z.enum(['floor', 'wall', 'object', 'scatter', 'edge']),
  prompt: z.string().min(1),
  negative: z
    .string()
    .default('blurry, low quality, watermark, text, signature, photo, jpeg artifacts'),
  count: z.number().int().min(1).max(8).default(4),
  gridSize: z.string().regex(/^[1-9]\d*x[1-9]\d*$/).default('1x1'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  seed: z.number().int().nonnegative().optional(),
  // Joined onto workflowsDir in the runner, so it must not escape that dir
  workflow: z
    .string()
    .regex(/^[\w-]+\.json$/, 'workflow must be a filesystem-safe .json filename')
    .default('txt2img.json'),
  checkpoint: z.string().optional(),
});

export type Job = z.infer<typeof JobSchema>;

/** ComfyUI endpoint — local by default, RunPod/Vast pod URL via env. */
export function comfyUrl(): string {
  return process.env['COMFY_URL'] ?? 'http://127.0.0.1:8188';
}

/** Walk up from cwd to the workspace root (pnpm-workspace.yaml). */
export function findRepoRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('pnpm-workspace.yaml not found above ' + from);
    dir = parent;
  }
}

export function forgeDirs(root: string = findRepoRoot()) {
  const forge = join(root, 'forge');
  return {
    forge,
    workflows: join(forge, 'workflows'),
    jobs: join(forge, 'jobs'),
    done: join(forge, 'jobs', 'done'),
    staging: join(forge, 'staging'),
  };
}
