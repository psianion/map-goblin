import { Command } from 'commander';
import { integrateSets } from '@dnd/vault-engine';
import type { AssetType } from '@dnd/vault-engine';

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

export function integrateCommand(): Command {
  return new Command('integrate')
    .description('Fold forge sets into a built pack, replacing hand-patched loose entries')
    .requiredOption('-b, --base <dir>', 'Existing built pack directory (holds pack-*.json)')
    .option('-s, --set <dir>', 'Forge set directory (repeatable)', collect, [])
    .requiredOption('-t, --type <type>', 'Asset type the sets pack as (e.g. wall)')
    // No -v/-p short flag: the root program already owns -V/--version, and a short
    // flag here reads too easily as an alias for it.
    .requiredOption('--pack-version <semver>', 'Version to stamp on the new manifest')
    .requiredOption('-o, --output <dir>', 'Output directory for the new pack')
    .action(
      async (opts: { base: string; set: string[]; type: string; packVersion: string; output: string }) => {
        try {
          if (opts.set.length === 0) {
            throw new Error('At least one --set <dir> is required');
          }
          const result = await integrateSets({
            basePackDir: opts.base,
            setDirs: opts.set,
            type: opts.type as AssetType,
            version: opts.packVersion,
            output: opts.output,
          });
          console.log(`Integrated ${opts.set.length} set(s) into ${result.manifest.name} v${result.manifest.version}`);
          console.log(`  Entries: ${Object.keys(result.manifest.entries).length}`);
          console.log(`  Bundle size: ${(result.manifest.bundleSize / 1024).toFixed(0)}KB`);
          console.log(`  Files written: ${result.writtenFiles.length}`);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
