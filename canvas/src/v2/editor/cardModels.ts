import type { SelectionVerb } from '@/shortcuts/defaultShortcuts';
import { isLockedObject, selectionTitle, type ResolvedSelection, type SelectionKind } from '@dnd/core/src/store/selectionResolve';

// Pure models of the selection cards' rows (CardActions.tsx, MixedCard.tsx), kept apart so
// the components' files export components only.

export type CardAction = SelectionVerb | 'more';

const FLIPPABLE = new Set(['asset', 'shape', 'water', 'wall']);
const ROTATABLE = new Set(['asset', 'text', 'shape', 'water', 'wall', 'zone']);

/** The buttons the row shows for a selection, in order. Pure. */
export function cardActions(sel: ResolvedSelection): CardAction[] {
  const members = [
    ...sel.children.map(({ child }) => ({ kind: child.childType as string, locked: isLockedObject(child) })),
    ...sel.walls.map(({ wall }) => ({ kind: 'wall', locked: isLockedObject(wall) })),
  ];
  const rooms = sel.rooms.length;
  if (members.length === 0) return rooms > 0 ? ['delete', 'more'] : [];
  const unlocked = members.filter((m) => !m.locked);
  const anyLocked = unlocked.length < members.length;
  if (rooms === 0 && unlocked.length === 0) return ['unlock', 'more'];
  if (rooms === 0 && members.every((m) => m.kind === 'door')) {
    return anyLocked ? ['unlock', 'delete', 'more'] : ['delete', 'more'];
  }
  const out: CardAction[] = [];
  if (unlocked.some((m) => FLIPPABLE.has(m.kind))) out.push('flipH', 'flipV');
  if (unlocked.some((m) => ROTATABLE.has(m.kind))) out.push('rotate');
  if (members.some((m) => m.kind !== 'door')) out.push('duplicate');
  if (unlocked.length > 0) out.push('lock');
  if (anyLocked) out.push('unlock');
  out.push('hide');
  if (unlocked.length > 0 || rooms > 0) out.push('delete');
  out.push('more');
  return out;
}


export interface MixedModel {
  title: string;
  /** Members the arrange verbs move: unlocked, with a box, not a door, not a room. */
  arrangeable: number;
  locked: number;
  hasProps: boolean;
  /** The one layer every child and wall sits on, or null. */
  layerId: string | null;
  kinds: [SelectionKind, number][];
}

export const KIND_LABEL: Record<SelectionKind, string> = {
  asset: 'Props',
  light: 'Lights',
  text: 'Labels',
  shape: 'Floors',
  water: 'Water',
  wall: 'Walls',
  door: 'Doors',
  zone: 'Zones',
  room: 'Rooms',
};

/** What the mixed card shows for a resolved selection. Pure. */
export function mixedModel(sel: ResolvedSelection): MixedModel {
  const arrangeable =
    sel.children.filter(({ child }) => child.childType !== 'door' && !isLockedObject(child)).length +
    sel.walls.filter(({ wall }) => !isLockedObject(wall)).length;
  const layers = new Set([...sel.children.map((c) => c.layer.id), ...sel.walls.map((w) => w.layer.id)]);
  return {
    title: selectionTitle(sel.kinds),
    arrangeable,
    locked: sel.locked.length,
    hasProps: (sel.kinds.asset ?? 0) > 0,
    layerId: layers.size === 1 ? [...layers][0] : null,
    kinds: (Object.entries(sel.kinds) as [SelectionKind, number][]).filter(([, n]) => n > 0),
  };
}

