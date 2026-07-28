import { z } from 'zod';

const AssetTypeEnum = z.enum([
  'floor', 'wall', 'pattern', 'edge', 'object',
  'scatter', 'path', 'portal', 'light-mask',
]);

const ToolTypeEnum = z.enum(['floor-fill', 'wall', 'path', 'stamp', 'scatter']);

export const GridSizeSchema = z.string().regex(
  /^[1-9]\d*x[1-9]\d*$/,
  'Grid size must be NxM where N,M are positive integers',
);

const BoundsSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export const AssetMetadataSchema = z.object({
  id: z.string().min(1),
  sourceFile: z.string().min(1),
  type: AssetTypeEnum,
  theme: z.string().min(1),
  material: z.string().min(1),
  gridSize: GridSizeSchema,
  pieceType: z.string().min(1),
  variant: z.string().min(1).max(5),
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #aabbcc'),
  tool: z.array(ToolTypeEnum).min(1),
  tileable: z.boolean(),
  transparency: z.boolean(),
  contentBounds: BoundsSchema,
  perceptualHash: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type AssetMetadataInput = z.infer<typeof AssetMetadataSchema>;
