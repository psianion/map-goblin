// The path card: Width, Smoothness, the transitions at each end and Block light, editable
// after placing, with Node mode first on the action row. Every row writes every picked path
// as one undo step and shows the first; a slider drag folds into one.

import { z } from 'zod';
import type { PathwayChild } from '@/store/types';
import { PATH_RANGES } from '@/store/slices/tools';
import { defineCard, defineCardField } from '@/editor/registry/define';
import { editChildren, editKey } from '@/editor/families/design/cardWrites';
import { EDITABLE_VERBS } from '@/editor/families/design/verbs';
import { TRANSITION_IN_OPTIONS, TRANSITION_OUT_OPTIONS } from './path';

const { width, smoothness } = PATH_RANGES;

const patchPaths = (label: string, ids: readonly string[], patch: Partial<PathwayChild>, coalesce?: string) =>
  editChildren(label, ids, (c) => (c.childType === 'pathway' ? patch : null), coalesce);

const pathWidth = defineCardField<'pathway', number>({
  id: 'card.path.width',
  label: 'Width',
  schema: z.number().min(width.min).max(width.max),
  default: 1,
  home: 'card',
  control: 'stepper',
  range: { ...width, unit: 'sq' },
  read: (p) => p.width,
  write: (_store, ids, v) => patchPaths('Path width', ids, { width: v }),
});

const pathSmoothness = defineCardField<'pathway', number>({
  id: 'card.path.smoothness',
  label: 'Smoothness',
  schema: z.number().min(smoothness.min).max(smoothness.max),
  default: 0.6,
  home: 'card',
  control: 'slider',
  range: { ...smoothness, unit: '%' },
  read: (p) => p.smoothness,
  write: (_store, ids, v) => patchPaths('Path smoothness', ids, { smoothness: v }, editKey('path.smoothness', ids)),
});

const transitionIn = defineCardField<'pathway', PathwayChild['transitionIn']>({
  id: 'card.path.transitionIn',
  label: 'Transition in',
  schema: z.enum(['hard', 'fade', 'grow']),
  default: 'fade',
  home: 'card',
  control: 'seg',
  options: TRANSITION_IN_OPTIONS,
  read: (p) => p.transitionIn,
  write: (_store, ids, v) => patchPaths('Path transition', ids, { transitionIn: v }),
});

const transitionOut = defineCardField<'pathway', PathwayChild['transitionOut']>({
  id: 'card.path.transitionOut',
  label: 'Transition out',
  schema: z.enum(['hard', 'fade', 'shrink']),
  default: 'hard',
  home: 'card',
  control: 'seg',
  options: TRANSITION_OUT_OPTIONS,
  read: (p) => p.transitionOut,
  write: (_store, ids, v) => patchPaths('Path transition', ids, { transitionOut: v }),
});

const blocksLight = defineCardField<'pathway', boolean>({
  id: 'card.path.blocksLight',
  label: 'Block light',
  schema: z.boolean(),
  default: false,
  home: 'card',
  control: 'switch',
  read: (p) => p.blocksLight,
  write: (_store, ids, v) => patchPaths('Block light', ids, { blocksLight: v }),
});

export const pathCard = defineCard({
  kind: 'pathway',
  title: () => 'Path',
  verbs: EDITABLE_VERBS,
  fields: [pathWidth, pathSmoothness, transitionIn, transitionOut, blocksLight],
});
