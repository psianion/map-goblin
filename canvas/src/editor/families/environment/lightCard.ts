// The light card: the Light tool's fields on a placed light, Attach or Detach as verbs, and
// under a Table caption only On at the table. Bright and Dim in feet; a drag lands as one step.

import { Link2, Unlink2 } from 'lucide-react';
import { z } from 'zod';
import { useStore } from '@/store/store';
import { selectChildById, selectLayerForChild } from '@/store/selectors';
import type { Command, LightChild, MapBuilderStore } from '@/store/types';
import { attachLight, detachLight, setLightFields, type LightPatch } from '@dnd/core/src/store/lightCommands';
import { undoManager } from '@/store/undoManager';
import { defineCard, defineCardField } from '@/editor/registry/define';
import type { CardFieldDef, EditorState, Verb } from '@/editor/registry/types';
import { SELECTION_VERBS } from '@/editor/families/select';
import { editKey, runEdit } from '@/editor/families/design/cardWrites';
import { nearestProp } from '@/v2/editor/lightModel';
import { ColourSwatch, FeetStepper } from './LightControls';
import {
  CONE_RANGE,
  DIRECTION_RANGE,
  EFFECTS,
  INTENSITY_RANGE,
  LIGHT_RADIUS_FT,
  SPEED_RANGE,
  animationFor,
  brightPatch,
  coneAngle,
  coneDirection,
  conePatch,
  dimPatch,
  effectOf,
  speedOf,
  toFt,
  type Effect,
} from './lightModel';

const state = () => useStore.getState() as MapBuilderStore;
const ftPerCell = () => state().mapSettings.cellScale.value;

function lightsOf(ids: readonly string[]): LightChild[] {
  return ids.map((id) => selectChildById(state(), id)).filter((c): c is LightChild => c?.childType === 'light');
}

/** A patch per picked light, as one step; with `coalesce`, a drag folds into one. */
function edit(label: string, ids: readonly string[], patch: (l: LightChild) => LightPatch, coalesce?: string): void {
  const cmds = lightsOf(ids)
    .map((l) => setLightFields(l.id, patch(l), undefined, label))
    .filter((c): c is Command => c !== null);
  runEdit(label, cmds, coalesce);
}

const field = <T>(def: Omit<CardFieldDef<'light', T>, 'home'>) => defineCardField<'light', T>({ ...def, home: 'card' });

const bright = field<number>({
  id: 'card.light.bright',
  label: 'Bright',
  schema: z.number().min(LIGHT_RADIUS_FT.min).max(LIGHT_RADIUS_FT.max),
  default: 5,
  control: 'custom',
  range: { ...LIGHT_RADIUS_FT, unit: 'ft' },
  render: FeetStepper,
  read: (l) => toFt(l.featherRadius, ftPerCell()),
  write: (_s, ids, ft) => edit('Bright', ids, (l) => brightPatch(l, ft, ftPerCell())),
});

const dim = field<number>({
  id: 'card.light.dim',
  label: 'Dim',
  schema: z.number().min(LIGHT_RADIUS_FT.min).max(LIGHT_RADIUS_FT.max),
  default: 30,
  control: 'custom',
  range: { ...LIGHT_RADIUS_FT, unit: 'ft' },
  render: FeetStepper,
  read: (l) => toFt(l.radius, ftPerCell()),
  write: (_s, ids, ft) => edit('Dim', ids, (l) => dimPatch(l, ft, ftPerCell())),
});

const intensity = field<number>({
  id: 'card.light.intensity',
  label: 'Intensity',
  schema: z.number().min(0).max(1),
  default: 0.9,
  control: 'slider',
  range: { ...INTENSITY_RANGE, unit: '%' },
  read: (l) => l.intensity,
  write: (_s, ids, v) => edit('Intensity', ids, () => ({ intensity: v }), editKey('light.intensity', ids)),
});

