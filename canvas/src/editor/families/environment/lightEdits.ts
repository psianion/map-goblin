// How the light card writes, for one light or several: one patch per picked light as one undo
// step, labelled with the group's name when the pick is exactly one group ("Watch: colour"), and
// the turns a mixed Direction or sweep edge makes (every light by the same amount, so beams keep
// their spread). A motion edit anchors every light at one moment (`anchoredMotion`), so beams
// that turned together keep turning together and none of them jumps.

import { useStore } from '@/store/store';
import { selectChildById } from '@/store/selectors';
import type { Command, LightChild, MapBuilderStore } from '@/store/types';
import { setLightFields, type LightPatch } from '@dnd/core/src/store/lightCommands';
import { anchoredMotion, coneAt, isMoving, motionTime } from '@dnd/core/src/shared/lightMotion';
import { runEdit } from '@/editor/families/design/cardWrites';
import { exactGroup, groupSelectIds } from '@/canvas/linkModel';
import { coneAngle, coneDirection } from './lightModel';

const state = () => useStore.getState() as MapBuilderStore;

/** The picked lights among `ids`, in pick order. */
export function lightsOf(ids: readonly string[]): LightChild[] {
  return ids.map((id) => selectChildById(state(), id)).filter((c): c is LightChild => c?.childType === 'light');
}

/** "Light colour" as a group's undo label reads it: "colour". */
function noun(label: string): string {
  return label
    .replace(/^Light /, '')
    .replace(/ light$/, '')
    .toLowerCase();
}

/** `label`, or "Watch: colour" when `ids` are exactly the lights of one group. */
export function editLabel(label: string, ids: readonly string[]): string {
  const group = ids.length > 1 ? exactGroup(state().layers, ids) : null;
  return group ? `${group}: ${noun(label)}` : label;
}

/** A patch per picked light, as one step; with `coalesce`, a drag folds into one. */
export function editLights(label: string, ids: readonly string[], patch: (l: LightChild) => LightPatch, coalesce?: string): void {
  const named = editLabel(label, ids);
  const cmds = lightsOf(ids)
    .map((l) => setLightFields(l.id, patch(l), undefined, named))
    .filter((c): c is Command => c !== null);
  runEdit(named, cmds, coalesce);
}

/**
 * A motion patch per picked light, each anchored at the same moment so its beam goes on from
 * where it points now (`anchoredMotion`); `next` returns the light's new motion, or null to
 * leave that light alone.
 */
export function editMotion(
  label: string,
  ids: readonly string[],
  next: (l: LightChild) => LightChild['motion'] | null,
  coalesce?: string,
): void {
  const now = motionTime();
  editLights(
    label,
    ids,
    (l) => {
      const m = next(l);
      if (m === null) return {};
      return { motion: m ? anchoredMotion(l, m, now) : undefined };
    },
    coalesce,
  );
}

/**
 * Motion off on every picked light, as one step: each moving beam keeps the angle it is drawn
 * at now (one `now` for all), written into its direction, so a lighthouse stops where it is
 * instead of snapping back. The turn is kept in whole degrees, the same for beams that turned
 * together, so their spread stays exact.
 */
export function stopLights(ids: readonly string[]): void {
  const now = motionTime();
  editLights('Stop moving', ids, (l) => {
    if (!isMoving(l)) return { motion: undefined };
    const turn = Math.round(coneAt(l, now)!.direction - l.cone!.direction);
    return { motion: undefined, cone: { angle: l.cone!.angle, direction: wrap(l.cone!.direction + turn) } };
  });
}

/** How far one press of a rotate-by turns every picked light, degrees. */
export const ROTATE_STEP = 15;

/** Every light of group `name` picked, so the light card edits them all together. */
export function selectGroup(name: string): void {
  useStore.getState().setSelectedIds(groupSelectIds(state().layers, name));
}

const wrap = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;

/** What a rotate-by turns: the cone's direction, or one edge of a sweep. */
export type TurnTarget = 'direction' | 'from' | 'to';

/** Every picked light turned by `delta` degrees on `target`, as one step: the spread between them stays. */
export function rotateLights(ids: readonly string[], target: TurnTarget, delta: number): void {
  if (!Number.isFinite(delta) || wrap(delta) === 0) return;
  if (target === 'direction') {
    editLights('Direction', ids, (l) => (coneAngle(l) < 360 ? { cone: { angle: coneAngle(l), direction: wrap(coneDirection(l) + delta) } } : {}));
    return;
  }
  editMotion('Sweep edge', ids, (l) => (l.motion?.kind === 'sweep' ? { ...l.motion, [target]: wrap(l.motion[target] + delta) } : null));
}

/** The light card's title over several lights: "Watch, 4 lights" when they are exactly one group, else "4 lights". */
export function lightsTitle(lights: readonly LightChild[]): string {
  const count = `${lights.length} ${lights.length === 1 ? 'light' : 'lights'}`;
  const group = exactGroup(
    state().layers,
    lights.map((l) => l.id),
  );
  return group ? `${group}, ${count}` : count;
}
