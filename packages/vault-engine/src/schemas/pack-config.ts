import { z } from 'zod';

export const PackConfigSchema = z.object({
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(500).default(''),
  type: z.enum(['foundation', 'expansion']),
  themes: z.array(z.string().min(1)).min(1),
  gridPixels: z.number().int().positive().default(200),
  randomization: z.object({
    floors: z.object({
      selectionStrategy: z.enum(['cell-seeded', 'uniform', 'single']).default('cell-seeded'),
    }).default({}),
    walls: z.object({
      segmentSelectionStrategy: z.enum(['node-seeded', 'uniform', 'single']).default('node-seeded'),
    }).default({}),
  }).default({}),
  localIdOverrides: z.record(z.string(), z.string()).optional(),
});

export type PackConfig = z.infer<typeof PackConfigSchema>;
