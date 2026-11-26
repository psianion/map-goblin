// Every light edit as one Command (one undo entry). Callers run `undoManager.execute()` on
// the result. The invariants a light keeps live here, so the card, the dock, the context
// menu and the canvas handles cannot write a light the renderer has to second-guess:
// bright edge <= dim edge, cone 10..360 degrees, animation speed 0.25..4, a motion's speed
// in range, a group name trimmed.

import type { LightChild } from '../shared/types';
import type { Command, Layer } from './types';
import { CompositeCommand, UpdateChildCommand } from './commands';
import { useStore } from './store';
import { SPIN_RPM, SWEEP_DEG_PER_SEC } from '../shared/lightMotion';
import { allLights, groupName, lightsInRoom, lightsOnProp, withGroupMates } from '../shared/lightSwitches';
import { lightStatePatch, type LightState } from '../shared/propLights';

/** The light fields an edit may write. `undefined` on a key removes it (back to its default). */
export type LightPatch = Partial<
  Pick<
    LightChild,
    | 'name'
    | 'visible'
    | 'color'
    | 'radius'
    | 'featherRadius'
    | 'intensity'
    | 'falloff'
    | 'position'
    | 'attachedTo'
    | 'cone'
    | 'animation'
    | 'throughWalls'
    | 'nightOnly'
    | 'darkness'
    | 'darkvisionSees'
    | 'tableOn'
    | 'embers'
    | 'group'
    | 'motion'
  >
>;

export const CONE_ANGLE = { min: 10, max: 360 } as const;
export const ANIMATION_SPEED = { min: 0.25, max: 4 } as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function findLight(layers: readonly Layer[], id: string): { layerId: string; light: LightChild } | null {
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) if (c.id === id && c.childType === 'light') return { layerId: layer.id, light: c };
  }
  return null;
}

/**
 * `patch` made legal against `light`: the bright edge never past the dim edge (moving the dim
 * edge in drags the bright one with it; pushing the bright edge out stops at the dim one),
 * radii never negative, the cone and the speed in range, a night-only window ordered.
 */
export function clampLightPatch(light: LightChild, patch: LightPatch): LightPatch {
  const out: LightPatch = { ...patch };
  if (out.radius !== undefined) out.radius = Math.max(0, out.radius);
  if (out.featherRadius !== undefined) out.featherRadius = Math.max(0, out.featherRadius);
  const radius = out.radius ?? light.radius;
  const feather = out.featherRadius ?? light.featherRadius;
  if (feather > radius) out.featherRadius = radius;
  if (out.intensity !== undefined) out.intensity = clamp(out.intensity, 0, 1);
  if (out.cone) {
    out.cone = {
      angle: clamp(out.cone.angle, CONE_ANGLE.min, CONE_ANGLE.max),
      direction: ((out.cone.direction % 360) + 360) % 360,
    };
  }
  if (out.animation) {
    out.animation = { ...out.animation, speed: clamp(out.animation.speed, ANIMATION_SPEED.min, ANIMATION_SPEED.max) };
  }
  if (out.nightOnly) {
    const a = clamp(out.nightOnly.min, 0, 1);
    const b = clamp(out.nightOnly.max, 0, 1);
    out.nightOnly = { min: Math.min(a, b), max: Math.max(a, b) };
  }
  if ('group' in out) out.group = groupName(out.group);
  if (out.motion?.kind === 'spin') {
    out.motion = { ...out.motion, rpm: clamp(out.motion.rpm, SPIN_RPM.min, SPIN_RPM.max) };
  } else if (out.motion?.kind === 'sweep') {
    out.motion = {
      ...out.motion,
      from: wrapDeg(out.motion.from),
      to: wrapDeg(out.motion.to),
      degPerSec: clamp(out.motion.degPerSec, SWEEP_DEG_PER_SEC.min, SWEEP_DEG_PER_SEC.max),
    };
  }
  return out;
}

const wrapDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** The values `light` holds now for each key `patch` writes. */
function beforeOf(light: LightChild, patch: LightPatch): LightPatch {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) before[key] = (light as unknown as Record<string, unknown>)[key];
  return before as LightPatch;
}

