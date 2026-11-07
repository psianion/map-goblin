// The Terrain family (plan 6.2): the Terrain brush, the Water brush and the Material brush.
// The terrain layer's Visible and Opacity stay on its layer sheet.
//
// Not built yet, and deliberately not registered, so nothing shows a control that changes
// nothing (plan 8.5):
//   - Path: it needs its own renderer.
//   - Colour per region, for art that declares regions: packs do not declare them yet.
//   - Biome dropdown that fills the slots: no pack declares a biome, and the installed
//     packs ship three floor textures between them.
//   - A card for terrain: painted terrain is not an object the selection can pick.

import { Mountain } from 'lucide-react';
import { defineFamily } from '@/editor/registry/define';
import { terrainBrushTool } from './brush';
import { waterBrushTool } from './water';
import { materialBrushTool } from './material';

export const terrain = defineFamily({
  id: 'terrain',
  label: 'Terrain',
  icon: Mountain,
  key: 'T',
  tools: [terrainBrushTool, waterBrushTool, materialBrushTool],
});
