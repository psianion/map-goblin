// The Rooms family: Outline (first, so the family opens on it), Divide and Draw room, and the
// cards for rooms, areas and levels. Suggest rooms, the Room outlines switch and the rooms
// list ride in every tool's panel. The rooms list, a room's key and the Prep overview are
// sheets (text/sheets.tsx); the cards and their fields still live beside them in text/.

import { LayoutPanelLeft } from 'lucide-react';
import { defineFamily } from '@/editor/registry/define';
import type { CardDef } from '@/editor/registry/types';
import { areaCard, levelCard, roomCard } from '@/editor/families/text/roomCards';
import { DOORS_TAB, WALLS_TAB, withTabs } from '@/editor/families/design/tabs';
import { divideTool, drawRoomTool, outlineTool } from './tools';

export const rooms = defineFamily({
  id: 'rooms',
  label: 'Rooms',
  icon: LayoutPanelLeft,
  // R is the Floor tool's Rectangle key while Floor is in hand, and a family key is live
  // under every tool; U was the free letter.
  key: 'U',
  tools: [outlineTool, divideTool, withTabs(drawRoomTool, [WALLS_TAB, DOORS_TAB])],
});

export const ROOMS_CARDS: readonly CardDef[] = [roomCard, areaCard, levelCard];
