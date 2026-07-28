import { z } from 'zod';

const PackSummarySchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  bundleSize: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  themes: z.array(z.string()),
  preview: z.string(),
  manifest: z.string(),
});

const CatalogSummarySchema = z.object({
  totalEntries: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  lastUpdated: z.string().datetime(),
});

export const IndexFileSchema = z.object({
  version: z.literal(1),
  packs: z.record(z.string(), PackSummarySchema),
  catalog: CatalogSummarySchema,
});

export type IndexFile = z.infer<typeof IndexFileSchema>;
