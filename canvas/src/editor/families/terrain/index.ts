// The Terrain family (plan 6.2): the brush under its three entries (Terrain, Water, Material:
// one tool, one stack of floor pieces) and Path, with the path card. An older map's terrain
// paint keeps its Visible and Opacity on its layer sheet.
//
// Not built yet, and deliberately not registered, so nothing shows a control that changes
// nothing (plan 8.5):
//   - Colour per region, for art that declares regions: packs do not declare them yet.
//   - Biome dropdown that fills the slots: no pack declares a biome, and the installed
//     packs ship three floor textures between them.
//   - A card for terrain: painted terrain is not an object the selection can pick.

import { Mountain } from 'lucide-react';
import { defineFamily } from '@/editor/registry/define';
import { terrainBrushTool, waterBrushTool } from './brush';
import { materialBrushTool } from './material';
import { pathTool } from './path';
import { pathCard } from './pathCard';
import type { CardDef } from '@/editor/registry/types';
import { DOORS_TAB, withTabs } from '@/editor/families/design/tabs';

export const terrain = defineFamily({
  id: 'terrain',
  label: 'Terrain',
  icon: Mountain,
  key: 'T',
  // A painted cave floor takes doors, so the brush sets their style up from its dock.
  tools: [terrainBrushTool, waterBrushTool, withTabs(materialBrushTool, [DOORS_TAB]), pathTool],
});

export const TERRAIN_CARDS: readonly CardDef[] = [pathCard];
