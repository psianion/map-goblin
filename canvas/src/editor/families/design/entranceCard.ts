// The cave mouth card, for a mouth the Door tool or Select picked in a plateau's or pit's cliff:
// Kit (the kit's mouths of its width, as pictures) and Width, and Delete, which closes the cliff.

import { Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { CliffEntrance } from '@/store/types';
import { defineCard, defineCardField } from '@/editor/registry/define';
import type { Verb } from '@/editor/registry/types';
import { DOOR_WIDTH_MAX } from '@/editor/models/selectionModel';
import { useStore } from '@/store/store';
import { deletePickedEntrance, entranceKitValue, pickEntranceKit, resizePickedEntrance } from './entranceModel';
import { EntranceKitField } from './StairsFields';

const kit = defineCardField<'entrance', string>({
  id: 'card.entrance.kit',
  label: 'Kit',
  schema: z.string(),
  default: '0',
  home: 'card',
  control: 'custom',
  render: EntranceKitField,
  read: () => entranceKitValue(useStore.getState()),
  write: (_store, _ids, value) => pickEntranceKit(value),
});

const width = defineCardField<'entrance', number>({
  id: 'card.entrance.width',
  label: 'Width',
  schema: z.number().int().min(1).max(DOOR_WIDTH_MAX),
  default: 2,
  home: 'card',
  control: 'stepper',
  range: { min: 1, max: DOOR_WIDTH_MAX, step: 1, unit: 'sq' },
  read: (o: CliffEntrance) => Math.round(o.to - o.from),
  write: (_store, ids, value) => resizePickedEntrance(ids, value),
});

const deleteEntrance: Verb = {
  id: 'delete',
  label: 'Delete',
  icon: Trash2,
  danger: true,
  run: (store) => deletePickedEntrance(store.getState().selection.selectedIds),
};

export const entranceCard = defineCard<'entrance'>({
  kind: 'entrance',
  title: () => 'Cave mouth',
  verbs: [deleteEntrance],
  fields: [kit, width],
});
