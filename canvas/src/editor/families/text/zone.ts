// The Zone tool and the zone card. A zone is where a trigger, an encounter or a note lives:
// a point, a circle or a rect. Its sheet (More) holds what happens there.

import { Crosshair } from 'lucide-react';
import { z } from 'zod';
import { useStore } from '@/store/store';
import type { ZoneChild, ZoneShape } from '@/store/types';
import { conditionZoneId } from '@dnd/core/src/shared/prep';
import { defineCard, defineCardField, defineSetting, defineTool } from '@/editor/registry/define';
import type { CardFieldDef } from '@/editor/registry/types';
import { SELECTION_VERBS } from '@/editor/families/select';
import { editChildren } from '@/editor/families/design/cardWrites';
import { ZoneNameField, ZonePlaceField, ZoneTriggersField } from './ZoneFields';

type Mode = ZoneChild['shape']['kind'];

const SHAPES: { value: Mode; label: string }[] = [
  { value: 'point', label: 'Point' },
  { value: 'circle', label: 'Circle' },
  { value: 'rect', label: 'Rect' },
];

/** The shape as a word, for the card. */
export const SHAPE_WORD: Record<Mode, string> = { point: 'Point', circle: 'Circle', rect: 'Rectangle' };

export const zoneShape = defineSetting<Mode>({
  id: 'zone.shape',
  label: 'Shape',
  schema: z.enum(['point', 'circle', 'rect']),
  default: 'point',
  home: 'dock',
  control: 'seg',
  section: 'Shape',
  options: SHAPES,
  path: 'zone.mode',
});

export const zoneTool = defineTool({
  id: 'zone',
  label: 'Zone',
  description: 'Where a trigger, encounter or note lives',
  icon: Crosshair,
  key: 'Z',
  engine: ['zone'],
  settings: [zoneShape],
  dock: [],
  hint: (s) => ({
    label: 'Zone',
    segments: [{ text: s.tools.settings.zone.mode === 'point' ? 'Click to place a point zone' : 'Drag to draw the zone' }],
  }),
});

/* ── The card ──────────────────────────────────────────── */

const field = <T>(def: Omit<CardFieldDef<'zone', T>, 'home'>) => defineCardField<'zone', T>({ ...def, home: 'card' });

const shapeSchema: z.ZodType<ZoneShape> = z.union([
  z.object({ kind: z.literal('point'), position: z.object({ x: z.number(), y: z.number() }) }),
  z.object({ kind: z.literal('circle'), position: z.object({ x: z.number(), y: z.number() }), radius: z.number().positive() }),
  z.object({ kind: z.literal('rect'), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
]);

const name = field<string>({
  id: 'card.zone.name',
  label: 'Name',
  schema: z.string(),
  default: '',
  control: 'custom',
  render: ZoneNameField,
  read: (z) => z.name,
  write: (_s, ids, raw) => {
    const next = raw.trim();
    if (next) editChildren('Rename zone', ids, (c) => (c.childType === 'zone' && c.name !== next ? { name: next } : null));
  },
});

const place = field<ZoneShape>({
  id: 'card.zone.place',
  label: 'Place',
  schema: shapeSchema,
  default: { kind: 'point', position: { x: 0, y: 0 } },
  control: 'custom',
  render: ZonePlaceField,
  read: (z) => z.shape,
  write: (_s, ids, shape) => editChildren('Zone shape', ids, (c) => (c.childType === 'zone' ? { shape } : null)),
});

const shapeWord = field<string>({
  id: 'card.zone.shape',
  label: 'Shape',
  schema: z.string(),
  default: '',
  control: 'readout',
  read: (z) => SHAPE_WORD[z.shape.kind],
  write: () => {},
});

const triggers = field<number>({
  id: 'card.zone.triggers',
  label: 'Triggers',
  schema: z.number().int().min(0),
  default: 0,
  control: 'custom',
  section: 'Prep',
  render: ZoneTriggersField,
  read: (z) => (useStore.getState().prep?.triggers ?? []).filter((t) => conditionZoneId(t.when) === z.id).length,
  write: () => {},
});

export const zoneCard = defineCard<'zone'>({
  kind: 'zone',
  title: (z) => z.name || 'Zone',
  verbs: SELECTION_VERBS,
  fields: [name, place, shapeWord, triggers],
});