/**
 * One undo entry for an edit of light `id`, clamped (`clampLightPatch`). `before` is for a
 * gesture that previewed its values straight onto the store while dragging: pass the values
 * from before the drag, so undo lands where the gesture started. Null when there is no such
 * light or nothing to write.
 */
export function setLightFields(id: string, patch: LightPatch, before?: LightPatch, label = 'Edit light'): Command | null {
  const found = findLight(useStore.getState().layers, id);
  if (!found || Object.keys(patch).length === 0) return null;
  const after = clampLightPatch(found.light, patch);
  const prior = before ? { ...beforeOf(found.light, after), ...before } : beforeOf(found.light, after);
  return new UpdateChildCommand(label, found.layerId, id, prior, after);
}

/**
 * Turns a light into a darkness source or back. The radii stay; the colour is dropped from
 * play (a darkness source burns no colour, so the renderer ignores it) but kept stored, so
 * turning it back restores the light it was. Turning darkness off also clears
 * `darkvisionSees`, which only a darkness source reads.
 */
export function toggleDarkness(id: string): Command | null {
  const found = findLight(useStore.getState().layers, id);
  if (!found) return null;
  const on = !found.light.darkness;
  const patch: LightPatch = on ? { darkness: true } : { darkness: undefined, darkvisionSees: undefined };
  return setLightFields(id, patch, undefined, on ? 'Make darkness' : 'Make light');
}

/** Glues light `id` to asset `assetId`: it then moves with the asset and is deleted with it. */
export function attachLight(id: string, assetId: string): Command | null {
  return setLightFields(id, { attachedTo: assetId }, undefined, 'Attach light');
}

/** Frees light `id` from the asset it follows. Null when it follows nothing. */
export function detachLight(id: string): Command | null {
  const found = findLight(useStore.getState().layers, id);
  if (!found?.light.attachedTo) return null;
  return setLightFields(id, { attachedTo: undefined }, undefined, 'Detach light');
}

// ─── Switching: one click, every light it reaches, one undo step ─────────────

/** The fields a switch writes: on or off, and for Embers or On from a card, the embers flag. */
type SwitchPatch = Pick<LightChild, 'visible'> & { embers?: true | undefined };

/**
 * The lock rule for every switch: a light that is locked, or sits on a locked layer, is never
 * reached through another light (a group mate, a room). The ids passed in were picked on
 * purpose and are switched as given; the double-click paths below leave locked ones out
 * before they get here, as the editor's double-click on a locked light always has.
 */
const lockedOut = (layer: Layer, light: LightChild): boolean => light.locked === true || layer.locked;

/** One light's change in a switch. */
interface SwitchStep {
  layerId: string;
  id: string;
  before: Partial<LightChild>;
  after: Partial<LightChild>;
}

/**
 * What a switch of `ids` to `patch` changes: each picked light, and every light grouped with
 * one of them put to the same on or off (embers is the picked lights' own; a group mate keeps
 * its own). Locked mates are left alone (`lockedOut`), and lights already there are skipped.
 */
function switchSteps(ids: readonly string[], patch: SwitchPatch): SwitchStep[] {
  const layers = useStore.getState().layers;
  const picked = new Set(ids);
  const reach = new Set(withGroupMates(layers, ids));
  const steps: SwitchStep[] = [];
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) {
      if (c.childType !== 'light' || !reach.has(c.id)) continue;
      if (!picked.has(c.id) && lockedOut(layer, c)) continue;
      const withEmbers = picked.has(c.id) && 'embers' in patch;
      const after: Partial<LightChild> = withEmbers ? { visible: patch.visible, embers: patch.embers } : { visible: patch.visible };
      const before: Partial<LightChild> = withEmbers ? { visible: c.visible, embers: c.embers } : { visible: c.visible };
      const changed = (c.visible !== false) !== patch.visible || (withEmbers && !!c.embers !== !!patch.embers);
      if (changed) steps.push({ layerId: layer.id, id: c.id, before, after });
    }
  }
  return steps;
}

function stepsCommand(steps: readonly SwitchStep[], label: string): Command | null {
  const cmds = steps.map((s) => new UpdateChildCommand(label, s.layerId, s.id, s.before, s.after));
  if (cmds.length === 0) return null;
  return cmds.length === 1 ? cmds[0]! : new CompositeCommand(label, cmds);
}

