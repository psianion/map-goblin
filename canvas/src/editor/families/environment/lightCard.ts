// The light card: the Light tool's fields on a placed light, Attach or Detach as verbs, and
// under a Table caption only On at the table. Bright and Dim in feet; a drag lands as one step.
// For prop lights: the attached prop's State tiles first, a Motion section for a cone (Still,
// Spin or Sweep with their speeds and edges), and a Group row. Over several lights (Select
// group, a box) it edits all of them: each field shows the shared value or "Mixed", a set lands
// on every one as one step, and a mixed Direction or sweep edge turns them all by the same
// amount so the beams keep their spread.

import { Link2, Unlink2 } from 'lucide-react';
import { z } from 'zod';
import { useStore } from '@/store/store';
import { selectChildById, selectLayerForChild } from '@/store/selectors';
import type { Command, LightChild, MapBuilderStore } from '@/store/types';
import { attachLight, detachLight } from '@dnd/core/src/store/lightCommands';
import { undoManager } from '@/store/undoManager';
import { defineCard, defineCardField } from '@/editor/registry/define';
import type { CardFieldDef, EditorState, Verb } from '@/editor/registry/types';
import { SELECTION_VERBS } from '@/editor/families/select';
import { editKey } from '@/editor/families/design/cardWrites';
import { nearestProp } from './lightModel';
import { FeetRow } from './LightControls';
import { AttachedRow, ConeNote, EdgeStepper, GroupField, LightStateField, MotionKindField, RotateByRow, SpinDirectionField } from './LightCardFields';
import { editLights as edit, editMotion, lightsOf, lightsTitle, rotateLights, stopLights } from './lightEdits';
import { hostStates } from './lightHosts';
import { SPIN_RPM, SWEEP_DEG_PER_SEC } from '@dnd/core/src/shared/lightMotion';
import {
  SPIN_DEFAULT_RPM,
  SWEEP_DEFAULT_DEG_PER_SEC,
  motionFor,
  motionKindOf,
  type MotionKind,
} from './lightModel';
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

const field = <T>(def: Omit<CardFieldDef<'light', T>, 'home'>) => defineCardField<'light', T>({ ...def, home: 'card' });

