import { z } from 'zod';

const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver (N.N.N)');

// 'door' postdates this schema — doors shipped as a first-class asset type and the
// bundled pack has carried six of them since, so validation rejected the very pack
// the app ships. The schema was the stale side, not the pack. 'water' covers the
// surface and bank textures the water tool samples.
const AssetTypeEnum = z.enum([
  'floor', 'wall', 'pattern', 'edge', 'object',
  'scatter', 'path', 'portal', 'light-mask', 'door', 'water',
]);

const FrameSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

const PointSchema = z.tuple([z.number(), z.number()]);

const BandSchema = z.object({
  /** The two butt joints, in cells from the tile's centre (x right, y down). */
  joints: z.tuple([PointSchema, PointSchema]),
  /** Signed turn across the piece in degrees, positive clockwise on screen. */
  turnDeg: z.number(),
  /** An open run's tip. Never laid inside a run. */
  end: z.boolean().optional(),
  /** The middle of the rock's solid body, joint 0 end to joint 1 end, in the joints' frame. */
  spine: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2).max(64).optional(),
});

const ManifestEntrySchema = z.object({
  type: AssetTypeEnum,
  material: z.string().min(1),
  gridSize: z.string().regex(/^[1-9]\d*x[1-9]\d*$/),
  pieceType: z.string().min(1),
  variant: z.string().min(1),
  atlas: z.string().optional(),
  frame: FrameSchema.optional(),
  // Opaque-content bounds within the entry's own cell (walls ship transparent
  // padding around a band of paint); the renderer trims to this at load time.
  contentRect: FrameSchema.optional(),
  // Forge-set provenance (set integration writes this; hand-authored packs don't have it).
  set: z.string().min(1).optional(),
  tags: z.array(z.string()),
  // A band kit piece's own measurements, so a set can carry its kit (see core's caveWallKit).
  band: BandSchema.optional(),
  // Variant family within its set (vault-cli `families` writes it on object entries).
  // Last so a re-parse keeps the key order and the manifest hash stable.
  family: z.string().min(1).optional(),
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
