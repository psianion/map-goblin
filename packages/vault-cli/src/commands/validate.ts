import { Command } from 'commander';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { validateFile } from '@dnd/vault-engine';

export function validateCommand(): Command {
  return new Command('validate')
    .description('Validate source images in a pack directory')
    .argument('<packDir>', 'Pack source directory')
    .action(async (packDir: string) => {
      try {
        console.log(`Validating pack at ${packDir}...`);
        const entries = await readdir(packDir, {
          withFileTypes: true,
          recursive: true,
        });
        const images = entries.filter(
          (e) =>
            e.isFile() &&
            ['.png', '.jpg', '.jpeg', '.webp'].includes(
              extname(e.name).toLowerCase(),
            ),
        );
        let passed = 0,
          failed = 0;
        for (const entry of images) {
          const fullPath = join(entry.parentPath ?? packDir, entry.name);
          const data = await readFile(fullPath);
          const result = await validateFile(data, entry.name);
          if (result.valid) {
            passed++;
          } else {
            failed++;
            console.error(`  FAIL: ${entry.name} — ${result.error}`);
          }
        }
        console.log(
          `\n${passed} passed, ${failed} failed out of ${images.length} images`,
        );
        if (failed > 0) process.exitCode = 1;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
