// packages/engine/src/build/bundle.ts
import { writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function atomicWrite(filepath: string, data: Buffer): Promise<void> {
  const tmp = filepath + '.tmp';
  await writeFile(tmp, data);
  await rename(tmp, filepath);
}

export interface BundleInput {
  packName: string;
  version: string;
  outputDir: string;
  files: Map<string, Buffer>;
}

/**
 * Write all build output files to the output directory.
 * CDN packs are served as individual files, not zipped.
 */
export async function writeBundle(input: BundleInput): Promise<string[]> {
  const packDir = join(input.outputDir, input.packName);
  const written: string[] = [];

  for (const [filename, data] of input.files) {
    const filepath = join(packDir, filename);
    await mkdir(dirname(filepath), { recursive: true });
    await atomicWrite(filepath, data);
    written.push(filepath);
  }

  return written;
}
