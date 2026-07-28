import { Command } from 'commander';
import { buildPack } from '@dnd/vault-engine';

export function buildCommand(): Command {
  return new Command('build')
    .description('Build a pack from source images')
    .argument('<packDir>', 'Pack source directory')
    .option('-o, --output <dir>', 'Output directory', 'dist')
    .option('-t, --taxonomy <path>', 'Taxonomy JSON path', 'taxonomy.json')
    .action(
      async (
        packDir: string,
        opts: { output: string; taxonomy: string },
      ) => {
        try {
          const result = await buildPack({
            packDir,
            outputDir: opts.output,
            taxonomyPath: opts.taxonomy,
          });
          console.log(
            `Built ${result.manifest.name} v${result.manifest.version}`,
          );
          console.log(
            `  Entries: ${Object.keys(result.manifest.entries).length}`,
          );
          console.log(
            `  Bundle size: ${(result.manifest.bundleSize / 1024).toFixed(0)}KB`,
          );
          console.log(`  Files written: ${result.writtenFiles.length}`);
          if (result.rejected.length > 0) {
            console.error(`  Rejected ${result.rejected.length} source image(s):`);
            for (const r of result.rejected) console.error(`    ${r.file}: ${r.error}`);
            process.exitCode = 1;
          }
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
