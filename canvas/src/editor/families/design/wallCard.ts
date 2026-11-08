// The drawn wall's card: Length, Type, Set (now editable: swap one wall from stone to
// timber without redrawing it), Corner style and Stones. Shadow waits for the renderer.

import { z } from 'zod';
import { useStore } from '@/store/store';
import { selectWallById } from '@/store/selectors';
import type { CornerStyle, MapBuilderStore, WallSegment } from '@/store/types';
import { polylineLength } from '@dnd/core/src/shared/wallResolve';
import { wallTypeGroup, GROUP_WALL_TYPE, type WallTypeGroup } from '@dnd/core/src/shared/wallLook';
import { wallStoneCount } from '@dnd/core/src/engine/wallNodeOverlay';
import { defineCard, defineCardField } from '@/editor/registry/define';
import { WALL_TYPE_CHOICES } from '@/editor/models/selectionModel';
import { editWalls } from './cardWrites';
import { EDITABLE_VERBS } from './verbs';
import { CORNER_STYLE_CHOICES, LAYER_SET, NO_SET, wallCornerStyleOf } from './wallLook';
import { SetField } from './WallFields';

const state = () => useStore.getState() as MapBuilderStore;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const length = defineCardField<'wall', string>({
  id: 'card.wall.length',
  label: 'Length',
  schema: z.string(),
  default: '',
  home: 'card',
  control: 'readout',
  read: (w) => `${fmt(polylineLength(w.points))} sq`,
  write: () => {},
});

const type = defineCardField<'wall', WallTypeGroup>({
  id: 'card.wall.type',
  label: 'Type',
  schema: z.enum(['solid', 'window', 'open']),
  default: 'solid',
  home: 'card',
  control: 'seg',
  options: WALL_TYPE_CHOICES.map(({ value, label }) => ({ value, label })),
  read: (w) => wallTypeGroup(w.wallType),
  // Picking the group a stored type already acts as keeps that type.
  write: (_store, ids, group) =>
    editWalls('Wall type', ids, (w) => (wallTypeGroup(w.wallType) === group ? null : { wallType: GROUP_WALL_TYPE[group] })),
});

function setValue(w: WallSegment): string {
  if (w.textureSetId === undefined) return LAYER_SET;
  return w.textureSetId === '' ? NO_SET : w.textureSetId;
}

const set = defineCardField<'wall', string>({
  id: 'card.wall.set',
  label: 'Set',
  schema: z.string().min(1),
  default: LAYER_SET,
  home: 'card',
  control: 'custom',
  render: SetField,
  read: setValue,
  write: (_store, ids, value) =>
    editWalls('Wall set', ids, () => ({
      textureSetId: value === LAYER_SET ? undefined : value === NO_SET ? '' : value,
    })),
});

const cornerStyle = defineCardField<'wall', CornerStyle>({
  id: 'card.wall.cornerStyle',
  label: 'Corner style',
  schema: z.enum(['rounded', 'sharp']),
  default: 'sharp',
  home: 'card',
  control: 'seg',
  options: CORNER_STYLE_CHOICES,
  read: (w) => wallCornerStyleOf(state(), w),
  write: (_store, ids, style) => editWalls('Corner style', ids, () => ({ cornerStyle: style })),
});

const stones = defineCardField<'wall', string>({
  id: 'card.wall.stones',
  label: 'Stones',
  schema: z.string(),
  default: '',
  home: 'card',
  control: 'readout',
  read: (w) => {
    const found = selectWallById(state(), w.id);
    const count = found ? wallStoneCount(found.layer, w) : null;
    return count === null ? 'Cave rock' : `${count} stones`;
  },
  write: () => {},
});

export const wallCard = defineCard<'wall'>({
  kind: 'wall',
  title: () => 'Wall',
  verbs: EDITABLE_VERBS,
  fields: [length, type, set, cornerStyle, stones],
});
