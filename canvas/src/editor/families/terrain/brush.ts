// The Terrain and Water entries of the brush. Both are the Material brush (material.ts): the
// same tool, the same controls, the same one stack of floor pieces. They differ only in the
// textures listed first and remembered: ground for Terrain, water (with the shore controls,
// which show whenever water is in hand) for Water.

import { Paintbrush, Waves } from 'lucide-react';
import { defineTool } from '@/editor/registry/define';
import type { DockColumnDef } from '@/editor/registry/types';
import { BRUSH_KEYS, BRUSH_SETTINGS, brushHint } from './material';
import { GroundColumn, WaterColumn } from './MaterialsColumn';

export { terrainMode } from './material';

const groundColumn: DockColumnDef = { id: 'terrain.ground', caption: 'Ground', render: GroundColumn };
const waterColumn: DockColumnDef = { id: 'terrain.water', caption: 'Water', render: WaterColumn };

export const terrainBrushTool = defineTool({
  id: 'terrainBrush',
  label: 'Terrain brush',
  description: 'Paint ground: grass, dirt and stone that blend at the edge',
  icon: Paintbrush,
  key: 'B',
  engine: ['terrain'],
  settings: BRUSH_SETTINGS,
  dock: [groundColumn],
  keys: BRUSH_KEYS,
  hint: brushHint('Terrain brush'),
});

export const waterBrushTool = defineTool({
  id: 'waterBrush',
  label: 'Water brush',
  description: 'Paint water with a shore',
  icon: Waves,
  key: 'W',
  engine: ['water'],
  settings: BRUSH_SETTINGS,
  dock: [waterColumn],
  keys: BRUSH_KEYS,
  hint: brushHint('Water brush'),
});
