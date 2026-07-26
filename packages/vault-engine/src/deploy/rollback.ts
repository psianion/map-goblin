export interface RollbackContext {
  getArchive: (key: string) => Promise<Buffer>;
  uploadFile: (key: string, data: Buffer) => Promise<void>;
  purgeCache: (urls: string[]) => Promise<void>;
}

export interface RollbackInput {
  packId: string;
  targetVersion: string;
}

export async function rollbackPack(ctx: RollbackContext, input: RollbackInput): Promise<void> {
  // Fetch archived manifest
  const archiveKey = `_archive/${input.packId}/${input.targetVersion}/pack.json`;
  const manifest = await ctx.getArchive(archiveKey);

  // Re-upload as current manifest
  await ctx.uploadFile(`${input.packId}/pack.json`, manifest);

  // Fetch and re-upload archived index.json
  try {
    const archivedIndex = await ctx.getArchive(`_archive/${input.packId}/${input.targetVersion}/index.json`);
    await ctx.uploadFile('index.json', archivedIndex);
  } catch (err: unknown) {
    // Only swallow "not found" errors — re-throw network/permission/etc.
    const isNotFound =
      err instanceof Error &&
      (err.message.includes('not found') ||
        err.message.includes('NoSuchKey') ||
        err.message.includes('404'));
    if (!isNotFound) throw err;
  }

  // Purge cache
  await ctx.purgeCache([`${input.packId}/pack.json`, 'index.json']);
}