const colour = field<string>({
  id: 'card.light.colour',
  label: 'Colour',
  schema: z.string().regex(/^#[0-9a-f]{6}$/i),
  default: '#ffdd88',
  control: 'custom',
  render: ColourSwatch,
  // A darkness source burns no colour.
  visibleWhen: (l) => !l.darkness,
  read: (l) => l.color,
  write: (_s, ids, c) => edit('Light colour', ids, () => ({ color: c }), editKey('light.colour', ids)),
});

const cone = field<number>({
  id: 'card.light.cone',
  label: 'Cone',
  schema: z.number().min(CONE_RANGE.min).max(CONE_RANGE.max),
  default: 360,
  control: 'slider',
  section: 'Shape',
  range: { ...CONE_RANGE, unit: '°' },
  read: coneAngle,
  write: (_s, ids, angle) => edit('Cone', ids, (l) => conePatch(l, angle), editKey('light.cone', ids)),
});

const direction = field<number>({
  id: 'card.light.direction',
  label: 'Direction',
  schema: z.number().min(0).max(359),
  default: 0,
  control: 'slider',
  section: 'Shape',
  range: { ...DIRECTION_RANGE, unit: '°' },
  visibleWhen: (l) => coneAngle(l) < 360,
  read: coneDirection,
  write: (_s, ids, d) => edit('Direction', ids, (l) => ({ cone: { angle: coneAngle(l), direction: d } }), editKey('light.direction', ids)),
});

const effect = field<Effect>({
  id: 'card.light.effect',
  label: 'Effect',
  schema: z.enum(['none', 'flicker', 'pulse']),
  default: 'none',
  control: 'seg',
  section: 'Effect',
  options: EFFECTS,
  read: effectOf,
  write: (_s, ids, e) => edit('Effect', ids, (l) => ({ animation: animationFor(e, speedOf(l)) })),
});

const speed = field<number>({
  id: 'card.light.speed',
  label: 'Speed',
  schema: z.number().min(SPEED_RANGE.min).max(SPEED_RANGE.max),
  default: 1,
  control: 'slider',
  section: 'Effect',
  range: { ...SPEED_RANGE, unit: '×' },
  visibleWhen: (l) => effectOf(l) !== 'none',
  read: speedOf,
  write: (_s, ids, v) => edit('Effect speed', ids, (l) => ({ animation: animationFor(effectOf(l), v) }), editKey('light.speed', ids)),
});

const throughWalls = field<boolean>({
  id: 'card.light.throughWalls',
  label: 'Through walls',
  schema: z.boolean(),
  default: false,
  control: 'switch',
  section: 'Reach',
  read: (l) => l.throughWalls === true,
  write: (_s, ids, on) => edit('Through walls', ids, () => ({ throughWalls: on ? true : undefined })),
});

const tableOn = field<boolean>({
  id: 'card.light.tableOn',
  label: 'On at the table',
  schema: z.boolean(),
  default: true,
  control: 'switch',
  section: 'Table',
  read: (l) => l.tableOn !== false,
  write: (_s, ids, on) => edit('On at the table', ids, () => ({ tableOn: on ? undefined : false })),
});

/** The one picked light, if exactly one is. */
function soleLight(s: EditorState): LightChild | null {
  const ids = s.selection.selectedIds;
  if (ids.length !== 1) return null;
  const c = selectChildById(s as MapBuilderStore, ids[0]);
  return c?.childType === 'light' ? c : null;
}

/** The prop a free light would glue to: the nearest on its layer within half a cell. */
function propNear(s: EditorState, light: LightChild) {
  const layer = selectLayerForChild(s as MapBuilderStore, light.id);
  return layer ? nearestProp(layer, light) : null;
}

const run = (cmd: Command | null) => {
  if (cmd) undoManager.execute(cmd);
};

const attach: Verb = {
  id: 'attachLight',
  label: 'Attach to the prop under it',
  icon: Link2,
  when: (s) => {
    const l = soleLight(s);
    return !!l && !l.attachedTo && propNear(s, l) !== null;
  },
  run: (store) => {
    const l = soleLight(store.getState());
    const prop = l ? propNear(store.getState(), l) : null;
    if (l && prop) run(attachLight(l.id, prop.id));
  },
};

const detach: Verb = {
  id: 'detachLight',
  label: 'Detach from its prop',
  icon: Unlink2,
  when: (s) => !!soleLight(s)?.attachedTo,
  run: (store) => {
    const l = soleLight(store.getState());
    if (l) run(detachLight(l.id));
  },
};

export const lightCard = defineCard<'light'>({
  kind: 'light',
  title: (l) => l.name || (l.darkness ? 'Darkness' : 'Light'),
  verbs: [attach, detach, ...SELECTION_VERBS],
  fields: [bright, dim, intensity, colour, cone, direction, effect, speed, throughWalls, tableOn],
});