const bright = field<number>({
  id: 'card.light.bright',
  label: 'Bright',
  schema: z.number().min(LIGHT_RADIUS_FT.min).max(LIGHT_RADIUS_FT.max),
  default: 5,
  control: 'custom',
  range: { ...LIGHT_RADIUS_FT, unit: 'ft' },
  render: FeetRow,
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
  render: FeetRow,
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
  control: 'colour',
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
  // Typed as well as dragged, so a round angle such as 60° is always reachable.
  typed: true,
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
  // A sweep's two edges stand in for it.
  visibleWhen: (l) => coneAngle(l) < 360 && motionKindOf(l) !== 'sweep',
  read: coneDirection,
  write: (_s, ids, d) => edit('Direction', ids, (l) => ({ cone: { angle: coneAngle(l), direction: d } }), editKey('light.direction', ids)),
  // Lights pointing different ways turn together by the same amount.
  mixed: { render: RotateByRow, write: (_s, ids, turn) => rotateLights(ids, 'direction', turn) },
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

/** The State tiles of the prop the light is attached to, at the top of the card. */
const lightState = field<null>({
  id: 'card.light.state',
  label: 'State',
  schema: z.null(),
  default: null,
  control: 'custom',
  render: LightStateField,
  visibleWhen: (l) => !!hostStates(l),
  read: () => null,
  write: () => {},
});

/** A light fixed to a prop: "Attached to <prop>" and Select prop, under the State tiles. */
const attached = field<null>({
  id: 'card.light.attached',
  label: 'Attached',
  schema: z.null(),
  default: null,
  control: 'custom',
  render: AttachedRow,
  visibleWhen: (l) => !!l.attachedTo,
  read: () => null,
  write: () => {},
});

/** Under a full circle's Cone: a moving light needs a cone. */
const coneNote = field<null>({
  id: 'card.light.coneNote',
  label: 'Cone note',
  schema: z.null(),
  default: null,
  control: 'custom',
  section: 'Shape',
  render: ConeNote,
  visibleWhen: (l) => coneAngle(l) >= 360,
  read: () => null,
  write: () => {},
});

const motion = field<MotionKind>({
  id: 'card.light.motion',
  label: 'Motion',
  schema: z.enum(['still', 'spin', 'sweep']),
  default: 'still',
  control: 'custom',
  section: 'Motion',
  render: MotionKindField,
  visibleWhen: (l) => coneAngle(l) < 360,
  read: motionKindOf,
  write: (_s, ids, kind) => {
    // Still: every beam stops where it is drawn now.
    if (kind === 'still') {
      stopLights(ids);
      return;
    }
    // Several lights take one pace and way round (the first already moving so sets them), each
    // from where it points now: a group spins or sweeps in step, keeping its spread.
    const lights = lightsOf(ids);
    const base = lights.find((l) => l.motion?.kind === kind)?.motion ?? motionFor(kind, lights[0] ?? {});
    editMotion(kind === 'spin' ? 'Spin light' : 'Sweep light', ids, (l) => {
      const own = motionFor(kind, l);
      if (!own || lights.length < 2) return own;
      if (own.kind === 'spin' && base?.kind === 'spin') return { ...own, rpm: base.rpm, clockwise: base.clockwise };
      if (own.kind === 'sweep' && base?.kind === 'sweep') return { ...own, degPerSec: base.degPerSec };
      return own;
    });
  },
});

const moving = (kind: MotionKind) => (l: LightChild) => coneAngle(l) < 360 && motionKindOf(l) === kind;

const spinWay = field<boolean>({
  id: 'card.light.spinWay',
  label: 'Way round',
  schema: z.boolean(),
  default: true,
  control: 'custom',
  section: 'Motion',
  render: SpinDirectionField,
  visibleWhen: moving('spin'),
  read: (l) => (l.motion?.kind === 'spin' ? l.motion.clockwise : true),
  write: (_s, ids, clockwise) => editMotion('Spin direction', ids, (l) => (l.motion?.kind === 'spin' ? { ...l.motion, clockwise } : null)),
});

const spinSpeed = field<number>({
  id: 'card.light.spinSpeed',
  label: 'Speed',
  schema: z.number().min(SPIN_RPM.min).max(SPIN_RPM.max),
  default: SPIN_DEFAULT_RPM,
  control: 'slider',
  section: 'Motion',
  range: { ...SPIN_RPM, unit: 'rpm' },
  visibleWhen: moving('spin'),
  read: (l) => (l.motion?.kind === 'spin' ? l.motion.rpm : SPIN_DEFAULT_RPM),
  write: (_s, ids, rpm) =>
    editMotion('Spin speed', ids, (l) => (l.motion?.kind === 'spin' ? { ...l.motion, rpm } : null), editKey('light.spinSpeed', ids)),
});

const sweepSpeed = field<number>({
  id: 'card.light.sweepSpeed',
  label: 'Speed',
  schema: z.number().min(SWEEP_DEG_PER_SEC.min).max(SWEEP_DEG_PER_SEC.max),
  default: SWEEP_DEFAULT_DEG_PER_SEC,
  control: 'slider',
  section: 'Motion',
  range: { ...SWEEP_DEG_PER_SEC, unit: '°/s' },
  visibleWhen: moving('sweep'),
  read: (l) => (l.motion?.kind === 'sweep' ? l.motion.degPerSec : SWEEP_DEFAULT_DEG_PER_SEC),
  write: (_s, ids, degPerSec) =>
    editMotion('Sweep speed', ids, (l) => (l.motion?.kind === 'sweep' ? { ...l.motion, degPerSec } : null), editKey('light.sweepSpeed', ids)),
});

const sweepEdge = (edge: 'from' | 'to', label: string) =>
  field<number>({
    id: `card.light.sweep.${edge}`,
    label,
    schema: z.number().min(0).max(359),
    default: 0,
    control: 'custom',
    section: 'Motion',
    range: { min: 0, max: 359, step: 5, unit: '°' },
    render: EdgeStepper,
    visibleWhen: moving('sweep'),
    read: (l) => (l.motion?.kind === 'sweep' ? l.motion[edge] : 0),
    write: (_s, ids, deg) => editMotion('Sweep edge', ids, (l) => (l.motion?.kind === 'sweep' ? { ...l.motion, [edge]: deg } : null)),
    // Edges that differ turn together by the same amount, as Direction does.
    mixed: { render: RotateByRow, write: (_s, ids, turn) => rotateLights(ids, edge, turn) },
  });

const group = field<string>({
  id: 'card.light.group',
  label: 'Group',
  schema: z.string(),
  default: '',
  control: 'custom',
  section: 'Group',
  render: GroupField,
  read: (l) => l.group ?? '',
  write: (_s, ids, name) => edit(name.trim() ? 'Join group' : 'Leave group', ids, () => ({ group: name.trim() || undefined })),
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
  multi: { title: lightsTitle },
  verbs: [attach, detach, ...SELECTION_VERBS],
  fields: [
    lightState,
    attached,
    bright,
    dim,
    intensity,
    colour,
    cone,
    coneNote,
    direction,
    motion,
    spinWay,
    spinSpeed,
    sweepSpeed,
    sweepEdge('from', 'From'),
    sweepEdge('to', 'To'),
    effect,
    speed,
    group,
    throughWalls,
    tableOn,
  ],
});
