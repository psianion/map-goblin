import { Command } from 'commander';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { composePieces, validateFile } from '@dnd/vault-engine';
import type { GridSize } from '@dnd/vault-engine';

export function composeCommand(): Command {
  return new Command('compose')
    .description('Auto-generate derived pieces from base sprites')
    .argument('<material>', 'Material name (e.g., stone-cobble)')
    .requiredOption('-s, --source <dir>', 'Source sprites directory')
    .option('-o, --output <dir>', 'Output directory', 'dist')
    .option(
      '-p, --pieces <types>',
      'Piece types to generate (comma-separated)',
      'straight,corner-90',
    )
    .option('-v, --variants <count>', 'Number of variants per piece', '2')
    .option(
      '--sizes <sizes>',
      'Grid sizes to generate (comma-separated)',
      '1x1,2x1,3x1',
    )
    .option('--grid-pixels <px>', 'Pixels per grid unit', '200')
    .action(
      async (
        material: string,
        opts: {
          source: string;
          output: string;
          pieces: string;
          variants: string;
          sizes: string;
          gridPixels: string;
        },
      ) => {
        try {
          console.log(`Composing pieces for material: ${material}`);
          console.log(`  Source: ${opts.source}`);

          // Discover source sprites
          const entries = await readdir(opts.source, { withFileTypes: true });
          const imageFiles = entries.filter(
            (e) =>
              e.isFile() &&
              ['.png', '.jpg', '.jpeg', '.webp'].includes(
                extname(e.name).toLowerCase(),
              ),
          );

          if (imageFiles.length === 0) {
            console.error('No source images found in', opts.source);
            process.exit(1);
          }

          // Load and validate sprites
          const sprites = [];
          for (const entry of imageFiles) {
            const fullPath = join(opts.source, entry.name);
            const data = await readFile(fullPath);
            const vResult = await validateFile(data, entry.name);
            if (!vResult.valid) {
              console.error(`  Skipping ${entry.name}: ${vResult.error}`);
              continue;
            }
            sprites.push({
              id: entry.name.replace(/\.[^.]+$/, ''),
              data,
              width: vResult.width!,
              height: vResult.height!,
            });
          }

          const pieceTypes = opts.pieces.split(',');
          const sizes = opts.sizes.split(',') as GridSize[];
          const variantCount = parseInt(opts.variants);
          const gridPixels = parseInt(opts.gridPixels);

          const results = await composePieces({
            material,
            sprites,
            targets: pieceTypes.map((pt) => ({
              pieceType: pt,
              sizes,
              variantCount,
            })),
            gridPixels,
          });

          // Write output
          const outDir = join(opts.output, material);
          await mkdir(outDir, { recursive: true });

          for (const result of results) {
            const filename = `${material}_${result.pieceType}_${result.size}_${result.variant}.webp`;
            await writeFile(join(outDir, filename), result.outputData);
          }

          console.log(`  Generated ${results.length} pieces → ${outDir}`);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
