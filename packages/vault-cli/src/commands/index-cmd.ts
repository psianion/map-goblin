import { Command } from 'commander';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateIndex, PackManifestSchema, type IndexInput } from '@dnd/vault-engine';

export function indexCommand(): Command {
  return new Command('index')
    .description('Generate index.json from built packs')
    .option('-d, --dist <dir>', 'Dist directory with built packs', 'dist')
    .action(async (opts: { dist: string }) => {
      try {
        console.log(`Generating index.json from ${opts.dist}...`);

        // Discover built pack directories
        const entries = await readdir(opts.dist, { withFileTypes: true });
        const packDirs = entries.filter((e) => e.isDirectory());

        const packs: IndexInput['packs'] = [];
        let totalEntries = 0;

        for (const dir of packDirs) {
          const packPath = join(opts.dist, dir.name);
          const files = await readdir(packPath);

          // Find the manifest file (pack-*.json)
          const manifestFile = files.find(
            (f) => f.startsWith('pack-') && f.endsWith('.json'),
          );
          if (!manifestFile) {
            console.error(`  Skipping ${dir.name}: no manifest found`);
            continue;
          }

          const manifestData = await readFile(
            join(packPath, manifestFile),
            'utf-8',
          );
          const manifest = PackManifestSchema.parse(JSON.parse(manifestData));

          const entryCount = Object.keys(manifest.entries).length;
          totalEntries += entryCount;

          // Find preview file
          const previewFile =
            files.find((f) => f.startsWith('preview-')) ?? '';

          packs.push({
            name: manifest.name,
            version: manifest.version,
            bundleSize: manifest.bundleSize,
            entryCount,
            themes: manifest.theme,
            previewFile: previewFile
              ? `${dir.name}/${previewFile}`
              : '',
            manifestFile: `${dir.name}/${manifestFile}`,
          });
        }

        if (packs.length === 0) {
          console.error('No built packs found in', opts.dist);
          process.exit(1);
        }

        const index = generateIndex({
          packs,
          totalEntries,
          // No command emits catalog chunks yet — advertising 1 would send
          // clients after a file that does not exist.
          chunkCount: 0,
        });

        const indexPath = join(opts.dist, 'index.json');
        await writeFile(indexPath, JSON.stringify(index, null, 2));
        console.log(
          `  Generated index.json with ${packs.length} pack(s), ${totalEntries} total entries`,
        );
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
