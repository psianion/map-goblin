// The Environment family (plan 6.4): the Light tool and the light card. The Sky and mood
// sheet (SkyMoodSheet) is the map's, opened from the Light panel; the Sheet surface hosts it.
//
// Not built yet (plan 8.5 and section 9): light shapes, when assets arrive. Removed and not
// coming back: the Flicker switch, Falloff, Night only, Darkvision sees through, the
// Darkness toggle; on the sheet Climate, Weather, Night sky and Time; room Mood, whose
// controls leave the room, area and level cards with the Text family (step 14).

import { SunMoon } from 'lucide-react';
import { defineFamily } from '@/editor/registry/define';
import type { CardDef } from '@/editor/registry/types';
import { lightTool } from './light';
import { lightCard } from './lightCard';

export const environment = defineFamily({
  id: 'environment',
  label: 'Environment',
  icon: SunMoon,
  key: 'E',
  tools: [lightTool],
});

export const ENVIRONMENT_CARDS: readonly CardDef[] = [lightCard];

export { SkyMoodSheet } from './SkyMoodSheet';
