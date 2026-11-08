// The Text family (plan 6.5): Label, Zone and the Rooms tools (Rectangle room, Polygon room,
// Divide), and the cards for labels, zones, rooms, areas and levels. The rooms list, a
// zone's sheet and the Prep overview are the family's sheets (TextSheets).
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
import { divideTool, roomPolygonTool, roomRectTool } from './rooms';
import { areaCard, levelCard, roomCard } from './roomCards';

export const text = defineFamily({
  id: 'text',
  label: 'Text',
  icon: Type,
  key: 'X',
  tools: [labelTool, zoneTool, roomRectTool, roomPolygonTool, divideTool],
});

export const TEXT_CARDS: readonly CardDef[] = [labelCard, zoneCard, roomCard, areaCard, levelCard];
