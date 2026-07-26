export interface DeployContext {
  uploadFile: (key: string, data: Buffer) => Promise<void>;
  purgeCache: (urls: string[]) => Promise<void>;
  listFiles: (prefix: string) => Promise<string[]>;
}

export interface DeployInput {
  packId: string;
  files: Map<string, Buffer>;
}

const PACK_MANIFEST_PATTERN = /pack-[a-f0-9]+\.json$/;
const CATALOG_META_PATTERN = /^catalog\/meta\.json$/;
const INDEX_PATTERN = /^index\.json$/;

/**
 * Three-phase atomic deploy:
 * Phase 1: Upload content-hashed assets (atlases, previews, objects, catalog chunks)
 * Phase 2a: Upload pack manifests + catalog meta
 * Phase 2b: Upload index.json LAST (the atomic "switch")
 * Phase 3: Purge CDN cache for manifests
 */
export async function atomicDeploy(ctx: DeployContext, input: DeployInput): Promise<void> {
  const contentFiles: Array<[string, Buffer]> = [];
  const packManifests: Array<[string, Buffer]> = [];
  let indexFile: [string, Buffer] | null = null;

  for (const [key, data] of input.files) {
    if (INDEX_PATTERN.test(key)) {
      indexFile = [key, data];
    } else if (PACK_MANIFEST_PATTERN.test(key) || CATALOG_META_PATTERN.test(key)) {
      packManifests.push([key, data]);
    } else {
      contentFiles.push([key, data]);
    }
  }

  // Phase 1: Upload content files
  for (const [key, data] of contentFiles) {
    await ctx.uploadFile(key, data);
  }

  // Phase 2a: Upload pack manifests + catalog meta
  for (const [key, data] of packManifests) {
    await ctx.uploadFile(key, data);
  }

  // Phase 2b: Upload index.json LAST — this is the atomic switch
  if (indexFile) {
    await ctx.uploadFile(indexFile[0], indexFile[1]);
  }

  // Phase 3: Purge cache
  const allManifestUrls = [...packManifests.map(([k]) => k)];
  if (indexFile) allManifestUrls.push(indexFile[0]);
  if (allManifestUrls.length > 0) {
    await ctx.purgeCache(allManifestUrls);
  }
}
