// The Design family (plan 6.1): Floor, Wall, Door and Elevation, and the cards for what
// they draw.
//
// Not built yet, and deliberately not registered, so no panel, dock or card shows a
// control that changes nothing. Each waits on renderer or tool work (plan 8.5):
//   - Carve out, a Mode on Floor (Draw or Carve out, Alt while drawing): polygon subtract.
//     Until then the Floor panel has no Mode section.
//   - Corner style on walls, rounded or sharp: wall sets with both corner pieces.
//   - Wall Merge on the card and Auto-join at an endpoint in the panel: join on snap.
//   - Wall Shadow on the card: the renderer casting wall shadows at all.
//   - Freestanding doors in the Door panel: a door object not bound to a wall edge.
//   - Node mode midpoint handles; until then Node mode opens today's point editing.
//   - Curve on Floor: the polygon tool draws straight edges; curve mode reaches walls only.

import { PencilRuler } from 'lucide-react';
import { defineFamily } from '@/editor/registry/define';
import type { CardDef } from '@/editor/registry/types';
import { floorTool } from './floor';
import { wallTool } from './wall';
import { doorTool } from './door';
import { elevationTool } from './elevation';
import { floorCard } from './floorCard';
import { wallCard } from './wallCard';
import { doorCard } from './doorCard';
import { plateauCard } from './plateauCard';

export const design = defineFamily({
  id: 'design',
  label: 'Design',
  icon: PencilRuler,
  key: 'D',
  tools: [floorTool, wallTool, doorTool, elevationTool],
});

export const DESIGN_CARDS: readonly CardDef[] = [floorCard, wallCard, doorCard, plateauCard];

export { openAssetsRef } from './openAssets';
