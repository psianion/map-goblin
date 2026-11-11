// The Material brush: a freehand stroke closes into one solid patch of a material on the
// layer in hand, the material's border units laid round it on release, "like scatter but
// fuller". Size and the material swatches are what changes mid-painting, so they sit in the
// dock; Paint or erase, Smooth, Border and whether the edge is a wall are set up in the panel.

import { Layers2 } from 'lucide-react';
import { z } from 'zod';
import { MATERIAL_BRUSH_RANGES } from '@/store/slices/tools';
import { defineSetting, defineTool } from '@/editor/registry/define';
import type { DockColumnDef } from '@/editor/registry/types';
import { terrainMode } from './brush';
import { MaterialsColumn } from './MaterialsColumn';

const { radius } = MATERIAL_BRUSH_RANGES;

/** Brush radius in cells. [ and ] and the wheel step it too (MaterialTool). */
export const materialSize = defineSetting<number>({
  id: 'material.size',
  label: 'Size',
  schema: z.number().min(radius.min).max(radius.max),
  default: 3,
  home: 'dock',
  control: 'stepper',
  section: 'Size',
  range: { ...radius, unit: 'sq' },
  path: 'material.radius',
});

/** Rounds the patch's outline before the border goes on. */
export const materialSmooth = defineSetting<boolean>({
  id: 'material.smooth',
  label: 'Smooth',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Outline',
  path: 'material.smooth',
});

/** The material's border units laid round the patch. */
export const materialBorder = defineSetting<boolean>({
  id: 'material.border',
  label: 'Border',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Outline',
  path: 'material.border',
});

/** The patch's edge blocks light and sight and takes doors, as a wall does. */
export const materialWall = defineSetting<boolean>({
  id: 'material.wall',
  label: 'Edge is a wall',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Outline',
  path: 'material.wall',
});

const materialsColumn: DockColumnDef = { id: 'material.swatches', caption: 'Material', render: MaterialsColumn };

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const materialBrushTool = defineTool({
  id: 'materialBrush',
  label: 'Material brush',
  description: "Paint a solid patch with the material's border",
  icon: Layers2,
  // M is Measure's on the rail; A is free in the family and everywhere the family is live.
  key: 'A',
  engine: ['material'],
  settings: [materialSize, terrainMode, materialSmooth, materialBorder, materialWall],
  dock: [materialsColumn],
  keys: [
    { id: 'size.down', combo: '[', label: 'Brush smaller' },
    { id: 'size.up', combo: ']', label: 'Brush larger' },
  ],
  hint: (s) => ({
    label: 'Material brush',
    segments: s.tools.eraseMode
      ? [t('Erase from patches · '), k('['), t(' '), k(']'), t(' size')]
      : [t('Paint a patch · release to close it · '), k('Alt'), t(' erase')],
  }),
});
