import { Command } from 'commander';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  atomicDeploy,
  rollbackPack,
  createR2Client,
  uploadToR2,
  downloadFromR2,
  purgeUrls,
  getCacheControl,
  PackManifestSchema,
  type DeployContext,
} from '@dnd/vault-engine';

/**
 * Publishing config, all from the environment. These are write credentials for the
 * bucket the whole product reads from — they belong on the machine that publishes and
 * nowhere else. Nothing here is ever bundled into an image or shipped to a browser.
 */
interface DeployEnv {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  baseUrl: string;
  zoneId?: string;
  apiToken?: string;
}

/**
 * Node reads .env itself since 20.12 — no dotenv dependency for six lines of parsing.
 * Absent file is fine: the vars may already be exported in the shell.
 */
function loadEnvFile(path: string): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env — fall back to whatever is already in the environment.
  }
}

function readEnv(): DeployEnv {
  const required = {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET,
    baseUrl: process.env.CDN_BASE_URL,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => envName(k));
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}\n` +
        `Set them in .env (or the shell). See docs/2026-08-09-pack-cdn-plan.md.`,
    );
  }

  return {
    ...(required as { [K in keyof typeof required]: string }),
    zoneId: process.env.CF_ZONE_ID,
    apiToken: process.env.CF_API_TOKEN,
  };
}

function envName(key: string): string {
  return (
    {
      accountId: 'R2_ACCOUNT_ID',
      accessKeyId: 'R2_ACCESS_KEY_ID',
      secretAccessKey: 'R2_SECRET_ACCESS_KEY',
      bucketName: 'R2_BUCKET',
      baseUrl: 'CDN_BASE_URL',
    }[key] ?? key
  );
}

/**
 * Every file under a pack directory, keyed the way the CDN serves it
 * ("dungeon-classic/atlas-<hash>.webp"). Recursive because catalog chunks will nest.
 * Keys are forward-slashed regardless of platform — this is a URL path, not a file path.
 */
export async function collectPackFiles(distDir: string, packId: string): Promise<Map<string, Buffer>> {
  const packPath = join(distDir, packId);
  const names = await readdir(packPath, { recursive: true, withFileTypes: true });
  const files = new Map<string, Buffer>();

  for (const entry of names) {
    if (!entry.isFile()) continue;
    // parentPath is absolute; make the key relative to the dist root and URL-shaped.
    const abs = join(entry.parentPath, entry.name);
    const key = abs.slice(distDir.length).replace(/\\/g, '/').replace(/^\//, '');
    files.set(key, await readFile(abs));
  }
  return files;
}

/** Read a pack's version from its manifest — it anchors the rollback archive key. */
async function readPackVersion(distDir: string, packId: string): Promise<string> {
  const packPath = join(distDir, packId);
  const names = await readdir(packPath);
  const manifestFile = names.find((f) => f.startsWith('pack-') && f.endsWith('.json'));
  if (!manifestFile) throw new Error(`No pack-*.json manifest in ${packPath}`);
  const manifest = PackManifestSchema.parse(
    JSON.parse(await readFile(join(packPath, manifestFile), 'utf-8')),
  );
  return manifest.version;
}

/** Pack directories present in dist (anything holding a pack-*.json). */
export async function discoverPacks(distDir: string): Promise<string[]> {
  const entries = await readdir(distDir, { withFileTypes: true });
  const packs: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const files = await readdir(join(distDir, e.name));
    if (files.some((f) => f.startsWith('pack-') && f.endsWith('.json'))) packs.push(e.name);
  }
  return packs;
}

function buildContext(env: DeployEnv, dryRun: boolean): DeployContext {
  if (dryRun) {
    return {
      uploadFile: async (key, data) => {
        console.log(`  PUT ${key}  (${formatBytes(data.length)})  ${getCacheControl(key)}`);
      },
      purgeCache: async (urls) => {
        console.log(`  PURGE ${urls.length} url(s): ${urls.join(', ')}`);
      },
    };
  }

  const client = createR2Client(env);
  return {
    uploadFile: async (key, data) => {
      await uploadToR2(client, env.bucketName, key, data);
      console.log(`  ✓ ${key}  (${formatBytes(data.length)})`);
    },
    purgeCache: async (urls) => {
      if (!env.zoneId || !env.apiToken) {
        console.warn(
          `  ! Skipping cache purge — CF_ZONE_ID / CF_API_TOKEN not set. Metadata is` +
            ` cached for 5 minutes, so updates will lag by that much.`,
        );
        return;
      }
      await purgeUrls({ zoneId: env.zoneId, apiToken: env.apiToken, baseUrl: env.baseUrl }, urls);
      console.log(`  ✓ purged ${urls.length} url(s)`);
    },
  };
}

function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function deployCommand(): Command {
  return new Command('deploy')
    .description('Publish built packs and index.json to R2')
    .option('-d, --dist <dir>', 'Directory holding built packs and index.json', 'dist')
    .option('-p, --pack <id>', 'Pack to publish (default: the only one in dist)')
    .option('--env-file <path>', 'Env file to load before reading credentials', '.env')
    .option('--dry-run', 'Print what would be uploaded, upload nothing', false)
    .action(async (opts: { dist: string; pack?: string; envFile: string; dryRun: boolean }) => {
      try {
        loadEnvFile(opts.envFile);

        const available = await discoverPacks(opts.dist);
        if (available.length === 0) throw new Error(`No built packs found in ${opts.dist}`);

        // Guessing which pack a deploy is "for" would also guess the archive key that
        // rollback later depends on. One candidate is unambiguous; more is not.
        if (!opts.pack && available.length > 1) {
          throw new Error(
            `${opts.dist} holds ${available.length} packs (${available.join(', ')}) — ` +
              `name one with --pack.`,
          );
        }
        const packId = opts.pack ?? available[0]!;
        if (!available.includes(packId)) {
          throw new Error(`Pack "${packId}" not found in ${opts.dist}. Have: ${available.join(', ')}`);
        }

        const env = opts.dryRun ? dryRunEnv() : readEnv();
        const version = await readPackVersion(opts.dist, packId);
        const files = await collectPackFiles(opts.dist, packId);

        // index.json rides along in the same deploy so atomicDeploy can order it last —
        // it is the pointer that makes everything else visible.
        const indexPath = join(opts.dist, 'index.json');
        try {
          files.set('index.json', await readFile(indexPath));
        } catch {
          throw new Error(
            `No index.json in ${opts.dist} — run \`pack-builder index -d ${opts.dist}\` first.`,
          );
        }

        console.log(
          `${opts.dryRun ? '[dry run] ' : ''}Deploying ${packId} ${version} — ` +
            `${files.size} files, ${formatBytes([...files.values()].reduce((s, b) => s + b.length, 0))}`,
        );

        await atomicDeploy(buildContext(env, opts.dryRun), { packId, version, files });

        console.log(
          opts.dryRun
            ? `[dry run] Nothing uploaded. Drop --dry-run to publish.`
            : `Deployed ${packId} ${version} to ${env.baseUrl}`,
        );
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

