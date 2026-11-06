// The door card: Name, Style, State, Opens to, Secret, Width, Angle, then the kit fields
// (Material, Hinge, Swing, Hinges). Material and the hanging rows list only the door kits
// an installed pack ships the art for; with none installed they are not shown at all.

import { z } from 'zod';
import { selectLayerForChild } from '@/store/selectors';
import { CompositeCommand, UpdateChildCommand, UpdateWallCommand } from '@/store/commands';
import type { AnyChild, DoorChild, DoorStyle } from '@/store/types';
import { resolveDoors, resolveWalls } from '@dnd/core/src/shared/wallResolve';
import { turnOwnPiece } from '@dnd/core/src/shared/doorwaySeal';
import { doorwayEditCommand } from '@dnd/core/src/store/doorwayCommands';
import { doorAngleValue, doorStyleLabel, PLACEABLE_DOOR_STYLES } from '@dnd/core/src/engine/tools/DoorTool';
import { doorKitById, isKitStyle, MAX_OPEN_ANGLE, type DoorKitId } from '@dnd/core/src/assets/doorKits';
import { defineCard, defineCardField } from '@/editor/registry/define';
import { cleanDoorName, DOOR_HINGES, DOOR_STATES, DOOR_SWINGS, doorModel, doorStyleChange, OPEN_ANGLE_STEP, swingChoice, swingValue, type DoorMaterial } from '@/v2/editor/selectionModel';
import { editChildren, editKey, runEdit } from './cardWrites';
import { SELECTION_VERBS } from './verbs';
import { doorDeg, doorHost, installedDoorKits, liveKit, state } from './doorModel';
import { AngleField, MaterialField, NameField, WidthField } from './DoorFields';

/* ── Name, style, state ────────────────────────────────── */

const name = defineCardField<'door', string>({
  id: 'card.door.name',
  label: 'Name',
  schema: z.string(),
  default: '',
  home: 'card',
  control: 'custom',
  render: NameField,
  read: (o) => o.name,
  write: (_store, ids, raw) => editChildren('Rename door', ids, (c) => {
    const next = cleanDoorName(raw, c.name);
    return next === null ? null : { name: next };
  }),
});

/** A wall door can also be a portal (it draws from pack art), so the menu offers it too. */
const STYLES: DoorStyle[] = [...PLACEABLE_DOOR_STYLES, 'portal'];

const style = defineCardField<'door', DoorStyle>({
  id: 'card.door.style',
  label: 'Style',
  schema: z.enum(STYLES as [DoorStyle, ...DoorStyle[]]),
  default: 'single',
  home: 'card',
  control: 'select',
  options: STYLES.map((value) => ({ value, label: doorStyleLabel(value) })),
  read: (o) => o.style,
  // The width follows the style, and the walls around a doorway follow the width.
  write: (_store, ids, next) => {
    const cmds = ids.flatMap((id) => {
      const host = doorHost(state(), id);
      if (!host || host.door.style === next) return [];
      const { after } = doorStyleChange(host.door, next, host.room);
      const cmd = doorwayEditCommand('Door style', host.layer, id, { style: host.door.style }, { style: next }, {
        width: (after as Partial<DoorChild>).width,
      });
      return cmd ? [cmd] : [];
    });
    runEdit('Door style', cmds);
  },
});

const doorState = defineCardField<'door', DoorChild['state']>({
  id: 'card.door.state',
  label: 'State',
  schema: z.enum(['closed', 'open', 'locked']),
  default: 'closed',
  home: 'card',
  control: 'seg',
  options: DOOR_STATES,
  // An archway cannot be shut, so it has no state to set.
  visibleWhen: (o) => o.style !== 'archway',
  read: (o) => o.state,
  write: (_store, ids, next) => editChildren('Door state', ids, (c) => (c.childType === 'door' ? { state: next } : null)),
});

const opensTo = defineCardField<'door', number>({
  id: 'card.door.opensTo',
  label: 'Opens to',
  schema: z.number().min(0).max(MAX_OPEN_ANGLE),
  default: 90,
  home: 'card',
  control: 'slider',
  range: { min: 0, max: MAX_OPEN_ANGLE, step: OPEN_ANGLE_STEP, unit: '°' },
  visibleWhen: (o) => o.style !== 'archway' && liveKit(o) !== null,
  read: (o) => {
    const host = doorHost(state(), o.id);
    return doorModel(o, host?.room ?? Infinity, host?.wallSetId).kit?.openAngle ?? 90;
  },
  write: (_store, ids, v) => editChildren('Door opening', ids, () => ({ openAngle: v }), editKey('door.opensTo', ids)),
});

const secret = defineCardField<'door', boolean>({
  id: 'card.door.secret',
  label: 'Secret',
  schema: z.boolean(),
  default: false,
  home: 'card',
  control: 'switch',
  read: (o) => o.isSecret,
  write: (_store, ids, on) => editChildren(on ? 'Make door secret' : 'Make door plain', ids, () => ({ isSecret: on })),
});

