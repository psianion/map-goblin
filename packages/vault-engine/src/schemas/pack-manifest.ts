import { z } from 'zod';

const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver (N.N.N)');

// 'door' postdates this schema — doors shipped as a first-class asset type and the
// bundled pack has carried six of them since, so validation rejected the very pack
// the app ships. The schema was the stale side, not the pack.
const AssetTypeEnum = z.enum([
  'floor', 'wall', 'pattern', 'edge', 'object',
  'scatter', 'path', 'portal', 'light-mask', 'door',
]);

const FrameSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

const ManifestEntrySchema = z.object({
  type: AssetTypeEnum,
  material: z.string().min(1),
  gridSize: z.string().regex(/^[1-9]\d*x[1-9]\d*$/),
  pieceType: z.string().min(1),
  variant: z.string().min(1),
  atlas: z.string().optional(),
  frame: FrameSchema.optional(),
  // Forge-set provenance (set integration writes this; hand-authored packs don't have it).
  set: z.string().min(1).optional(),
  tags: z.array(z.string()),
});

const FileRefSchema = z.object({
  checksum: z.string().startsWith('sha256:'),
  size: z.number().int().positive(),
});

export const PackManifestSchema = z.object({
  name: z.string().min(1).max(64),
  version: SemverSchema,
  description: z.string().max(500),
  theme: z.array(z.string().min(1)),
  entries: z.record(z.string(), ManifestEntrySchema),
  atlases: z.record(z.string(), FileRefSchema),
  files: z.record(z.string(), FileRefSchema),
  checksums: z.record(z.string(), z.string().startsWith('sha256:')).optional(),
  bundleSize: z.number().int().nonnegative(),
});

export type PackManifest = z.infer<typeof PackManifestSchema>;
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
