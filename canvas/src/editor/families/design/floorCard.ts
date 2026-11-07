// The floor card (frame D): Size and Layer, then Look (Colour with Reset, Texture with
// Change, Tint, Opacity, the Fill fold), then Edge (Edge band). Colour shows for floors
// without a texture, Tint and Fill for textured ones: each row only where it changes something.

import { z } from 'zod';
import { selectLayerForChild } from '@/store/selectors';
import { createMoveToLayerCommand } from '@dnd/core/src/store/propEdits';
import { getChildBounds } from '@dnd/core/src/engine/hitTest';
import { hasLiveTexture } from '@dnd/core/src/assets/packCatalog';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, DungeonStyle, ShapeChild } from '@/store/types';
import { defineCard, defineCardField } from '@/editor/registry/define';
import { floorColorOf, degToRad, TEXTURE_SCALE_RANGE } from '@/editor/models/selectionModel';
import { editChildren, editKey } from './cardWrites';
import { EDITABLE_VERBS } from './verbs';
import { edgeBandOf, fillOf, layerBandOf, pickedFloors, state, type FillValue } from './floorModel';
import { ColourField, EdgeBandField, FillField, LayerField, TextureField } from './FloorFields';

const styleOf = (o: ShapeChild): DungeonStyle | undefined => selectLayerForChild(state(), o.id)?.style;
const fmtSq = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/* ── Size and layer ────────────────────────────────────── */

const size = defineCardField<'shape', string>({
  id: 'card.floor.size',
  label: 'Size',
  schema: z.string(),
  default: '',
  home: 'card',
  control: 'readout',
  read: (o) => {
    const b = getChildBounds(o);
    return `${fmtSq(b.width)} × ${fmtSq(b.height)} sq`;
  },
  write: () => {},
});

const layer = defineCardField<'shape', string>({
  id: 'card.floor.layer',
  label: 'Layer',
  schema: z.string(),
  default: '',
  home: 'card',
  control: 'custom',
  render: LayerField,
  read: (o) => selectLayerForChild(state(), o.id)?.id ?? '',
  write: (_store, ids, layerId) => {
    const cmd = createMoveToLayerCommand([...ids], layerId);
    if (cmd) undoManager.execute(cmd);
  },
});

/* ── Look ──────────────────────────────────────────────── */

const colour = defineCardField<'shape', string>({
  id: 'card.floor.colour',
  label: 'Colour',
  schema: z.string(),
  default: '#ffffff',
  home: 'card',
  control: 'custom',
  section: 'Look',
  render: ColourField,
  visibleWhen: (o) => !hasLiveTexture(o.textureId),
  read: (o) => {
    const style = styleOf(o);
    return style ? floorColorOf(o, style) : '#ffffff';
  },
  // Pins only the floors it paints: a colour under a texture shows nowhere.
  write: (_store, ids, value) =>
    editChildren(
      'Floor colour',
      ids,
      (c) =>
        c.childType === 'shape' && !hasLiveTexture(c.textureId)
          ? { styleOverrides: { ...(c.styleOverrides ?? {}), floorColor: value } }
          : null,
      editKey('floor.colour', ids),
    ),
});

const texture = defineCardField<'shape', string>({
  id: 'card.floor.texture',
  label: 'Texture',
  schema: z.string(),
  default: '',
  home: 'card',
  control: 'custom',
  section: 'Look',
  render: TextureField,
  read: (o) => o.textureId ?? '',
  write: (_store, ids, textureId) => editChildren('Set Texture', ids, () => ({ textureId: textureId || undefined })),
});

const tint = defineCardField<'shape', string>({
  id: 'card.floor.tint',
  label: 'Tint',
  schema: z.string(),
  default: '#ffffff',
  home: 'card',
  control: 'colour',
  section: 'Look',
  visibleWhen: (o) => hasLiveTexture(o.textureId),
  read: (o) => o.textureTint,
  write: (_store, ids, value) =>
    editChildren(
      'Texture tint',
      ids,
      (c) => (c.childType === 'shape' && hasLiveTexture(c.textureId) ? { textureTint: value } : null),
      editKey('floor.tint', ids),
    ),
});

/** The floor's fill and texture alpha; its walls, band, props and lights keep theirs. */
const opacity = defineCardField<'shape', number>({
  id: 'card.floor.opacity',
  label: 'Opacity',
  schema: z.number().min(0).max(1),
  default: 1,
  home: 'card',
  control: 'slider',
  section: 'Look',
  range: { min: 0, max: 1, step: 0.05, unit: '%' },
  read: (o) => o.opacity ?? 1,
  // Full opacity is the default, so it is stored as nothing.
  write: (_store, ids, v) =>
    editChildren('Floor opacity', ids, () => ({ opacity: v < 1 ? v : undefined }), editKey('floor.opacity', ids)),
});

/* ── Fill ──────────────────────────────────────────────── */

const fill = defineCardField<'shape', FillValue>({
  id: 'card.floor.fill',
  label: 'Fill',
  schema: z.object({ scale: z.number().min(TEXTURE_SCALE_RANGE.min).max(TEXTURE_SCALE_RANGE.max), rotate: z.number(), x: z.number(), y: z.number() }),
  default: { scale: 1, rotate: 0, x: 0, y: 0 },
  home: 'card',
  control: 'custom',
  section: 'Look',
  render: FillField,
  visibleWhen: (o) => hasLiveTexture(o.textureId),
  read: fillOf,
  // Writes only what moved from the first floor's value, so a mixed pick keeps the rest.
  write: (_store, ids, v) => {
    const head = pickedFloors(ids)[0];
    if (!head) return;
    const now = fillOf(head);
    const patch: Partial<ShapeChild> = {};
    if (v.scale !== now.scale) patch.textureScale = v.scale;
    if (v.rotate !== now.rotate) patch.textureFillRotation = degToRad(v.rotate);
    if (v.x !== now.x) patch.textureOffsetX = v.x;
    if (v.y !== now.y) patch.textureOffsetY = v.y;
    editChildren('Texture fill', ids, (c) => (c.childType === 'shape' ? patch : null), editKey('floor.fill', ids));
  },
});

/* ── Edge ──────────────────────────────────────────────── */

/** None or a band; the layer's own band unpins it, so the floor follows its layer again. */
const edgeBand = defineCardField<'shape', string | null>({
  id: 'card.floor.edgeBand',
  label: 'Edge band',
  schema: z.string().nullable(),
  default: null,
  home: 'card',
  control: 'custom',
  section: 'Edge',
  render: EdgeBandField,
  read: edgeBandOf,
  write: (_store, ids, v) =>
    editChildren('Edge band', ids, (c) => {
      const layer = selectLayerForChild(state(), c.id);
      return { edgeBand: v === layerBandOf(layer?.type === 'dungeon' ? (layer as DungeonLayer) : null) ? undefined : v };
    }),
});

export const floorCard = defineCard<'shape'>({
  kind: 'shape',
  title: () => 'Floor',
  verbs: EDITABLE_VERBS,
  fields: [size, layer, colour, texture, tint, opacity, fill, edgeBand],
});
