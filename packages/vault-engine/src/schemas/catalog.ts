import { z } from 'zod';
import { GridSizeSchema } from './asset-metadata.js';

const ChunkInfoSchema = z.object({
  index: z.number().int().nonnegative(),
  url: z.string().min(1),
  entryCount: z.number().int().nonnegative(),
});

const InvertedIndexSchema = z.object({
  type: z.record(z.string(), z.array(z.number().int().nonnegative())).default({}),
  theme: z.record(z.string(), z.array(z.number().int().nonnegative())).default({}),
  material: z.record(z.string(), z.array(z.number().int().nonnegative())).default({}),
});

const CatalogEntrySchema = z.object({
  entryId: z.string().min(1),
  localId: z.string().min(1),
  packId: z.string().min(1),
  type: z.string().min(1),
  material: z.string(),
  theme: z.string(),
  gridSize: GridSizeSchema,
  tags: z.array(z.string()),
  tint: z.string(),
  thumbnailUrl: z.string().min(1),
  pHash: z.string().length(16).optional(),
});

export const CatalogChunkSchema = z.object({
  entries: z.array(CatalogEntrySchema),
});

export const CatalogMetaSchema = z.object({
  version: z.number().int().positive(),
  totalEntries: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  chunks: z.array(ChunkInfoSchema),
  invertedIndex: InvertedIndexSchema,
});

export { ChunkInfoSchema, CatalogEntrySchema };
export type ChunkInfo = z.infer<typeof ChunkInfoSchema>;
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type CatalogChunk = z.infer<typeof CatalogChunkSchema>;
export type CatalogMeta = z.infer<typeof CatalogMetaSchema>;