/* ── Width and angle ───────────────────────────────────── */

const width = defineCardField<'door', number>({
  id: 'card.door.width',
  label: 'Width',
  schema: z.number().positive(),
  default: 1,
  home: 'card',
  control: 'custom',
  render: WidthField,
  read: (o) => o.width,
  // Each tick is computed from the layer as it stands, and the drag folds into one step.
  write: (_store, ids, w) => {
    const cmds = ids.flatMap((id) => {
      const host = doorHost(state(), id);
      const cmd = host ? doorwayEditCommand('Door width', host.layer, id, {}, {}, { width: w }) : null;
      return cmd ? [cmd] : [];
    });
    runEdit('Door width', cmds, editKey('door.width', ids));
  },
});

const angle = defineCardField<'door', number>({
  id: 'card.door.angle',
  label: 'Angle',
  schema: z.number().min(0).max(179),
  default: 0,
  home: 'card',
  control: 'custom',
  render: AngleField,
  read: (o) => {
    const layer = selectLayerForChild(state(), o.id);
    const r = layer ? resolveDoors(layer, resolveWalls(layer)).find((x) => x.door.id === o.id) : undefined;
    return doorDeg(r?.angle ?? 0);
  },
  // Its piece of wall turns about the door's centre, with the door, as one step.
  write: (_store, ids, deg) => {
    const cmds = ids.flatMap((id) => {
      const layer = selectLayerForChild(state(), id);
      const door = layer?.children.find((c): c is DoorChild => c.id === id && c.childType === 'door');
      const turn = layer && turnOwnPiece(layer, id, (doorAngleValue(deg) * Math.PI) / 180);
      if (!layer || !door || !turn) return [];
      return [
        new CompositeCommand('Turn door', [
          new UpdateWallCommand(layer.id, turn.wallId, { points: turn.before }, { points: turn.after }),
          new UpdateChildCommand('Turn door', layer.id, id, { angle: door.angle, position: door.position } as Partial<AnyChild>, turn.door as Partial<AnyChild>),
        ]),
      ];
    });
    runEdit('Turn door', cmds);
  },
});

/* ── Kit ───────────────────────────────────────────────── */

const material = defineCardField<'door', string>({
  id: 'card.door.material',
  label: 'Material',
  schema: z.string().min(1),
  default: 'auto',
  home: 'card',
  control: 'custom',
  section: 'Kit',
  render: MaterialField,
  visibleWhen: (o) => isKitStyle(o.style) && installedDoorKits().length > 0,
  read: (o) => (doorKitById(o.kit) ? (o.kit as string) : 'auto'),
  write: (_store, ids, v) =>
    editChildren('Door material', ids, (c) =>
      c.childType === 'door' ? { kit: v === 'auto' ? undefined : (v as DoorMaterial as DoorKitId) } : null,
    ),
});

const hinge = defineCardField<'door', 'start' | 'end'>({
  id: 'card.door.hinge',
  label: 'Hinge',
  schema: z.enum(['start', 'end']),
  default: 'start',
  home: 'card',
  control: 'seg',
  section: 'Kit',
  options: DOOR_HINGES.map(({ value, label }) => ({ value, label })),
  // A double hangs on both edges, so only a single has a hinge side.
  visibleWhen: (o) => o.style === 'single' && liveKit(o) !== null,
  read: (o) => o.hinge ?? 'start',
  write: (_store, ids, v) => editChildren('Door hinge', ids, (c) => (c.childType === 'door' ? { hinge: v } : null)),
});

const swing = defineCardField<'door', 'normal' | 'reversed'>({
  id: 'card.door.swing',
  label: 'Swing',
  schema: z.enum(['normal', 'reversed']),
  default: 'normal',
  home: 'card',
  control: 'seg',
  section: 'Kit',
  options: DOOR_SWINGS.map(({ value, label }) => ({ value, label })),
  visibleWhen: (o) => liveKit(o) !== null,
  read: (o) => swingChoice(o.swing === -1 ? -1 : 1),
  write: (_store, ids, v) => editChildren('Door swing', ids, (c) => (c.childType === 'door' ? { swing: swingValue(v) } : null)),
});

const hinges = defineCardField<'door', boolean>({
  id: 'card.door.hinges',
  label: 'Hinges',
  schema: z.boolean(),
  default: true,
  home: 'card',
  control: 'switch',
  section: 'Kit',
  visibleWhen: (o) => liveKit(o) !== null,
  read: (o) => o.hinges !== false,
  write: (_store, ids, on) => editChildren(on ? 'Show hinges' : 'Hide hinges', ids, () => ({ hinges: on })),
});

export const doorCard = defineCard<'door'>({
  kind: 'door',
  title: (o) => o.name || doorStyleLabel(o.style),
  // A door rides its wall: it is not flipped, turned or copied on its own (cardActions).
  verbs: SELECTION_VERBS,
  fields: [name, style, doorState, opensTo, secret, width, angle, material, hinge, swing, hinges],
});
