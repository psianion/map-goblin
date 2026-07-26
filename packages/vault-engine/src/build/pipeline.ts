// packages/engine/src/build/pipeline.ts
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { validateFile } from '../import/validate.js';
import { autoTag } from '../import/auto-tag.js';
import { convertToWebP, getQualityProfile } from './convert.js';
import { packSprites, type SpriteInput } from './pack-sprites.js';
import { generateManifest, type ManifestEntryInput, type FileInput } from './manifest.js';
import { generatePreview } from './preview.js';
import { writeBundle } from './bundle.js';
import { contentHash } from '../hash.js';
import { PackConfigSchema } from '../schemas/pack-config.js';
import { TaxonomySchema } from '../schemas/taxonomy.js';
import { ATLAS_TYPES, INDIVIDUAL_TYPES } from '../types.js';
import type { AssetType, BuildOptions } from '../types.js';
import type { PackManifest } from '../schemas/pack-manifest.js';

export interface BuildResult {
  manifest: PackManifest;
  writtenFiles: string[];
}

async function discoverImages(dir: string): Promise<{ path: string; relPath: string }[]> {
  const images: { path: string; relPath: string }[] = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      const fullPath = join(entry.parentPath ?? dir, entry.name);
      images.push({ path: fullPath, relPath: relative(dir, fullPath) });
    }
  }
  return images;
}

export async function buildPack(opts: BuildOptions): Promise<BuildResult> {
  const maxAtlasSize = opts.maxAtlasSize ?? 4096;

  // Load and validate config
  const configRaw = await readFile(join(opts.packDir, 'config.json'), 'utf-8');
  const config = PackConfigSchema.parse(JSON.parse(configRaw));

  // Load and validate taxonomy
  const taxRaw = await readFile(opts.taxonomyPath, 'utf-8');
  TaxonomySchema.parse(JSON.parse(taxRaw));

  // Discover all source images
  const sourceImages = await discoverImages(opts.packDir);

  // Validate and tag each image
  const tagged: Array<{
    relPath: string;
    data: Buffer;
    webpData: Buffer;
    type: AssetType;
    tags: ReturnType<typeof autoTag>;
  }> = [];

  for (const img of sourceImages) {
    const data = await readFile(img.path);
    const vResult = await validateFile(data, img.relPath);
    if (!vResult.valid) continue; // Skip invalid (log in production)

    const tags = autoTag({
      filename: img.relPath,
      width: vResult.width!,
      height: vResult.height!,
      hasAlpha: vResult.hasAlpha ?? false,
      dominantColor: '#808080', // Simplified; full version uses sharp stats
    });

    const profile = getQualityProfile(tags.type);
    const webpData = await convertToWebP(data, profile);

    tagged.push({ relPath: img.relPath, data, webpData, type: tags.type, tags });
  }

  // Split into atlas vs individual types
  const atlasAssets = tagged.filter((t) => ATLAS_TYPES.has(t.type));
  const individualAssets = tagged.filter((t) => INDIVIDUAL_TYPES.has(t.type));

  // Pack spritesheets grouped by type
  const atlasFileInputs: FileInput[] = [];
  const manifestEntries: ManifestEntryInput[] = [];
  const previewImages: Buffer[] = [];

  // Group atlas assets by type
  const byType = new Map<string, typeof atlasAssets>();
  for (const asset of atlasAssets) {
    const group = byType.get(asset.type) ?? [];
    group.push(asset);
    byType.set(asset.type, group);
  }

  for (const [type, assets] of byType) {
    const sprites: SpriteInput[] = assets.map((a) => {
      const meta = { width: a.tags.gridSize.split('x').map(Number)[0]! * (config.gridPixels ?? 200), height: a.tags.gridSize.split('x').map(Number)[1]! * (config.gridPixels ?? 200) };
      return { id: a.tags.material + '_' + a.tags.gridSize + '_' + a.tags.type + '_' + a.tags.variant, data: a.webpData, width: meta.width, height: meta.height };
    });

    const packResult = await packSprites(sprites, { maxSize: maxAtlasSize, padding: 1 });

    for (let i = 0; i < packResult.atlases.length; i++) {
      const atlas = packResult.atlases[i]!;
      const hash = contentHash(atlas.imageData);
      const imgFilename = `atlas-${type}-${hash}.webp`;
      const jsonFilename = `atlas-${type}-${hash}.json`;

      atlas.meta.image = imgFilename;
      const jsonData = Buffer.from(JSON.stringify({ frames: atlas.frames, meta: atlas.meta }));

      atlasFileInputs.push(
        { filename: imgFilename, data: atlas.imageData, size: atlas.imageData.length },
        { filename: jsonFilename, data: jsonData, size: jsonData.length },
      );

      for (const [id, frame] of Object.entries(atlas.frames)) {
        const asset = assets.find((a) => (a.tags.material + '_' + a.tags.gridSize + '_' + a.tags.type + '_' + a.tags.variant) === id);
        if (!asset) continue;
        manifestEntries.push({
          localId: id,
          type: asset.type,
          material: asset.tags.material,
          gridSize: asset.tags.gridSize,
          pieceType: asset.tags.type,
          variant: asset.tags.variant,
          tags: config.themes,
          atlasFile: imgFilename,
          frame: frame.frame,
        });
      }

      previewImages.push(atlas.imageData);
    }
  }

  // Process individual assets
  const individualFileInputs: FileInput[] = [];
  for (const asset of individualAssets) {
    const hash = contentHash(asset.webpData);
    const filename = `${asset.tags.material}_${asset.tags.gridSize}_${asset.tags.variant}-${hash}.webp`;
    individualFileInputs.push({ filename, data: asset.webpData, size: asset.webpData.length });
    manifestEntries.push({
      localId: `${asset.tags.material}_${asset.tags.gridSize}_${asset.tags.type}_${asset.tags.variant}`,
      type: asset.type,
      material: asset.tags.material,
      gridSize: asset.tags.gridSize,
      pieceType: asset.tags.type,
      variant: asset.tags.variant,
      tags: config.themes,
    });
  }

  // Generate manifest
  const manifest = generateManifest({
    name: config.name,
    version: config.version,
    description: config.description,
    themes: config.themes,
    entries: manifestEntries,
    atlasFiles: atlasFileInputs,
    individualFiles: individualFileInputs,
  });

  // Generate preview
  if (previewImages.length > 0) {
    const preview = await generatePreview(previewImages);
    const previewHash = contentHash(preview);
    const previewFilename = `preview-${previewHash}.webp`;
    individualFileInputs.push({ filename: previewFilename, data: preview, size: preview.length });
  }

  // Write to output directory
  const allFiles = new Map<string, Buffer>();
  for (const f of [...atlasFileInputs, ...individualFileInputs]) {
    allFiles.set(f.filename, f.data);
  }
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestHash = contentHash(Buffer.from(manifestJson));
  allFiles.set(`pack-${manifestHash}.json`, Buffer.from(manifestJson));

  const written = await writeBundle({
    packName: config.name,
    version: config.version,
    outputDir: opts.outputDir,
    files: allFiles,
  });

  return { manifest, writtenFiles: written };
}
