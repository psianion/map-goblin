import { Command } from 'commander';
import { addLights, rewriteManifest } from '@dnd/vault-engine';

export function lightsCommand(): Command {
  return new Command('lights')
    .description('Write the light props table onto the object entries of a built pack (manifest only, no re-encode)')
    .requiredOption('-p, --pack <dir>', 'Built pack directory (holds pack-*.json)')
    // Same as families: no short flag, so it never reads as the root -V/--version.
    .requiredOption('--pack-version <semver>', 'Version to stamp on the new manifest')
    .action(async (opts: { pack: string; packVersion: string }) => {
      try {
        let props = 0;
        let pictured = 0;
        const file = await rewriteManifest(
          opts.pack,
          (m) => {
            const next = addLights(m);
            for (const e of Object.values(next.entries)) {
              if (!e.light) continue;
              props++;
              if (e.light.states) pictured++;
            }
            return next;
          },
          opts.packVersion,
        );
        console.log(`Wrote ${file} v${opts.packVersion}: ${props} light props, ${pictured} with pictures that follow the light`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
