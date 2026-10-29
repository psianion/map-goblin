import { Command } from 'commander';
import { addFamilies, rewriteManifest } from '@dnd/vault-engine';

export function familiesCommand(): Command {
  return new Command('families')
    .description('Write variant families on the object entries of a built pack (manifest only, no re-encode)')
    .requiredOption('-p, --pack <dir>', 'Built pack directory (holds pack-*.json)')
    // Same as integrate: no short flag, so it never reads as the root -V/--version.
    .requiredOption('--pack-version <semver>', 'Version to stamp on the new manifest')
    .action(async (opts: { pack: string; packVersion: string }) => {
      try {
        let objects = 0;
        const families = new Set<string>();
        const file = await rewriteManifest(
          opts.pack,
          (m) => {
            const next = addFamilies(m);
            for (const e of Object.values(next.entries)) {
              if (e.family === undefined) continue;
              objects++;
              families.add(`${e.set ?? ''}:${e.family}`);
            }
            return next;
          },
          opts.packVersion,
        );
        console.log(`Wrote ${file} v${opts.packVersion}: ${families.size} families over ${objects} object entries`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
