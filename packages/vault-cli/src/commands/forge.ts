import { Command } from 'commander';
import { comfyUrl, forgeDirs } from '../forge/types.js';
import { runJobs } from '../forge/runner.js';
import { listStaging, approve, reject } from '../forge/staging.js';
import { sliceSheet } from '../forge/slice.js';

export function forgeCommand(): Command {
  const forge = new Command('forge').description(
    'AI asset factory: run ComfyUI jobs, review staging, approve into pack sources',
  );

  forge
    .command('run')
    .description('Run all queued jobs in forge/jobs/ against ComfyUI (COMFY_URL)')
    .action(async () => {
      try {
        const dirs = forgeDirs();
        const results = await runJobs({
          url: comfyUrl(),
          jobsDir: dirs.jobs,
          workflowsDir: dirs.workflows,
          stagingDir: dirs.staging,
          doneDir: dirs.done,
          log: (m) => console.log(m),
        });
        if (results.length === 0) console.log('No queued jobs in forge/jobs/');
        else console.log(`Done: ${results.length} job(s) → forge/staging/`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  forge
    .command('list')
    .description('List staged jobs awaiting review')
    .action(async () => {
      const jobs = await listStaging(forgeDirs().staging);
      if (jobs.length === 0) {
        console.log('Staging is empty.');
        return;
      }
      for (const j of jobs) {
        console.log(`${j.name}  [${j.type} ${j.gridSize}]  ${j.images.length} images  "${j.prompt}"`);
      }
    });

  forge
    .command('approve')
    .description('Resize kept candidates to grid size and move into a pack source dir')
    .argument('<name>', 'Staged job name')
    .requiredOption('-d, --dest <dir>', 'Pack source root (e.g. packs/ai-experiments/source)')
    .option('-k, --keep <numbers>', 'Comma-separated 1-based image numbers to keep (default: all)')
    .action(async (name: string, opts: { dest: string; keep?: string }) => {
      try {
        const keep = opts.keep ? opts.keep.split(',').map((n) => parseInt(n.trim(), 10)) : undefined;
        const written = await approve({
          stagingDir: forgeDirs().staging,
          name,
          keep,
          dest: opts.dest,
        });
        for (const w of written) console.log('wrote', w);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  forge
    .command('slice')
    .description('Slice an asset-sheet image into individual transparent PNGs')
    .argument('<image>', 'Path to the sheet image')
    .requiredOption('-o, --out <dir>', 'Output directory for sliced assets')
    .option('-t, --threshold <n>', 'Background color distance threshold', '60')
    .option('-m, --min-size <n>', 'Minimum asset size in px', '40')
    .action(async (image: string, opts: { out: string; threshold: string; minSize: string }) => {
      try {
        const written = await sliceSheet(image, opts.out, {
          threshold: parseInt(opts.threshold, 10),
          minSize: parseInt(opts.minSize, 10),
        });
        console.log(`sliced ${written.length} assets → ${opts.out}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  forge
    .command('reject')
    .description('Delete a staged job')
    .argument('<name>', 'Staged job name')
    .action(async (name: string) => {
      await reject(forgeDirs().staging, name);
      console.log('rejected', name);
    });

  return forge;
}
