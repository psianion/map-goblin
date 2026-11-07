// The prop card: Transform, Look (Tint, Opacity), Layering (the four order steps, Overhead,
// Below water, Lock), Variant with Replace, Behaviour (Casts shadow, Blocks light and sight). Glows and
// Blocks movement are gone from it: an attached light glows better, and nothing reads
// movement yet. Old maps that carry either still load; the map format drops them in step 13.

import { z } from 'zod';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { createPropBoxCommand, createSetPropFieldsCommand, createSwapPropCommand } from '@dnd/core/src/store/propEdits';
import { propField, type PropFieldKey } from '@dnd/core/src/shared/propFields';
import { undoManager } from '@/store/undoManager';
import type { AssetChild, Command } from '@/store/types';
import { defineCard, defineCardField } from '@/editor/registry/define';
import { SELECTION_VERBS } from '@/editor/families/select';
import { editKey, runEdit } from '@/editor/families/design/cardWrites';
import { propBoxModel } from '@/editor/models/selectionModel';
import { boxOf, pickedProps, type BoxValue } from './propModel';
import { OrderField, TransformField, VariantField } from './PropFields';

type FieldPatch = Partial<Pick<AssetChild, PropFieldKey | 'tint'>>;

/** One field on every picked prop; with `coalesce`, a drag lands as one undo step. */
function setFields(ids: readonly string[], patch: FieldPatch, coalesce?: string): void {
  const cmd = createSetPropFieldsCommand([...ids], patch);
  if (cmd) runEdit(cmd.label, [cmd], coalesce);
}

const run = (cmd: Command | null) => {
  if (cmd) undoManager.execute(cmd);
};

const sw = (id: string, label: string, key: PropFieldKey, section: string) =>
  defineCardField<'asset', boolean>({
    id,
    label,
    schema: z.boolean(),
    default: false,
    home: 'card',
    control: 'switch',
    section,
    read: (o) => propField(o, key) as boolean,
    write: (_store, ids, on) => setFields(ids, { [key]: on }),
  });

const transform = defineCardField<'asset', BoxValue>({
  id: 'card.prop.transform',
  label: 'Transform',
  schema: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), angle: z.number() }),
  default: { x: 0, y: 0, w: 1, h: 1, angle: 0 },
  home: 'card',
  control: 'custom',
  section: 'Transform',
  render: TransformField,
  read: () => boxOf(pickedProps()),
  // From the props' exact box, not the rounded one the row shows, so nothing creeps.
  write: (_store, ids, to) => {
    const props = pickedProps().filter((p) => ids.includes(p.id));
    if (props.length === 0) return;
    const b = propBoxModel(props);
    const angle = typeof b.angle === 'number' ? b.angle : 0;
    run(createPropBoxCommand([...ids], { x: b.x, y: b.y, w: b.w, h: b.h, angle }, { x: to.x, y: to.y, w: to.w, h: to.h, angle: (to.angle * Math.PI) / 180 }));
  },
});

const tint = defineCardField<'asset', string>({
  id: 'card.prop.tint',
  label: 'Tint',
  schema: z.string().regex(/^#[0-9a-f]{6}$/i),
  default: '#ffffff',
  home: 'card',
  control: 'colour',
  section: 'Look',
  read: (o) => o.tint || '#ffffff',
  write: (_store, ids, c) => setFields(ids, { tint: c }, editKey('prop.tint', ids)),
});

const opacity = defineCardField<'asset', number>({
  id: 'card.prop.opacity',
  label: 'Opacity',
  schema: z.number().min(0).max(1),
  default: 1,
  home: 'card',
  control: 'slider',
  section: 'Look',
  range: { min: 0, max: 1, step: 0.01, unit: '%' },
  read: (o) => propField(o, 'opacity'),
  write: (_store, ids, v) => setFields(ids, { opacity: v }, editKey('prop.opacity', ids)),
});

const order = defineCardField<'asset', null>({
  id: 'card.prop.order',
  label: 'Order',
  schema: z.null(),
  default: null,
  home: 'card',
  control: 'custom',
  section: 'Layering',
  render: OrderField,
  read: () => null,
  write: () => {},
});

const variant = defineCardField<'asset', string>({
  id: 'card.prop.variant',
  label: 'Variant',
  schema: z.string().min(1),
  default: 'asset',
  home: 'card',
  control: 'custom',
  section: 'Variant',
  render: VariantField,
  // An imported image has no family to step through.
  visibleWhen: (o) => o.objectType === 'asset',
  read: (o) => o.assetId,
  write: (_store, ids, id) => run(createSwapPropCommand([...ids], id, 'footprint')),
});

export const propCard = defineCard<'asset'>({
  kind: 'asset',
  title: (o) => o.name || getCatalogEntry(o.assetId)?.label || 'Prop',
  verbs: SELECTION_VERBS,
  fields: [
    transform,
    tint,
    opacity,
    order,
    sw('card.prop.overhead', 'Overhead', 'overhead', 'Layering'),
    sw('card.prop.belowWater', 'Below water', 'belowWater', 'Layering'),
    sw('card.prop.lock', 'Lock', 'locked', 'Layering'),
    variant,
    sw('card.prop.castsShadow', 'Casts shadow', 'castsShadow', 'Behaviour'),
    sw('card.prop.blocksLight', 'Blocks light and sight', 'blocksLight', 'Behaviour'),
  ],
});
