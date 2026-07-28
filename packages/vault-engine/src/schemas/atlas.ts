import { z } from 'zod';

const FrameDataSchema = z.object({
  frame: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  rotated: z.boolean(),
  trimmed: z.boolean(),
  sourceSize: z.object({ w: z.number(), h: z.number() }),
  spriteSourceSize: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});

const MetaSchema = z.object({
  image: z.string(),
  format: z.string(),
  size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  scale: z.string(),
  related_multi_packs: z.array(z.string()).optional(),
});

export const AtlasSchema = z.object({
  frames: z.record(z.string(), FrameDataSchema),
  meta: MetaSchema,
});

export type Atlas = z.infer<typeof AtlasSchema>;
