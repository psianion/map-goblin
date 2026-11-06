// The Objects family (plan 6.3): Stamp and Scatter over one props brush, and the prop card.
// See under overhead is a view, not a brush setting: it lives in the View group of the
// top actions' menu.
//
// Not built yet, and deliberately not registered (plan 8.5):
//   - Live preview of the stamp tint in the library, and which assets take a colour: packs
//     do not declare colourable regions yet.
//   - Library tags and the Used filter: the asset panel's (step 8 and later).
//   - Save as prefab from a group card: serialising a group into a pack asset.
//   - Asset defaults for Casts shadow and Blocks light (a crate blocks, a rug does not):
//     packs do not declare them.

import { Box } from 'lucide-react';
import { defineFamily } from '@/editor/registry/define';
import type { CardDef } from '@/editor/registry/types';
import { scatterTool, stampTool } from './tools';
import { propCard } from './propCard';

export const objects = defineFamily({
  id: 'objects',
  label: 'Objects',
  icon: Box,
  key: 'O',
  tools: [stampTool, scatterTool],
});

export const OBJECTS_CARDS: readonly CardDef[] = [propCard];
