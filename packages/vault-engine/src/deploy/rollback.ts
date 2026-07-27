import { archiveKey } from './atomic-deploy.js';

export interface RollbackContext {
  getArchive: (key: string) => Promise<Buffer>;
  uploadFile: (key: string, data: Buffer) => Promise<void>;
  purgeCache: (urls: string[]) => Promise<void>;
}

export interface RollbackInput {
  packId: string;
  targetVersion: string;
}

/**
 * Restore a previously deployed index.json. index.json is the only mutable
 * pointer — it already names the content-hashed manifest for each pack — so
 * putting the archived one back is the whole rollback.
 */
export async function rollbackPack(ctx: RollbackContext, input: RollbackInput): Promise<void> {
  const key = archiveKey(input.packId, input.targetVersion);

  // Read first: nothing is written unless the archive actually resolves
  let archivedIndex: Buffer;
  try {
    archivedIndex = await ctx.getArchive(key);
  } catch (err: unknown) {
    // S3 signals a missing object by name/status, not by message text
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
      throw new Error(`No archived deploy for ${input.packId}@${input.targetVersion}`);
    }
    throw err;
  }

  await ctx.uploadFile('index.json', archivedIndex);
  await ctx.purgeCache(['index.json']);
}
