// The stairs card, for a flight the Door tool picked on a plateau's or pit's edge: Kit and Width,
// and Delete, which takes the flight off and closes the cliff again.

import { Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { StairSpan } from '@/store/types';
import { defineCard, defineCardField } from '@/editor/registry/define';
import type { Verb } from '@/editor/registry/types';
import { DOOR_WIDTH_MAX } from '@/editor/models/selectionModel';
import { DEFAULT_STAIRS, deletePickedStairs, pickStairKit, resizePickedStairs } from './stairsModel';
import { StairKitField } from './StairsFields';

const kit = defineCardField<'stairs', string>({
  id: 'card.stairs.kit',
  label: 'Kit',
  schema: z.string(),
  default: DEFAULT_STAIRS,
  home: 'card',
  control: 'custom',
  render: StairKitField,
  read: (o: StairSpan) => o.kit ?? DEFAULT_STAIRS,
  write: (_store, _ids, value) => pickStairKit(value),
});

const width = defineCardField<'stairs', number>({
  id: 'card.stairs.width',
  label: 'Width',
  schema: z.number().int().min(1).max(DOOR_WIDTH_MAX),
  default: 1,
  home: 'card',
  control: 'stepper',
  range: { min: 1, max: DOOR_WIDTH_MAX, step: 1, unit: 'sq' },
  read: (o: StairSpan) => Math.round(o.to - o.from),
  write: (_store, ids, value) => resizePickedStairs(ids, value),
});

const deleteStairs: Verb = {
  id: 'delete',
  label: 'Delete',
  icon: Trash2,
  danger: true,
  run: (store) => deletePickedStairs(store.getState().selection.selectedIds),
};

export const stairsCard = defineCard<'stairs'>({
  kind: 'stairs',
  title: () => 'Stairs',
  verbs: [deleteStairs],
  fields: [kit, width],
});