/** One undo step that switches `ids` to `patch` with their groups (`switchSteps`). Null when nothing changes. */
export function switchLightsCommand(ids: readonly string[], patch: SwitchPatch, label: string): Command | null {
  return stepsCommand(switchSteps(ids, patch), label);
}

/** The lights in `lights` a double-click may switch: not locked, not on a locked layer. */
function unlockedOf(lights: readonly LightChild[]): LightChild[] {
  const lockedLayers = new Set(useStore.getState().layers.filter((l) => l.locked).map((l) => l.id));
  const layerOf = new Map<string, string>();
  for (const layer of useStore.getState().layers) {
    if (layer.type === 'dungeon') for (const c of layer.children) layerOf.set(c.id, layer.id);
  }
  return lights.filter((l) => !l.locked && !lockedLayers.has(layerOf.get(l.id) ?? ''));
}

/** "Switch light", or "Switch group Hall sconces" when the lights switched carry a group. */
function switchLabel(layers: readonly Layer[], ids: readonly string[]): string {
  const wanted = new Set(ids);
  const group = allLights(layers).find((l) => wanted.has(l.id) && groupName(l.group))?.group;
  return group ? `Switch group ${groupName(group)}` : 'Switch light';
}

/**
 * Light `id` on if it is off and off if it is on, with its group (a double-click). Null for an
 * unknown light, or a locked one.
 */
export function toggleLightCommand(id: string): Command | null {
  const layers = useStore.getState().layers;
  const found = findLight(layers, id);
  if (!found || unlockedOf([found.light]).length === 0) return null;
  return switchLightsCommand([id], { visible: found.light.visible === false }, switchLabel(layers, [id]));
}

/**
 * The lights attached to prop `propId`, with their groups (a double-click on the prop): all off
 * when any of them burns, all on when none does. Locked lights are left as they are. Null for a
 * prop with no unlocked attached light.
 */
export function toggleLightsOnPropCommand(propId: string): Command | null {
  const layers = useStore.getState().layers;
  const lights = unlockedOf(lightsOnProp(layers, propId));
  if (lights.length === 0) return null;
  const ids = lights.map((l) => l.id);
  const on = !lights.some((l) => l.visible !== false);
  return switchLightsCommand(ids, { visible: on }, switchLabel(layers, ids));
}

/** Light `ids` put to `state` (Off, Embers or On, as the card's State tiles pick), with their groups. */
export function setLightStateCommand(ids: readonly string[], state: LightState): Command | null {
  if (ids.length === 0) return null;
  return switchLightsCommand(ids, lightStatePatch(state), switchLabel(useStore.getState().layers, ids));
}

/**
 * Every light in room `roomId` on or off (`lightsInRoom`), darkness sources and locked lights
 * left alone. Group mates outside the room follow, as for any switch, and the label counts
 * every light that actually changes: "Switch room 3 lights".
 */
export function switchRoomCommand(roomId: string, on: boolean): Command | null {
  const { layers, levels } = useStore.getState();
  const lights = unlockedOf(lightsInRoom({ layers, levels }, roomId).filter((l) => !l.darkness));
  const steps = switchSteps(
    lights.map((l) => l.id),
    { visible: on },
  );
  return stepsCommand(steps, `Switch room ${steps.length} ${steps.length === 1 ? 'light' : 'lights'}`);
}

/**
 * Every light in group `from` takes the name `to` (trimmed), as one step: "Rename group Hall
 * to East hall". Typing a name on one light's card only moves that light; this is the group's
 * own rename. Null when nothing would change or `to` is empty.
 */
export function renameGroupCommand(from: string, to: string): Command | null {
  const old = groupName(from);
  const next = groupName(to);
  if (!old || !next || old === next) return null;
  const label = `Rename group ${old} to ${next}`;
  const cmds: Command[] = [];
  for (const layer of useStore.getState().layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) {
      if (c.childType === 'light' && groupName(c.group) === old) {
        cmds.push(new UpdateChildCommand(label, layer.id, c.id, { group: c.group }, { group: next }));
      }
    }
  }
  if (cmds.length === 0) return null;
  return cmds.length === 1 ? cmds[0]! : new CompositeCommand(label, cmds);
}
