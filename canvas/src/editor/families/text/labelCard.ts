// The label card: its text, what it follows (with Unbind), Style, Size, Colour, Weight,
// Backdrop, Align, Angle and Visible to players. Each change re-measures the label's box and
// is one undo step; a size or colour drag folds into one.

import { z } from 'zod';
import { useStore } from '@/store/store';
import type { DungeonLayer, MapBuilderStore, TextChild } from '@/store/types';
import { defineCard, defineCardField } from '@/editor/registry/define';
import type { CardFieldDef } from '@/editor/registry/types';
import { SELECTION_VERBS } from '@/editor/families/select';
import { editChildren, editKey } from '@/editor/families/design/cardWrites';
import { FollowsField, LabelTextField, SizeRow } from './LabelControls';
import { CUSTOM, LABEL_SIZE_RANGE, STYLE_OPTIONS, clampSize, stylePatch, withBox, type StyleChoice } from './labelModel';
import { selectLayerForChild } from '@/store/selectors';

const field = <T>(def: Omit<CardFieldDef<'text', T>, 'home'>) => defineCardField<'text', T>({ ...def, home: 'card' });

/** Every picked label gets `patch`, its box re-measured. */
function edit(label: string, ids: readonly string[], patch: (c: TextChild) => Partial<TextChild>, coalesce?: string): void {
  editChildren(label, ids, (c) => (c.childType === 'text' ? withBox(c, patch(c)) : null), coalesce);
}

/** The name of what a bound label follows, live. */
function followedName(label: TextChild): string {
  const b = label.bound;
  if (!b) return '';
  for (const l of (useStore.getState() as MapBuilderStore).layers) {
    if (l.type !== 'dungeon') continue;
    const layer = l as DungeonLayer;
    if (b.kind === 'room') {
      const room = layer.rooms?.find((r) => r.id === b.id);
      if (room) return room.name || 'a room';
    } else {
      const door = layer.children.find((c) => c.id === b.id && c.childType === 'door');
      if (door) return door.name || 'a door';
    }
  }
  return '';
}

const text = field<string>({
  id: 'card.label.text',
  label: 'Text',
  schema: z.string(),
  default: '',
  control: 'custom',
  render: LabelTextField,
  read: (c) => c.text,
  write: () => {},
});

const follows = field<string>({
  id: 'card.label.follows',
  label: 'Follows',
  schema: z.string(),
  default: '',
  control: 'custom',
  render: FollowsField,
  visibleWhen: (c) => Boolean(c.bound),
  read: followedName,
  write: () => {},
});

const style = field<StyleChoice>({
  id: 'card.label.style',
  label: 'Style',
  schema: z.enum([CUSTOM, 'room-name', 'door-tag', 'gm-note', 'number-pin', 'callout']),
  default: CUSTOM,
  control: 'select',
  section: 'Style',
  options: STYLE_OPTIONS,
  read: (c) => c.style ?? CUSTOM,
  write: (_s, ids, choice) =>
    editChildren('Label style', ids, (c) => {
      if (c.childType !== 'text') return null;
      const layer = selectLayerForChild(useStore.getState(), c.id);
      return layer ? stylePatch(c, choice, layer.id) : null;
    }),
});

const size = field<number>({
  id: 'card.label.size',
  label: 'Size',
  schema: z.number().min(LABEL_SIZE_RANGE.min).max(LABEL_SIZE_RANGE.max),
  default: 0.8,
  control: 'custom',
  section: 'Style',
  range: { ...LABEL_SIZE_RANGE, unit: 'sq' },
  render: SizeRow,
  read: (c) => c.fontSize,
  write: (_s, ids, v) => edit('Label size', ids, () => ({ fontSize: clampSize(v) }), editKey('label.size', ids)),
});

const colour = field<string>({
  id: 'card.label.colour',
  label: 'Colour',
  schema: z.string().regex(/^#[0-9a-f]{6}$/i),
  default: '#222222',
  control: 'colour',
  section: 'Style',
  read: (c) => c.color,
  write: (_s, ids, v) => edit('Label colour', ids, () => ({ color: v }), editKey('label.colour', ids)),
});

const weight = field<'regular' | 'bold'>({
  id: 'card.label.weight',
  label: 'Weight',
  schema: z.enum(['regular', 'bold']),
  default: 'regular',
  control: 'seg',
  section: 'Style',
  options: [
    { value: 'regular', label: 'Regular' },
    { value: 'bold', label: 'Bold' },
  ],
  read: (c) => c.weight ?? 'regular',
  write: (_s, ids, v) => edit('Label weight', ids, () => ({ weight: v === 'bold' ? 'bold' : undefined })),
});

const backdrop = field<'none' | 'halo' | 'pill'>({
  id: 'card.label.backdrop',
  label: 'Backdrop',
  schema: z.enum(['none', 'halo', 'pill']),
  default: 'none',
  control: 'seg',
  section: 'Style',
  options: [
    { value: 'none', label: 'None' },
    { value: 'halo', label: 'Halo' },
    { value: 'pill', label: 'Pill' },
  ],
  read: (c) => c.backdrop ?? 'none',
  write: (_s, ids, v) => edit('Label backdrop', ids, () => ({ backdrop: v === 'none' ? undefined : v })),
});

const align = field<'left' | 'centre' | 'right'>({
  id: 'card.label.align',
  label: 'Align',
  schema: z.enum(['left', 'centre', 'right']),
  default: 'centre',
  control: 'seg',
  section: 'Style',
  options: [
    { value: 'left', label: 'Left' },
    { value: 'centre', label: 'Centre' },
    { value: 'right', label: 'Right' },
  ],
  read: (c) => c.align ?? 'centre',
  write: (_s, ids, v) => edit('Label align', ids, () => ({ align: v === 'centre' ? undefined : v })),
});

const angle = field<number>({
  id: 'card.label.angle',
  label: 'Angle',
  schema: z.number().min(0).max(359),
  default: 0,
  control: 'stepper',
  section: 'Style',
  range: { min: 0, max: 345, step: 15, unit: '°' },
  read: (c) => ((Math.round((c.rotation * 180) / Math.PI) % 360) + 360) % 360,
  write: (_s, ids, deg) => edit('Label angle', ids, () => ({ rotation: (deg * Math.PI) / 180 })),
});

const players = field<boolean>({
  id: 'card.label.players',
  label: 'Visible to players',
  schema: z.boolean(),
  default: false,
  control: 'switch',
  section: 'Visibility',
  read: (c) => c.players === true,
  write: (_s, ids, on) => edit('Visible to players', ids, () => ({ players: on ? true : undefined })),
});

export const labelCard = defineCard<'text'>({
  kind: 'text',
  title: (c) => c.name || 'Label',
  verbs: SELECTION_VERBS,
  fields: [text, follows, style, size, colour, weight, backdrop, align, angle, players],
});
