// Every family that has landed, and the cards for what they draw. The registry reads these;
// a family registers by being listed here.

import type { CardDef, FamilyDef } from '@/editor/registry/types';
import { DESIGN_CARDS, design } from './design';
import { TERRAIN_CARDS, terrain } from './terrain';
import { OBJECTS_CARDS, objects } from './objects';
import { ENVIRONMENT_CARDS, environment } from './environment';
import { TEXT_CARDS, text } from './text';

export const families: readonly FamilyDef[] = [design, terrain, objects, environment, text];

export const cards: readonly CardDef[] = [...DESIGN_CARDS, ...TERRAIN_CARDS, ...OBJECTS_CARDS, ...ENVIRONMENT_CARDS, ...TEXT_CARDS];
