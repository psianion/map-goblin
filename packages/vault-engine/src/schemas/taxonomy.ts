import { z } from 'zod';

const AssetTypeEnum = z.enum([
  'floor', 'wall', 'pattern', 'edge', 'object',
  'scatter', 'path', 'portal', 'light-mask',
]);

export const TaxonomySchema = z.object({
  types: z.array(AssetTypeEnum).min(1),
  themes: z.array(z.string().min(1)).min(1),
  materials: z.record(z.string(), z.array(z.string().min(1)).min(1))
    .refine((m) => Object.keys(m).length > 0, { message: 'At least one material category required' }),
  pieceTypes: z.record(z.string(), z.array(z.string().min(1))),
});

export type Taxonomy = z.infer<typeof TaxonomySchema>;
