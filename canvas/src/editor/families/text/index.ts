// The Text family (plan 6.5): Label and Zone, and the cards for labels and zones. The rooms
// list, a zone's sheet and the Prep overview are sheets here (TextSheets); the Rooms tools
// and the room, area and level cards are the Rooms family's (families/rooms).
//
// Not built yet (plan 8.5): a Font for labels (the label renderer, here and at the table,
// draws one face), Clone on create and Compare levels in the Level column (the store keeps
// no level copy or second-level overlay). Moved: Outlines and room Labels (Off, Numbers,
// Both) and hide-all-labels are views, in the View group of the top actions' menu.

import { Type } from 'lucide-react';
import { defineFamily } from '@/editor/registry/define';
import type { CardDef } from '@/editor/registry/types';
import { labelTool } from './label';
import { labelCard } from './labelCard';
import { zoneCard, zoneTool } from './zone';

export const text = defineFamily({
  id: 'text',
  label: 'Text',
  icon: Type,
  key: 'X',
  tools: [labelTool, zoneTool],
});

export const TEXT_CARDS: readonly CardDef[] = [labelCard, zoneCard];
