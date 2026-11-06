// Every family that has landed, and the cards for what they draw. The registry reads these;
// a family registers by being listed here.

import type { CardDef, FamilyDef } from '@/editor/registry/types';
import { DESIGN_CARDS, design } from './design';
import { terrain } from './terrain';
import { OBJECTS_CARDS, objects } from './objects';

export const families: readonly FamilyDef[] = [design, terrain, objects];

export const cards: readonly CardDef[] = [...DESIGN_CARDS, ...OBJECTS_CARDS];
