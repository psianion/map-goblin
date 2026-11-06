// The Terrain family (plan 6.2): the Terrain brush. The terrain layer's Visible and Opacity
// stay on its layer sheet.
//
// Not built yet, and deliberately not registered, so nothing shows a control that changes
// nothing (plan 8.5):
//   - Water brush, Material brush and Path: each needs its own renderer.
//   - Smooth blending and Fill enclosed floor on the Terrain brush: the terrain renderer
//     has no blend mode to switch and no flood fill inside a floor.
//   - Colour per region, for art that declares regions: packs do not declare them yet.
//   - Biome dropdown that fills the slots: no pack declares a biome, and the installed
//     packs ship three floor textures between them.
//   - A card for terrain: painted terrain is not an object the selection can pick.

import { Mountain } from 'lucide-react';
import { defineFamily } from '@/editor/registry/define';
import { terrainBrushTool } from './brush';

export const terrain = defineFamily({
  id: 'terrain',
  label: 'Terrain',
  icon: Mountain,
  key: 'T',
  tools: [terrainBrushTool],
});