/** Dry runs never touch the network, so they must not demand real credentials. */
function dryRunEnv(): DeployEnv {
  return {
    accountId: 'dry-run',
    accessKeyId: 'dry-run',
    secretAccessKey: 'dry-run',
    bucketName: process.env.R2_BUCKET ?? 'dry-run-bucket',
    baseUrl: process.env.CDN_BASE_URL ?? 'https://cdn.example',
  };
}

export function rollbackCommand(): Command {
  return new Command('rollback')
    .description('Restore a previously deployed index.json, reverting clients to that version')
    .requiredOption('-p, --pack <id>', 'Pack to roll back')
    .requiredOption('--to <version>', 'Previously deployed version to restore')
    .option('--env-file <path>', 'Env file to load before reading credentials', '.env')
    .action(async (opts: { pack: string; to: string; envFile: string }) => {
      try {
        loadEnvFile(opts.envFile);
        const env = readEnv();
        const client = createR2Client(env);

        await rollbackPack(
          {
            getArchive: (key) => downloadFromR2(client, env.bucketName, key),
            uploadFile: async (key, data) => {
              await uploadToR2(client, env.bucketName, key, data);
              console.log(`  ✓ ${key}`);
            },
            purgeCache: async (urls) => {
              if (!env.zoneId || !env.apiToken) {
                console.warn('  ! Skipping cache purge — CF_ZONE_ID / CF_API_TOKEN not set.');
                return;
              }
              await purgeUrls(
                { zoneId: env.zoneId, apiToken: env.apiToken, baseUrl: env.baseUrl },
                urls,
              );
            },
          },
          { packId: opts.pack, targetVersion: opts.to },
        );

        console.log(`Rolled ${opts.pack} back to ${opts.to}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
