// The Design family (plan 6.1): Floor, Wall, Door and Elevation, and the cards for what
// they draw.
//
// Not built yet, and deliberately not registered, so no panel, dock or card shows a
// control that changes nothing. It waits on renderer work (plan 8.5):
//   - Wall Shadow on the card: the renderer casting wall shadows at all.

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
