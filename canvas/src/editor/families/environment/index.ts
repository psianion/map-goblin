// The Environment family (plan 6.4): the Light tool, the Sky entry and the light card. Sky is
// not a tool: picking it opens the map's Sky sheet (SkyMoodSheet), which the Sheet surface
// hosts. While it is open it stands in hand and holds the tool before it (shell/sheetHold.ts),
// which comes back when the sheet closes.
//
// Not built yet (plan 8.5 and section 9): light shapes, when assets arrive. Removed and not
// coming back: the Flicker switch, Falloff, Night only, Darkvision sees through, the
// Darkness toggle; on the sheet Climate, Weather, Night sky and Time; room Mood, whose
// controls leave the room, area and level cards with the Text family (step 14).

import { Sun, SunMoon } from 'lucide-react';
import { defineFamily, defineTool } from '@/editor/registry/define';
import type { CardDef } from '@/editor/registry/types';
import { lightTool } from './light';
import { lightCard } from './lightCard';

export const skyEntry = defineTool({
  id: 'sky',
  label: 'Sky',
  description: 'Place, sun and moon shadows, tint',
  icon: Sun,
  key: 'K',
  engine: [],
  sheet: 'sky',
  settings: [],
  dock: [],
  hint: () => ({ label: 'Sky', segments: [{ text: "Set the map's place, shadows and tint" }] }),
});

export const environment = defineFamily({
  id: 'environment',
  label: 'Environment',
  icon: SunMoon,
  key: 'E',
  tools: [lightTool, skyEntry],
});

export const ENVIRONMENT_CARDS: readonly CardDef[] = [lightCard];

export { SkyMoodSheet } from './SkyMoodSheet';
