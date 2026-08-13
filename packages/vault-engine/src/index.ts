// Types
export * from './types.js';

// Hash utilities
export { hashCombine, sha256File, contentHash } from './hash.js';

// Schemas
export * from './schemas/index.js';

// Import pipeline
export { validateFile } from './import/validate.js';
export { detectAssetType } from './import/detect.js';
export { autoTag, parseFilename } from './import/auto-tag.js';
export { computePhash, hammingDistance } from './import/phash.js';
export { findDuplicates } from './import/dedup.js';
export { importFiles } from './import/pipeline.js';

// Catalog
export { CatalogDB } from './catalog/db.js';
export { queryByType, queryByMaterial, queryByTheme } from './catalog/queries.js';

// Build pipeline
export { convertToWebP, getQualityProfile } from './build/convert.js';
export { packSprites } from './build/pack-sprites.js';
export { generateManifest } from './build/manifest.js';
export { generatePreview } from './build/preview.js';
export { writeBundle } from './build/bundle.js';
export { generateIndex, type IndexInput } from './build/index-gen.js';
export { generateCatalogChunks, type CatalogEntryInput } from './build/catalog-gen.js';
export { buildPack } from './build/pipeline.js';
export { integrateSets, type IntegrateOptions, type IntegrateResult } from './build/integrate.js';

// Composition engine
export { analyzeSprite, computeTileableEdges } from './compose/analyze.js';
export { composeStraight } from './compose/layout.js';
export { composeCorner } from './compose/corner.js';
export { generateVariantSeed, shuffleWithSeed } from './compose/variants.js';
export { checkQuality } from './compose/quality.js';
export { composePieces } from './compose/pipeline.js';

// Deploy
export * from './deploy/index.js';
